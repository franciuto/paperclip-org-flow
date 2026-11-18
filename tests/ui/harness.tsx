/**
 * Visual harness entry: renders the three UI exports with the SDK stub.
 * Query: ?view=page|widget  &fixture=busy|quiet  &dark=1  &sim=1  &select=FRA-59 | person:<name>
 */
import { createRoot } from "react-dom/client";
import { OrgFlowDashboardWidget, OrgFlowPage, OrgFlowSidebarLink } from "../../src/ui/index.js";

const qs = new URLSearchParams(location.search);
if (qs.get("dark") === "1") document.documentElement.classList.add("dark");
const context = { companyId: "co-1", companyPrefix: "FRA", projectId: null, entityId: null, entityType: null, userId: "board-1" };

function Harness() {
  if (qs.get("view") === "widget") {
    return (
      <div className="hx-dash">
        <nav className="hx-side" aria-label="Barra laterale (finta)">
          <div className="hx-side-item">Dashboard</div>
          <div className="hx-side-item">Task</div>
          <div className="hx-side-item">Agenti</div>
          <OrgFlowSidebarLink context={context} />
        </nav>
        <div className="hx-cards">
          <section className="hx-card"><OrgFlowDashboardWidget context={context} /></section>
          <section className="hx-card hx-ghost">Altro riquadro della dashboard</section>
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
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Simulazione"));
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
