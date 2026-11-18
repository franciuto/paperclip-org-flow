import { beforeEach, describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import type { FeedRecord } from "../src/worker/feed.js";

const COMPANY = "co-1";

describe("org-flow worker", () => {
  let harness: ReturnType<typeof createTestHarness>;
  let emitted: Array<{ channel: string; event: unknown }>;

  beforeEach(async () => {
    harness = createTestHarness({ manifest });
    harness.seed({
      agents: [
        { id: "ag-giulia", companyId: COMPANY, name: "Giulia Bennett" },
        { id: "ag-sofia", companyId: COMPANY, name: "Sofia Carter" },
      ] as never,
      issues: [{ id: "iss-1", companyId: COMPANY, identifier: "FRA-34", title: "Logo per la newsletter" }] as never,
    });
    emitted = [];
    const streams = harness.ctx.streams;
    const original = streams.emit.bind(streams);
    streams.emit = (channel: string, event: unknown) => { emitted.push({ channel, event }); original(channel, event); };
    await plugin.definition.setup(harness.ctx);
  });

  it("streams a handoff with agent names and issue title, and keeps it in recent", async () => {
    await harness.emit("issue.updated", {
      changes: { assigneeAgentId: { from: "ag-giulia", to: "ag-sofia" } },
    }, { companyId: COMPANY, entityId: "iss-1", entityType: "issue", eventId: "ev-1" });

    expect(emitted).toHaveLength(1);
    const rec = emitted[0].event as FeedRecord;
    expect(emitted[0].channel).toBe("feed");
    expect(rec.kind).toBe("handoff");
    expect(rec.from?.name).toBe("Giulia Bennett");
    expect(rec.to?.name).toBe("Sofia Carter");
    expect(rec.title).toBe("Logo per la newsletter");
    expect(rec.identifier).toBe("FRA-34");

    const data = await harness.getData<{ records: FeedRecord[] }>("recent", { companyId: COMPANY });
    expect(data.records.map((r) => r.id)).toEqual(["ev-1"]);
  });

  it("ignores irrelevant issue updates", async () => {
    await harness.emit("issue.updated", { changes: { executionRunId: { from: null, to: "r" } } }, { companyId: COMPANY, entityId: "iss-1", entityType: "issue" });
    expect(emitted).toHaveLength(0);
  });

  it("streams run events", async () => {
    await harness.emit("agent.run.started", { agentId: "ag-sofia", runId: "r1" }, { companyId: COMPANY, eventId: "ev-run" });
    const rec = emitted[0].event as FeedRecord;
    expect(rec).toMatchObject({ kind: "run_started", actor: { kind: "agent", id: "ag-sofia", name: "Sofia Carter" } });
  });

  it("ping pushes a test record through the same path", async () => {
    const res = await harness.performAction<{ ok: boolean }>("ping", { companyId: COMPANY }, { companyId: COMPANY });
    expect(res.ok).toBe(true);
    expect((emitted[0].event as FeedRecord).kind).toBe("ping");
    const data = await harness.getData<{ records: FeedRecord[] }>("recent", { companyId: COMPANY });
    expect(data.records[0].kind).toBe("ping");
  });

  it("returns an empty list without a company", async () => {
    expect(await harness.getData("recent", {})).toEqual({ records: [] });
  });
});
