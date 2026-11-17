import { z } from 'zod';

export const GuideActionTypeSchema = z.enum([
  'click',
  'type',
  'select',
  'upload',
  'read',
  'wait',
]);
export type GuideActionType = z.infer<typeof GuideActionTypeSchema>;

export const GuideCompletionConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click') }),
  z.object({
    type: z.literal('valueFilled'),
    minLength: z.number().int().optional(),
    pattern: z.string().optional(),
  }),
  z.object({ type: z.literal('valueChanged') }),
  z.object({ type: z.literal('fileSelected') }),
  z.object({ type: z.literal('routeChanged'), to: z.string() }),
  z.object({ type: z.literal('elementAppears'), guideId: z.string() }),
  z.object({ type: z.literal('manual') }),
]);
export type GuideCompletionCondition = z.infer<typeof GuideCompletionConditionSchema>;

export const GuideStepTargetSchema = z.object({
  guideId: z.string().min(1),
  fallbacks: z.array(z.string()).optional(),
  scrollIntoView: z.boolean().optional(),
});
export type GuideStepTarget = z.infer<typeof GuideStepTargetSchema>;

export const GuideStepSchema = z.object({
  stepId: z.string().min(1),
  route: z.string().optional(),
  target: GuideStepTargetSchema.nullable(),
  instruction: z.object({
    en: z.string().min(1),
    ml: z.string().optional(),
  }),
  voice: z
    .object({
      en: z.string().min(1),
      ml: z.string().optional(),
    })
    .optional(),
  action: GuideActionTypeSchema,
  completeWhen: GuideCompletionConditionSchema.optional(),
  hint: z
    .object({
      en: z.string(),
      ml: z.string().optional(),
    })
    .optional(),
  optional: z.boolean().optional(),
  sensitive: z.boolean().optional(),
});
export type GuideStep = z.infer<typeof GuideStepSchema>;

export const GuideDefSchema = z.object({
  guideId: z.string().min(1),
  title: z.object({
    en: z.string().min(1),
    ml: z.string().optional(),
  }),
  summary: z.object({
    en: z.string().min(1),
    ml: z.string().optional(),
  }),
  keywords: z.array(z.string()).min(1),
  roles: z.union([
    z.literal('public'),
    z.array(z.enum(['SUPER_ADMIN', 'ADMIN', 'SECTOR_MANAGER', 'STUDENT'])),
  ]),
  startRoute: z.string().optional(),
  steps: z.array(GuideStepSchema).min(1),
  completion: z.object({
    message: z.object({
      en: z.string().min(1),
      ml: z.string().optional(),
    }),
    followUpChips: z.array(z.string()).optional(),
  }),
});
export type GuideDef = z.infer<typeof GuideDefSchema>;
