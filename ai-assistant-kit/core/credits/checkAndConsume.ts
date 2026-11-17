import type { ChatRequest } from '../schemas.ts';
import type { OrgCreditStore } from './creditStore.ts';
import type { CheckAndConsumeResult, CreditCostAction } from './types.ts';

/**
 * Single server-side gatekeeper called before every assistant request that invokes models or tools.
 */
export async function checkAndConsume(
  store: OrgCreditStore,
  orgId: string,
  userId: string,
  role: string,
  actionType: CreditCostAction,
  opts?: {
    idempotencyKey?: string;
    now?: Date;
    costOverride?: number;
  }
): Promise<CheckAndConsumeResult> {
  return store.checkAndConsume(orgId, userId, role, actionType, opts);
}

/**
 * Infers appropriate billing tier from the chat request payload before execution.
 */
export function inferChatActionCostType(
  body: Pick<ChatRequest, 'messages' | 'attachments'>,
  extraDataKeywords: string[] = []
): CreditCostAction {
  const hasAttachments =
    (Array.isArray(body.attachments) && body.attachments.length > 0) ||
    body.messages.some((m) => Array.isArray(m.attachments) && m.attachments.length > 0);
  if (hasAttachments) {
    return 'attachment';
  }
  const lastUserText =
    [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
  if (/\b(export|download|excel|xlsx|csv|pdf|docx|statement|report)\b/i.test(lastUserText)) {
    return 'export';
  }
  if (
    /\b(post|add|create|record|edit|update|void|delete|import|batch|collect|dues|fee|credit|debit|pending|balance|summary|list|search)\b/i.test(
      lastUserText
    )
  ) {
    return 'data_query';
  }
  if (extraDataKeywords.length > 0) {
    const lower = lastUserText.toLowerCase();
    if (extraDataKeywords.some((k) => k && lower.includes(k.toLowerCase()))) {
      return 'data_query';
    }
  }
  return 'chat';
}
