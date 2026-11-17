export type GuideStepLanguage = 'en' | 'ml';

export type GuideTargetAction =
  | 'click'
  | 'input'
  | 'focus'
  | 'route_change'
  | 'any_submit'
  | 'manual';

export interface GuideStepDefinition {
  id: string;
  route?: string;
  selector: string;
  fallbackSelectors?: string[];
  title: {
    en: string;
    ml?: string;
  };
  instruction: {
    en: string;
    ml?: string;
  };
  waitFor: GuideTargetAction;
  expectedValue?: string;
  sensitive?: boolean;
  autoAdvanceDelayMs?: number;
}

export interface GuideDefinition {
  id: string;
  title: {
    en: string;
    ml?: string;
  };
  summary: {
    en: string;
    ml?: string;
  };
  roles: Array<'PUBLIC' | 'SUPER_ADMIN' | 'ADMIN' | 'SCOPED_MANAGER' | 'END_USER' | string>;
  keywords: string[];
  startRoute?: string;
  steps: GuideStepDefinition[];
}

export interface GuideProgressState {
  active: boolean;
  guideId: string | null;
  currentStepIndex: number;
  language: GuideStepLanguage;
  muted: boolean;
  completedStepIds: string[];
  error?: string;
  resolvedTargetFound: boolean;
}
