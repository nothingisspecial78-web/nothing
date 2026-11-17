import type { AdapterSessionContext } from '../../adapter/contract.ts';
import type { AssistantTool } from '../tools/types.ts';

export interface AssistantAuditEvent {
  timestamp: string;
  event: 'tool_call' | 'chat_message' | 'export' | 'import' | 'auth_denied' | 'billing';
  userId?: string;
  role?: string;
  organizationId?: string;
  actionName?: string;
  status: 'success' | 'failure' | 'blocked';
  details?: Record<string, unknown>;
}

export interface AssistantPlugin {
  name: string;
  version?: string;
  onBeforeMessage?: (
    message: string,
    context?: Record<string, unknown>
  ) => Promise<string | void> | string | void;
  onAfterMessage?: (response: string, metadata?: Record<string, unknown>) => Promise<void> | void;
  onBeforeTool?: (toolName: string, args: Record<string, unknown>, ctx: AdapterSessionContext) => Promise<boolean | void> | boolean | void;
  onAudit?: (event: AssistantAuditEvent) => Promise<void> | void;
  registerTools?: () => AssistantTool[];
}

const registeredPlugins = new Map<string, AssistantPlugin>();

export function registerPlugin(plugin: AssistantPlugin): () => void {
  registeredPlugins.set(plugin.name, plugin);
  return () => {
    registeredPlugins.delete(plugin.name);
  };
}

export function getPlugins(): AssistantPlugin[] {
  return Array.from(registeredPlugins.values());
}

export function clearPlugins(): void {
  registeredPlugins.clear();
}

export async function dispatchPluginAudit(event: AssistantAuditEvent): Promise<void> {
  for (const plugin of registeredPlugins.values()) {
    if (plugin.onAudit) {
      try {
        await plugin.onAudit(event);
      } catch (err) {
        console.warn(`[AssistantPlugin:${plugin.name}] onAudit failed:`, err);
      }
    }
  }
}
