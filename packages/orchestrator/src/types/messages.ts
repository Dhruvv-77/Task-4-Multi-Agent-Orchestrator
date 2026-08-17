import { z } from 'zod';

// Zod Schemas & Types

export const PlanSchema = z.object({
  taskId: z.string(),
  originalTask: z.string(),
  approach: z.string(),
  affectedFiles: z.array(z.string()),
  expectedOutcome: z.string(),
  risks: z.array(z.string()).optional(),
  clarifyingQuestion: z.string().optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PatchSchema = z.object({
  taskId: z.string(),
  planId: z.string(),
  filePath: z.string(),
  code: z.string(),
  reasoning: z.string(), // Isolated from Critic
  testsPassed: z.boolean().optional(),
  issues: z.array(z.string()).optional(),
});
export type Patch = z.infer<typeof PatchSchema>;

export const CriticIssueSchema = z.object({
  severity: z.enum(['blocker', 'minor']),
  note: z.string(),
  location: z.string().optional(),
});
export type CriticIssue = z.infer<typeof CriticIssueSchema>;

export const ReviewSchema = z.object({
  patchId: z.string(),
  verdict: z.enum(['approve', 'revise']),
  issues: z.array(CriticIssueSchema),
  turnsUsed: z.number(),
  confidence: z.number().optional(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const RevisionRequestSchema = z.object({
  taskId: z.string(),
  patchId: z.string(),
  review: ReviewSchema,
  maxRevisionRounds: z.number(),
  roundsRemaining: z.number(),
});
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;

export const EscalationResultSchema = z.object({
  taskId: z.string(),
  reason: z.literal('max-revisions-hit'),
  lastReview: ReviewSchema,
  lastPatch: PatchSchema,
  criticHistory: z.array(ReviewSchema),
  recommendation: z.string(),
});
export type EscalationResult = z.infer<typeof EscalationResultSchema>;

export const TrajectorySchema = z.object({
  taskId: z.string(),
  category: z.enum(['well-specified', 'seeded-flaw', 'ambiguous']),
  task: z.string(),
  plan: PlanSchema.optional(),
  patches: z.array(PatchSchema),
  reviews: z.array(ReviewSchema),
  escalation: EscalationResultSchema.optional(),
  finalOutcome: z.enum(['approved', 'escalated', 'clarification-requested']),
  totalTurns: z.number(),
  totalTokens: z.number(),
  wallClockMs: z.number(),
});
export type Trajectory = z.infer<typeof TrajectorySchema>;
