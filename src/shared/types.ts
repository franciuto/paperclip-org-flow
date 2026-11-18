/**
 * Org Flow — data contract shared by the worker (producer) and the UI (consumer).
 *
 * Rules:
 * - Everything here must be JSON-serialisable (it crosses the worker → host → browser bridge).
 * - Timestamps are ISO 8601 strings.
 * - Person ids: agent UUID for agents, `user:<userId>` for human board users.
 * - Changing a field is a contract change: update worker, UI, tests and docs/contratto-dati.md together.
 */

/* ------------------------------------------------------------------ */
/* Feed (live events)                                                  */
/* ------------------------------------------------------------------ */

export type Party = { kind: "agent" | "user"; id: string; name?: string } | null;

export type FeedKind =
  | "handoff"        // assignee changed (agent↔agent, agent↔user)
  | "status"         // status changed, assignee unchanged
  | "created"        // issue created
  | "run_started"    // agent heartbeat run started
  | "run_finished"   // run succeeded
  | "run_failed"     // run failed / timed out
  | "progress"       // progress reported by an agent through the report_progress tool
  | "ping";          // test event from the UI button

export interface FeedRecord {
  id: string;
  at: string;
  kind: FeedKind;
  issueId?: string | null;
  identifier?: string | null;
  title?: string | null;
  /** Parent issue id, when known (lets the UI colour the event by group). */
  parentId?: string | null;
  from?: Party;
  to?: Party;
  actor?: Party;
  statusFrom?: string | null;
  statusTo?: string | null;
  /** For kind "progress". */
  percent?: number | null;
  note?: string | null;
}

/* ------------------------------------------------------------------ */
/* Snapshot (current state of the company)                             */
/* ------------------------------------------------------------------ */

/** Visual state of a person. Agents map 1:1 to Paperclip character poses (see POSE_FOR_STATE). */
export type VisualState =
  | "working"    // run in progress, or holds an in_progress task with recent activity
  | "thinking"   // holds an in_review task (is reviewing)
  | "listening"  // just received a task (handoff in the last ~60 s)
  | "success"    // just closed / got approved (last ~90 s)
  | "confused"   // agent status error, or last run failed, or task sent back to them
  | "sleepy"     // no open tasks and no activity for settings.sleepAfterMinutes
  | "idle"       // has tasks to do (todo/backlog) or is simply free
  | "paused"     // agent paused by the board
  | "waiting";   // human board user holding tasks that wait for them

export type Pose = "rest" | "idle" | "listening" | "thinking" | "working" | "success" | "confused" | "sleepy";

export const POSE_FOR_STATE: Record<VisualState, Pose> = {
  working: "working",
  thinking: "thinking",
  listening: "listening",
  success: "success",
  confused: "confused",
  sleepy: "sleepy",
  idle: "idle",
  paused: "rest",
  waiting: "idle",
};

export interface PersonView {
  id: string;
  kind: "agent" | "user";
  name: string;
  title: string | null;
  role: string | null;
  /** Person id of the manager (agents: reportsTo). Top-level agents: null. Users: null. */
  reportsTo: string | null;
  /** Paperclip character palette (agents). Null for users. */
  paletteId: string | null;
  /** Custom avatar URL (uploaded photo) — when set, the UI shows it instead of the character poses. */
  customAvatarUrl: string | null;
  /** Raw Paperclip agent status (idle, running, paused, error, …). Null for users. */
  agentStatus: string | null;
  state: VisualState;
  /** Short Italian label shown under the name, e.g. "Lavora su FRA-62 · 40%". */
  stateLabel: string;
  stateSince: string | null;
  activeTaskId: string | null;
  lastActivityAt: string | null;
  stats: { received24h: number; passed24h: number; closed24h: number };
}

export type ProgressSource = "reported" | "checklist" | "children" | "status";

export interface JourneyStep { personId: string; since: string }

export interface TaskView {
  id: string;
  identifier: string | null;
  title: string;
  status: string;            // Paperclip issue status
  priority: string | null;
  holderId: string | null;   // person id of the current assignee
  parentId: string | null;
  /** Group the task is coloured by: parent id, own id if the task is itself a parent, or "standalone". */
  groupId: string;
  progress: number;          // 0..100
  progressSource: ProgressSource;
  progressNote: string | null;
  updatedAt: string;
  /** Times the task went back and forth between the same two people (A→B→A counts 1). */
  bounces: number;
  /** Holders over time, oldest first (from the plugin's own history; may be partial for old tasks). */
  journey: JourneyStep[];
  closedAt: string | null;   // set for done/cancelled tasks kept for a short while
}

export interface GroupView {
  id: string;                // parent issue id, or "standalone"
  identifier: string | null;
  title: string;
  /** Stable CSS colour (oklch) derived from the id. Standalone group uses a neutral colour. */
  color: string;
  status: string | null;
  progress: number;          // done children / total children × 100
  childrenTotal: number;
  childrenDone: number;
  holderIds: string[];       // people currently holding open tasks of this group
  updatedAt: string | null;
}

export interface OrgFlowSettings {
  sleepAfterMinutes: number;   // default 15
  keepClosedHours: number;     // closed tasks/groups stay visible this long, default 24
  enableSimulation: boolean;   // show the "Simulazione" toggle in the UI, default true
}

export interface Snapshot {
  companyId: string;
  generatedAt: string;
  people: PersonView[];
  tasks: TaskView[];
  groups: GroupView[];
  feed: FeedRecord[];          // newest first, max 100
  settings: OrgFlowSettings;
  counts: { working: number; thinking: number; sleepy: number; waiting: number; open: number; closed24h: number };
}

/* ------------------------------------------------------------------ */
/* Stream messages (channel "org-flow")                                */
/* ------------------------------------------------------------------ */

export type StreamMessage =
  | { type: "event"; record: FeedRecord }       // emitted immediately, drives animations
  | { type: "snapshot"; snapshot: Snapshot };   // emitted after a short debounce, replaces state

export const STREAM_CHANNEL = "org-flow";

/* ------------------------------------------------------------------ */
/* Bridge keys                                                         */
/* ------------------------------------------------------------------ */

/** ctx.data.register keys */
export const DATA_SNAPSHOT = "snapshot";        // params { companyId } → Snapshot
/**
 * Incremental events for polling. IMPORTANT: in Paperclip 2026.1023.0 and 2026.1106.0 the
 * plugin stream bridge is NOT wired on the host (GET …/bridge/stream/:channel answers 501),
 * so `usePluginStream` never connects. The UI must poll this key (every ~3 s) and use the
 * stream only if it is actually connected.
 * params { companyId, after?: ISO timestamp } → EventsPage
 */
export const DATA_EVENTS = "events";

export interface EventsPage {
  /** Records with `at` strictly greater than `after`, OLDEST first, max 50. Without `after`: the latest 20, oldest first. */
  records: FeedRecord[];
  /** `at` of the newest record returned (or the `after` received when nothing is new). Pass it back as `after`. */
  cursor: string | null;
  /** Snapshot.generatedAt of the worker's latest snapshot, so the UI knows when to refetch the snapshot. */
  snapshotAt: string | null;
}
/** ctx.actions.register keys */
export const ACTION_PING = "ping";              // params { companyId } → { ok: true }
export const ACTION_REFRESH = "refresh";        // params { companyId } → Snapshot (forces rebuild + stream)
/** Agent tool name (manifest.tools) */
export const TOOL_REPORT_PROGRESS = "report_progress";

/** Neutral colour for tasks without a parent. */
export const STANDALONE_GROUP_ID = "standalone";
export const STANDALONE_COLOR = "oklch(62% 0 0)";
