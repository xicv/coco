export type CommandEffect = 'read' | 'write' | 'destructive' | 'external';

export interface CommandDescriptor {
  name: string;
  surfaces: ('cli' | 'mcp' | 'skill')[ ];
  effect: CommandEffect;
  summary: string;
  safety?: string;
}

const COMMANDS: readonly CommandDescriptor[] = [
  { name: 'coco init', surfaces: ['cli', 'mcp'], effect: 'write', summary: 'Bootstrap .coco and tracked coco.config.json on a clean repo.' },
  { name: 'coco next', surfaces: ['cli', 'mcp', 'skill'], effect: 'read', summary: 'Return the next ready backlog task according to dependency/priority rules.' },
  { name: '$coco-queue', surfaces: ['skill'], effect: 'read', summary: 'Inspect the project queue and explain the next ready task without implementing it.' },
  { name: '$coco-night', surfaces: ['skill'], effect: 'external', summary: 'Pick exactly one ready task and run one bounded coco-loop attempt for overnight work.', safety: 'Stops at merge-gate unless the user explicitly invoked --auto for this one goal.' },
  { name: 'coco goal start', surfaces: ['cli', 'mcp', 'skill'], effect: 'write', summary: 'Create one active goal branch from the configured base branch.', safety: 'Refuses dirty trees and concurrent active goals.' },
  { name: 'coco goal status', surfaces: ['cli', 'mcp', 'skill'], effect: 'read', summary: 'Derive deterministic nextAction from goal state and live git.' },
  { name: 'coco goal record', surfaces: ['cli', 'mcp', 'skill'], effect: 'write', summary: 'Append plan/implement/review events bound to expectedSha.', safety: 'Review verdicts are parsed from Oracle output; verify is not accepted here.' },
  { name: 'coco goal verify', surfaces: ['cli', 'mcp', 'skill'], effect: 'external', summary: 'Run the committed verify.testCommand and record pass/fail from exit code.', safety: 'Coco owns verify; agents cannot self-report pass.' },
  { name: 'coco merge', surfaces: ['cli', 'skill'], effect: 'destructive', summary: 'Human-terminal FF-only merge path.', safety: 'Requires clean review, passing verify, current epoch, clean branch, base ancestry, and explicit ack for verify policy changes.' },
  { name: 'coco_merge', surfaces: ['mcp', 'skill'], effect: 'destructive', summary: 'Opt-in auto-merge attempt for a single goal.', safety: 'Requires per-goal consent and risk-tier; falls back to human on risk.' },
  { name: 'coco health', surfaces: ['cli', 'mcp'], effect: 'read', summary: 'Report loop health, stall, conflict, in-flight, and invalid-state conditions.' },
  { name: 'coco doctor', surfaces: ['cli'], effect: 'read', summary: 'Aggregate local environment, repo, wiring, goal, audit, and data hygiene checks.' },
  { name: 'coco doctor clean', surfaces: ['cli'], effect: 'destructive', summary: 'Dry-run/apply cleanup of terminal or orphaned verify-run cache only.' },
  { name: 'coco audit report', surfaces: ['cli'], effect: 'read', summary: 'Summarise valid audit records, feedback, and loop trajectory signals.' },
  { name: 'coco audit validate', surfaces: ['cli'], effect: 'read', summary: 'Validate audit schema and cross-record invariants before self-improvement acts.' },
  { name: 'coco audit feedback', surfaces: ['cli'], effect: 'write', summary: 'Append structured redacted human feedback for goal/implementation/loop quality.' },
  { name: 'coco improve digest', surfaces: ['cli', 'skill'], effect: 'read', summary: 'Summarise structural audit + feedback signals with an insufficient-data gate.' },
  { name: 'coco improve check', surfaces: ['cli', 'skill'], effect: 'read', summary: 'Refuse protected-path targets for self-improvement proposals.' },
  { name: 'coco improve promote', surfaces: ['cli', 'skill'], effect: 'write', summary: 'Promote one non-protected improve task linked to a local improve-spec.' },
  { name: 'coco eval', surfaces: ['cli'], effect: 'read', summary: 'Run deterministic safety-regression fixture checks.' },
  { name: 'coco setup codex', surfaces: ['cli'], effect: 'write', summary: 'Dry-run/apply Codex MCP config and skill sync.' },
  { name: 'coco-store', surfaces: ['cli', 'skill'], effect: 'write', summary: 'PM layer for ResourceCards, roadmap, backlog, briefs, and visualisation.', safety: 'Must not mutate .coco/goals.' },
];

export function listCommandDescriptors(): CommandDescriptor[] {
  return COMMANDS.map((c) => ({ ...c, surfaces: [...c.surfaces] }));
}
