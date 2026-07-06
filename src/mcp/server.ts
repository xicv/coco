import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  cocoDoneTool,
  cocoGoalClear,
  cocoGoalOpClear,
  cocoGoalOpStart,
  cocoGoalOracleUnavailable,
  cocoGoalRecord,
  cocoGoalStart,
  cocoGoalStatus,
  cocoGoalVerifyResult,
  cocoGoalVerifyStart,
  cocoHealth,
  cocoInit,
  cocoNextTool,
} from './tools.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/** Wrap a sync handler so a thrown error becomes an MCP error result, not a crash. */
function wrap<T>(fn: (a: T) => unknown): (a: T) => Promise<ToolResult> {
  return async (a: T) => {
    try {
      return ok(fn(a));
    } catch (e) {
      return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
    }
  };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'coco', version: '0.0.1' });
  const repoDir = z.string().describe('Absolute path to the target git repository (the project cwd).');

  server.registerTool(
    'coco_init',
    {
      title: 'Bootstrap a repo for coco',
      description: 'Idempotently init git + .coco in repoDir. Leaves a clean tree.',
      inputSchema: { repoDir },
    },
    wrap(cocoInit),
  );

  server.registerTool(
    'coco_goal_start',
    {
      title: 'Start a coco goal',
      description: 'Create a goal + coco/<id> branch. Refuses if a goal is already active or the tree is dirty. Returns goalId + status.',
      inputSchema: {
        repoDir,
        objective: z.string().min(1),
        acceptanceChecks: z.array(z.string()).optional(),
        maxFixRounds: z.number().int().positive().optional(),
        backlogTaskId: z.string().optional().describe('the BACKLOG.md task id this goal implements (from coco_next), so coco_done survives a session drop'),
        budget: z.object({ maxWallClockMin: z.number().positive() }).optional().describe('optional wall-clock cap (minutes); over budget mid-loop → coco_health returns `budget-exceeded`'),
      },
    },
    wrap(cocoGoalStart),
  );

  server.registerTool(
    'coco_goal_status',
    {
      title: 'Deterministic next action',
      description:
        'Pure read: returns nextAction, headSha, live git + derived facts. Call at the START of every loop cycle; never infer phase from memory. Use the returned headSha as the next record expectedSha.',
      inputSchema: { repoDir, goalId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(cocoGoalStatus),
  );

  server.registerTool(
    'coco_goal_record',
    {
      title: 'Record a phase result',
      description:
        'Append a plan/implement/review event bound to expectedSha (the headSha from the latest coco_goal_status). review: pass reviewOutput (Oracle text with a line "VERDICT: clean|blocking" — parsed server-side; missing/ambiguous sets review-unavailable and pauses). evidence is always required. VERIFY IS NOT RECORDED HERE — it is coco-owned: use coco_goal_verify_start / coco_goal_verify_result. Returns the recorded event + updated status.',
      inputSchema: {
        repoDir,
        goalId: z.string(),
        phase: z.enum(['plan', 'implement', 'review']),
        expectedSha: z.string(),
        evidence: z.string().min(1).describe('What was done / observed (test output, oracle session id, summary).'),
        reviewOutput: z.string().optional().describe('review only: Oracle output containing a "VERDICT: clean|blocking" line.'),
      },
    },
    wrap(cocoGoalRecord),
  );

  server.registerTool(
    'coco_goal_verify_start',
    {
      title: 'Start the coco-owned verify run',
      description:
        'At nextAction "verify", START coco running the verify test suite itself (you do NOT report pass/fail — that closes the false-green hole). coco runs the committed `verify.testCommand` from coco.config.json in the background and derives pass|fail from its exit code. Requires a clean tree + HEAD === expectedSha (the latest coco_goal_status headSha). Returns a runId; sets health operation-in-progress. Then poll coco_goal_verify_result. If coco.config.json has no verify.testCommand, this errors — tell the user to configure it (there is no agent fallback).',
      inputSchema: { repoDir, goalId: z.string(), expectedSha: z.string() },
    },
    wrap(cocoGoalVerifyStart),
  );

  server.registerTool(
    'coco_goal_verify_result',
    {
      title: 'Poll the coco-owned verify run',
      description:
        'Poll a runId from coco_goal_verify_start. status:"running" → wait and poll again. status:"done" → coco recorded verify pass|fail (from the exit code) and advanced the loop; read `verdict` + `nextAction`. status:"aborted" → HEAD moved or the tests dirtied the tree during the run; nothing recorded — re-run coco_goal_status and start again. (Not read-only: on completion it records the verify event.)',
      inputSchema: { repoDir, goalId: z.string(), runId: z.string() },
    },
    wrap(cocoGoalVerifyResult),
  );

  server.registerTool(
    'coco_health',
    {
      title: 'Loop health verdict',
      description: 'Pure read: healthy / stuck / conflict / operation-in-progress / in-flight-timeout / stalled / review-unavailable / wrong-branch / missing-branch / missing-base / invalid-state / needs-human / budget-exceeded, plus staleForSec. `operation-in-progress` = a legit Oracle/test op is running (from coco_goal_op_start); `in-flight-timeout` = that op has run >1h (likely hung); `stalled` = the loop should be acting but has gone quiet; `review-unavailable` = Oracle down/ambiguous, loop paused for the human.',
      inputSchema: { repoDir, goalId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(cocoHealth),
  );

  server.registerTool(
    'coco_goal_op_start',
    {
      title: 'Mark a long op in flight',
      description:
        'Call BEFORE a long Oracle consult (plan/review) or test run (verify) so coco_health reports `operation-in-progress` instead of misreading the pause as `stalled`. kind: oracle|test. Cleared automatically by the matching coco_goal_record — or by coco_goal_op_clear if the op is aborted. An op still in flight after 1h → coco_health `in-flight-timeout`.',
      inputSchema: { repoDir, goalId: z.string(), phase: z.enum(['plan', 'implement', 'review', 'verify']), kind: z.enum(['oracle', 'test']) },
    },
    wrap(cocoGoalOpStart),
  );

  server.registerTool(
    'coco_goal_op_clear',
    {
      title: 'Clear transient markers (resume)',
      description: 'Clear the in-flight op AND the review-unavailable pause. Idempotent. Use to RESUME the loop after the human has resolved an Oracle problem (re-login, restart Codex, etc.). Normally coco_goal_record clears these for you.',
      inputSchema: { repoDir, goalId: z.string() },
    },
    wrap(cocoGoalOpClear),
  );

  server.registerTool(
    'coco_goal_oracle_unavailable',
    {
      title: 'Record Oracle unavailable (fail-to-human)',
      description:
        'Call after your OWN retry-once when an Oracle plan/review consult is unreachable, times out, errors, or returns no usable "VERDICT: clean|blocking" line. Sets a durable review-unavailable marker: coco_goal_status → escalate-human and merge is refused, so the loop pauses for the human instead of proceeding to a false-green. NEVER fabricate a verdict instead of calling this. Cleared by coco_goal_op_clear (resume) or a later successful record. reason: preflight-failed|oracle-timeout|oracle-error|ambiguous-verdict.',
      inputSchema: {
        repoDir,
        goalId: z.string(),
        phase: z.enum(['plan', 'review']),
        reason: z.enum(['preflight-failed', 'oracle-timeout', 'oracle-error', 'ambiguous-verdict']),
        attempts: z.number().int().positive().optional().describe('how many times you tried (e.g. 2 after a retry)'),
        evidence: z.string().optional().describe('the error text / partial Oracle output, for the incident log'),
      },
    },
    wrap(cocoGoalOracleUnavailable),
  );

  server.registerTool(
    'coco_goal_clear',
    {
      title: 'Cancel the active goal',
      description: 'Terminal: marks the goal cancelled. Use ONLY for explicit user cancellation, never in normal loop flow.',
      inputSchema: { repoDir, goalId: z.string() },
      annotations: { destructiveHint: true },
    },
    wrap(cocoGoalClear),
  );

  server.registerTool(
    'coco_next',
    {
      title: 'Next backlog task',
      description: 'Return the next actionable task from BACKLOG.md (highest-priority `ready` node whose deps are `done`), or null. Use its title + body as the goal objective when the user starts a loop without one.',
      inputSchema: { repoDir },
      annotations: { readOnlyHint: true },
    },
    wrap(cocoNextTool),
  );

  server.registerTool(
    'coco_done',
    {
      title: 'Mark a backlog task done',
      description: "Set a BACKLOG.md task's status to `done` (call after its goal merges).",
      inputSchema: { repoDir, taskId: z.string() },
      annotations: { destructiveHint: true },
    },
    wrap(cocoDoneTool),
  );

  // NOTE: coco_merge is deliberately NOT registered. Merge is the human consent
  // checkpoint: the user runs `coco merge --goal <id>` in the terminal. Keeping it
  // off MCP means a confused/runaway loop cannot merge, even under --yolo.
  return server;
}
