/**
 * Live data for the page.
 *
 * The host's plugin stream bridge is not wired in the Paperclip versions we target (the SSE
 * endpoint answers 501), so POLLING is the primary channel:
 * - `DATA_EVENTS` with `after = cursor` (opaque) → new records (oldest first) go to `onRecords`
 *   right away (flights, flashes, feed). Polling is SELF-SCHEDULING: the next poll is planned only
 *   after the previous one settled (the host's refresh() cancels the previous request without
 *   aborting it, so a fixed timer could starve when replies are slow); a watchdog retries a
 *   request that has not settled after POLL_CEILING_MS.
 * - `DATA_SNAPSHOT` is refetched (never more than one in flight, triggers coalesced) when new
 *   records arrive or `snapshotAt` moves, and every 30 s; `ACTION_REFRESH` every 60 s forces a
 *   rebuild (time-based states like "sleepy").
 * - If 5 consecutive polls return nothing while `snapshotAt` keeps moving, the cursor is reset.
 * If the stream does connect, its messages are used too and polling slows down. The stream hook
 * lives in a child component that is remounted when its (ever-growing) event array gets large.
 *
 * `usePluginData` sets `data` to null on error, so the last good snapshot is kept locally.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePluginAction, usePluginData, usePluginStream } from "@paperclipai/plugin-sdk/ui";
import {
  ACTION_REFRESH,
  DATA_EVENTS,
  DATA_SNAPSHOT,
  STREAM_CHANNEL,
  type EventsPage,
  type FeedRecord,
  type Snapshot,
  type StreamMessage,
} from "../shared/types.js";
import { connectionState, type ConnectionState } from "./model.js";
import { initialCursorWatch, POLL_CEILING_MS, RequestGate, watchCursor } from "./poll.js";

export const POLL_MS = 3000;
export const POLL_MS_AFTER_ERROR = 6000;
export const POLL_MS_WITH_STREAM = 30_000;
export const SNAPSHOT_REFRESH_MS = 30_000;
export const ACTION_REFRESH_MS = 60_000;
export const STREAM_REMOUNT_AT = 500;

export function isSnapshot(v: unknown): v is Snapshot {
  const s = v as Snapshot | null;
  return !!s && typeof s === "object" && Array.isArray(s.people) && Array.isArray(s.tasks) && Array.isArray(s.groups) && typeof s.generatedAt === "string";
}

/** Prefer the newest snapshot (by generatedAt); a different company always wins. */
export function newerSnapshot(cur: Snapshot | null, next: Snapshot): Snapshot {
  if (!cur || cur.companyId !== next.companyId) return next;
  const a = Date.parse(cur.generatedAt);
  const b = Date.parse(next.generatedAt);
  return !Number.isFinite(a) || !Number.isFinite(b) || b >= a ? next : cur;
}

const pageVisible = () => typeof document === "undefined" || !document.hidden;

/** Owns the stream hook; remounted (new key) when its event array grows past STREAM_REMOUNT_AT. */
function StreamTap(props: {
  companyId: string | undefined;
  onMessages: (msgs: StreamMessage[], total: number) => void;
  onConnected: (connected: boolean) => void;
}) {
  const s = usePluginStream<StreamMessage>(STREAM_CHANNEL, { companyId: props.companyId });
  const processed = useRef(0);
  const cbs = useRef(props);
  cbs.current = props;
  useEffect(() => {
    const evs = s.events ?? [];
    if (evs.length < processed.current) processed.current = 0;
    const fresh = evs.slice(processed.current);
    processed.current = evs.length;
    if (fresh.length) cbs.current.onMessages(fresh, evs.length);
  }, [s.events]);
  useEffect(() => cbs.current.onConnected(!!s.connected), [s.connected]);
  return null;
}

export interface LiveState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  connection: ConnectionState;
  lastOkAt: number | null;
  /** Render this somewhere in the tree (it renders nothing): it hosts the stream subscription. */
  streamTap: ReactNode;
}

export function useLiveOrgFlow(
  companyId: string | undefined,
  onRecords: (records: FeedRecord[], animate: boolean) => void,
  options: { forceRefresh?: boolean } = {},
): LiveState {
  const onRecordsRef = useRef(onRecords);
  onRecordsRef.current = onRecords;

  const snapParams = useMemo(() => ({ companyId }), [companyId]);
  const snapQ = usePluginData<Snapshot>(DATA_SNAPSHOT, snapParams);
  const [cursor, setCursor] = useState<string | null>(null);
  const evParams = useMemo(() => (cursor ? { companyId, after: cursor } : { companyId }), [companyId, cursor]);
  const evQ = usePluginData<EventsPage>(DATA_EVENTS, evParams);
  const refreshAction = usePluginAction(ACTION_REFRESH);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snapshot;
  const offer = useCallback((s: unknown) => {
    if (isSnapshot(s)) setSnapshot((cur) => newerSnapshot(cur, s));
  }, []);

  const [health, setHealth] = useState<{ lastOkAt: number | null; failures: number }>({ lastOkAt: null, failures: 0 });
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);
  const cursorWatch = useRef(initialCursorWatch());
  // Both queries start fetching on mount, so both gates start "in flight".
  const evGate = useRef<RequestGate | null>(null);
  const snapGate = useRef<RequestGate | null>(null);
  if (!evGate.current) {
    evGate.current = new RequestGate(POLL_CEILING_MS);
    evGate.current.start(Date.now());
    snapGate.current = new RequestGate(POLL_CEILING_MS);
    snapGate.current.start(Date.now());
  }

  const snapRefresh = useRef(snapQ.refresh);
  snapRefresh.current = snapQ.refresh;
  const evRefresh = useRef(evQ.refresh);
  evRefresh.current = evQ.refresh;

  const [streamConnected, setStreamConnected] = useState(false);
  const pollMs = streamConnected ? POLL_MS_WITH_STREAM : POLL_MS;
  const pollMsRef = useRef(pollMs);
  pollMsRef.current = pollMs;

  /* ---------- snapshot: single flight, coalesced, debounced triggers ---------- */
  const requestSnapshot = useCallback(() => {
    if (snapGate.current!.request(Date.now())) snapRefresh.current();
  }, []);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSnapshot = useCallback((ms: number) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      debounce.current = null;
      requestSnapshot();
    }, ms);
  }, [requestSnapshot]);

  useEffect(() => {
    if (snapQ.data) offer(snapQ.data);
    if (snapQ.data || snapQ.error) {
      if (snapGate.current!.settle(Date.now())) snapRefresh.current();
    }
  }, [snapQ.data, snapQ.error, offer]);

  /* ---------- events: self-scheduling poll with watchdog ---------- */
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firePollRef = useRef<() => void>(() => undefined);
  const schedulePoll = useCallback((ms: number) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = setTimeout(() => firePollRef.current(), ms);
  }, []);
  firePollRef.current = () => {
    const now = Date.now();
    if (!companyId) return;
    if (!pageVisible()) return schedulePoll(pollMsRef.current);
    const gate = evGate.current!;
    if (!gate.inFlight || gate.stuck(now)) {
      gate.start(now);
      evRefresh.current();
    }
    schedulePoll(POLL_CEILING_MS); // watchdog; replaced by the normal delay once the poll settles
  };
  useEffect(() => {
    schedulePoll(POLL_CEILING_MS); // watchdog for the initial request
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [schedulePoll]);

  const ingest = useCallback((records: FeedRecord[]) => {
    const fresh = records.filter((r) => r && typeof r.id === "string" && !seen.current.has(r.id));
    for (const r of fresh) seen.current.add(r.id);
    if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-1000));
    if (fresh.length) onRecordsRef.current(fresh, initialized.current);
    return fresh.length;
  }, []);

  useEffect(() => {
    const page = evQ.data;
    if (!page || !Array.isArray(page.records)) return;
    evGate.current!.settle(Date.now());
    setHealth({ lastOkAt: Date.now(), failures: 0 });
    const n = ingest(page.records);
    initialized.current = true;
    if (n) scheduleSnapshot(700);
    const current = snapRef.current;
    if (page.snapshotAt && current && Date.parse(page.snapshotAt) > Date.parse(current.generatedAt)) scheduleSnapshot(250);
    const w = watchCursor(cursorWatch.current, { records: page.records, snapshotAt: page.snapshotAt ?? null });
    cursorWatch.current = w.watch;
    const nextCursor = w.reset ? null : page.cursor ?? cursor;
    if (nextCursor !== cursor) {
      // The host refetches on its own when params change: count it as the next poll.
      evGate.current!.start(Date.now());
      setCursor(nextCursor);
      schedulePoll(POLL_CEILING_MS);
    } else {
      schedulePoll(pollMsRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evQ.data]);

  useEffect(() => {
    if (!evQ.error) return;
    evGate.current!.settle(Date.now());
    setHealth((h) => ({ ...h, failures: h.failures + 1 }));
    schedulePoll(Math.max(POLL_MS_AFTER_ERROR, pollMsRef.current));
  }, [evQ.error, schedulePoll]);

  /* ---------- periodic snapshot + forced rebuild ---------- */
  useEffect(() => {
    if (!companyId) return;
    const id = setInterval(() => {
      if (pageVisible()) requestSnapshot();
    }, SNAPSHOT_REFRESH_MS);
    return () => clearInterval(id);
  }, [companyId, requestSnapshot]);

  const actionRef = useRef(refreshAction);
  actionRef.current = refreshAction;
  const actionBusy = useRef(false);
  useEffect(() => {
    if (!companyId || options.forceRefresh === false) return;
    const id = setInterval(() => {
      if (!pageVisible() || actionBusy.current) return;
      actionBusy.current = true;
      actionRef.current({ companyId })
        .then(offer, () => undefined)
        .finally(() => { actionBusy.current = false; });
    }, ACTION_REFRESH_MS);
    return () => clearInterval(id);
  }, [companyId, offer, options.forceRefresh]);

  /* ---------- stream (only if the host connects it) ---------- */
  const [streamGen, setStreamGen] = useState(0);
  const onStreamMessages = useCallback((msgs: StreamMessage[], total: number) => {
    for (const m of msgs) {
      if (!m || typeof m !== "object") continue;
      if (m.type === "event" && m.record) ingest([m.record]);
      else if (m.type === "snapshot") offer(m.snapshot);
    }
    if (total > STREAM_REMOUNT_AT) setStreamGen((g) => g + 1);
  }, [ingest, offer]);
  const streamTap = (
    <StreamTap key={`${companyId ?? "-"}:${streamGen}`} companyId={companyId} onMessages={onStreamMessages} onConnected={setStreamConnected} />
  );

  return {
    snapshot,
    loading: !snapshot && snapQ.loading,
    error: !snapshot && snapQ.error ? snapQ.error.message : null,
    connection: connectionState({ streamConnected, lastOkAt: health.lastOkAt, failures: health.failures, nowMs: Date.now(), pollMs }),
    lastOkAt: health.lastOkAt,
    streamTap,
  };
}
