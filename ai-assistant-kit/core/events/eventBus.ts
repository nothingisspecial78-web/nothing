export type AssistantEventMap = {
  open: { trigger?: 'button' | 'context-menu' | 'shortcut' | 'programmatic'; route?: string };
  close: { reason?: 'user' | 'escape' | 'programmatic' | 'guide_started' };
  message_sent: { id: string; text: string; role: 'user' | 'assistant' | 'system'; conversationId?: string };
  message_received: { id: string; text: string; model?: string; provider?: string; latencyMs?: number };
  action_requested: { actionId: string; name: string; params: Record<string, unknown>; requiresConfirmation: boolean };
  action_confirmed: { actionId: string; name: string; decision: 'confirm' | 'cancel' };
  action_executed: { actionId: string; name: string; ok: boolean; summary?: string };
  export_generated: { exportId: string; format: 'csv' | 'xlsx' | 'pdf' | 'docx'; rowCount: number; filename: string };
  guide_started: { guideId: string; goal: string };
  guide_completed: { guideId: string; completedSteps: number };
  credits_changed: { organizationId: string; creditsRemaining: number; delta: number };
  upgrade_clicked: { source: 'widget' | 'banner' | 'limit_reached' | 'page'; planId?: string };
  provider_fallback: { fromProvider: string; toProvider: string; reason: string };
  error: { code?: string; message: string; recoverable: boolean };
};

export type AssistantEventType = keyof AssistantEventMap;
export type AssistantEventListener<K extends AssistantEventType> = (payload: AssistantEventMap[K]) => void;

export class AssistantEventBus {
  private listeners = new Map<AssistantEventType, Set<AssistantEventListener<never>>>();

  on<K extends AssistantEventType>(event: K, handler: AssistantEventListener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const casted = handler as AssistantEventListener<never>;
    set.add(casted);
    return () => {
      set?.delete(casted);
    };
  }

  off<K extends AssistantEventType>(event: K, handler: AssistantEventListener<K>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler as AssistantEventListener<never>);
    }
  }

  emit<K extends AssistantEventType>(event: K, payload: AssistantEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of Array.from(set)) {
      try {
        (handler as AssistantEventListener<K>)(payload);
      } catch (err) {
        console.error(`[AssistantEventBus] Listener failed for "${event}":`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export const globalEventBus = new AssistantEventBus();
