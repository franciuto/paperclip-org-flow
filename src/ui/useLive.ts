/**
 * Live data for the page.
 *
 * The host's plugin stream bridge is not wired in the Paperclip versions we target (the SSE
 * endpoint answers 501), so POLLING is the primary channel:
 * - `DATA_EVENTS` every ~3 s with `after = cursor` → new records (oldest first) are handed to
 *   `onRecords` right away (they drive flights, flashes and the feed);
 * - `DATA_SNAPSHOT` is refetched when new records arrive or `snapshotAt` moves (debounced) and
 *   every 30 s; `ACTION_REFRESH` every 60 s forces a rebuild (time-based states like "sleepy").
 * If `usePluginStream` does connect, its events/snapshots are used too and polling slows down.
 *
 * `usePluginData` clears `data` on error, so the last good snapshot is kept in local state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export const POLL_MS = 3000;
export const POLL_MS_WITH_STREAM = 30_000;
export const SNAPSHOT_REFRESH_MS = 30_000;
export const ACTION_REFRESH_MS = 60_000;

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

export interface LiveState {
  snapshot: Snapshot | null;
  loading: boolean;
  error: string | null;
  connection: ConnectionState;
  lastOkAt: number | null;
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
  const stream = usePluginStream<StreamMessage>(STREAM_CHANNEL, { companyId });
  const refreshAction = usePluginAction(ACTION_REFRESH);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snapshot;
  const offer = useCallback((s: unknown) => {
    if (isSnapshot(s)) setSnapshot((cur) => newerSnapshot(cur, s));
  }, []);

  // Polling health and de-duplication
  const [health, setHealth] = useState<{ lastOkAt: number | null; failures: number }>({ lastOkAt: null, failures: 0 });
  const seen = useRef(new Set<string>());
  const initialized = useRef(false);

  // Reset when the company changes
  useEffect(() => {
    setCursor(null);
    setSnapshot(null);
    setHealth({ lastOkAt: null, failures: 0 });
    seen.current.clear();
    initialized.current = false;
  }, [companyId]);

  useEffect(() => {
    if (snapQ.data) offer(snapQ.data);
  }, [snapQ.data, offer]);

  const snapRefresh = useRef(snapQ.refresh);
  snapRefresh.current = snapQ.refresh;
  const evRefresh = useRef(evQ.refresh);
  evRefresh.current = evQ.refresh;

  // Debounced snapshot refetch
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSnapshot = useCallback((ms: number) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      debounce.current = null;
      snapRefresh.current();
    }, ms);
  }, []);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);


  const ingest = useCallback((records: FeedRecord[], animateIfInitialized: boolean) => {
    const fresh = records.filter((r) => r && typeof r.id === "string" && !seen.current.has(r.id));
    for (const r of fresh) seen.current.add(r.id);
    if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-1000));
    if (fresh.length) onRecordsRef.current(fresh, animateIfInitialized && initialized.current);
    return fresh.length;
  }, []);

  useEffect(() => {
    const page = evQ.data;
    if (!page || !Array.isArray(page.records)) return;
    setHealth({ lastOkAt: Date.now(), failures: 0 });
    const n = ingest(page.records, true);
    initialized.current = true;
    if (n) scheduleSnapshot(700);
    const current = snapRef.current;
    if (page.snapshotAt && current && Date.parse(page.snapshotAt) > Date.parse(current.generatedAt)) scheduleSnapshot(250);
    if (page.cursor && page.cursor !== cursor) setCursor(page.cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evQ.data]);

  useEffect(() => {
    if (evQ.error) setHealth((h) => ({ ...h, failures: h.failures + 1 }));
  }, [evQ.error]);

  // Stream (used only if the host actually connects it)
  const processed = useRef(0);
  useEffect(() => {
    const evs = stream.events ?? [];
    if (evs.length < processed.current) processed.current = 0;
    const fresh = evs.slice(processed.current);
    processed.current = evs.length;
    for (const m of fresh) {
      if (!m || typeof m !== "object") continue;
      if (m.type === "event" && m.record) ingest([m.record], true);
      else if (m.type === "snapshot") offer(m.snapshot);
    }
  }, [stream.events, ingest, offer]);

  const pollMs = stream.connected ? POLL_MS_WITH_STREAM : POLL_MS;
  useEffect(() => {
    if (!companyId) return;
    const id = setInterval(() => {
      if (pageVisible()) evRefresh.current();
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, companyId]);

  useEffect(() => {
    if (!companyId) return;
    const id = setInterval(() => {
      if (pageVisible()) snapRefresh.current();
    }, SNAPSHOT_REFRESH_MS);
    return () => clearInterval(id);
  }, [companyId]);

  const actionRef = useRef(refreshAction);
  actionRef.current = refreshAction;
  useEffect(() => {
    if (!companyId || options.forceRefresh === false) return;
    const id = setInterval(() => {
      if (!pageVisible()) return;
      actionRef.current({ companyId }).then(offer, () => undefined);
    }, ACTION_REFRESH_MS);
    return () => clearInterval(id);
  }, [companyId, offer, options.forceRefresh]);

  return {
    snapshot,
    loading: !snapshot && snapQ.loading,
    error: !snapshot && snapQ.error ? snapQ.error.message : null,
    connection: connectionState({ streamConnected: stream.connected, lastOkAt: health.lastOkAt, failures: health.failures, nowMs: Date.now(), pollMs }),
    lastOkAt: health.lastOkAt,
  };
}
