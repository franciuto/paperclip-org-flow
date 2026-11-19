/**
 * Layout pieces of the full-page view: the chart box that fills the viewport, the detail drawer
 * that slides over the chart, and collapsible sections remembered in localStorage.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { fillHeight, isSectionOpen, loadSections, saveSections, type KV, type SectionState } from "../viewport.js";

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Height (px) that makes the element fill the visible viewport below its top edge. */
export function useFillHeight(ref: RefObject<HTMLElement | null>, ready: boolean, mode: string = ""): number | null {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const compute = () => {
      const sp = scrollParent(el);
      const vpTop = sp ? sp.getBoundingClientRect().top : 0;
      const vpH = sp ? sp.clientHeight : window.innerHeight;
      const scrolled = sp ? sp.scrollTop : window.scrollY;
      const next = fillHeight(vpH, el.getBoundingClientRect().top - vpTop + scrolled);
      setH((cur) => (cur === next ? cur : next));
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [ref, ready, mode]);
  return h;
}

export type FullscreenMode = "native" | "overlay" | null;

/**
 * Full screen for the plugin page. Uses the browser Fullscreen API on `ref`; where it is missing or
 * refused (e.g. iPhone Safari) falls back to an "overlay" mode: the page covers the whole Paperclip
 * UI with position:fixed (CSS class `of-immersive`). Esc or `toggle()` leaves either mode.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>): { mode: FullscreenMode; toggle: () => void } {
  const [mode, setMode] = useState<FullscreenMode>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setMode((m) => (document.fullscreenElement && document.fullscreenElement === ref.current ? "native" : m === "native" ? null : m));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [ref]);
  useEffect(() => {
    if (mode !== "overlay") return;
    const onKey = (ev: globalThis.KeyboardEvent) => { if (ev.key === "Escape" && !ev.defaultPrevented) setMode(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);
  const toggle = useCallback(() => {
    const el = ref.current;
    if (mode === "native") { void document.exitFullscreen?.().catch(() => setMode(null)); return; }
    if (mode === "overlay") { setMode(null); return; }
    if (el && typeof el.requestFullscreen === "function" && document.fullscreenEnabled !== false) {
      el.requestFullscreen().then(() => setMode("native"), () => setMode("overlay"));
    } else {
      setMode("overlay");
    }
  }, [mode, ref]);
  return { mode, toggle };
}

/**
 * Detail drawer over the right edge of the chart (bottom sheet on phones, via CSS).
 * Focus moves into it when it opens and back where it was when it closes; Esc closes.
 */
export function Drawer({ open, label, onClose, children }: { open: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    returnTo.current = (document.activeElement as HTMLElement | null) ?? null;
    const raf = requestAnimationFrame(() => {
      const target = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current;
      target?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      const back = returnTo.current;
      if (back && document.contains(back)) back.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="of-drawer" role="dialog" aria-modal="false" aria-label={label} ref={ref} tabIndex={-1} onKeyDown={onKey}>
      {children}
    </div>
  );
}

function storage(): KV | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Open/closed state of the collapsible sections, remembered per browser. */
export function useSections(): { state: SectionState; isOpen: (id: string) => boolean; toggle: (id: string) => void; setAll: (ids: string[], open: boolean) => void } {
  const [state, setState] = useState<SectionState>(() => loadSections(storage()));
  const update = useCallback((fn: (s: SectionState) => SectionState) => {
    setState((s) => {
      const next = fn(s);
      saveSections(storage(), next);
      return next;
    });
  }, []);
  return {
    state,
    isOpen: (id) => isSectionOpen(state, id),
    toggle: (id) => update((s) => ({ ...s, [id]: !isSectionOpen(s, id) })),
    setAll: (ids, open) => update((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, open])) })),
  };
}

export function Section(props: { id: string; title: string; meta?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  const bodyId = `of-sec-${props.id}`;
  return (
    <section className={`of-section${props.open ? " of-open" : ""}`} aria-label={props.title}>
      <h2 className="of-sec-h">
        <button type="button" aria-expanded={props.open} aria-controls={bodyId} onClick={props.onToggle}>
          <svg className="of-chev" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          <span>{props.title}</span>
          {props.meta != null && <span className="of-count">{props.meta}</span>}
        </button>
      </h2>
      {props.open && <div className="of-sec-body" id={bodyId}>{props.children}</div>}
    </section>
  );
}
