import OpenAI from 'openai';
import sharp from 'sharp';
import {
  DEFAULT_IMAGE_MAX_WIDTH,
  DEFAULT_IMAGE_QUALITY,
  type RetrievedChunk,
} from '@ai-assistant/core';
import { logger, type ServerConfig } from '../config.ts';
import { ProviderFallbackChain } from './providerChain.ts';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
        | { type: 'file_data'; file_data: { fileUri: string; mimeType: string } }
      >;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenAiToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmCompletionResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
  modelUsed: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export async function compressScreenshotDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  const rawBuffer = Buffer.from(match[2], 'base64');

  try {
    const compressed = await sharp(rawBuffer)
      .resize({ width: DEFAULT_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: DEFAULT_IMAGE_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${compressed.toString('base64')}`;
  } catch (err) {
    logger.warn({ err }, 'Sharp compression skipped; forwarding original image');
    return dataUrl;
  }
}

export interface LlmGateway {
  readonly hasLiveProvider: boolean;
  readonly chain: ProviderFallbackChain;
  streamChat(params: {
    model: string;
    messages: LlmChatMessage[];
    onDelta: (text: string) => void;
    onStreamReset?: () => void;
    retrievedChunks?: RetrievedChunk[];
    language?: 'en' | 'ml';
    signal?: AbortSignal;
  }): Promise<{
    fullText: string;
    modelUsed: string;
    provider?: string;
    ttftMs?: number;
    totalMs?: number;
    usage?: LlmCompletionResult['usage'];
  }>;

  completeWithTools(params: {
    model: string;
    messages: LlmChatMessage[];
    tools: OpenAiToolSpec[];
    retrievedChunks?: RetrievedChunk[];
    language?: 'en' | 'ml';
    signal?: AbortSignal;
  }): Promise<LlmCompletionResult & { provider?: string }>;
}

function buildGroundedLocalAnswer(
  messages: LlmChatMessage[],
  chunks: RetrievedChunk[],
  language: 'en' | 'ml'
): string {
  const lastTool = [...messages].reverse().find((m) => m.role === 'tool' && typeof m.content === 'string');
  if (lastTool && typeof lastTool.content === 'string') {
    const raw = lastTool.content
      .replace(/^<untrusted_data[^>]*>\s*/i, '')
      .replace(/\s*<\/untrusted_data>$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.formattedReport === 'string' && parsed.formattedReport.trim()) {
        return parsed.formattedReport;
      }
      if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
        return parsed.summary;
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        if (parsed.error.trim() === 'Invalid tool arguments') {
          return "I couldn't match all parameters for that lookup cleanly. Try rephrasing with a sector, class, or student name.";
        }
        return parsed.error;
      }
    } catch {
      if (raw) return raw.slice(0, 1800);
    }
  }

  const sysMsg = messages.find((m) => m.role === 'system');
  const sysText = typeof sysMsg?.content === 'string' ? sysMsg.content : '';
  const uiMatch = /<untrusted_data source="ui_context">\s*(\{[\s\S]*?\})\s*<\/untrusted_data>/i.exec(sysText);
  if (uiMatch) {
    try {
      const ui = JSON.parse(uiMatch[1]) as {
        nearbyLabel?: string;
        text?: string;
        routePath?: string;
      };
      const label = (ui.nearbyLabel || '').trim();
      const snippet = (ui.text || '').replace(/\s+/g, ' ').trim();
      if (label || snippet) {
        const subject = label || snippet.slice(0, 60);
        const detail = snippet && snippet !== label ? ` (${snippet.slice(0, 120)})` : '';
        return language === 'ml'
          ? `ഈ ഭാഗം നിലവിലെ അക്കൗണ്ടിലോ വെബ് ആപ്പിലോ ഉള്ള **${subject}** വിവരങ്ങളാണ് കാണിക്കുന്നത്${detail}.`
          : `This shows the **${subject}** currently displayed in this account and web app${detail}.`;
      }
    } catch {
      // fall through to docs synthesis
    }
  }

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const hasImage =
    Array.isArray(lastUser?.content) && lastUser.content.some((p) => p.type === 'image_url');

  if (chunks.length === 0) {
    return "I don't have enough documentation context to answer that question.";
  }

  const top = chunks[0];
  const citations = chunks
    .slice(0, 3)
    .map((c) => `${c.source} (${c.heading})`)
    .join(', ');

  if (hasImage) {
    return [
      `Based on the uploaded screenshot and the **${top.heading}** documentation:`,
      '',
      '1. Review the active form or table highlighted on the current screen.',
      '2. Verify required inputs match the documented rules in **' + top.source + '**.',
      '3. Fix any highlighted validation warnings and submit or retry the action.',
      '',
      `Source: ${citations}`,
      '',
      'Want me to do this for you?',
    ].join('\n');
  }

  const combinedLines: string[] = [];
  for (const chunk of chunks.slice(0, 3)) {
    const lines = chunk.content
      .replace(/^#+\s*/gm, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (!combinedLines.includes(line)) {
        combinedLines.push(line);
      }
      if (combinedLines.length >= 28) break;
    }
    if (combinedLines.length >= 28) break;
  }

  const prefix =
    language === 'ml'
      ? 'ലഭ്യമായ ഡോക്യുമെന്റേഷൻ പ്രകാരം:\n\n'
      : '';

  return `${prefix}${combinedLines.join('\n')}\n\nSource: ${citations}`;
}

interface ProviderTarget {
  name: 'openrouter' | 'groq' | 'gemini';
  client: OpenAI;
  supportsVision: boolean;
  mapModel: (requestedModel: string) => string[];
}

function messagesContainImage(messages: LlmChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === 'image_url' || part.type === 'file_data')
  );
}

export function createLlmGateway(cfg: ServerConfig): LlmGateway {
  const chain = new ProviderFallbackChain(cfg);
  const hasLiveProvider = chain.getProviders().some((p) => p.isConfigured());

  return {
    hasLiveProvider,
    chain,

    async streamChat({
      model,
      messages,
      onDelta,
      onStreamReset,
      retrievedChunks = [],
      language = 'en',
      signal,
    }) {
      const hasImage = messagesContainImage(messages);
      const modelType = hasImage ? 'vision' : model === cfg.modelStrong ? 'strong' : 'fast';

      if (hasLiveProvider) {
        try {
          const res = await chain.streamChat(
            {
              modelType,
              messages,
              temperature: 0.2,
              maxTokens: 650,
            },
            {
              signal,
              onDelta,
              onStreamReset,
            }
          );
          return res;
        } catch (err) {
          logger.warn({ err }, 'All providers in fallback chain failed for streamChat; falling back to local grounded answer');
        }
      }

      const synthesized = buildGroundedLocalAnswer(messages, retrievedChunks, language);
      for (const token of synthesized.split(/(\s+)/)) {
        if (token) onDelta(token);
      }
      return {
        fullText: synthesized,
        modelUsed: 'local-grounded-fallback',
        provider: 'local',
        ttftMs: 10,
        totalMs: 30,
      };
    },

    async completeWithTools({
      model: _model,
      messages,
      tools,
      retrievedChunks = [],
      language = 'en',
      signal,
    }) {
      if (hasLiveProvider && tools.length > 0) {
        try {
          const needsVision = messagesContainImage(messages);
          const res = await chain.completeWithTools(
            {
              modelType: needsVision ? 'vision' : 'strong',
              messages,
              tools,
              temperature: 0.1,
              maxTokens: 650,
            },
            { signal }
          );
          return res;
        } catch (err) {
          logger.warn({ err }, 'All providers in fallback chain failed for completeWithTools; falling back to local grounded answer');
        }
      }

      return {
        content: buildGroundedLocalAnswer(messages, retrievedChunks, language),
        toolCalls: [],
        modelUsed: 'local-grounded-fallback',
        provider: 'local',
      };
    },
  };
}
