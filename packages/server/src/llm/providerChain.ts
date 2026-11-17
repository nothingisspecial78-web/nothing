import crypto from 'node:crypto';
import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Schema,
} from '@google/genai';
import OpenAI from 'openai';
import { logger, type ServerConfig } from '../config.ts';
import type { LlmChatMessage, LlmCompletionResult, OpenAiToolSpec } from './client.ts';

export interface NormalizedChatRequest {
  modelType: 'fast' | 'strong' | 'vision';
  messages: LlmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface NormalizedToolRequest extends NormalizedChatRequest {
  tools: OpenAiToolSpec[];
}

export interface ProviderDebugStatus {
  name: 'openrouter' | 'gemini' | 'groq';
  circuitState: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureReason?: string;
  lastFailureTime?: string;
  lastLatencyMs?: number;
  configured: boolean;
  modelFast: string;
  modelStrong: string;
}

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private lastFailureReason?: string;
  private lastLatencyMs?: number;

  constructor(
    public readonly name: string,
    private readonly threshold = 3,
    private readonly cooldownMs = 60000
  ) {}

  canAttempt(): boolean {
    const now = Date.now();
    if (this.state === 'open') {
      if (now - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'half_open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(latencyMs: number): void {
    this.failureCount = 0;
    this.state = 'closed';
    this.lastLatencyMs = latencyMs;
  }

  recordFailure(reason: string): void {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    this.lastFailureReason = reason;
    if (this.failureCount >= this.threshold) {
      this.state = 'open';
      logger.warn(
        { provider: this.name, failures: this.failureCount, reason },
        `Circuit breaker OPEN for provider "${this.name}" (cooling down for ${this.cooldownMs / 1000}s)`
      );
    }
  }

  getStatus(): {
    circuitState: 'closed' | 'open' | 'half_open';
    failureCount: number;
    lastFailureReason?: string;
    lastFailureTime?: string;
    lastLatencyMs?: number;
  } {
    // If open but cooldown elapsed, report as half_open
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.cooldownMs) {
      return {
        circuitState: 'half_open',
        failureCount: this.failureCount,
        lastFailureReason: this.lastFailureReason,
        lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : undefined,
        lastLatencyMs: this.lastLatencyMs,
      };
    }
    return {
      circuitState: this.state,
      failureCount: this.failureCount,
      lastFailureReason: this.lastFailureReason,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : undefined,
      lastLatencyMs: this.lastLatencyMs,
    };
  }
}

export interface LLMProvider {
  readonly name: 'openrouter' | 'gemini' | 'groq';
  readonly supports: { tools: boolean; vision: boolean };
  readonly breaker: CircuitBreaker;
  isConfigured(): boolean;
  getModelName(type: 'fast' | 'strong' | 'vision'): string;
  chatStream(
    req: NormalizedChatRequest,
    opts: {
      signal?: AbortSignal;
      onDelta: (token: string) => void;
      firstTokenTimeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ): Promise<{ fullText: string; modelUsed: string; ttftMs: number; totalMs: number }>;
  completeWithTools?(
    req: NormalizedToolRequest,
    opts: { signal?: AbortSignal; totalTimeoutMs?: number }
  ): Promise<LlmCompletionResult>;
}

function hasImages(messages: LlmChatMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p.type === 'image_url' || p.type === 'file_data')
  );
}

function hasGeminiFileData(messages: LlmChatMessage[]): boolean {
  return messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'file_data')
  );
}

function sanitizeMessagesForOpenAi(messages: LlmChatMessage[]): LlmChatMessage[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    const filtered = m.content.filter((p) => p.type !== 'file_data');
    return { ...m, content: filtered.length > 0 ? filtered : [{ type: 'text', text: '' }] };
  });
}

// 1. OpenRouter Provider
export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter' as const;
  readonly supports = { tools: true, vision: true };
  readonly breaker = new CircuitBreaker('openrouter', 3, 60000);
  private client: OpenAI | null = null;

  constructor(private readonly cfg: ServerConfig) {
    if (cfg.openRouterApiKey) {
      this.client = new OpenAI({
        apiKey: cfg.openRouterApiKey,
        baseURL: cfg.llmBaseUrl || 'https://openrouter.ai/api/v1',
        timeout: 45000,
        defaultHeaders: { 'X-Title': 'Khazna AI Assistant' },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.openRouterApiKey && this.client);
  }

  getModelName(type: 'fast' | 'strong' | 'vision'): string {
    if (type === 'vision') {
      return process.env.OPENROUTER_MODEL_VISION || 'openai/gpt-4o-mini';
    }
    if (type === 'strong') {
      return process.env.OPENROUTER_MODEL_STRONG || 'openai/gpt-4o-mini';
    }
    return process.env.OPENROUTER_MODEL_FAST || 'openai/gpt-4o-mini';
  }

  async chatStream(
    req: NormalizedChatRequest,
    opts: {
      signal?: AbortSignal;
      onDelta: (token: string) => void;
      firstTokenTimeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ): Promise<{ fullText: string; modelUsed: string; ttftMs: number; totalMs: number }> {
    if (!this.client) throw new Error('OpenRouter API key is not configured');
    const model = this.getModelName(req.modelType);
    const start = Date.now();
    let ttftMs = 0;
    let firstTokenReceived = false;

    const controller = new AbortController();
    const abortCombined = () => controller.abort();
    if (opts.signal) {
      opts.signal.addEventListener('abort', abortCombined);
    }

    const ttftTimeout = setTimeout(() => {
      if (!firstTokenReceived) {
        controller.abort(new Error(`OpenRouter time-to-first-token exceeded ${opts.firstTokenTimeoutMs || 8000}ms`));
      }
    }, opts.firstTokenTimeoutMs || 8000);

    const totalTimeout = setTimeout(() => {
      controller.abort(new Error(`OpenRouter total stream timeout exceeded ${opts.totalTimeoutMs || 45000}ms`));
    }, opts.totalTimeoutMs || 45000);

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: req.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          stream: true,
          temperature: req.temperature ?? 0.2,
          max_tokens: Math.min(req.maxTokens ?? 650, 700),
        },
        { signal: controller.signal }
      );

      let fullText = '';
      for await (const chunk of stream) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          ttftMs = Date.now() - start;
          clearTimeout(ttftTimeout);
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          opts.onDelta(delta);
        }
      }

      if (!fullText.trim()) {
        throw new Error('OpenRouter returned empty stream response');
      }

      const totalMs = Date.now() - start;
      this.breaker.recordSuccess(totalMs);
      return { fullText, modelUsed: `openrouter:${model}`, ttftMs: ttftMs || totalMs, totalMs };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.breaker.recordFailure(errMsg);
      throw err;
    } finally {
      clearTimeout(ttftTimeout);
      clearTimeout(totalTimeout);
      if (opts.signal) {
        opts.signal.removeEventListener('abort', abortCombined);
      }
    }
  }

  async completeWithTools(
    req: NormalizedToolRequest,
    opts: { signal?: AbortSignal; totalTimeoutMs?: number }
  ): Promise<LlmCompletionResult> {
    if (!this.client) throw new Error('OpenRouter API key is not configured');
    const model = this.getModelName(req.modelType);
    const start = Date.now();

    try {
      const res = await this.client.chat.completions.create(
        {
          model,
          messages: req.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          tools: req.tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens: Math.min(req.maxTokens ?? 650, 700),
        },
        { signal: opts.signal }
      );

      const msg = res.choices?.[0]?.message;
      const content = msg?.content || '';
      const toolCalls = (msg?.tool_calls || [])
        .filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          argumentsJson: tc.function.arguments,
        }));

      const totalMs = Date.now() - start;
      this.breaker.recordSuccess(totalMs);
      return {
        content,
        toolCalls,
        modelUsed: `openrouter:${model}`,
        usage: res.usage
          ? {
              promptTokens: res.usage.prompt_tokens,
              completionTokens: res.usage.completion_tokens,
              totalTokens: res.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.breaker.recordFailure(errMsg);
      throw err;
    }
  }
}

function mapJsonSchemaToGeminiType(typeName: unknown): Type {
  const t = String(typeName || '').toLowerCase();
  if (t === 'string') return Type.STRING;
  if (t === 'number') return Type.NUMBER;
  if (t === 'integer') return Type.INTEGER;
  if (t === 'boolean') return Type.BOOLEAN;
  if (t === 'array') return Type.ARRAY;
  return Type.OBJECT;
}

function convertSchemaNodeToGemini(node: Record<string, unknown>): Schema {
  const schema: Schema = {
    type: mapJsonSchemaToGeminiType(node.type),
  };
  if (typeof node.description === 'string' && node.description) {
    schema.description = node.description;
  }
  if (Array.isArray(node.enum)) {
    schema.enum = node.enum.map(String);
  }
  if (Array.isArray(node.required)) {
    schema.required = node.required.map(String);
  }
  if (node.properties && typeof node.properties === 'object') {
    const props: Record<string, Schema> = {};
    for (const [k, v] of Object.entries(node.properties as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        props[k] = convertSchemaNodeToGemini(v as Record<string, unknown>);
      }
    }
    schema.properties = props;
  }
  if (node.items && typeof node.items === 'object') {
    schema.items = convertSchemaNodeToGemini(node.items as Record<string, unknown>);
  }
  return schema;
}

function convertOpenAiToolsToGemini(tools: OpenAiToolSpec[]): FunctionDeclaration[] {
  return tools.map((t) => {
    const rawParams = (t.function.parameters || {}) as Record<string, unknown>;
    const hasProps =
      rawParams.properties &&
      typeof rawParams.properties === 'object' &&
      Object.keys(rawParams.properties as Record<string, unknown>).length > 0;
    const decl: FunctionDeclaration = {
      name: t.function.name,
      description: t.function.description,
    };
    if (hasProps) {
      decl.parameters = convertSchemaNodeToGemini(rawParams);
    }
    return decl;
  });
}

function convertMessagesToGemini(messages: LlmChatMessage[]): {
  systemInstruction?: string;
  contents: Content[];
} {
  const systemParts: string[] = [];
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string' && msg.content.trim()) {
        systemParts.push(msg.content);
      }
      continue;
    }

    if (msg.role === 'tool') {
      let responseObj: Record<string, unknown>;
      const rawText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      try {
        const parsed = JSON.parse(rawText);
        responseObj =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { result: parsed };
      } catch {
        responseObj = { result: rawText };
      }
      const part: Part = {
        functionResponse: {
          ...(msg.tool_call_id ? { id: msg.tool_call_id } : {}),
          name: msg.name || 'tool',
          response: responseObj,
        },
      };
      const prev = contents[contents.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.parts)) {
        prev.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const parts: Part[] = [];
      if (typeof msg.content === 'string' && msg.content.trim()) {
        parts.push({ text: msg.content });
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function.name,
              args: parsedArgs,
            },
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: 'model', parts });
      }
      continue;
    }

    // user role
    const parts: Part[] = [];
    if (typeof msg.content === 'string') {
      parts.push({ text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item.type === 'text') {
          parts.push({ text: item.text });
        } else if (item.type === 'image_url' && item.image_url?.url) {
          const match = /^data:([^;]+);base64,(.+)$/.exec(item.image_url.url);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1]!,
                data: match[2]!,
              },
            });
          } else {
            parts.push({ text: `[Image URL: ${item.image_url.url}]` });
          }
        } else if (item.type === 'file_data' && item.file_data?.fileUri) {
          parts.push({
            fileData: {
              fileUri: item.file_data.fileUri,
              mimeType: item.file_data.mimeType || 'application/pdf',
            },
          });
        }
      }
    }
    if (parts.length > 0) {
      contents.push({ role: 'user', parts });
    }
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Hello' }] }],
  };
}

function isDeprecatedGeminiModel(model?: string): boolean {
  if (!model) return true;
  return /^gemini-(?:1\.5|2\.0|2\.5-flash$)|^gemini-pro$/i.test(model.trim());
}

// 2. Gemini Provider (@google/genai SDK with gemini-4-hydrogen)
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  readonly supports = { tools: true, vision: true };
  readonly breaker = new CircuitBreaker('gemini', 3, 60000);
  private ai: GoogleGenAI | null = null;

  constructor(private readonly cfg: ServerConfig) {
    if (cfg.geminiApiKey) {
      this.ai = new GoogleGenAI({
        apiKey: cfg.geminiApiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.geminiApiKey && this.ai);
  }

  getModelName(type: 'fast' | 'strong' | 'vision'): string {
    const envModel =
      type === 'strong' ? process.env.GEMINI_MODEL_STRONG : process.env.GEMINI_MODEL_FAST;
    if (envModel && !isDeprecatedGeminiModel(envModel)) {
      return envModel.trim();
    }
    return 'gemini-4-hydrogen';
  }

  async chatStream(
    req: NormalizedChatRequest,
    opts: {
      signal?: AbortSignal;
      onDelta: (token: string) => void;
      firstTokenTimeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ): Promise<{ fullText: string; modelUsed: string; ttftMs: number; totalMs: number }> {
    if (!this.ai) throw new Error('Gemini API key is not configured');
    const model = this.getModelName(req.modelType);
    const start = Date.now();
    let ttftMs = 0;
    let firstTokenReceived = false;

    const { systemInstruction, contents } = convertMessagesToGemini(req.messages);

    let ttftTimer: ReturnType<typeof setTimeout> | undefined;
    let totalTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const streamPromise = this.ai.models.generateContentStream({
        model,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(opts.signal ? { abortSignal: opts.signal } : {}),
        },
      });

      const firstTokenGuard = new Promise<never>((_, reject) => {
        ttftTimer = setTimeout(() => {
          if (!firstTokenReceived) {
            reject(new Error(`Gemini time-to-first-token exceeded ${opts.firstTokenTimeoutMs || 8000}ms`));
          }
        }, opts.firstTokenTimeoutMs || 8000);
      });

      const totalGuard = new Promise<never>((_, reject) => {
        totalTimer = setTimeout(() => {
          reject(new Error(`Gemini total stream timeout exceeded ${opts.totalTimeoutMs || 45000}ms`));
        }, opts.totalTimeoutMs || 45000);
      });

      const stream = await Promise.race([streamPromise, firstTokenGuard, totalGuard]);

      let fullText = '';
      for await (const chunk of stream) {
        if (opts.signal?.aborted) {
          throw new Error('Gemini stream aborted');
        }
        const delta = chunk.text;
        if (delta) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            ttftMs = Date.now() - start;
            if (ttftTimer) clearTimeout(ttftTimer);
          }
          fullText += delta;
          opts.onDelta(delta);
        }
      }

      if (!fullText.trim()) {
        throw new Error('Gemini returned empty stream response');
      }

      const totalMs = Date.now() - start;
      this.breaker.recordSuccess(totalMs);
      return { fullText, modelUsed: `gemini:${model}`, ttftMs: ttftMs || totalMs, totalMs };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.breaker.recordFailure(errMsg);
      throw err;
    } finally {
      if (ttftTimer) clearTimeout(ttftTimer);
      if (totalTimer) clearTimeout(totalTimer);
    }
  }

  async completeWithTools(
    req: NormalizedToolRequest,
    opts: { signal?: AbortSignal; totalTimeoutMs?: number }
  ): Promise<LlmCompletionResult> {
    if (!this.ai) throw new Error('Gemini API key is not configured');
    const model = this.getModelName(req.modelType);
    const start = Date.now();
    const { systemInstruction, contents } = convertMessagesToGemini(req.messages);
    const functionDeclarations = convertOpenAiToolsToGemini(req.tools);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutGuard = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Gemini completeWithTools timeout exceeded ${opts.totalTimeoutMs || 45000}ms`)),
          opts.totalTimeoutMs || 45000
        );
      });

      const response = await Promise.race([
        this.ai.models.generateContent({
          model,
          contents,
          config: {
            ...(systemInstruction ? { systemInstruction } : {}),
            ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
            ...(opts.signal ? { abortSignal: opts.signal } : {}),
          },
        }),
        timeoutGuard,
      ]);

      const content = response.text || '';
      const toolCalls = (response.functionCalls || [])
        .filter((fc) => Boolean(fc.name))
        .map((fc) => ({
          id: fc.id || `call_${crypto.randomUUID().slice(0, 8)}`,
          name: fc.name!,
          argumentsJson: JSON.stringify(fc.args || {}),
        }));

      const totalMs = Date.now() - start;
      this.breaker.recordSuccess(totalMs);
      return {
        content,
        toolCalls,
        modelUsed: `gemini:${model}`,
        usage: response.usageMetadata
          ? {
              promptTokens: response.usageMetadata.promptTokenCount || 0,
              completionTokens: response.usageMetadata.candidatesTokenCount || 0,
              totalTokens: response.usageMetadata.totalTokenCount || 0,
            }
          : undefined,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.breaker.recordFailure(errMsg);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

// 3. Groq Provider
export class GroqProvider implements LLMProvider {
  readonly name = 'groq' as const;
  readonly supports = { tools: true, vision: false };
  readonly breaker = new CircuitBreaker('groq', 3, 60000);
  private client: OpenAI | null = null;

  constructor(private readonly cfg: ServerConfig) {
    if (cfg.groqApiKey) {
      this.client = new OpenAI({
        apiKey: cfg.groqApiKey,
        baseURL: 'https://api.groq.com/openai/v1',
        timeout: 45000,
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.groqApiKey && this.client);
  }

  getModelName(type: 'fast' | 'strong' | 'vision'): string {
    if (type === 'strong') {
      return process.env.GROQ_MODEL_STRONG || 'openai/gpt-oss-120b';
    }
    return process.env.GROQ_MODEL_FAST || 'openai/gpt-oss-20b';
  }

  async chatStream(
    req: NormalizedChatRequest,
    opts: {
      signal?: AbortSignal;
      onDelta: (token: string) => void;
      firstTokenTimeoutMs?: number;
      totalTimeoutMs?: number;
    }
  ): Promise<{ fullText: string; modelUsed: string; ttftMs: number; totalMs: number }> {
    if (!this.client) throw new Error('Groq API key is not configured');
    const model = this.getModelName(req.modelType);
    const start = Date.now();
    let ttftMs = 0;
    let firstTokenReceived = false;

    const controller = new AbortController();
    const abortCombined = () => controller.abort();
    if (opts.signal) {
      opts.signal.addEventListener('abort', abortCombined);
    }

    const ttftTimeout = setTimeout(() => {
      if (!firstTokenReceived) {
        controller.abort(new Error(`Groq time-to-first-token exceeded ${opts.firstTokenTimeoutMs || 8000}ms`));
      }
    }, opts.firstTokenTimeoutMs || 8000);

    const totalTimeout = setTimeout(() => {
      controller.abort(new Error(`Groq total stream timeout exceeded ${opts.totalTimeoutMs || 45000}ms`));
    }, opts.totalTimeoutMs || 45000);

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: req.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          stream: true,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 1000,
        },
        { signal: controller.signal }
      );

      let fullText = '';
      for await (const chunk of stream) {
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          ttftMs = Date.now() - start;
          clearTimeout(ttftTimeout);
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          opts.onDelta(delta);
        }
      }

      if (!fullText.trim()) {
        throw new Error('Groq returned empty stream response');
      }

      const totalMs = Date.now() - start;
      this.breaker.recordSuccess(totalMs);
      return { fullText, modelUsed: `groq:${model}`, ttftMs: ttftMs || totalMs, totalMs };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.breaker.recordFailure(errMsg);
      throw err;
    } finally {
      clearTimeout(ttftTimeout);
      clearTimeout(totalTimeout);
      if (opts.signal) {
        opts.signal.removeEventListener('abort', abortCombined);
      }
    }
  }

  async completeWithTools(
    req: NormalizedToolRequest,
    opts: { signal?: AbortSignal; totalTimeoutMs?: number }
  ): Promise<LlmCompletionResult> {
    if (!this.client) throw new Error('Groq API key is not configured');
    const model = this.getModelName(req.modelType);
    const start = Date.now();

    try {
      const res = await this.client.chat.completions.create(
        {
          model,
          messages: req.messages as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
          tools: req.tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens: req.maxTokens ?? 1000,
        },
        { signal: opts.signal }
      );

      const msg = res.choices?.[0]?.message;
      const content = msg?.content || '';
      const toolCalls = (msg?.tool_calls || [])
        .filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          argumentsJson: tc.function.arguments,
        }));

      const totalMs = Date.now() - start;
      this.breaker.recordSuccess(totalMs);
      return {
        content,
        toolCalls,
        modelUsed: `groq:${model}`,
        usage: res.usage
          ? {
              promptTokens: res.usage.prompt_tokens,
              completionTokens: res.usage.completion_tokens,
              totalTokens: res.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.breaker.recordFailure(errMsg);
      throw err;
    }
  }
}

// Orchestrator: Strict Sequential Provider Fallback Chain
export class ProviderFallbackChain {
  private readonly providers: LLMProvider[];

  constructor(cfg: ServerConfig) {
    const openrouter = new OpenRouterProvider(cfg);
    const gemini = new GeminiProvider(cfg);
    const groq = new GroqProvider(cfg);

    const providerMap = {
      openrouter,
      gemini,
      groq,
    };

    // Default order: openrouter -> gemini -> groq
    const orderEnv = process.env.PROVIDER_ORDER || 'openrouter,gemini,groq';
    const parsedOrder = orderEnv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is 'openrouter' | 'gemini' | 'groq' => s in providerMap);

    this.providers = parsedOrder.map((name) => providerMap[name]);
  }

  getProviders(): LLMProvider[] {
    return this.providers;
  }

  getDebugStatuses(): ProviderDebugStatus[] {
    return this.providers.map((p) => {
      const st = p.breaker.getStatus();
      return {
        name: p.name,
        circuitState: st.circuitState,
        failureCount: st.failureCount,
        lastFailureReason: st.lastFailureReason,
        lastFailureTime: st.lastFailureTime,
        lastLatencyMs: st.lastLatencyMs,
        configured: p.isConfigured(),
        modelFast: p.getModelName('fast'),
        modelStrong: p.getModelName('strong'),
      };
    });
  }

  async streamChat(
    req: NormalizedChatRequest,
    opts: {
      signal?: AbortSignal;
      onDelta: (token: string) => void;
      onStreamReset?: () => void;
    }
  ): Promise<{ fullText: string; modelUsed: string; provider: string; ttftMs: number; totalMs: number }> {
    const needsVision = hasImages(req.messages);
    const hasFileUris = hasGeminiFileData(req.messages);
    const errors: Array<{ provider: string; error: string }> = [];

    const geminiReady = this.providers.some((p) => p.name === 'gemini' && p.isConfigured() && p.breaker.canAttempt());

    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        continue;
      }
      if (hasFileUris && geminiReady && provider.name !== 'gemini') {
        continue;
      }
      if (needsVision && !provider.supports.vision) {
        continue;
      }
      if (!provider.breaker.canAttempt()) {
        logger.warn({ provider: provider.name }, 'Skipping provider due to open circuit breaker');
        continue;
      }

      let emittedAny = false;
      const capturedDelta = (token: string) => {
        emittedAny = true;
        opts.onDelta(token);
      };

      const providerMessages =
        provider.name === 'gemini' ? req.messages : sanitizeMessagesForOpenAi(req.messages);

      try {
        const result = await provider.chatStream(
          {
            ...req,
            messages: providerMessages,
            modelType: needsVision ? 'vision' : req.modelType,
          },
          {
            signal: opts.signal,
            onDelta: capturedDelta,
            firstTokenTimeoutMs: Number(process.env.LLM_FIRST_TOKEN_TIMEOUT_MS || 8000),
            totalTimeoutMs: Number(process.env.LLM_TOTAL_TIMEOUT_MS || 45000),
          }
        );
        return { ...result, provider: provider.name };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ provider: provider.name, error: errMsg }, 'Provider attempt failed in chain');
        errors.push({ provider: provider.name, error: errMsg });

        // If tokens were already emitted to the user before failure, reset widget stream!
        if (emittedAny && opts.onStreamReset) {
          logger.info({ provider: provider.name }, 'Mid-stream failure; sending stream_reset before trying next provider');
          opts.onStreamReset();
        }
      }
    }

    throw new Error(
      `All configured providers in fallback chain failed: ${errors
        .map((e) => `[${e.provider}: ${e.error}]`)
        .join(', ')}`
    );
  }

  async completeWithTools(
    req: NormalizedToolRequest,
    opts: { signal?: AbortSignal }
  ): Promise<LlmCompletionResult & { provider: string }> {
    const needsVision = hasImages(req.messages);
    const hasFileUris = hasGeminiFileData(req.messages);
    const errors: Array<{ provider: string; error: string }> = [];

    const geminiReady = this.providers.some((p) => p.name === 'gemini' && p.isConfigured() && p.breaker.canAttempt());

    for (const provider of this.providers) {
      if (!provider.isConfigured() || !provider.completeWithTools) {
        continue;
      }
      if (hasFileUris && geminiReady && provider.name !== 'gemini') {
        continue;
      }
      if (needsVision && !provider.supports.vision) {
        continue;
      }
      if (!provider.breaker.canAttempt()) {
        logger.warn({ provider: provider.name }, 'Skipping provider due to open circuit breaker');
        continue;
      }

      const providerMessages =
        provider.name === 'gemini' ? req.messages : sanitizeMessagesForOpenAi(req.messages);

      try {
        const res = await provider.completeWithTools(
          {
            ...req,
            messages: providerMessages,
            modelType: needsVision ? 'vision' : 'strong',
          },
          { signal: opts.signal, totalTimeoutMs: Number(process.env.LLM_TOTAL_TIMEOUT_MS || 45000) }
        );
        return { ...res, provider: provider.name };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ provider: provider.name, error: errMsg }, 'Provider completeWithTools failed in chain');
        errors.push({ provider: provider.name, error: errMsg });
      }
    }

    throw new Error(
      `All configured providers failed completeWithTools: ${errors
        .map((e) => `[${e.provider}: ${e.error}]`)
        .join(', ')}`
    );
  }
}
