-- ==============================================================================
-- UNIVERSAL AI ASSISTANT & KHAZNA WEB APP - COMPLETE SUPABASE SQL SCHEMA
-- ==============================================================================
-- Paste this entire script into your Supabase SQL Editor:
-- Supabase Dashboard -> Your Project -> SQL Editor -> New Query -> Run
-- Safe & Idempotent: Uses IF NOT EXISTS, safe constraints, and additive indexes.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 1. AI ASSISTANT CHAT SESSIONS & CONVERSATION HISTORY
-- ==============================================================================

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL DEFAULT 'khazna-ledger',
  title TEXT NOT NULL DEFAULT 'New Conversation',
  summary TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_conv_user_app ON assistant_conversations (user_id, app_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_msgs_conv_ts ON assistant_messages (conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_assistant_msgs_user ON assistant_messages (user_id);

-- ==============================================================================
-- 2. USER PREFERENCES & INTELLIGENT SUGGESTION CHIPS (CTR TRACKING)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS assistant_user_profile (
  user_id TEXT PRIMARY KEY,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  answer_style TEXT NOT NULL DEFAULT 'concise' CHECK (answer_style IN ('concise', 'detailed', 'step-by-step')),
  notes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assistant_chip_usage (
  user_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  chip_id TEXT NOT NULL,
  shown_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TIMESTAMPTZ NULL,
  PRIMARY KEY (user_id, chip_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_chip_usage_lookup ON assistant_chip_usage (user_id, page_id);

-- ==============================================================================
-- 3. AUDIT LOGGING & SECURITY TRACKING
-- ==============================================================================

CREATE TABLE IF NOT EXISTS assistant_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_audit_user_ts ON assistant_audit_logs (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_tool ON assistant_audit_logs (tool);

-- Tool Execution Action Logs (Supports Pending Confirmations and Undo)
CREATE TABLE IF NOT EXISTS assistant_action_logs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('read', 'write')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'executed', 'failed', 'undone', 'cancelled')),
  summary TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NULL,
  created_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ NULL,
  undone_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_action_logs_app_user ON assistant_action_logs (app_id, user_id, created_at DESC);

-- ==============================================================================
-- 4. RAG KNOWLEDGE BASE & VECTOR EMBEDDINGS (pgvector 1536 dims)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS assistant_chunks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  source TEXT NOT NULL,
  heading TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'manager', 'admin')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_chunks_app_vis ON assistant_chunks (app_id, visibility);

-- HNSW Vector Index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_assistant_chunks_embedding 
ON assistant_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- RPC Function: Match chunks by cosine similarity
CREATE OR REPLACE FUNCTION match_assistant_chunks (
  query_embedding vector(1536),
  filter_app_id text,
  match_count int DEFAULT 5,
  min_similarity float DEFAULT 0.0
)
RETURNS TABLE (
  id text,
  app_id text,
  source text,
  heading text,
  chunk_index int,
  content text,
  token_count int,
  visibility text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id,
    ac.app_id,
    ac.source,
    ac.heading,
    ac.chunk_index,
    ac.content,
    ac.token_count,
    ac.visibility,
    ac.metadata,
    1 - (ac.embedding <=> query_embedding) AS similarity
  FROM assistant_chunks ac
  WHERE ac.app_id = filter_app_id
    AND 1 - (ac.embedding <=> query_embedding) >= min_similarity
  ORDER BY ac.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RPC Function: Scoped matching with role visibility filtering
CREATE OR REPLACE FUNCTION match_assistant_chunks_scoped (
  query_embedding vector(1536),
  filter_app_id text,
  allowed_visibilities text[],
  match_count int DEFAULT 5,
  min_similarity float DEFAULT 0.0
)
RETURNS TABLE (
  id text,
  app_id text,
  source text,
  heading text,
  chunk_index int,
  content text,
  token_count int,
  visibility text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ac.id,
    ac.app_id,
    ac.source,
    ac.heading,
    ac.chunk_index,
    ac.content,
    ac.token_count,
    ac.visibility,
    ac.metadata,
    1 - (ac.embedding <=> query_embedding) AS similarity
  FROM assistant_chunks ac
  WHERE ac.app_id = filter_app_id
    AND ac.visibility = ANY(allowed_visibilities)
    AND 1 - (ac.embedding <=> query_embedding) >= min_similarity
  ORDER BY ac.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ==============================================================================
-- 5. MULTI-TENANT BILLING, SUBSCRIPTIONS & CREDITS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS organization (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
  plan_interval TEXT NULL CHECK (plan_interval IN ('monthly', 'annual')),
  premium_started_at TIMESTAMPTZ NULL,
  premium_expires_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_credit_balance (
  org_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  credits_remaining INTEGER NOT NULL DEFAULT 100 CHECK (credits_remaining >= 0),
  credits_monthly_allowance INTEGER NOT NULL DEFAULT 100 CHECK (credits_monthly_allowance >= 0),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  action_feature TEXT NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  idempotency_key TEXT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL DEFAULT TRUE,
  refunded BOOLEAN NOT NULL DEFAULT FALSE,
  error_reason TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_org_ts ON ai_usage_log (org_id, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_log_idempotency ON ai_usage_log (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscription (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  interval TEXT NOT NULL CHECK (interval IN ('monthly', 'annual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  provider TEXT NULL,
  provider_ref TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_org_status ON subscription (org_id, status);

CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'premium' CHECK (plan IN ('free', 'premium')),
  interval TEXT NOT NULL CHECK (interval IN ('monthly', 'annual')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  provider TEXT NOT NULL DEFAULT 'razorpay',
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT NULL,
  method TEXT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'refunded')),
  idempotency_key TEXT NULL,
  error_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_org_created ON payment (org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_org_idempotency ON payment (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_webhook_event (
  event_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  order_id TEXT NULL,
  payment_id TEXT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_audit_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 6. APP ENTITY DATA TABLES (KHAZNA CAMPUS LEDGER / LIBRARY)
-- ==============================================================================

-- Students (Campus Ledger)
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  phone TEXT NULL,
  email TEXT NULL,
  guardian TEXT NULL,
  organization_id TEXT NOT NULL,
  sector_id TEXT NULL,
  pending_fee NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  paid_total NUMERIC NOT NULL DEFAULT 0,
  debit_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_org_sec ON students (organization_id, sector_id);
CREATE INDEX IF NOT EXISTS idx_students_search ON students (name, phone, email);

-- Books (Library System)
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT NULL,
  shelf TEXT NULL,
  copies INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  organization_id TEXT NOT NULL DEFAULT 'default-org',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_search ON books (title, author, isbn);

-- Loans (Library System)
CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  book_title TEXT NOT NULL,
  member_name TEXT NOT NULL,
  member_id TEXT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  returned BOOLEAN NOT NULL DEFAULT FALSE,
  organization_id TEXT NOT NULL DEFAULT 'default-org',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loans_org_returned ON loans (organization_id, returned);

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) & SERVICE ROLE PERMISSIONS
-- ==============================================================================

-- Enable RLS across all tables
ALTER TABLE assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_user_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_chip_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

-- Service Role Bypass (The AI backend connects with service_role key)
DROP POLICY IF EXISTS "Service role full access on assistant_conversations" ON assistant_conversations;
CREATE POLICY "Service role full access on assistant_conversations" ON assistant_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on assistant_messages" ON assistant_messages;
CREATE POLICY "Service role full access on assistant_messages" ON assistant_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on assistant_user_profile" ON assistant_user_profile;
CREATE POLICY "Service role full access on assistant_user_profile" ON assistant_user_profile FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on assistant_chip_usage" ON assistant_chip_usage;
CREATE POLICY "Service role full access on assistant_chip_usage" ON assistant_chip_usage FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on assistant_audit_logs" ON assistant_audit_logs;
CREATE POLICY "Service role full access on assistant_audit_logs" ON assistant_audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on assistant_action_logs" ON assistant_action_logs;
CREATE POLICY "Service role full access on assistant_action_logs" ON assistant_action_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on assistant_chunks" ON assistant_chunks;
CREATE POLICY "Service role full access on assistant_chunks" ON assistant_chunks FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on organization" ON organization;
CREATE POLICY "Service role full access on organization" ON organization FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ai_credit_balance" ON ai_credit_balance;
CREATE POLICY "Service role full access on ai_credit_balance" ON ai_credit_balance FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on ai_usage_log" ON ai_usage_log;
CREATE POLICY "Service role full access on ai_usage_log" ON ai_usage_log FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on subscription" ON subscription;
CREATE POLICY "Service role full access on subscription" ON subscription FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on payment" ON payment;
CREATE POLICY "Service role full access on payment" ON payment FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on payment_webhook_event" ON payment_webhook_event;
CREATE POLICY "Service role full access on payment_webhook_event" ON payment_webhook_event FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on billing_audit_log" ON billing_audit_log;
CREATE POLICY "Service role full access on billing_audit_log" ON billing_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on students" ON students;
CREATE POLICY "Service role full access on students" ON students FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on books" ON books;
CREATE POLICY "Service role full access on books" ON books FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on loans" ON loans;
CREATE POLICY "Service role full access on loans" ON loans FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated Users Policies (Scoped to user_id or organization_id)
DROP POLICY IF EXISTS "Users can read own conversations" ON assistant_conversations;
CREATE POLICY "Users can read own conversations" ON assistant_conversations FOR ALL TO authenticated
USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can read own messages" ON assistant_messages;
CREATE POLICY "Users can read own messages" ON assistant_messages FOR ALL TO authenticated
USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can manage own profile" ON assistant_user_profile;
CREATE POLICY "Users can manage own profile" ON assistant_user_profile FOR ALL TO authenticated
USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);

-- ==============================================================================
-- 8. INITIAL DEFAULT SEED DATA (OPTIONAL)
-- ==============================================================================

INSERT INTO organization (id, owner_admin_id, plan, status)
VALUES ('default-org', 'admin-1', 'free', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_credit_balance (org_id, credits_remaining, credits_monthly_allowance, period_start, period_end)
VALUES (
  'default-org',
  100,
  100,
  NOW(),
  NOW() + INTERVAL '30 days'
)
ON CONFLICT (org_id) DO NOTHING;
