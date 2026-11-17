import crypto from 'node:crypto';
import {
  DEFAULT_AGENT_MAX_STEPS,
  type AppProfile,
  type AssistantSseEvent,
  type ChatAttachment,
  type ChatMessage,
  type PersonalizationSettings,
  type RightClickContext,
  type SourceCitation,
} from '@ai-assistant/core';
import { logger, type ServerConfig } from '../config.ts';
import { createConfirmationToken, type ActionLogStore } from '../security/confirmation.ts';
import { detectLanguage, wrapUntrustedData } from '../security/sanitize.ts';
import type { ResponseCache } from '../security/limits.ts';
import { retrieveForQuery } from '../rag/retriever.ts';
import type { Embedder } from '../rag/embedder.ts';
import type { VectorStore } from '../rag/store.ts';
import type { ToolRegistry } from '../tools/registry.ts';
import { inferDeterministicToolCall, shouldUseAgentLoop } from './intentParser.ts';
import {
  compressScreenshotDataUrl,
  type LlmChatMessage,
  type LlmGateway,
  type OpenAiToolSpec,
} from './client.ts';
import { buildSystemPrompt, trimHistoryToBudget } from './prompts.ts';
import type { AccessScope } from '../security/scope.ts';
import type { AssistantRepository } from '../db/assistantRepository.ts';
import type { OrgCreditStore } from '../billing/creditStore.ts';
import type { BillingStatusSnapshot } from '../billing/types.ts';
import { getRankedChips, resolvePageId } from '../chips/pageRegistry.ts';
import { summarizeConversationBackground } from './summarizer.ts';
import { recordUserFailedRequest } from '../tools/datasetState.ts';
import {
  buildOfflinePublicReply,
  buildPublicGuardRefusalMessage,
  classifyPublicAuthQuery,
  isPublicAuthContext,
} from './publicGuard.ts';

export { inferDeterministicToolCall, shouldUseAgentLoop } from './intentParser.ts';

export function isBillingStatusQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (!q) return false;
  if (/\b(how\s+(?:do\s+i|to)\s+upgrade|guide\s*me|walkthrough|step\s+by\s+step|cancel\s+(?:my\s+)?(?:plan|subscription)|upgrade\s+to\s+premium)\b/i.test(q)) {
    return false;
  }
  return (
    /\b(?:is\s+(?:it\s+)?(?:my\s+|our\s+|this\s+)?account\s+(?:is\s+)?(?:premium|free)|am\s+i\s+(?:on\s+)?(?:premium|free)|do\s+(?:i|we)\s+have\s+premium|check\s+(?:my\s+|our\s+)?(?:plan|subscription|billing|credits)|what(?:'s|\s+is)\s+(?:my|our)\s+(?:current\s+)?(?:plan|subscription|billing|credit)|how\s+many\s+credits|credits?\s+(?:left|remaining|balance)|(?:plan|subscription|premium)\s+status|when\s+does\s+(?:my|our)\s+premium\s+(?:expire|renew))\b/i.test(
      q
    ) ||
    (/^(?:premium|plan|credits|subscription)\??$/i.test(q))
  );
}

export function formatBillingStatusReply(
  snap: BillingStatusSnapshot,
  lang: 'en' | 'ml' = 'en'
): string {
  const isPremium = snap.effectivePlan === 'premium';
  const intervalLabel =
    snap.planInterval === 'annual' ? 'Annual' : snap.planInterval === 'monthly' ? 'Monthly' : 'Standard';
  const expiryDate = snap.premiumExpiresAt ? snap.premiumExpiresAt.slice(0, 10) : null;
  const resetDate = snap.periodEnd.slice(0, 10);

  if (lang === 'ml') {
    if (isPremium) {
      return `അതെ — നിങ്ങളുടെ ഓർഗനൈസേഷൻ (**${snap.orgId}**) നിലവിൽ **Premium (${intervalLabel})** പ്ലാനിലാണ് (**${snap.status}**).\n- **AI ക്രെഡിറ്റുകൾ:** പരിധിയില്ലാതെ ഉപയോഗിക്കാം (Unlimited)\n- **ഉപയോക്താക്കൾ:** അഡ്മിൻ, സെക്ടർ മാനേജർമാർ, വിദ്യാർത്ഥികൾ എല്ലാവർക്കും AI Assistant ലഭ്യമാണ്.${expiryDate ? `\n- **കാലാവധി:** ${expiryDate} വരെ` : ''}`;
    }
    return `നിങ്ങളുടെ ഓർഗനൈസേഷൻ (**${snap.orgId}**) നിലവിൽ **Free** പ്ലാനിലാണ്.\n- **ബാക്കി ക്രെഡിറ്റുകൾ:** ഈ മാസം ${snap.creditsRemaining} / ${snap.creditsMonthlyAllowance} ക്രെഡിറ്റുകൾ ബാക്കിയുണ്ട് (അടുത്ത പുതുക്കൽ: ${resetDate}).\n- **ലഭ്യത:** Free പ്ലാനിൽ അഡ്മിന് മാത്രമാണ് AI Assistant ഉപയോഗിക്കാൻ കഴിയുക. Unlimited ഉപയോഗത്തിന് **Plan & Credits** പേജിൽ നിന്ന് Premium-ലേക്ക് അപ്ഗ്രേഡ് ചെയ്യാം.`;
  }

  if (isPremium) {
    const statusNote =
      snap.status === 'cancelled' && expiryDate
        ? `Cancelled (remains active until **${expiryDate}**)`
        : `Active (${intervalLabel})`;
    return [
      `Yes — your organization (**${snap.orgId}**) is currently on the **Premium** plan.`,
      `- **Status:** ${statusNote}`,
      `- **AI Credits:** Unlimited across your workspace`,
      `- **Access:** Admin, sector managers, and imported students can all use Khazna AI.`,
      ...(expiryDate ? [`- **Renewal / Expiry Date:** ${expiryDate}`] : []),
    ].join('\n');
  }

  return [
    `Your organization (**${snap.orgId}**) is currently on the **Free** plan (status: **${snap.status}**).`,
    `- **AI Credits:** **${snap.creditsRemaining} of ${snap.creditsMonthlyAllowance}** remaining this calendar month (resets **${resetDate}**).`,
    `- **Access:** Only the organization **Admin** can use Khazna AI on the Free plan. Upgrade to **Premium** on **Plan & Credits** to unlock Unlimited credits for all managers and students.`,
  ].join('\n');
}

const FORCE_INFERRED_TOOLS = new Set([
  'addStudent',
  'markStudentPaid',
  'unmarkStudentPaid',
  'createSector',
  'addFund',
  'importStudents',
  'controlAppUi',
  'addBook',
  'borrowBook',
  'returnBook',
  'khaznaGetOverview',
  'khaznaGetStudentAccount',
  'khaznaListStudents',
  'khaznaListTransactions',
  'khaznaCreateCollegeAccount',
  'khaznaNavigate',
  'khaznaOpenInteractiveForm',
  'khaznaCreateEntry',
  'khaznaCollectDues',
  'khaznaEditEntry',
  'khaznaVoidEntry',
  'khaznaUnvoidEntry',
  'khaznaAddStudent',
  'khaznaEditStudent',
  'khaznaDeleteStudent',
  'khaznaCreateSector',
  'khaznaUpdateSector',
  'khaznaDeleteSector',
  'khaznaManageClass',
  'khaznaPostBatch',
  'khaznaVoidBatch',
  'khaznaDeleteBatch',
  'khaznaImportStudents',
  'khaznaImportManagers',
  'khaznaImportBulkEntries',
  'khaznaImportSectors',
  'khaznaDownloadReport',
  'khaznaDownloadStudentStatement',
  'khaznaDownloadAuditCsv',
  'khaznaDownloadTemplateCsv',
  'khaznaPrintPage',
  'khaznaManageManager',
  'khaznaUpdateInstitution',
  'khaznaManageSignatory',
  'khaznaManageIssuedReport',
  'khaznaUpdatePhone',
  'khaznaMarkNoticeRead',
  'khaznaSetTheme',
  'khaznaManageWorkspace',
  'find_students',
  'get_student',
  'list_students',
  'summarize_student_finance',
  'find_sectors',
  'get_sector',
  'summarize_sector_finance',
  'find_classes',
  'get_class',
  'summarize_class',
  'report_class',
  'find_payments',
  'list_payments',
  'summarize_collections',
  'compare_periods',
  'report_defaulters',
  'get_receipt',
  'list_batches',
  'get_batch',
  'summarize_batches',
  'find_users',
  'list_users',
  'get_user',
  'summarize_managers',
  'find_funds',
  'list_funds',
  'get_fund',
  'report_fund_utilization',
  'list_signatories',
  'get_signatory',
  'summarize_signatories',
  'list_notices',
  'get_notice',
  'summarize_notices',
  'list_issued_reports',
  'get_issued_report',
  'summarize_issued_reports',
  'list_audit_logs',
  'get_audit_log',
  'summarize_audit_activity',
  'list_organizations',
  'get_organization',
  'summarize_platform_usage',
  'query_data',
  'query_entities',
  'search_guides',
  'start_guide',
  'search_entities',
  'get_entity_details',
  'export_data',
]);

function redactSensitiveArgs(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(redactSensitiveArgs);
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (/password|secret|token/i.test(k)) {
        out[k] = '••••••••';
      } else {
        out[k] = redactSensitiveArgs(v);
      }
    }
    return out;
  }
  return val;
}

function sanitizeRawToolArgs(
  raw: Record<string, unknown>,
  toolName: string,
  scope?: AccessScope
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') continue;
      if (trimmed === 'true') {
        cleaned[k] = true;
        continue;
      }
      if (trimmed === 'false') {
        cleaned[k] = false;
        continue;
      }
      cleaned[k] = trimmed;
      continue;
    }
    cleaned[k] = v;
  }

  if (scope?.role === 'SECTOR_MANAGER' && scope.sectorIds.length > 0) {
    const assigned = scope.sectorIds[0];
    if (toolName === 'get_sector' || toolName === 'summarize_sector_finance') {
      const secVal = String(cleaned.sector || '').trim().toLowerCase();
      if (!secVal || secVal === 'my sector' || secVal === 'this sector') {
        cleaned.sector = assigned;
      }
    } else if (toolName === 'find_sectors' && cleaned.query === undefined) {
      cleaned.query = '';
    }
  }

  return cleaned;
}

export async function runChatAgent(params: {
  profile: AppProfile;
  messages: ChatMessage[];
  context?: RightClickContext;
  contexts?: RightClickContext[];
  attachments?: ChatAttachment[];
  requestedLanguage?: string;
  appState?: Record<string, unknown>;
  personalization?: PersonalizationSettings;
  userId: string;
  authToken: string;
  cfg: ServerConfig;
  embedder: Embedder;
  vectorStore: VectorStore;
  llm: LlmGateway;
  toolRegistry: ToolRegistry;
  actionStore: ActionLogStore;
  cache: ResponseCache;
  emit: (event: AssistantSseEvent) => void;
  maxSteps?: number;
  scope?: AccessScope;
  repository?: AssistantRepository;
  creditStore?: OrgCreditStore;
  conversationId?: string;
}): Promise<{
  refusal: boolean;
  model: string;
  topScore: number;
  citations: SourceCitation[];
  latencyMs: number;
  provider?: string;
}> {
  const startMs = Date.now();
  const {
    profile,
    messages,
    context,
    contexts,
    attachments = [],
    requestedLanguage,
    appState,
    personalization,
    userId,
    authToken,
    cfg,
    embedder,
    vectorStore,
    llm,
    toolRegistry,
    actionStore,
    cache,
    emit,
    maxSteps = DEFAULT_AGENT_MAX_STEPS,
    scope,
    repository,
    creditStore,
    conversationId,
  } = params;

  // Cap history to 12 messages max
  const trimmedHistory = trimHistoryToBudget(messages, 2500).slice(-12);
  const lastUserMsg = [...trimmedHistory].reverse().find((m) => m.role === 'user');
  const question = lastUserMsg?.content || '';
  const effectiveLangReq =
    requestedLanguage === 'ml' || requestedLanguage === 'en'
      ? requestedLanguage
      : personalization?.preferredLanguage === 'ml' || personalization?.preferredLanguage === 'en'
        ? personalization.preferredLanguage
        : undefined;
  const detectedLang =
    effectiveLangReq === 'ml' || effectiveLangReq === 'en'
      ? effectiveLangReq
      : detectLanguage(question);

  const mergedContexts =
    contexts && contexts.length > 0 ? contexts : context ? [context] : [];
  const imageAttachments = attachments.filter((a) => a.type === 'image' && (a.dataUrl || a.geminiFileUri));
  const fileAttachments = attachments.filter((a) => a.type === 'file');
  const hasGeminiFileAttachment = fileAttachments.some((f) => Boolean(f.geminiFileUri));
  const hasScreenshot = imageAttachments.length > 0 || hasGeminiFileAttachment;
  const tools = toolRegistry.getToolsForProfile(profile, scope);
  const useTools = shouldUseAgentLoop(question, profile, attachments);

  emit({ type: 'status', phase: 'thinking', label: 'Analyzing request & active context…' });

  // 0. Sign-in / Sign-up Page Guardrail: ONLY login, signup/create-org, password help, or AI Assistant features
  const routeHint =
    mergedContexts[0]?.routePath ||
    (typeof appState?.pathname === 'string' ? appState.pathname : undefined);
  const isPublicAuth = isPublicAuthContext(scope, routeHint, appState);
  let publicCategory: 'auth_help' | 'assistant_features' | 'greeting' | null = null;

  if (isPublicAuth) {
    const contextText = mergedContexts
      .map((c) => `${c.nearbyLabel || ''} ${c.text || ''}`)
      .join(' ')
      .trim();
    const classification = classifyPublicAuthQuery(question, {
      hasAttachments: imageAttachments.length > 0 || fileAttachments.length > 0,
      hasContext: mergedContexts.length > 0,
      contextText,
    });

    if (!classification.allowed || classification.category === 'blocked') {
      const refusalText = buildPublicGuardRefusalMessage(detectedLang);
      emit({ type: 'status', phase: 'completed', label: 'Sign-in or create an organization first' });
      emit({ type: 'token', delta: refusalText });
      const publicScope: AccessScope = scope || { role: 'PUBLIC', userId: 'guest' };
      emit({
        type: 'follow_up_chips',
        chips: getRankedChips({
          scope: publicScope,
          pageId: 'auth.login',
          lang: detectedLang,
          limit: 3,
        }),
      });
      const latencyMs = Date.now() - startMs;
      emit({
        type: 'done',
        refusal: true,
        model: 'public-auth-guard',
        provider: 'local',
        latencyMs,
        sources: [],
      });
      return {
        refusal: true,
        model: 'public-auth-guard',
        provider: 'local',
        topScore: 0,
        citations: [],
        latencyMs,
      };
    }

    publicCategory = classification.category;
  }

  // 0b. Verified Organization Plan & Credit Status query (direct accurate answer from OrgCreditStore)
  let billingStatus: BillingStatusSnapshot | undefined;
  if (creditStore && scope && scope.role !== 'PUBLIC' && !isPublicAuth) {
    const orgId =
      'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
    try {
      billingStatus = await creditStore.getStatus(orgId, scope.role, scope.userId);
    } catch (err) {
      logger.warn({ err, orgId }, 'Unable to load billing status in agentLoop');
    }

    if (billingStatus && isBillingStatusQuestion(question) && !hasScreenshot && fileAttachments.length === 0) {
      const reply = formatBillingStatusReply(billingStatus, detectedLang);
      emit({ type: 'status', phase: 'completed', label: 'Checked organization plan & credits' });
      for (const token of reply.split(/(\s+)/)) {
        if (token) emit({ type: 'token', delta: token });
      }
      const pageId = resolvePageId(
        mergedContexts[0]?.routePath || (appState?.pathname as string) || ''
      );
      emit({
        type: 'follow_up_chips',
        chips: getRankedChips({
          scope,
          pageId,
          lang: detectedLang,
          limit: 3,
        }),
      });
      if (repository) {
        const convId = conversationId || 'conv-default';
        void repository.appendMessage(convId, scope, 'user', question);
        void repository.appendMessage(convId, scope, 'assistant', reply);
      }
      const latencyMs = Date.now() - startMs;
      emit({
        type: 'done',
        refusal: false,
        model: 'billing-status-store',
        provider: 'local',
        latencyMs,
        sources: [],
      });
      return {
        refusal: false,
        model: 'billing-status-store',
        provider: 'local',
        topScore: 1,
        citations: [],
        latencyMs,
      };
    }
  }

  // 1. Short-TTL Cache lookup for plain Q&A without attachments
  const contextKey = mergedContexts
    .map((c) => `${c.cssSelector || ''}|${(c.text || '').slice(0, 80)}`)
    .join(';');
  const scopeCacheTag = scope
    ? `${scope.role}:${scope.userId}:${'organizationId' in scope ? scope.organizationId || '' : ''}:${'sectorIds' in scope ? scope.sectorIds.join(',') : ''}:${billingStatus?.effectivePlan || ''}`
    : 'anon';
  const cacheKey =
    !hasScreenshot && fileAttachments.length === 0 && !useTools && !appState
      ? cache.makeKey(`${profile.appId}:${scopeCacheTag}`, question, detectedLang, mergedContexts[0]?.routePath, contextKey)
      : '';

  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
      emit({ type: 'source', sources: cached.sources });
      emit({ type: 'token', delta: cached.answer });
      const latencyMs = Date.now() - startMs;
      emit({
        type: 'done',
        refusal: cached.refusal,
        model: cached.model,
        latencyMs,
        sources: cached.sources,
        cached: true,
      });
      return {
        refusal: cached.refusal,
        model: cached.model,
        topScore: 1,
        citations: cached.sources,
        latencyMs,
      };
    }
  }

  // 2. RAG retrieval with strict appId isolation & out-of-scope guard
  // Allow live UI element inspections and explicit agent tool commands with custom names/values
  const isElementInspection =
    mergedContexts.some((c) => Boolean(c.text || c.nearbyLabel || c.cssSelector)) &&
    /\b(what does .* show|what is shown|what is this|explain.*(div|section|element|this|area|card)|describe.*(div|section|this|area|card))\b/i.test(
      question
    );

  const inferredTool = useTools
    ? inferDeterministicToolCall(question, tools, attachments, context, mergedContexts, {
        conversationId,
        scope,
      })
    : null;

  const hasDomainEntityAction =
    useTools &&
    (/\b(student|students|sector|sectors|union|fund|funds|charity|grant|endowment|fee|fees|financial|finance|finances|transaction|transactions|admission|book|books|loan|loans|catalog|library|tab|khazna|ledger|receipt|void|unvoid|batch|class|deposit|debit|credit|tuition|mess|fiqh|civil|ihsan|velitcham|audit|report|reports|issued|notifications|notice|profile|signatory|institution|download|export|print|pdf|excel|xlsx|xls|csv|word|docx|doc|json|txt|sheet|spreadsheet|same\s+as|this\s+list|pages|numbers|odt|rtf|xml|statement|template|phone|org|organization|organizations|college|colleges|workspace|edit|invite|revoke|extend|theme|dark|light|demo|domo|model|logout|log\s*out|sign\s*out|signout|session|section|admin|manager|account|signup|sign\s*up|campus|password|display|overview|summary|balance|bulk|upload|stable|dues|owe|owes|collect|paid|status|who\s+is|who's|who\s+are|where\s+is|tell\s+me\s+about|on\s+leave|teacher|teachers|principal|staff|clerk|shelf|shelves|isbn|leave|employee)\b/i.test(
      question
    ) ||
      /\bS\d{3,5}\b/i.test(question) ||
      /\b(DF|OF|EF|TF)-\d+\b/i.test(question));

  const retrieval = await retrieveForQuery({
    profile,
    question: question || (hasScreenshot ? 'screenshot help' : 'import file'),
    context,
    contexts: mergedContexts,
    embedder,
    store: vectorStore,
    scope,
    bypassOutOfScopeGuard:
      hasScreenshot ||
      fileAttachments.length > 0 ||
      isElementInspection ||
      Boolean(inferredTool) ||
      hasDomainEntityAction ||
      Boolean(publicCategory),
  });

  if (retrieval.refused) {
    const refusalText = retrieval.refusalMessage || profile.refusalMessage;
    emit({ type: 'status', phase: 'completed', label: 'Out-of-scope check complete' });
    emit({ type: 'token', delta: refusalText });
    const latencyMs = Date.now() - startMs;
    emit({
      type: 'done',
      refusal: true,
      model: 'guard-bypass',
      latencyMs,
      sources: [],
    });
    if (cacheKey) {
      cache.set(cacheKey, {
        answer: refusalText,
        sources: [],
        refusal: true,
        model: 'guard-bypass',
      });
    }
    return {
      refusal: true,
      model: 'guard-bypass',
      topScore: retrieval.topScore,
      citations: [],
      latencyMs,
    };
  }

  emit({ type: 'source', sources: retrieval.citations });

  // 3. Build system prompt with untrusted-data framing
  const systemPrompt = buildSystemPrompt({
    profile,
    chunks: retrieval.chunks,
    language: detectedLang,
    context,
    contexts: mergedContexts,
    hasScreenshot,
    availableTools: Array.from(tools.keys()),
    agentMode: useTools && !hasScreenshot,
    appState,
    personalization,
    scope,
    userId,
    billingStatus,
  });

  const llmMessages: LlmChatMessage[] = [{ role: 'system', content: systemPrompt }];
  for (let i = 0; i < trimmedHistory.length; i += 1) {
    const msg = trimmedHistory[i];
    const isLastUser = i === trimmedHistory.length - 1 && msg.role === 'user';

    let contentText = msg.content;
    if (isLastUser && fileAttachments.length > 0) {
      const fileSummary = fileAttachments
        .map((f) => {
          const head = `Attached file "${f.name}" (mime: ${f.mimeType}, uploadId: ${f.uploadId || 'none'}): ${f.previewSummary || ''}`;
          return f.extractedText ? `${head}\n${f.extractedText}` : head;
        })
        .join('\n\n');
      contentText = `${contentText}\n\n${wrapUntrustedData('uploaded_file_summary', fileSummary)}`;
    }

    const multimodalParts: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
      | { type: 'file_data'; file_data: { fileUri: string; mimeType: string } }
    > = [];

    if (isLastUser && (imageAttachments.length > 0 || hasGeminiFileAttachment)) {
      const compressedImages = await Promise.all(
        imageAttachments
          .filter((img) => Boolean(img.dataUrl))
          .map((img) => compressScreenshotDataUrl(img.dataUrl!))
      );
      multimodalParts.push({
        type: 'text',
        text: contentText || 'Please inspect the attached file(s) or screenshot and help me.',
      });
      for (const img of imageAttachments) {
        if (img.geminiFileUri) {
          multimodalParts.push({
            type: 'file_data',
            file_data: { fileUri: img.geminiFileUri, mimeType: img.mimeType || 'image/jpeg' },
          });
        }
      }
      for (const url of compressedImages) {
        multimodalParts.push({
          type: 'image_url',
          image_url: { url },
        });
      }
      for (const f of fileAttachments) {
        if (f.geminiFileUri) {
          multimodalParts.push({
            type: 'file_data',
            file_data: { fileUri: f.geminiFileUri, mimeType: f.mimeType || 'application/pdf' },
          });
        }
      }
      llmMessages.push({
        role: 'user',
        content: multimodalParts,
      });
    } else {
      llmMessages.push({
        role: msg.role,
        content: contentText,
      });
    }
  }

  // 4. Plain Q&A or Vision streaming path (MODEL_FAST / MODEL_VISION)
  const explicitPublicGuideRequested =
    /\b(guide\s*me|walkthrough|walk\s+me\s+through|step\s+by\s+step|show\s+me\s+how)\b/i.test(
      question
    );
  const shouldBypassToolsForPublicOverview =
    publicCategory === 'greeting' ||
    publicCategory === 'assistant_features' ||
    (publicCategory === 'auth_help' && (!inferredTool || !explicitPublicGuideRequested));

  if (!useTools || hasScreenshot || shouldBypassToolsForPublicOverview) {
    let fullText = '';
    let modelUsed = cfg.modelFast;
    let provider: string | undefined = 'local';

    if (publicCategory && !llm.hasLiveProvider && !hasScreenshot) {
      fullText = buildOfflinePublicReply(publicCategory, question, detectedLang);
      for (const token of fullText.split(/(\s+)/)) {
        if (token) emit({ type: 'token', delta: token });
      }
      modelUsed = 'public-auth-guide-local';
      provider = 'local';
    } else {
      const selectedModel = hasScreenshot ? cfg.modelVision : cfg.modelFast;
      const streamed = await llm.streamChat({
        model: selectedModel,
        messages: llmMessages,
        retrievedChunks: retrieval.chunks,
        language: detectedLang,
        onDelta: (delta) => emit({ type: 'token', delta }),
        onStreamReset: () => emit({ type: 'stream_reset' }),
      });
      fullText = streamed.fullText;
      modelUsed = streamed.modelUsed;
      provider = streamed.provider;
    }

    if (cacheKey && fullText) {
      cache.set(cacheKey, {
        answer: fullText,
        sources: retrieval.citations,
        refusal: false,
        model: modelUsed,
      });
    }

    // Follow-up prompt chips for active role & page
    const effectiveScope: AccessScope = scope || {
      role: 'STUDENT',
      userId,
      studentId: userId,
      organizationId: 'demo',
      sectorId: 'dept-fiqh',
    };
    const pageId = resolvePageId(
      mergedContexts[0]?.routePath || (appState?.pathname as string) || ''
    );
    const followUp = getRankedChips({
      scope: effectiveScope,
      pageId,
      lang: detectedLang,
      limit: 3,
    });
    emit({ type: 'follow_up_chips', chips: followUp });

    if (repository && scope) {
      const convId = conversationId || 'conv-default';
      void repository.appendMessage(convId, scope, 'user', question);
      void repository.appendMessage(convId, scope, 'assistant', fullText);
      if (messages.length >= 12) {
        void summarizeConversationBackground({
          conversationId: convId,
          scope,
          messages,
          repository,
          llm,
          cfg,
        });
      }
    }

    const latencyMs = Date.now() - startMs;
    emit({
      type: 'done',
      refusal: false,
      model: modelUsed,
      provider: provider || 'openrouter',
      latencyMs,
      sources: retrieval.citations,
    });
    return {
      refusal: false,
      model: modelUsed,
      provider: provider || 'openrouter',
      topScore: retrieval.topScore,
      citations: retrieval.citations,
      latencyMs,
    };
  }

  // 5. Agent Tool-Calling Loop on MODEL_STRONG (max 6 steps, repeated-call guard)
  const openAiTools: OpenAiToolSpec[] = Array.from(tools.values()).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonParameters,
    },
  }));

  const seenCalls = new Set<string>();
  let modelUsed = cfg.modelStrong;
  let providerUsed = 'local';
  let lastActionLogId: string | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    let completion: {
      content: string;
      toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
      modelUsed: string;
      provider?: string;
    };

    const fastInferred =
      step === 0
        ? inferDeterministicToolCall(question, tools, attachments, context, mergedContexts, {
            conversationId,
            scope,
          })
        : null;

    if (fastInferred && FORCE_INFERRED_TOOLS.has(fastInferred.name)) {
      completion = {
        content: '',
        toolCalls: [
          {
            id: `call_${crypto.randomUUID().slice(0, 8)}`,
            name: fastInferred.name,
            argumentsJson: JSON.stringify(fastInferred.args),
          },
        ],
        modelUsed: 'instant-intent-router',
        provider: 'local',
      };
      modelUsed = completion.modelUsed;
      providerUsed = 'local';
    } else {
      completion = await llm.completeWithTools({
        model: cfg.modelStrong,
        messages: llmMessages,
        tools: openAiTools,
        retrievedChunks: retrieval.chunks,
        language: detectedLang,
      });
      modelUsed = completion.modelUsed;
      providerUsed = completion.provider || providerUsed;
    }

    // Deterministic tool fallback on step 0 when offline, on local fallback, or for explicit agent action intents
    if (step === 0 && completion.toolCalls.length === 0) {
      const inferred =
        fastInferred ||
        inferDeterministicToolCall(question, tools, attachments, context, mergedContexts, {
          conversationId,
          scope,
        });
      const shouldForceInferred =
        inferred &&
        (!llm.hasLiveProvider ||
          completion.modelUsed === 'local-grounded-fallback' ||
          FORCE_INFERRED_TOOLS.has(inferred.name));
      if (shouldForceInferred && inferred) {
        completion = {
          ...completion,
          toolCalls: [
            {
              id: `call_${crypto.randomUUID().slice(0, 8)}`,
              name: inferred.name,
              argumentsJson: JSON.stringify(inferred.args),
            },
          ],
        };
      }
    }

    if (completion.toolCalls.length === 0) {
      const answer = completion.content || 'Done.';
      emit({ type: 'token', delta: answer });

      // Follow-up prompt chips for active role & page
      const effectiveScope: AccessScope = scope || {
        role: 'STUDENT',
        userId,
        studentId: userId,
        organizationId: 'demo',
        sectorId: 'dept-fiqh',
      };
      const pageId = resolvePageId(
        mergedContexts[0]?.routePath || (appState?.pathname as string) || ''
      );
      const followUp = getRankedChips({
        scope: effectiveScope,
        pageId,
        lang: detectedLang,
        limit: 3,
      });
      emit({ type: 'follow_up_chips', chips: followUp });

      if (repository && scope) {
        const convId = conversationId || 'conv-default';
        void repository.appendMessage(convId, scope, 'user', question);
        void repository.appendMessage(convId, scope, 'assistant', answer);
        if (messages.length >= 12) {
          void summarizeConversationBackground({
            conversationId: convId,
            scope,
            messages,
            repository,
            llm,
            cfg,
          });
        }
      }

      const latencyMs = Date.now() - startMs;
      emit({
        type: 'done',
        refusal: false,
        model: modelUsed,
        provider: providerUsed,
        latencyMs,
        sources: retrieval.citations,
        actionLogId: lastActionLogId,
      });
      return {
        refusal: false,
        model: modelUsed,
        provider: providerUsed,
        topScore: retrieval.topScore,
        citations: retrieval.citations,
        latencyMs,
      };
    }

    // Add assistant tool_call turn to history
    llmMessages.push({
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      })),
    });

    for (const tc of completion.toolCalls) {
      const callSignature = `${tc.name}::${tc.argumentsJson}`;
      if (seenCalls.has(callSignature)) {
        const stopMsg = 'Stopped agent execution to avoid repeating the identical tool call.';
        emit({ type: 'token', delta: stopMsg });
        const latencyMs = Date.now() - startMs;
        emit({
          type: 'done',
          refusal: false,
          model: modelUsed,
          latencyMs,
          sources: retrieval.citations,
        });
        return {
          refusal: false,
          model: modelUsed,
          topScore: retrieval.topScore,
          citations: retrieval.citations,
          latencyMs,
        };
      }
      seenCalls.add(callSignature);

      const tool = tools.get(tc.name);
      if (!tool) {
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify({ error: `Tool "${tc.name}" is not enabled for app "${profile.appId}".` }),
        });
        continue;
      }

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.argumentsJson || '{}') as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }

      const sanitizedArgs = sanitizeRawToolArgs(parsedArgs, tool.name, scope);
      const validated = tool.inputSchema.safeParse(sanitizedArgs);
      if (!validated.success) {
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify({
            error: 'Invalid tool arguments',
            issues: validated.error.issues.map((i) => i.message),
          }),
        });
        continue;
      }

      const cleanArgs = validated.data as Record<string, unknown>;
      const safeArgs = redactSensitiveArgs(cleanArgs) as Record<string, unknown>;

      emit({ type: 'status', phase: 'checking_permissions', label: 'Checking role & permissions…' });

      // Strict role-based parameter security enforcement
      if (scope) {
        if (scope.role === 'SECTOR_MANAGER') {
          const reqSector = String(cleanArgs.sector || cleanArgs.sectorCode || cleanArgs.sectorSlug || '').trim();
          if (reqSector && !scope.sectorIds.some((s) => s.toLowerCase() === reqSector.toLowerCase())) {
            const deniedSummary = `Access denied: You only have access to your assigned sector (${scope.sectorIds.join(', ')}).`;
            emit({ type: 'token', delta: deniedSummary });
            const latencyMs = Date.now() - startMs;
            emit({ type: 'done', refusal: false, model: modelUsed, latencyMs, sources: [] });
            return { refusal: false, model: modelUsed, topScore: 1, citations: [], latencyMs };
          }
        } else if (scope.role === 'STUDENT') {
          const reqStu = String(cleanArgs.studentId || '').trim();
          if (reqStu && reqStu.toLowerCase() !== scope.studentId.toLowerCase()) {
            const deniedSummary = `Access denied: You can only view your own records (${scope.studentId}).`;
            emit({ type: 'token', delta: deniedSummary });
            const latencyMs = Date.now() - startMs;
            emit({ type: 'done', refusal: false, model: modelUsed, latencyMs, sources: [] });
            return { refusal: false, model: modelUsed, topScore: 1, citations: [], latencyMs };
          }
        }
      }

      // IMMEDIATE AGENT ACTIONS (UI-click triggers AND auto-executing single-record mutations with Undo support)
      if (tool.uiTrigger || (tool.risk === 'write' && tool.autoExecute)) {
        emit({ type: 'status', phase: 'preparing_changes', label: `Preparing ${tool.name}…` });
        emit({
          type: 'tool_call',
          toolName: tool.name,
          risk: 'write',
          args: safeArgs,
          status: 'running',
        });

        try {
          emit({ type: 'status', phase: 'executing_action', label: `Executing ${tool.name}…` });
          const result = await tool.execute(cleanArgs, {
            appId: profile.appId,
            profile,
            userId,
            authToken,
            cfg,
            actionStore,
            appState,
            scope,
            conversationId,
          });

          if (!result.ok) {
            emit({ type: 'status', phase: 'failed', label: 'Action blocked or not found' });
            emit({
              type: 'tool_call',
              toolName: tool.name,
              risk: 'write',
              args: safeArgs,
              status: 'failed',
              summary: result.summary,
            });
            emit({ type: 'token', delta: result.summary });
            const latencyMs = Date.now() - startMs;
            emit({
              type: 'done',
              refusal: false,
              model: modelUsed,
              latencyMs,
              sources: retrieval.citations,
            });
            return {
              refusal: false,
              model: modelUsed,
              topScore: retrieval.topScore,
              citations: retrieval.citations,
              latencyMs,
            };
          }

          emit({ type: 'status', phase: 'verifying_result', label: 'Verifying result…' });
          const isFormClarificationOnly = Boolean(result.formRequest && !result.uiAction);
          let actionId = `act_${crypto.randomUUID()}`;

          if (isFormClarificationOnly) {
            emit({
              type: 'tool_call',
              toolName: tool.name,
              risk: 'write',
              args: safeArgs,
              status: 'completed',
              summary: result.summary,
            });
          } else {
            lastActionLogId = actionId;
            const logEntry = {
              id: actionId,
              appId: profile.appId,
              userId,
              toolName: tool.name,
              risk: 'write' as const,
              status: 'executed' as const,
              summary: result.summary,
              args: safeArgs,
              result: result.data,
              createdIds: result.createdIds || [],
              createdAt: new Date().toISOString(),
              executedAt: new Date().toISOString(),
            };
            actionStore.recordImmediateAction(logEntry);

            emit({
              type: 'tool_call',
              toolName: tool.name,
              risk: 'write',
              args: safeArgs,
              status: 'completed',
              summary: result.summary,
            });
            emit({
              type: 'action_executed',
              actionId,
              toolName: tool.name,
              summary: result.summary,
              details: safeArgs,
              canUndo: Boolean(tool.undo && (result.createdIds || []).length > 0),
              action: logEntry,
            });
          }
          if (result.uiAction) {
            emit({ type: 'status', phase: 'locating_section', label: result.uiAction.label || 'Navigating to section…' });
            emit({
              type: 'ui_action',
              actionId,
              action: result.uiAction.action,
              selector: result.uiAction.selector,
              fallbackTabSelector: result.uiAction.fallbackTabSelector,
              value: result.uiAction.value,
              highlightSelector: result.uiAction.highlightSelector,
              refreshApp: result.uiAction.refreshApp,
              cursorWaypoints: result.uiAction.cursorWaypoints,
              followUpActions: result.uiAction.followUpActions,
              appCommand: result.uiAction.appCommand,
              label: result.uiAction.label,
            });
            if (tool.name === 'start_guide') {
              emit({
                type: 'start_guide',
                guideId: String(cleanArgs.guideId || ''),
                startStep: typeof cleanArgs.startStep === 'string' ? cleanArgs.startStep : undefined,
              });
            }
          }
          if (result.formRequest) {
            emit({ type: 'form_request', form: result.formRequest });
          }
          emit({ type: 'status', phase: 'completed', label: 'Completed' });
          emit({ type: 'token', delta: result.summary });
          const effectiveScopeAfterWrite: AccessScope = scope || {
            role: 'STUDENT',
            userId,
            studentId: userId,
            organizationId: 'demo',
            sectorId: 'dept-fiqh',
          };
          const writePageId = resolvePageId(
            mergedContexts[0]?.routePath || (appState?.pathname as string) || ''
          );
          emit({
            type: 'follow_up_chips',
            chips: getRankedChips({
              scope: effectiveScopeAfterWrite,
              pageId: writePageId,
              lang: detectedLang,
              limit: 3,
            }),
          });
          const latencyMs = Date.now() - startMs;
          emit({
            type: 'done',
            refusal: false,
            model: modelUsed,
            latencyMs,
            sources: retrieval.citations,
            actionLogId: actionId,
          });
          return {
            refusal: false,
            model: modelUsed,
            topScore: retrieval.topScore,
            citations: retrieval.citations,
            latencyMs,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Agent action failed';
          recordUserFailedRequest({
            appId: profile.appId,
            scope,
            userId,
            prompt: question,
            reason: message,
          });
          emit({ type: 'status', phase: 'failed', label: 'Action failed' });
          emit({
            type: 'tool_call',
            toolName: tool.name,
            risk: 'write',
            args: safeArgs,
            status: 'failed',
            summary: message,
          });
          emit({ type: 'token', delta: `Could not complete action: ${message}` });
          const latencyMs = Date.now() - startMs;
          emit({
            type: 'done',
            refusal: false,
            model: modelUsed,
            latencyMs,
            sources: retrieval.citations,
          });
          return {
            refusal: false,
            model: modelUsed,
            topScore: retrieval.topScore,
            citations: retrieval.citations,
            latencyMs,
          };
        }
      }

      // WRITE TOOLS WITH EXPLICIT CONFIRMATION GATE (e.g. bulk spreadsheet importStudents)
      if (tool.risk === 'write') {
        emit({ type: 'status', phase: 'preparing_changes', label: 'Awaiting user confirmation…' });
        const actionId = `act_${crypto.randomUUID()}`;
        const summary = tool.summarize(safeArgs);
        const { token, expiresAt } = createConfirmationToken(
          {
            actionId,
            appId: profile.appId,
            userId,
            toolName: tool.name,
            args: cleanArgs,
          },
          cfg.confirmationSecret
        );

        actionStore.savePendingAction(
          {
            id: actionId,
            appId: profile.appId,
            userId,
            toolName: tool.name,
            risk: 'write',
            status: 'pending',
            summary,
            args: safeArgs,
            createdIds: [],
            createdAt: new Date().toISOString(),
          },
          cleanArgs
        );

        emit({
          type: 'confirmation_required',
          actionId,
          confirmationToken: token,
          toolName: tool.name,
          summary,
          details: safeArgs,
          expiresAt,
        });

        const msg = `I have prepared the action: **${summary}**. Please review and click **Confirm** to execute.`;
        emit({ type: 'status', phase: 'completed', label: 'Confirmation ready' });
        emit({ type: 'token', delta: msg });
        const latencyMs = Date.now() - startMs;
        emit({
          type: 'done',
          refusal: false,
          model: modelUsed,
          latencyMs,
          sources: retrieval.citations,
          actionLogId: actionId,
        });
        return {
          refusal: false,
          model: modelUsed,
          topScore: retrieval.topScore,
          citations: retrieval.citations,
          latencyMs,
        };
      }

      // READ TOOLS run automatically with the logged-in user's token
      emit({ type: 'status', phase: 'reading_info', label: `Reading ${tool.name}…` });
      emit({
        type: 'tool_call',
        toolName: tool.name,
        risk: 'read',
        args: safeArgs,
        status: 'running',
      });

      try {
        const result = await tool.execute(cleanArgs, {
          appId: profile.appId,
          profile,
          userId,
          authToken,
          cfg,
          actionStore,
          appState,
          scope,
          conversationId,
        });

        const logId = `act_${crypto.randomUUID()}`;
        lastActionLogId = logId;
        actionStore.recordImmediateAction({
          id: logId,
          appId: profile.appId,
          userId,
          toolName: tool.name,
          risk: 'read',
          status: 'executed',
          summary: result.summary,
          args: safeArgs,
          result: result.data,
          createdIds: [],
          createdAt: new Date().toISOString(),
          executedAt: new Date().toISOString(),
        });

        emit({
          type: 'tool_call',
          toolName: tool.name,
          risk: 'read',
          args: safeArgs,
          status: result.ok ? 'completed' : 'failed',
          summary: result.summary,
        });

        if (result.formRequest) {
          emit({ type: 'status', phase: 'completed', label: 'Input form ready' });
          emit({ type: 'form_request', form: result.formRequest });
          emit({ type: 'token', delta: result.summary });
          const latencyMs = Date.now() - startMs;
          emit({
            type: 'done',
            refusal: false,
            model: modelUsed,
            latencyMs,
            sources: retrieval.citations,
            actionLogId: logId,
          });
          return {
            refusal: false,
            model: modelUsed,
            topScore: retrieval.topScore,
            citations: retrieval.citations,
            latencyMs,
          };
        }

        if (result.uiAction) {
          emit({ type: 'status', phase: 'locating_section', label: result.uiAction.label || 'Opening section…' });
          emit({
            type: 'ui_action',
            actionId: logId,
            action: result.uiAction.action,
            selector: result.uiAction.selector,
            fallbackTabSelector: result.uiAction.fallbackTabSelector,
            value: result.uiAction.value,
            highlightSelector: result.uiAction.highlightSelector,
            refreshApp: result.uiAction.refreshApp,
            cursorWaypoints: result.uiAction.cursorWaypoints,
            followUpActions: result.uiAction.followUpActions,
            appCommand: result.uiAction.appCommand,
            label: result.uiAction.label,
          });
          if (tool.name === 'start_guide') {
            emit({
              type: 'start_guide',
              guideId: String(cleanArgs.guideId || ''),
              startStep: typeof cleanArgs.startStep === 'string' ? cleanArgs.startStep : undefined,
            });
          }
          emit({ type: 'status', phase: 'completed', label: 'Completed' });
          emit({ type: 'token', delta: result.summary });
          const uiEffectiveScope: AccessScope = scope || {
            role: 'STUDENT',
            userId,
            studentId: userId,
            organizationId: 'demo',
            sectorId: 'dept-fiqh',
          };
          emit({
            type: 'follow_up_chips',
            chips: getRankedChips({
              scope: uiEffectiveScope,
              pageId: resolvePageId(mergedContexts[0]?.routePath || (appState?.pathname as string) || ''),
              lang: detectedLang,
              limit: 3,
            }),
          });
          const latencyMs = Date.now() - startMs;
          emit({
            type: 'done',
            refusal: false,
            model: modelUsed,
            latencyMs,
            sources: retrieval.citations,
            actionLogId: logId,
          });
          return {
            refusal: false,
            model: modelUsed,
            topScore: retrieval.topScore,
            citations: retrieval.citations,
            latencyMs,
          };
        }

        // If deterministic read tool executed cleanly (or returned explicit access denied), surface verified summary
        if (
          !llm.hasLiveProvider ||
          result.ok === false ||
          result.exportFile ||
          tool.name === 'export_data' ||
          tool.name === 'khaznaGetStudentAccount' ||
          tool.name === 'khaznaGetOverview' ||
          tool.name === 'search_guides' ||
          FORCE_INFERRED_TOOLS.has(tool.name)
        ) {
          if (result.exportFile) {
            emit({ type: 'export_file', exportFile: result.exportFile });
          }
          emit({ type: 'status', phase: result.ok ? 'completed' : 'failed', label: result.ok ? 'Completed' : 'Access denied' });
          emit({ type: 'token', delta: result.summary });
          const readEffectiveScope: AccessScope = scope || {
            role: 'STUDENT',
            userId,
            studentId: userId,
            organizationId: 'demo',
            sectorId: 'dept-fiqh',
          };
          const chips =
            result.followUpChips && result.followUpChips.length > 0
              ? result.followUpChips
              : getRankedChips({
                  scope: readEffectiveScope,
                  pageId: resolvePageId(mergedContexts[0]?.routePath || (appState?.pathname as string) || ''),
                  lang: detectedLang,
                  limit: 3,
                });
          emit({
            type: 'follow_up_chips',
            chips,
          });
          const latencyMs = Date.now() - startMs;
          emit({
            type: 'done',
            refusal: false,
            model: modelUsed,
            latencyMs,
            sources: retrieval.citations,
            actionLogId: logId,
          });
          return {
            refusal: false,
            model: modelUsed,
            topScore: retrieval.topScore,
            citations: retrieval.citations,
            latencyMs,
          };
        }

        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tool.name,
          content: wrapUntrustedData(`tool_${tool.name}`, JSON.stringify(result.data)),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tool execution failed';
        logger.warn({ err, tool: tool.name, appId: profile.appId }, 'Read tool execution failed');
        emit({
          type: 'tool_call',
          toolName: tool.name,
          risk: 'read',
          args: cleanArgs,
          status: 'failed',
          summary: message,
        });
        llmMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: JSON.stringify({ error: message }),
        });
      }
    }
  }

  const maxStepMsg = 'Reached the maximum agent reasoning steps (6). Please refine your request.';
  emit({ type: 'token', delta: maxStepMsg });
  const latencyMs = Date.now() - startMs;
  emit({
    type: 'done',
    refusal: false,
    model: modelUsed,
    latencyMs,
    sources: retrieval.citations,
    actionLogId: lastActionLogId,
  });
  return {
    refusal: false,
    model: modelUsed,
    topScore: retrieval.topScore,
    citations: retrieval.citations,
    latencyMs,
  };
}
