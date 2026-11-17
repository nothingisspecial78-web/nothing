-- Organization Billing, Credits & Subscription Schema (Plug-and-Play Multi-Tenant)
-- Safe additive migration: creates tables if they do not exist and leaves existing tables untouched.

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

ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS refunded BOOLEAN NOT NULL DEFAULT FALSE;

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

CREATE INDEX IF NOT EXISTS idx_billing_audit_org_ts ON billing_audit_log (org_id, created_at DESC);
