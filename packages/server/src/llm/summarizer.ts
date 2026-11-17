import type { ChatMessage } from '@ai-assistant/core';
import type { ServerConfig } from '../config.ts';
import type { AssistantRepository } from '../db/assistantRepository.ts';
import type { AccessScope } from '../security/scope.ts';
import type { LlmGateway } from './client.ts';
import { logger } from '../config.ts';

export async function summarizeConversationBackground(params: {
  conversationId: string;
  scope: AccessScope;
  messages: ChatMessage[];
  repository: AssistantRepository;
  llm: LlmGateway;
  cfg: ServerConfig;
}): Promise<void> {
  const { conversationId, scope, messages, repository, llm, cfg } = params;
  try {
    const textHistory = messages
      .slice(-16)
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt = `Summarize the key facts from this conversation in 3 sentences, focusing on: user goal, entities mentioned (students, sectors, amounts), pending actions.\n\n${textHistory}`;

    let summary = '';
    if (llm.hasLiveProvider) {
      const res = await llm.streamChat({
        model: cfg.modelFast,
        messages: [{ role: 'user', content: prompt }],
        onDelta: (delta) => {
          summary += delta;
        },
      });
      summary = res.fullText.trim();
    } else {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      summary = `User discussed ${lastUser?.content.slice(0, 80) || 'ledger inquiries'}. Recent entities and operations reviewed in session.`;
    }

    if (summary) {
      await repository.updateConversationSummary(conversationId, scope, summary);
      logger.info({ conversationId, userId: scope.userId }, 'Background conversation summary updated');
    }
  } catch (err) {
    logger.warn({ err, conversationId }, 'Background conversation summary failed');
  }
}
