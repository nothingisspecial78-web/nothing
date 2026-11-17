import type { z } from 'zod';
import type { AppProfile, CursorWaypoint, ExportFilePayload, FormRequest } from '@ai-assistant/core';
import type { ServerConfig } from '../config.ts';
import type { ActionLogStore } from '../security/confirmation.ts';

import type { AccessScope } from '../security/scope.ts';

export interface ToolExecutionContext {
  appId: string;
  profile: AppProfile;
  userId: string;
  authToken: string;
  cfg: ServerConfig;
  actionStore: ActionLogStore;
  appState?: Record<string, unknown>;
  scope?: AccessScope;
  conversationId?: string;
}

export interface UiActionPayload {
  action: 'click' | 'refresh' | 'set_value';
  selector?: string;
  fallbackTabSelector?: string;
  value?: string;
  highlightSelector?: string;
  refreshApp?: boolean;
  followUpActions?: Array<{
    action: 'click' | 'set_value';
    selector: string;
    value?: string;
  }>;
  appCommand?: {
    command: string;
    payload: Record<string, unknown>;
  };
  cursorWaypoints?: CursorWaypoint[];
  label: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  summary: string;
  data: unknown;
  createdIds?: string[];
  uiAction?: UiActionPayload;
  formRequest?: FormRequest;
  exportFile?: ExportFilePayload;
  followUpChips?: Array<{ id: string; label: string; prompt: string }>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  risk: 'read' | 'write';
  uiTrigger?: boolean;
  autoExecute?: boolean;
  inputSchema: z.ZodTypeAny;
  jsonParameters: Record<string, unknown>;
  summarize(args: Record<string, unknown>): string;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
  undo?(createdIds: string[], args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
}
