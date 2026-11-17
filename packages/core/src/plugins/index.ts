import type { AssistantConfig } from '../config/schema.ts';
import type { UserContext } from '../adapters/types.ts';

export interface PluginContext {
  config: AssistantConfig;
  user?: UserContext;
  orgId?: string;
}

export interface AssistantPlugin {
  name: string;
  version?: string;
  description?: string;

  /**
   * Called when plugin is registered with the SDK runtime.
   */
  init?(ctx: PluginContext): Promise<void> | void;

  /**
   * Hook before sending prompt to the model (for memory injection, RAG retrieval).
   */
  beforeModelCall?(prompt: string, ctx: PluginContext): Promise<string> | string;

  /**
   * Hook after receiving response from model (for evaluation, audit logging, filtering).
   */
  afterModelCall?(response: string, ctx: PluginContext): Promise<string> | string;

  /**
   * Audit hook invoked on major events.
   */
  onAudit?(event: { type: string; payload: unknown; timestamp: string }): Promise<void> | void;
}

const pluginRegistry = new Map<string, AssistantPlugin>();

export function registerPlugin(plugin: AssistantPlugin): void {
  pluginRegistry.set(plugin.name, plugin);
}

export function unregisterPlugin(name: string): void {
  pluginRegistry.delete(name);
}

export function getPlugins(): AssistantPlugin[] {
  return Array.from(pluginRegistry.values());
}

export function clearPlugins(): void {
  pluginRegistry.clear();
}
