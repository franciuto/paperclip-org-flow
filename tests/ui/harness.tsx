/**
 * Visual harness entry: renders the three UI exports with the SDK stub.
 * Query: ?view=page|widget  &fixture=busy|quiet  &dark=1  &sim=1  &select=ACME-59 | person:<name>
 */
import { createRoot } from "react-dom/client";
import type { TaskView } from "../../src/shared/types.js";
import { chipWidthFor } from "../../src/ui/chips.js";
import { Chip } from "../../src/ui/components/OrgChart.js";
import { OrgFlowDashboardWidget, OrgFlowPage, OrgFlowSidebarLink } from "../../src/ui/index.js";
import { useStyles } from "../../src/ui/styles.js";

const qs = new URLSearchParams(location.search);
if (qs.get("dark") === "1") document.documentElement.classList.add("dark");
const context = { companyId: "co-1", companyPrefix: "ACME", projectId: null, entityId: null, entityType: null, userId: "board-1" };

/** Close-up of chips (scale 4) to check that code and percent never overlap. */
function ChipGallery() {
  useStyles();
  const codes = ["ACME-56", "ACME-1234", "PROJ-12345", "A-VERY-LONG-IDENTIFIER-12345"];
  const rows: Array<[string, number]> = [["in_review", 100], ["in_progress", 45], ["todo", 5], ["blocked", 55]];
  const colors = ["oklch(62% .19 300)", "oklch(63% .12 190)", "oklch(71% .15 62)", "oklch(58% .19 255)"];
  return (
    <div className="of-root" style={{ padding: 12 }}>
      {codes.map((code, ci) => {
        const w = chipWidthFor([code]);
        return (
          <svg key={code} width={(rows.length * (w + 6)) * 2.6} height={22 * 2.6} viewBox={`0 0 ${rows.length * (w + 6)} 22`} style={{ display: "block", marginBottom: 6 }}>
            {rows.map(([status, progress], i) => {
              const t = { id: `${code}-${i}`, identifier: code, title: code, status, progress, groupId: "g" } as TaskView;
              return <Chip key={i} task={t} x={2 + i * (w + 6)} y={2} w={w} color={colors[ci]!} groupTitle="" selected={false} dim={false} onSelect={() => undefined} />;
            })}
          </svg>
        );
      })}
    </div>
  );
}

function Harness() {
  if (qs.get("view") === "chips") return <ChipGallery />;
  if (qs.get("view") === "widget") {
    return (
      <div className="hx-dash">
        <nav className="hx-side" aria-label="Sidebar (fake)">
          <div className="hx-side-item">Dashboard</div>
          <div className="hx-side-item">Task</div>
          <div className="hx-side-item">Agents</div>
          <OrgFlowSidebarLink context={context} />
        </nav>
        <div className="hx-cards">
          <section className="hx-card"><OrgFlowDashboardWidget context={context} /></section>
          <section className="hx-card hx-ghost">Another dashboard widget</section>
        </div>
      </div>
    );
  }
  return <OrgFlowPage context={context} />;
}

createRoot(document.getElementById("root")!).render(<Harness />);

// Scripted interactions for screenshots
const click = (sel: string) => (document.querySelector(sel) as HTMLElement | SVGElement | null)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
if (qs.get("sim") === "1") {
  setTimeout(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Simulation"));
    btn?.click();
  }, 900);
}
const sel = qs.get("select");
if (sel) {
  setTimeout(() => {
    if (sel.startsWith("person:")) click(`.of-node[aria-label^="${sel.slice(7)}"]`);
    else click(`.of-chip[aria-label^="${sel} "]`);
  }, 900);
}

if (qs.get("ping") === "1") {
  setTimeout(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Check connection"))?.click();
  }, 1500);
}
// Short chart box so the sections below fit in a screenshot: ?compact=1
if (qs.get("compact") === "1") {
  const st = document.createElement("style");
  st.textContent = ".of-stage{height:560px!important}";
  document.head.appendChild(st);
}
// Collapse one section first: ?collapse=kpi
const collapse = qs.get("collapse");
if (collapse) {
  setTimeout(() => {
    Array.from(document.querySelectorAll(".of-sec-h button")).find((b) => b.getAttribute("aria-controls") === `of-sec-${collapse}`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, 1200);
}
