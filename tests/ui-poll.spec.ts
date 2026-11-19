import { describe, expect, it } from "vitest";
import { bucketUnknownHolders, OTHERS_ID, heldByPerson } from "../src/ui/model.js";
import { announce, CURSOR_RESET_AFTER, flushAnnouncer, initialCursorWatch, RequestGate, rovingNext, watchCursor } from "../src/ui/poll.js";
import { CSS, ensureStyles, STYLE_ID, type StyleDoc } from "../src/ui/styles.js";
import { busySnapshot, IDS } from "./ui/fixtures.js";

describe("RequestGate (single flight, coalesced, ceiling)", () => {
  it("never lets two requests run at once and coalesces triggers into one follow-up", () => {
    const g = new RequestGate(15_000);
    expect(g.request(0)).toBe(true);
    expect(g.request(1000)).toBe(false);
    expect(g.request(2000)).toBe(false); // coalesced with the previous trigger
    expect(g.settle(3000)).toBe(true); // exactly one follow-up
    expect(g.inFlight).toBe(true);
    expect(g.settle(4000)).toBe(false);
    expect(g.inFlight).toBe(false);
  });

  it("does not starve when replies are slower than the poll interval", () => {
    // Polls every 3 s, replies take 5 s: with the gate each reply is applied, none is cancelled.
    const g = new RequestGate(15_000);
    let fired = 0;
    let settled = 0;
    let inFlightSince: number | null = null;
    for (let t = 0; t <= 60_000; t += 1000) {
      if (inFlightSince !== null && t - inFlightSince >= 5000) {
        g.settle(t);
        settled++;
        inFlightSince = null;
      }
      if (t % 3000 === 0 && !g.inFlight) {
        g.start(t);
        fired++;
        inFlightSince = t;
      }
    }
    expect(fired).toBeGreaterThan(5);
    expect(settled).toBeGreaterThanOrEqual(fired - 1);
  });

  it("retries a request stuck past the ceiling", () => {
    const g = new RequestGate(15_000);
    g.start(0);
    expect(g.stuck(14_999)).toBe(false);
    expect(g.request(10_000)).toBe(false);
    expect(g.stuck(15_000)).toBe(true);
    expect(g.request(15_000)).toBe(true);
  });
});

describe("watchCursor", () => {
  it("resets after 5 empty polls while snapshotAt keeps moving", () => {
    let w = initialCursorWatch();
    let reset = false;
    for (let i = 0; i <= CURSOR_RESET_AFTER; i++) {
      const r = watchCursor(w, { records: [], snapshotAt: `2026-11-19T10:00:0${i}Z` });
      w = r.watch;
      reset = reset || r.reset;
    }
    expect(reset).toBe(true);
  });

  it("does not reset when snapshotAt is still, or when records arrive", () => {
    let w = initialCursorWatch();
    for (let i = 0; i < 20; i++) {
      const r = watchCursor(w, { records: [], snapshotAt: "2026-11-19T10:00:00Z" });
      expect(r.reset).toBe(false);
      w = r.watch;
    }
    for (let i = 0; i < 20; i++) {
      const r = watchCursor(w, { records: i % 4 === 0 ? [{}] : [], snapshotAt: `2026-11-19T10:00:${String(i).padStart(2, "0")}Z` });
      expect(r.reset).toBe(false);
      w = r.watch;
    }
  });
});

describe("announcer", () => {
  it("emits at most one message per gap; the latest queued one is flushed later", () => {
    let a = { lastAt: null as number | null, queued: null as string | null };
    let r = announce(a, "uno", 0, 8000);
    expect(r.emit).toBe("uno");
    a = r.state;
    r = announce(a, "due", 1000, 8000);
    expect(r.emit).toBeNull();
    r = announce(r.state, "tre", 2000, 8000);
    expect(r.emit).toBeNull();
    expect(flushAnnouncer(r.state, 5000, 8000).emit).toBeNull();
    const f = flushAnnouncer(r.state, 8000, 8000);
    expect(f.emit).toBe("tre");
    expect(flushAnnouncer(f.state, 20_000, 8000).emit).toBeNull();
  });
});

describe("rovingNext", () => {
  const keys = ["p:a", "t:1", "p:b", "t:2"];
  it("moves in reading order and clamps at the ends", () => {
    expect(rovingNext(keys, "p:a", "ArrowRight")).toBe("t:1");
    expect(rovingNext(keys, "t:1", "ArrowDown")).toBe("p:b");
    expect(rovingNext(keys, "t:2", "ArrowRight")).toBe("t:2");
    expect(rovingNext(keys, "p:a", "ArrowLeft")).toBe("p:a");
    expect(rovingNext(keys, "p:b", "ArrowUp")).toBe("t:1");
    expect(rovingNext(keys, "t:1", "Home")).toBe("p:a");
    expect(rovingNext(keys, null, "End")).toBe("t:2");
    expect(rovingNext(keys, "gone", "ArrowRight")).toBe("p:a");
    expect(rovingNext(keys, "p:a", "Enter")).toBeNull();
    expect(rovingNext([], null, "ArrowRight")).toBeNull();
  });
});

describe("bucketUnknownHolders", () => {
  it("moves open tasks of unknown holders to 'Altri' and only adds the node when needed", () => {
    const s = busySnapshot(Date.parse("2026-11-19T15:00:00Z"));
    expect(bucketUnknownHolders(s.tasks, s.people).others).toBeNull();
    const people = s.people.filter((p) => p.id !== IDS.daniel);
    const r = bucketUnknownHolders(s.tasks, people);
    expect(r.others?.id).toBe(OTHERS_ID);
    expect(r.others?.stateLabel).toBe("5 task");
    const held = heldByPerson(r.tasks, s.groups.map((g) => g.id));
    expect(held.get(OTHERS_ID)).toHaveLength(5);
    expect(r.tasks.filter((t) => t.holderId === IDS.daniel)).toHaveLength(0);
  });
});

describe("ensureStyles", () => {
  function fakeDoc() {
    const els = new Map<string, { id: string; textContent: string | null }>();
    const doc: StyleDoc = {
      getElementById: (id) => els.get(id) ?? null,
      createElement: () => ({ id: "", textContent: null }),
      head: { appendChild: (n) => { const el = n as { id: string; textContent: string | null }; els.set(el.id, el); return n; } },
    };
    return { doc, els };
  }
  it("injects once and replaces stale content after a plugin upgrade", () => {
    const { doc, els } = fakeDoc();
    ensureStyles(doc, "a{}");
    ensureStyles(doc, "a{}");
    expect(els.size).toBe(1);
    expect(els.get(STYLE_ID)!.textContent).toBe("a{}");
    ensureStyles(doc, CSS);
    expect(els.size).toBe(1);
    expect(els.get(STYLE_ID)!.textContent).toBe(CSS);
  });
});
