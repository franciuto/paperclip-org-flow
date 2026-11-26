import { describe, expect, it } from "vitest";
import { computePresence, type PresenceInput } from "../src/worker/presence.js";

const NOW = Date.parse("2026-11-19T10:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

const base = (over: Partial<PresenceInput> = {}): PresenceInput => ({
  kind: "agent",
  agentStatus: "idle",
  heldOpen: [],
  activeRun: null,
  lastRun: null,
  received: null,
  closed: null,
  bounced: null,
  lastActivityAt: ago(60),
  ...over,
});

const task = (id: string, status: string, progress = 40) => ({ id, ref: id.toUpperCase(), status, progress });
const sig = (s: number, taskId = "acme-1") => ({ at: ago(s), taskId, ref: taskId.toUpperCase() });

describe("computePresence — rule order", () => {
  it("paused wins over everything", () => {
    const r = computePresence(base({ agentStatus: "paused", activeRun: sig(5), closed: sig(5) }), NOW, 15);
    expect(r.state).toBe("paused");
    expect(r.label).toBe("Paused");
  });

  it("error status → confused", () => {
    expect(computePresence(base({ agentStatus: "error" }), NOW, 15)).toMatchObject({ state: "confused", label: "Error" });
  });

  it("last run failed in the last 10 min → confused, older → not", () => {
    const failed = { ...sig(120), failed: true };
    expect(computePresence(base({ lastRun: failed }), NOW, 15)).toMatchObject({ state: "confused", label: "Run failed · ACME-1" });
    const old = { ...sig(11 * 60), failed: true };
    expect(computePresence(base({ lastRun: old }), NOW, 15).state).not.toBe("confused");
    const ok = { ...sig(30), failed: false };
    expect(computePresence(base({ lastRun: ok }), NOW, 15).state).not.toBe("confused");
  });

  it("task sent back in the last 2 min → confused (beats success and listening)", () => {
    const r = computePresence(base({ bounced: sig(30), closed: sig(10), received: sig(30) }), NOW, 15);
    expect(r).toMatchObject({ state: "confused", label: "Sent back: ACME-1", activeTaskId: "acme-1" });
    expect(computePresence(base({ bounced: sig(130) }), NOW, 15).state).not.toBe("confused");
  });

  it("closed in the last 90 s → success, before listening and working", () => {
    const r = computePresence(base({ closed: sig(80), received: sig(10), activeRun: sig(5) }), NOW, 15);
    expect(r).toMatchObject({ state: "success", label: "Closed ACME-1" });
    expect(computePresence(base({ closed: sig(95) }), NOW, 15).state).not.toBe("success");
  });

  it("received in the last 60 s → listening", () => {
    expect(computePresence(base({ received: sig(50, "acme-9"), activeRun: sig(5) }), NOW, 15))
      .toMatchObject({ state: "listening", label: "Received ACME-9" });
    expect(computePresence(base({ received: sig(61) }), NOW, 15).state).not.toBe("listening");
  });

  it("run in progress → working with task and percent", () => {
    const r = computePresence(base({ activeRun: sig(20, "acme-2"), heldOpen: [task("acme-2", "in_progress", 40)] }), NOW, 15);
    expect(r).toMatchObject({ state: "working", label: "Working on ACME-2 · 40%", activeTaskId: "acme-2" });
  });

  it("agent status running without a tracked run → working", () => {
    expect(computePresence(base({ agentStatus: "running" }), NOW, 15)).toMatchObject({ state: "working", label: "Working" });
  });

  it("holding an in_review task → thinking", () => {
    const r = computePresence(base({ heldOpen: [task("acme-3", "in_review"), task("acme-4", "todo")] }), NOW, 15);
    expect(r).toMatchObject({ state: "thinking", label: "Reviewing ACME-3" });
  });

  it("open tasks → idle with a useful label", () => {
    expect(computePresence(base({ heldOpen: [task("acme-5", "todo")] }), NOW, 15).label).toBe("To do: ACME-5");
    expect(computePresence(base({ heldOpen: [task("acme-5", "in_progress", 40)] }), NOW, 15).label).toBe("In progress: ACME-5 · 40%");
    expect(computePresence(base({ heldOpen: [task("acme-5", "blocked")] }), NOW, 15).label).toBe("Blocked: ACME-5");
    const many = computePresence(base({ heldOpen: [task("a", "todo"), task("b", "backlog")] }), NOW, 15);
    expect(many).toMatchObject({ state: "idle", label: "2 tasks to do" });
  });

  it("no tasks and no activity for sleepAfterMinutes → sleepy, otherwise free", () => {
    expect(computePresence(base({ lastActivityAt: ago(16 * 60) }), NOW, 15)).toMatchObject({ state: "sleepy", label: "Asleep" });
    expect(computePresence(base({ lastActivityAt: ago(14 * 60) }), NOW, 15)).toMatchObject({ state: "idle", label: "Idle" });
    expect(computePresence(base({ lastActivityAt: null }), NOW, 15).state).toBe("sleepy");
    expect(computePresence(base({ lastActivityAt: ago(14 * 60) }), NOW, 10).state).toBe("sleepy");
  });

  it("users: waiting when holding open tasks", () => {
    expect(computePresence(base({ kind: "user", agentStatus: null, heldOpen: [task("acme-7", "in_review")] }), NOW, 15))
      .toMatchObject({ state: "waiting", label: "To handle: ACME-7" });
    expect(computePresence(base({ kind: "user", agentStatus: null }), NOW, 15).state).toBe("idle");
  });

  it("terminated agents are shown as not active", () => {
    expect(computePresence(base({ agentStatus: "terminated" }), NOW, 15)).toMatchObject({ state: "paused", label: "No longer active" });
  });
});
