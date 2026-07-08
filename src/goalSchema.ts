import { ZodError, z } from 'zod';
import type { GoalState } from './types.js';

export const GOAL_SCHEMA_VERSION = 1;

const phaseSchema = z.enum(['plan', 'implement', 'review', 'verify']);
const verdictSchema = z.enum(['clean', 'blocking', 'pass', 'fail']);
const lifecycleSchema = z.enum(['active', 'achieved', 'blocked', 'failed', 'cancelled']);

const goalEventSchema = z
  .object({
    phase: phaseSchema,
    at: z.string().min(1),
    commit: z.string().min(1),
    tree: z.string().min(1),
    verdict: verdictSchema.optional(),
    evidence: z.string().optional(),
    runId: z.string().optional(),
  })
  .passthrough();

const inFlightSchema = z
  .object({
    phase: phaseSchema,
    kind: z.enum(['oracle', 'test']),
    startedAt: z.string().min(1),
    runId: z.string().optional(),
  })
  .passthrough();

const reviewUnavailableSchema = z
  .object({
    at: z.string().min(1),
    phase: z.enum(['plan', 'review']),
    commit: z.string().min(1),
    tree: z.string().min(1),
    reason: z.enum(['preflight-failed', 'oracle-timeout', 'oracle-error', 'ambiguous-verdict']),
    attempts: z.number().int().positive(),
    evidence: z.string().optional(),
  })
  .passthrough();

const failureLoopSchema = z
  .object({
    key: z.string().min(1),
    count: z.number().int().nonnegative(),
    history: z.array(
      z
        .object({
          key: z.string().min(1),
          at: z.string().min(1),
          commit: z.string().min(1),
          tree: z.string().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const goalStateSchema = z
  .object({
    schemaVersion: z.number().int().positive().optional(),
    id: z.string().min(1),
    objective: z.string().min(1),
    branch: z.string().min(1),
    base: z.string().min(1),
    baseTree: z.string().optional(),
    state: lifecycleSchema,
    maxFixRounds: z.number().int().positive(),
    acceptanceChecks: z.array(z.string()),
    events: z.array(goalEventSchema),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    lastActivityAt: z.string().optional(),
    lastOperation: z.string().optional(),
    backlogTaskId: z.string().optional(),
    autoMergeAllowed: z.boolean().optional(),
    improveOrigin: z.boolean().optional(),
    budget: z.object({ maxWallClockMin: z.number().positive().optional() }).passthrough().optional(),
    inFlight: inFlightSchema.optional(),
    failureLoop: failureLoopSchema.optional(),
    reviewUnavailable: reviewUnavailableSchema.optional(),
  })
  .passthrough();

function explainZod(e: ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
}

/** Parse and migrate persisted `.coco/goals/*.json`. This is a trust boundary: malformed state must
 * become `invalid-state` / a clear command error, never a partially-trusted GoalState cast. */
export function parseGoalState(raw: unknown): GoalState {
  try {
    const parsed = goalStateSchema.parse(raw) as GoalState;
    return { ...parsed, schemaVersion: parsed.schemaVersion ?? GOAL_SCHEMA_VERSION };
  } catch (e) {
    if (e instanceof ZodError) throw new Error(`coco: goal state schema invalid (${explainZod(e)})`);
    throw e;
  }
}

export function parseGoalFile(raw: string): GoalState {
  try {
    return parseGoalState(JSON.parse(raw) as unknown);
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`coco: goal JSON parse failed (${e.message})`);
    throw e;
  }
}

export function stampGoalSchema(goal: GoalState): GoalState {
  return { ...goal, schemaVersion: goal.schemaVersion ?? GOAL_SCHEMA_VERSION };
}
