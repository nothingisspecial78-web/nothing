export { AssistantWidget } from './AssistantWidget.tsx';
export type { AssistantWidgetProps, AssistantWidgetTheme } from './AssistantWidget.tsx';
export { AssistantProvider, useAssistant } from './context/AssistantContext.tsx';
export type { AssistantContextValue, AssistantProviderProps } from './context/AssistantContext.tsx';
export {
  Assistant,
  AppAssistantElement,
  mountAssistantWidget,
  unmountAssistantWidget,
} from './embed.ts';
export type { EmbedInitOptions, AssistantInstance } from './embed.ts';
export { useChatStream } from './hooks/useChatStream.ts';
export { useContextCapture } from './hooks/useContextCapture.ts';
export { useGuideCoBrowser } from './hooks/useGuideCoBrowser.ts';
export * from './guide/index.ts';
