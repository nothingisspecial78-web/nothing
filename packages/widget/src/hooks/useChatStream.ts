import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActionLogEntry,
  AssistantSseEvent,
  ChatAttachment,
  CursorWaypoint,
  ExportFilePayload,
  FormRequest,
  GuideClarificationOption,
  ImportPreviewResult,
  PersonalizationSettings,
  RightClickContext,
  SourceCitation,
} from '@ai-assistant/core';
import { parseJsonSafely } from '../utils/safeFetchJson.ts';

export interface WidgetConfirmationState {
  actionId: string;
  confirmationToken: string;
  toolName: string;
  summary: string;
  details: Record<string, unknown>;
  expiresAt: string;
  status: 'pending' | 'confirming' | 'executed' | 'cancelled' | 'undone' | 'error';
  resultMessage?: string;
  canUndo?: boolean;
}

export interface WidgetMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  context?: RightClickContext;
  contexts?: RightClickContext[];
  attachments?: ChatAttachment[];
  sources?: SourceCitation[];
  statusPhase?: string;
  statusLabel?: string;
  toolEvents?: Array<{
    toolName: string;
    risk: 'read' | 'write';
    status: 'running' | 'completed' | 'failed';
    summary?: string;
  }>;
  confirmation?: WidgetConfirmationState;
  formRequest?: FormRequest;
  formStatus?: 'pending' | 'submitted' | 'cancelled';
  formValues?: Record<string, string | number | boolean>;
  importPreview?: ImportPreviewResult;
  exportFile?: ExportFilePayload;
  model?: string;
  refusal?: boolean;
  isStreaming?: boolean;
  followUpChips?: Array<{ id: string; label: string; prompt: string }>;
  guideClarification?: {
    goal: string;
    question: string;
    options: GuideClarificationOption[];
    selectedOptionId?: string;
    selectedLabel?: string;
  };
}

type UiActionEventPayload = Extract<AssistantSseEvent, { type: 'ui_action' }>;

export interface UseChatStreamOptions {
  appId: string;
  apiUrl: string;
  userKey?: string;
  threadKey?: string;
  initialMessages?: WidgetMessage[];
  personalization?: PersonalizationSettings;
  getAuthToken?: () => string | Promise<string>;
  getAppState?: () => Record<string, unknown>;
  onAppCommand?: (command: string, payload: Record<string, unknown>) => void;
  onActionCompleted?: (action: ActionLogEntry) => void;
  onUiAction?: () => void;
  onStartGuide?: (guideId: string, startStep?: string) => void;
  onMessagesChange?: (messages: WidgetMessage[]) => void;
  onBillingRefresh?: () => void;
  onBillingError?: (
    code: 'UPGRADE_REQUIRED' | 'CREDITS_EXHAUSTED',
    payload: { error?: string; resetDate?: string }
  ) => void;
}

export function useChatStream({
  appId,
  apiUrl,
  threadKey,
  initialMessages,
  personalization,
  getAuthToken,
  getAppState,
  onAppCommand,
  onActionCompleted,
  onUiAction,
  onStartGuide,
  onMessagesChange,
  onBillingRefresh,
  onBillingError,
}: UseChatStreamOptions) {
  const [messages, setMessages] = useState<WidgetMessage[]>(() => initialMessages || []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledUiActionsRef = useRef<Set<string>>(new Set());
  const skipNextSyncRef = useRef(false);
  const lastThreadKeyRef = useRef<string | undefined>(threadKey);

  const baseUrl = apiUrl.replace(/\/$/, '');

  // Load saved messages whenever user switches thread or userKey
  useEffect(() => {
    if (lastThreadKeyRef.current !== threadKey) {
      lastThreadKeyRef.current = threadKey;
      abortRef.current?.abort();
      setIsStreaming(false);
      setError(null);
      skipNextSyncRef.current = true;
      setMessages(initialMessages || []);
    }
  }, [initialMessages, threadKey]);

  // Persist settled messages back to thread storage
  useEffect(() => {
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    if (!isStreaming) {
      onMessagesChange?.(messages);
    }
  }, [isStreaming, messages, onMessagesChange]);

  const executeUiAction = useCallback(
    (event: UiActionEventPayload, dedupeKey?: string) => {
      const key = dedupeKey || event.actionId;
      if (key && handledUiActionsRef.current.has(key)) return;
      if (key) handledUiActionsRef.current.add(key);

      if (typeof window !== 'undefined') {
        const waypoints: CursorWaypoint[] =
          Array.isArray(event.cursorWaypoints) && event.cursorWaypoints.length > 0
            ? event.cursorWaypoints
            : event.selector || event.fallbackTabSelector || event.label
              ? [
                  {
                    selector: event.selector || event.fallbackTabSelector,
                    label: event.label || 'Running agent action…',
                    action: 'click',
                  },
                ]
              : [];
        if (waypoints.length > 0) {
          window.dispatchEvent(
            new CustomEvent('aia:cursor-waypoints', {
              detail: { waypoints, label: event.label },
            })
          );
        }
      }

      if (event.appCommand) {
        onAppCommand?.(event.appCommand.command, event.appCommand.payload);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aia:app-command', { detail: event.appCommand }));
        }
      }

      void (async () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const setNativeControlValue = (el: HTMLElement, val: string) => {
          if (el instanceof HTMLInputElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el instanceof HTMLSelectElement) {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            setter?.call(el, val);
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        };
        const highlightEl = async (el: HTMLElement, durationMs = 450) => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const prevOutline = el.style.outline;
          const prevShadow = el.style.boxShadow;
          el.style.outline = '3px solid var(--aia-primary, #f97316)';
          el.style.boxShadow = '0 0 0 6px rgba(249, 115, 22, 0.22)';
          await sleep(durationMs);
          el.style.outline = prevOutline;
          el.style.boxShadow = prevShadow;
        };

        if (event.fallbackTabSelector) {
          const tabBtn = document.querySelector(event.fallbackTabSelector) as HTMLElement | null;
          if (tabBtn && tabBtn.getAttribute('data-aia-tab')) {
            tabBtn.click();
            await sleep(140);
          }
        }

        if (event.action === 'click' && event.selector) {
          let targetEl = document.querySelector(event.selector) as HTMLElement | null;
          if (!targetEl) {
            await sleep(140);
            targetEl = document.querySelector(event.selector) as HTMLElement | null;
          }
          if (targetEl) {
            await highlightEl(targetEl, 320);
            targetEl.click();
          }
        } else if (event.action === 'set_value' && event.selector) {
          const inputEl = document.querySelector(event.selector) as HTMLElement | null;
          if (inputEl) {
            setNativeControlValue(inputEl, event.value ?? '');
            await highlightEl(inputEl, 420);
          }
        } else if (event.action === 'refresh' && event.highlightSelector) {
          let rowEl: HTMLElement | null = null;
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await sleep(160);
            rowEl = document.querySelector(event.highlightSelector) as HTMLElement | null;
            if (rowEl) break;
          }
          if (rowEl) {
            await highlightEl(rowEl, 700);
          }
        }

        if (Array.isArray(event.followUpActions)) {
          for (const step of event.followUpActions) {
            await sleep(80);
            const el = document.querySelector(step.selector) as HTMLElement | null;
            if (!el) continue;
            if (step.action === 'click') {
              await highlightEl(el, 240);
              el.click();
            } else if (step.action === 'set_value') {
              setNativeControlValue(el, step.value ?? '');
              await highlightEl(el, 320);
            }
          }
        }

        onUiAction?.();
      })();
    },
    [onAppCommand, onUiAction]
  );

  const resolveHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'x-app-id': appId,
    };
    if (threadKey) {
      headers['x-thread-id'] = threadKey;
    }
    if (getAuthToken) {
      const token = await getAuthToken();
      if (token) {
        headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
      }
    }
    return headers;
  }, [appId, getAuthToken, threadKey]);

  const executeChatTurn = useCallback(
    async (
      baseHistory: WidgetMessage[],
      params: {
        text: string;
        context?: RightClickContext;
        contexts?: RightClickContext[];
        attachments?: ChatAttachment[];
        language?: string;
      }
    ) => {
      const trimmed = params.text.trim();
      if (!trimmed && (!params.attachments || params.attachments.length === 0)) return;

      setError(null);
      const userMsgId = `u_${Date.now()}`;
      const assistantMsgId = `a_${Date.now() + 1}`;
      const resolvedContexts =
        params.contexts && params.contexts.length > 0
          ? params.contexts
          : params.context
            ? [params.context]
            : undefined;

      const userMsg: WidgetMessage = {
        id: userMsgId,
        role: 'user',
        content: trimmed || 'Please inspect the attached file or screenshot.',
        context: params.context || resolvedContexts?.[0],
        contexts: resolvedContexts,
        attachments: params.attachments,
      };

      const historyPayload = [...baseHistory, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages([
        ...baseHistory,
        userMsg,
        {
          id: assistantMsgId,
          role: 'assistant',
          content: '',
          statusPhase: 'thinking',
          statusLabel: 'Analyzing request…',
          isStreaming: true,
        },
      ]);

      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const resolvedLanguage =
        params.language ||
        (personalization?.preferredLanguage && personalization.preferredLanguage !== 'auto'
          ? personalization.preferredLanguage
          : undefined);

      try {
        const headers = await resolveHeaders();
        const idempotencyKey =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `turn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const requestBody = JSON.stringify({
          appId,
          messages: historyPayload,
          context: params.context || resolvedContexts?.[0],
          contexts: resolvedContexts,
          attachments: params.attachments,
          language: resolvedLanguage,
          personalization,
          appState: getAppState?.(),
          conversationId: threadKey || 'default',
        });

        let res: Response;
        try {
          res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
              'X-Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            signal: controller.signal,
          });
        } catch (firstNetErr) {
          if (controller.signal.aborted) throw firstNetErr;
          // Brief pause and 1 idempotent retry for transient keep-alive/dev-server socket drops
          await new Promise((r) => setTimeout(r, 250));
          if (controller.signal.aborted) throw firstNetErr;
          res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
              'X-Idempotency-Key': idempotencyKey,
            },
            body: requestBody,
            signal: controller.signal,
          });
        }

        const respContentType = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || !res.body || respContentType.includes('text/html')) {
          const { data: errJson, errorMessage } = await parseJsonSafely<{
            error?: string;
            errorCode?: string;
            resetDate?: string;
          }>(res, 'Chat request failed');
          if (
            (res.status === 402 || res.status === 403) &&
            (errJson?.errorCode === 'UPGRADE_REQUIRED' || errJson?.errorCode === 'CREDITS_EXHAUSTED')
          ) {
            onBillingError?.(errJson.errorCode, errJson);
          }
          throw new Error(errJson?.error || errorMessage || `Request failed with HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let guideTriggeredThisTurn = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';

          for (const block of blocks) {
            const dataLine = block
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!dataLine) continue;

            let event: AssistantSseEvent;
            try {
              event = JSON.parse(dataLine.slice(6)) as AssistantSseEvent;
            } catch {
              continue;
            }

            if (event.type === 'ui_action') {
              executeUiAction(event);
              continue;
            }

            if (event.type === 'start_guide') {
              if (!guideTriggeredThisTurn) {
                guideTriggeredThisTurn = true;
                onStartGuide?.(event.guideId, event.startStep);
              }
              continue;
            }

            if (event.type === 'action_executed') {
              if (event.action && onActionCompleted) {
                onActionCompleted(event.action);
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        confirmation: event.canUndo
                          ? {
                              actionId: event.actionId,
                              confirmationToken: '',
                              toolName: event.toolName,
                              summary: event.summary,
                              details: event.details || {},
                              expiresAt: '',
                              status: 'executed',
                              resultMessage: 'Completed in app.',
                              canUndo: true,
                            }
                          : m.confirmation,
                      }
                    : m
                )
              );
              continue;
            }

            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMsgId) return m;
                switch (event.type) {
                  case 'status':
                    return { ...m, statusPhase: event.phase, statusLabel: event.label };
                  case 'token':
                    return { ...m, content: m.content + event.delta };
                  case 'source':
                    return { ...m, sources: event.sources };
                  case 'tool_call': {
                    const existing = m.toolEvents || [];
                    const idx = existing.findIndex((t) => t.toolName === event.toolName && t.status === 'running');
                    const updated = [...existing];
                    if (idx >= 0) {
                      updated[idx] = {
                        toolName: event.toolName,
                        risk: event.risk,
                        status: event.status,
                        summary: event.summary,
                      };
                    } else {
                      updated.push({
                        toolName: event.toolName,
                        risk: event.risk,
                        status: event.status,
                        summary: event.summary,
                      });
                    }
                    return { ...m, toolEvents: updated };
                  }
                  case 'confirmation_required':
                    return {
                      ...m,
                      confirmation: {
                        actionId: event.actionId,
                        confirmationToken: event.confirmationToken,
                        toolName: event.toolName,
                        summary: event.summary,
                        details: event.details,
                        expiresAt: event.expiresAt,
                        status: 'pending',
                      },
                    };
                  case 'form_request':
                    return {
                      ...m,
                      formRequest: event.form,
                      formStatus: 'pending',
                    };
                  case 'stream_reset':
                    return { ...m, content: '', statusLabel: 'Reconnecting provider…' };
                  case 'follow_up_chips':
                    return { ...m, followUpChips: event.chips };
                  case 'export_file':
                    return { ...m, exportFile: event.exportFile };
                  case 'done':
                    return {
                      ...m,
                      isStreaming: false,
                      statusLabel: undefined,
                      model: event.model,
                      refusal: event.refusal,
                      sources: event.sources.length > 0 ? event.sources : m.sources,
                    };
                  case 'error':
                    return {
                      ...m,
                      isStreaming: false,
                      statusLabel: undefined,
                      content: m.content || `Error: ${event.message}`,
                    };
                  default:
                    return m;
                }
              })
            );
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const msg = err instanceof Error ? err.message : 'Streaming failed';
          setError(msg);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, isStreaming: false, statusLabel: undefined, content: m.content || `Error: ${msg}` }
                : m
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        onBillingRefresh?.();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('aia:billing-refresh'));
        }
      }
    },
    [appId, baseUrl, executeUiAction, getAppState, onActionCompleted, onBillingError, onBillingRefresh, onStartGuide, personalization, resolveHeaders, threadKey]
  );

  const sendMessage = useCallback(
    async (params: {
      text: string;
      context?: RightClickContext;
      contexts?: RightClickContext[];
      attachments?: ChatAttachment[];
      language?: string;
    }) => executeChatTurn(messages, params),
    [executeChatTurn, messages]
  );

  const editAndResendMessage = useCallback(
    async (messageId: string, newText: string) => {
      const idx = messages.findIndex((m) => m.id === messageId && m.role === 'user');
      if (idx < 0 || !newText.trim()) return;
      abortRef.current?.abort();
      const target = messages[idx];
      const prior = messages.slice(0, idx);
      await executeChatTurn(prior, {
        text: newText.trim(),
        context: target.context,
        contexts: target.contexts,
        attachments: target.attachments,
      });
    },
    [executeChatTurn, messages]
  );

  const submitInteractiveForm = useCallback(
    (
      messageId: string,
      form: FormRequest,
      values: Record<string, string | number | boolean>
    ) => {
      const mergedPayload: Record<string, unknown> = {
        ...(form.presetPayload || {}),
        ...values,
      };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('aia:cursor-waypoints', {
            detail: {
              waypoints: [{ selector: 'main h1, main table', label: form.submitLabel }],
              label: form.submitLabel,
            },
          })
        );
      }
      onAppCommand?.(form.command, mergedPayload);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('aia:app-command', {
            detail: { command: form.command, payload: mergedPayload },
          })
        );
      }
      const redactedValues: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(values)) {
        redactedValues[k] = /password|secret|token/i.test(k) ? '••••••••' : v;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                formStatus: 'submitted',
                formValues: redactedValues,
                content: `${m.content ? `${m.content}\n\n` : ''}Submitted **${form.title}** (${form.submitLabel}).`,
              }
            : m
        )
      );
      onUiAction?.();
    },
    [onAppCommand, onUiAction]
  );

  const cancelInteractiveForm = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              formStatus: 'cancelled',
              content: `${m.content ? `${m.content}\n\n` : ''}Cancelled form input.`,
            }
          : m
      )
    );
  }, []);

  const uploadSpreadsheet = useCallback(
    async (
      file: File,
      options?:
        | Record<string, string>
        | {
            columnOverrides?: Record<string, string>;
            targetArea?: 'auto' | 'students' | 'sectors' | 'managers' | 'bulk-entries';
            sheetName?: string;
          }
    ): Promise<ImportPreviewResult> => {
      const headers = await resolveHeaders();
      const formData = new FormData();
      formData.append('appId', appId);
      formData.append('file', file);
      const currentState = getAppState?.();
      if (currentState && typeof currentState.role === 'string') {
        formData.append('role', currentState.role);
      }
      if (currentState && typeof currentState.managerSector === 'string') {
        formData.append('managerSector', currentState.managerSector);
      }
      const columnOverrides =
        options && 'columnOverrides' in options
          ? options.columnOverrides
          : (options as Record<string, string> | undefined);
      const targetArea = options && 'targetArea' in options ? options.targetArea : undefined;
      const sheetName = options && 'sheetName' in options ? options.sheetName : undefined;

      if (targetArea && targetArea !== 'auto') {
        formData.append('targetArea', targetArea);
      }
      if (sheetName) {
        formData.append('sheetName', sheetName);
      }
      if (columnOverrides && Object.keys(columnOverrides).length > 0) {
        formData.append('columnOverrides', JSON.stringify(columnOverrides));
      }

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const { data: parsedData, errorMessage } = await parseJsonSafely<
        ImportPreviewResult & { error?: string; errorCode?: string; resetDate?: string }
      >(res, 'Upload failed');
      if (!res.ok || !parsedData || errorMessage) {
        if (
          (res.status === 402 || res.status === 403) &&
          (parsedData?.errorCode === 'UPGRADE_REQUIRED' || parsedData?.errorCode === 'CREDITS_EXHAUSTED')
        ) {
          onBillingError?.(parsedData.errorCode, parsedData);
        }
        onBillingRefresh?.();
        throw new Error(parsedData?.error || errorMessage || `Upload failed with HTTP ${res.status}`);
      }
      onBillingRefresh?.();
      const data = parsedData;

      const mismatchMsg = data.permissionError
        ? data.permissionError
        : data.formatMatched === false
          ? `Spreadsheet verification **failed** for \`${data.fileName}\` (target template: \`${data.templateId}\`).${
              data.missingRequiredColumns?.length
                ? ` Missing required columns: **${data.missingRequiredColumns.join(', ')}**.`
                : ' No valid rows matched the required format.'
            } Use **Fix mapping** or check column names.`
          : `Verified format (\`${data.templateId}\`) for \`${data.fileName}\`: **${data.validCount}** valid of **${data.totalRows}** row(s) (${data.invalidCount} errors${(data.duplicateCount || 0) > 0 ? `, ${data.duplicateCount} duplicate` : ''}). Review the preview below and click **Confirm Import** to execute.`;

      setMessages((prev) => [
        ...prev,
        {
          id: `u_${Date.now()}`,
          role: 'user',
          content: `Uploaded spreadsheet "${file.name}"${targetArea && targetArea !== 'auto' ? ` to ${targetArea}` : ''} for verification.`,
        },
        {
          id: `a_${Date.now() + 1}`,
          role: 'assistant',
          content: mismatchMsg,
          importPreview: data,
        },
      ]);

      return data;
    },
    [appId, baseUrl, getAppState, onBillingError, onBillingRefresh, resolveHeaders]
  );

  const revalidateUpload = useCallback(
    async (
      messageId: string,
      uploadId: string,
      opts: { sheetName?: string; columnOverrides?: Record<string, string>; targetArea?: string }
    ): Promise<ImportPreviewResult> => {
      const headers = await resolveHeaders();
      const currentState = getAppState?.();
      const res = await fetch(`${baseUrl}/api/upload/${encodeURIComponent(uploadId)}/revalidate`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId,
          sheetName: opts.sheetName,
          columnOverrides: opts.columnOverrides,
          targetArea: opts.targetArea,
          role: typeof currentState?.role === 'string' ? currentState.role : undefined,
        }),
      });
      const { data, errorMessage } = await parseJsonSafely<ImportPreviewResult & { error?: string }>(
        res,
        'Revalidation failed'
      );
      if (!res.ok || !data || errorMessage) {
        throw new Error(data?.error || errorMessage || `Revalidation failed (${res.status})`);
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                importPreview: data,
                content: data.permissionError
                  ? data.permissionError
                  : data.formatMatched === false
                    ? `Spreadsheet verification **failed** for \`${data.fileName}\` (target template: \`${data.templateId}\`).${
                        data.missingRequiredColumns?.length
                          ? ` Missing required columns: **${data.missingRequiredColumns.join(', ')}**.`
                          : ''
                      }`
                    : `Updated mapping for \`${data.fileName}\` (${data.templateId}): **${data.validCount}** valid of **${data.totalRows}** row(s).`,
              }
            : m
        )
      );
      return data;
    },
    [appId, baseUrl, getAppState, resolveHeaders]
  );

  const confirmAction = useCallback(
    async (
      messageId: string,
      actionId: string,
      confirmationToken: string,
      decision: 'confirm' | 'cancel'
    ) => {
      const headers = await resolveHeaders();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.confirmation
            ? { ...m, confirmation: { ...m.confirmation, status: 'confirming' } }
            : m
        )
      );

      const res = await fetch(`${baseUrl}/api/actions/${encodeURIComponent(actionId)}/confirm`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId,
          confirmationToken,
          decision,
          appState: getAppState?.(),
        }),
      });

      const { data: parsedConfirm, errorMessage: confirmErr } = await parseJsonSafely<{
        ok?: boolean;
        summary?: string;
        error?: string;
        uiAction?: Omit<UiActionEventPayload, 'type' | 'actionId'>;
        action?: ActionLogEntry;
      }>(res, 'Confirmation failed');
      const data = parsedConfirm || {};

      if (!res.ok || confirmErr) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.confirmation
              ? {
                  ...m,
                  confirmation: {
                    ...m.confirmation,
                    status: 'error',
                    resultMessage: data.error || confirmErr || 'Confirmation failed',
                  },
                }
              : m
          )
        );
        return;
      }

      if (data.uiAction) {
        executeUiAction(
          { type: 'ui_action', actionId: `${actionId}:confirm`, ...data.uiAction },
          `${actionId}:confirm`
        );
      }

      const nextStatus = decision === 'cancel' ? 'cancelled' : 'executed';
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const canUndo =
            nextStatus === 'executed' && (m.confirmation?.toolName || m.importPreview?.targetTool) !== undefined;
          return {
            ...m,
            confirmation: m.confirmation
              ? {
                  ...m.confirmation,
                  status: nextStatus,
                  resultMessage: data.summary || (decision === 'cancel' ? 'Cancelled.' : 'Executed.'),
                  canUndo,
                }
              : undefined,
          };
        })
      );

      if (data.action && onActionCompleted) {
        onActionCompleted(data.action);
      }
    },
    [appId, baseUrl, executeUiAction, getAppState, onActionCompleted, resolveHeaders]
  );

  const confirmImportPreview = useCallback(
    async (
      messageId: string,
      preview: ImportPreviewResult,
      decision: 'confirm' | 'cancel'
    ): Promise<{ ok: boolean; summary?: string }> => {
      if (!preview.actionId || !preview.confirmationToken) {
        return { ok: false, summary: 'No valid rows available to confirm.' };
      }
      const headers = await resolveHeaders();
      const res = await fetch(
        `${baseUrl}/api/actions/${encodeURIComponent(preview.actionId)}/confirm`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            appId,
            confirmationToken: preview.confirmationToken,
            decision,
            idempotencyKey: `imp_${preview.uploadId}_${preview.actionId}`,
            appState: getAppState?.(),
          }),
        }
      );

      const { data: parsedImportConfirm, errorMessage: importErr } = await parseJsonSafely<{
        ok?: boolean;
        summary?: string;
        error?: string;
        uiAction?: Omit<UiActionEventPayload, 'type' | 'actionId'>;
        action?: ActionLogEntry;
      }>(res, 'Import confirmation failed');
      const data = parsedImportConfirm || {};

      if (!res.ok || importErr) {
        return { ok: false, summary: data.error || importErr || 'Import confirmation failed.' };
      }

      if (data.uiAction) {
        executeUiAction(
          { type: 'ui_action', actionId: `${preview.actionId}:confirm`, ...data.uiAction },
          `${preview.actionId}:confirm`
        );
      }

      if (data.action && onActionCompleted) {
        onActionCompleted(data.action);
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                content: data.summary || m.content,
              }
            : m
        )
      );

      return { ok: true, summary: data.summary };
    },
    [appId, baseUrl, executeUiAction, getAppState, onActionCompleted, resolveHeaders]
  );

  const undoAction = useCallback(
    async (messageId: string, actionId: string): Promise<{ ok: boolean; summary?: string }> => {
      const headers = await resolveHeaders();
      const res = await fetch(`${baseUrl}/api/actions/${encodeURIComponent(actionId)}/undo`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ appId }),
      });

      const { data: parsedUndo, errorMessage: undoErr } = await parseJsonSafely<{
        ok?: boolean;
        summary?: string;
        error?: string;
        undoUiAction?: Omit<UiActionEventPayload, 'type' | 'actionId'>;
        action?: ActionLogEntry;
      }>(res, 'Undo failed');
      const data = parsedUndo || {};
      if (!res.ok || undoErr) {
        return { ok: false, summary: data.error || undoErr || 'Undo failed' };
      }

      if (data.undoUiAction) {
        executeUiAction(
          { type: 'ui_action', actionId: `${actionId}:undo`, ...data.undoUiAction },
          `${actionId}:undo`
        );
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.confirmation
            ? {
                ...m,
                confirmation: {
                  ...m.confirmation,
                  status: 'undone',
                  resultMessage: data.summary || 'Action undone.',
                  canUndo: false,
                },
              }
            : m
        )
      );

      if (data.action && onActionCompleted) {
        onActionCompleted(data.action);
      }

      return { ok: true, summary: data.summary };
    },
    [appId, baseUrl, executeUiAction, onActionCompleted, resolveHeaders]
  );

  const downloadErrorCsv = useCallback(
    async (uploadId: string) => {
      const headers = await resolveHeaders();
      const res = await fetch(
        `${baseUrl}/api/upload/${encodeURIComponent(uploadId)}/errors.csv?appId=${encodeURIComponent(appId)}`,
        { headers }
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-errors-${uploadId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [appId, baseUrl, resolveHeaders]
  );

  const downloadErrorXlsx = useCallback(
    async (uploadId: string) => {
      const headers = await resolveHeaders();
      const res = await fetch(
        `${baseUrl}/api/upload/${encodeURIComponent(uploadId)}/errors.xlsx?appId=${encodeURIComponent(appId)}`,
        { headers }
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import-errors-${uploadId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [appId, baseUrl, resolveHeaders]
  );

  const appendGuideClarification = useCallback(
    (params: {
      goal: string;
      question: string;
      options: GuideClarificationOption[];
    }) => {
      const now = Date.now();
      setMessages((prev) => [
        ...prev,
        {
          id: `u_${now}`,
          role: 'user',
          content: params.goal,
        },
        {
          id: `a_${now + 1}`,
          role: 'assistant',
          content: params.question,
          guideClarification: {
            goal: params.goal,
            question: params.question,
            options: params.options,
          },
        },
      ]);
    },
    []
  );

  const resolveGuideClarification = useCallback(
    (messageId: string, option: GuideClarificationOption, viaTextReply?: string) => {
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === messageId && m.guideClarification
            ? {
                ...m,
                guideClarification: {
                  ...m.guideClarification,
                  selectedOptionId: option.id,
                  selectedLabel: option.label,
                },
              }
            : m
        );
        const now = Date.now();
        return [
          ...updated,
          {
            id: `u_${now}`,
            role: 'user',
            content: viaTextReply || option.label,
          },
          {
            id: `a_${now + 1}`,
            role: 'assistant',
            content: `Starting guided walkthrough for **${option.label}**…`,
          },
        ];
      });
    },
    []
  );

  const dismissGuideClarification = useCallback((messageId: string, viaTextReply?: string) => {
    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.id === messageId && m.guideClarification
          ? {
              ...m,
              guideClarification: {
                ...m.guideClarification,
                selectedOptionId: '__cancelled__',
                selectedLabel: 'Cancelled',
              },
            }
          : m
      );
      const now = Date.now();
      return [
        ...updated,
        {
          id: `u_${now}`,
          role: 'user',
          content: viaTextReply || 'Cancel',
        },
        {
          id: `a_${now + 1}`,
          role: 'assistant',
          content: 'Cancelled the guided walkthrough selection. Ask anything else whenever you are ready.',
        },
      ];
    });
  }, []);

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    editAndResendMessage,
    submitInteractiveForm,
    cancelInteractiveForm,
    uploadSpreadsheet,
    revalidateUpload,
    confirmAction,
    confirmImportPreview,
    undoAction,
    downloadErrorCsv,
    downloadErrorXlsx,
    appendGuideClarification,
    resolveGuideClarification,
    dismissGuideClarification,
    clearMessages,
  };
}
