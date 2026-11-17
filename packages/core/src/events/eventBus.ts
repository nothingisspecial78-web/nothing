/**
 * Universal Assistant Event Bus
 * Exposes all required SDK lifecycle events:
 * - message_sent
 * - response_received
 * - action_requested
 * - action_confirmed
 * - action_completed
 * - error
 * - credits_changed
 * - plan_changed
 * - file_attached
 */

export interface MessageSentEvent {
  id: string;
  text: string;
  role: 'user';
  attachments?: Array<{ name: string; type: string; size?: number }>;
  timestamp: string;
}

export interface ResponseReceivedEvent {
  id: string;
  text: string;
  role: 'assistant';
  actions?: Array<{ name: string; params: Record<string, unknown> }>;
  timestamp: string;
}

export interface ActionRequestedEvent {
  actionId: string;
  name: string;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  timestamp: string;
}

export interface ActionConfirmedEvent {
  actionId: string;
  name: string;
  params?: Record<string, unknown>;
  timestamp: string;
}

export interface ActionCompletedEvent {
  actionId: string;
  name: string;
  result: unknown;
  success: boolean;
  timestamp: string;
}

export interface ErrorEvent {
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
}

export interface CreditsChangedEvent {
  organizationId: string;
  creditsRemaining: number;
  delta: number;
  reason?: string;
  timestamp: string;
}

export interface PlanChangedEvent {
  organizationId: string;
  planId: string;
  isPremium: boolean;
  timestamp: string;
}

export interface FileAttachedEvent {
  name: string;
  size: number;
  mimeType: string;
  timestamp: string;
}

export interface AssistantEventMap {
  message_sent: MessageSentEvent;
  response_received: ResponseReceivedEvent;
  action_requested: ActionRequestedEvent;
  action_confirmed: ActionConfirmedEvent;
  action_completed: ActionCompletedEvent;
  error: ErrorEvent;
  credits_changed: CreditsChangedEvent;
  plan_changed: PlanChangedEvent;
  file_attached: FileAttachedEvent;
}

export type AssistantEventHandler<T extends keyof AssistantEventMap = keyof AssistantEventMap> = (
  event: AssistantEventMap[T]
) => void;

export class AssistantEventBus {
  private listeners: Map<keyof AssistantEventMap, Set<AssistantEventHandler<any>>> = new Map();

  public on<K extends keyof AssistantEventMap>(
    eventName: K,
    handler: (data: AssistantEventMap[K]) => void
  ): () => void {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(handler);

    // Return unbind function
    return () => this.off(eventName, handler);
  }

  public off<K extends keyof AssistantEventMap>(
    eventName: K,
    handler: (data: AssistantEventMap[K]) => void
  ): void {
    const set = this.listeners.get(eventName);
    if (set) {
      set.delete(handler);
    }
  }

  public emit<K extends keyof AssistantEventMap>(
    eventName: K,
    data: Omit<AssistantEventMap[K], 'timestamp'> & { timestamp?: string }
  ): void {
    const payload = {
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
    } as AssistantEventMap[K];

    const set = this.listeners.get(eventName);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[AssistantEventBus] Error in handler for event "${eventName}":`, err);
        }
      }
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}

// Global shared event bus instance
export const globalEventBus = new AssistantEventBus();
