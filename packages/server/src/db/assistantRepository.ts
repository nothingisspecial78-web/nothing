import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AccessScope } from '../security/scope.ts';
import { logger, type ServerConfig } from '../config.ts';

export interface AssistantConversation {
  id: string;
  userId: string;
  appId: string;
  title: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface UserProfile {
  userId: string;
  preferredLanguage: string;
  answerStyle: 'concise' | 'detailed' | 'step-by-step';
  notesJson: Record<string, unknown>;
  updatedAt: string;
}

export interface ChipUsage {
  userId: string;
  chipId: string;
  pageId: string;
  shownCount: number;
  clickCount: number;
  lastClickedAt?: string;
}

export interface AssistantAuditLog {
  id: string;
  userId: string;
  role: string;
  scope: Record<string, unknown>;
  tool: string;
  parameters: Record<string, unknown>;
  result?: Record<string, unknown>;
  timestamp: string;
}

export class AssistantRepository {
  private readonly client: SupabaseClient | null = null;
  private schemaMissing = false;

  // In-memory fallbacks
  private readonly conversations = new Map<string, AssistantConversation>();
  private readonly messages = new Map<string, AssistantMessage[]>();
  private readonly profiles = new Map<string, UserProfile>();
  private readonly chipUsages = new Map<string, ChipUsage>();
  private readonly auditLogs: AssistantAuditLog[] = [];

  constructor(cfg: ServerConfig) {
    if (cfg.supabaseUrl && cfg.supabaseServiceRoleKey) {
      this.client = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      });
    }
  }

  // ================= Conversations =================
  async getOrCreateConversation(
    appId: string,
    scope: AccessScope,
    conversationId?: string,
    title = 'New Conversation'
  ): Promise<AssistantConversation> {
    const id = conversationId || `conv-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    if (this.client && !this.schemaMissing) {
      try {
        const { data, error } = await this.client
          .from('assistant_conversations')
          .select('*')
          .eq('id', id)
          .eq('user_id', scope.userId)
          .single();

        if (!error && data) {
          return {
            id: data.id,
            userId: data.user_id,
            appId: data.app_id,
            title: data.title,
            summary: data.summary || undefined,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
          };
        }

        const newConv = {
          id,
          user_id: scope.userId,
          app_id: appId,
          title,
          created_at: now,
          updated_at: now,
        };
        const { error: insErr } = await this.client
          .from('assistant_conversations')
          .insert(newConv);
        if (!insErr) {
          return {
            id,
            userId: scope.userId,
            appId,
            title,
            createdAt: now,
            updatedAt: now,
          };
        }
      } catch (err) {
        this.schemaMissing = true;
        logger.warn({ err }, 'Supabase conversation error; falling back to in-memory');
      }
    }

    let existing = this.conversations.get(id);
    if (!existing) {
      existing = {
        id,
        userId: scope.userId,
        appId,
        title,
        createdAt: now,
        updatedAt: now,
      };
      this.conversations.set(id, existing);
    }
    return existing;
  }

  async updateConversationSummary(
    conversationId: string,
    scope: AccessScope,
    summary: string
  ): Promise<void> {
    const now = new Date().toISOString();
    if (this.client && !this.schemaMissing) {
      try {
        await this.client
          .from('assistant_conversations')
          .update({ summary, updated_at: now })
          .eq('id', conversationId)
          .eq('user_id', scope.userId);
      } catch {
        // fallback
      }
    }
    const mem = this.conversations.get(conversationId);
    if (mem && mem.userId === scope.userId) {
      mem.summary = summary;
      mem.updatedAt = now;
    }
  }

  // ================= Messages =================
  async getRecentMessages(
    conversationId: string,
    scope: AccessScope,
    limit = 12
  ): Promise<AssistantMessage[]> {
    if (this.client && !this.schemaMissing) {
      try {
        const { data, error } = await this.client
          .from('assistant_messages')
          .select('*')
          .eq('conversation_id', conversationId)
          .eq('user_id', scope.userId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error && Array.isArray(data)) {
          return data.reverse().map((m) => ({
            id: m.id,
            conversationId: m.conversation_id,
            userId: m.user_id,
            role: m.role,
            content: m.content,
            metadata: m.metadata,
            createdAt: m.created_at,
          }));
        }
      } catch {
        // fallback
      }
    }

    const list = this.messages.get(conversationId) || [];
    const scoped = list.filter((m) => m.userId === scope.userId);
    return scoped.slice(-limit);
  }

  async appendMessage(
    conversationId: string,
    scope: AccessScope,
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<AssistantMessage> {
    const msg: AssistantMessage = {
      id: `msg-${crypto.randomUUID()}`,
      conversationId,
      userId: scope.userId,
      role,
      content,
      metadata,
      createdAt: new Date().toISOString(),
    };

    if (this.client && !this.schemaMissing) {
      try {
        await this.client.from('assistant_messages').insert({
          id: msg.id,
          conversation_id: msg.conversationId,
          user_id: msg.userId,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata || {},
          created_at: msg.createdAt,
        });
      } catch {
        // fallback
      }
    }

    const list = this.messages.get(conversationId) || [];
    list.push(msg);
    this.messages.set(conversationId, list);
    return msg;
  }

  // ================= User Profile =================
  async getUserProfile(userId: string): Promise<UserProfile> {
    if (this.client && !this.schemaMissing) {
      try {
        const { data, error } = await this.client
          .from('assistant_user_profile')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (!error && data) {
          return {
            userId: data.user_id,
            preferredLanguage: data.preferred_language,
            answerStyle: data.answer_style,
            notesJson: data.notes_json || {},
            updatedAt: data.updated_at,
          };
        }
      } catch {
        // fallback
      }
    }

    return (
      this.profiles.get(userId) || {
        userId,
        preferredLanguage: 'en',
        answerStyle: 'concise',
        notesJson: {},
        updatedAt: new Date().toISOString(),
      }
    );
  }

  // ================= Chip Usage =================
  async getChipUsages(userId: string, pageId: string): Promise<ChipUsage[]> {
    if (this.client && !this.schemaMissing) {
      try {
        const queryPromise = this.client
          .from('assistant_chip_usage')
          .select('*')
          .eq('user_id', userId)
          .eq('page_id', pageId);

        const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: new Error('Timeout') }), 800)
        );

        const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

        if (error) {
          this.schemaMissing = true;
        } else if (Array.isArray(data)) {
          return data.map((d) => ({
            userId: d.user_id,
            chipId: d.chip_id,
            pageId: d.page_id,
            shownCount: d.shown_count,
            clickCount: d.click_count,
            lastClickedAt: d.last_clicked_at,
          }));
        }
      } catch {
        this.schemaMissing = true;
      }
    }

    const results: ChipUsage[] = [];
    for (const u of this.chipUsages.values()) {
      if (u.userId === userId && u.pageId === pageId) {
        results.push(u);
      }
    }
    return results;
  }

  async recordChipImpression(userId: string, pageId: string, chipIds: string[]): Promise<void> {
    for (const chipId of chipIds) {
      const key = `${userId}:${pageId}:${chipId}`;
      const cur = this.chipUsages.get(key) || {
        userId,
        chipId,
        pageId,
        shownCount: 0,
        clickCount: 0,
      };
      cur.shownCount += 1;
      this.chipUsages.set(key, cur);

      if (this.client && !this.schemaMissing) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 1500)
          );
          const upsertPromise = this.client.from('assistant_chip_usage').upsert(
            {
              user_id: userId,
              page_id: pageId,
              chip_id: chipId,
              shown_count: cur.shownCount,
              click_count: cur.clickCount,
            },
            { onConflict: 'user_id,chip_id,page_id' }
          );
          const { error } = (await Promise.race([upsertPromise, timeoutPromise])) as any;
          if (error) this.schemaMissing = true;
        } catch {
          this.schemaMissing = true;
        }
      }
    }
  }

  async recordChipClick(userId: string, pageId: string, chipId: string): Promise<void> {
    const key = `${userId}:${pageId}:${chipId}`;
    const now = new Date().toISOString();
    const cur = this.chipUsages.get(key) || {
      userId,
      chipId,
      pageId,
      shownCount: 1,
      clickCount: 0,
    };
    cur.clickCount += 1;
    cur.lastClickedAt = now;
    this.chipUsages.set(key, cur);

    if (this.client && !this.schemaMissing) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 1500)
        );
        const upsertPromise = this.client.from('assistant_chip_usage').upsert(
          {
            user_id: userId,
            page_id: pageId,
            chip_id: chipId,
            shown_count: cur.shownCount,
            click_count: cur.clickCount,
            last_clicked_at: now,
          },
          { onConflict: 'user_id,chip_id,page_id' }
        );
        const { error } = (await Promise.race([upsertPromise, timeoutPromise])) as any;
        if (error) this.schemaMissing = true;
      } catch {
        this.schemaMissing = true;
      }
    }
  }

  // ================= Audit Logs =================
  async logAction(entry: {
    userId: string;
    role: string;
    scope: AccessScope;
    tool: string;
    parameters: Record<string, unknown>;
    result?: Record<string, unknown>;
  }): Promise<void> {
    const item: AssistantAuditLog = {
      id: `audit-${crypto.randomUUID()}`,
      userId: entry.userId,
      role: entry.role,
      scope: entry.scope as Record<string, unknown>,
      tool: entry.tool,
      parameters: entry.parameters,
      result: entry.result,
      timestamp: new Date().toISOString(),
    };

    this.auditLogs.unshift(item);
    if (this.auditLogs.length > 500) {
      this.auditLogs.length = 500;
    }

    if (this.client && !this.schemaMissing) {
      try {
        await this.client.from('assistant_audit_logs').insert({
          id: item.id,
          user_id: item.userId,
          role: item.role,
          scope: item.scope,
          tool: item.tool,
          parameters: item.parameters,
          result: item.result || null,
          timestamp: item.timestamp,
        });
      } catch {
        // fallback
      }
    }
  }

  getAuditLogs(): AssistantAuditLog[] {
    return [...this.auditLogs];
  }
}
