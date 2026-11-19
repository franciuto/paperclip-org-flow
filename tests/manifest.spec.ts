import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import manifest from "../src/manifest.js";
import { TOOL_REPORT_PROGRESS } from "../src/shared/types.js";

describe("manifest", () => {
  it("passes the host's zod validator", () => {
    const result = pluginManifestV1Schema.safeParse(manifest);
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2));
    expect(result.success).toBe(true);
  });

  it("declares version, slots, tool and settings", () => {
    expect(manifest.version).toBe("1.1.0");
    const slots = manifest.ui?.slots ?? [];
    expect(slots.map((s) => [s.type, s.exportName])).toEqual([
      ["page", "OrgFlowPage"],
      ["sidebar", "OrgFlowSidebarLink"],
      ["dashboardWidget", "OrgFlowDashboardWidget"],
    ]);
    expect(slots.find((s) => s.type === "page")?.routePath).toBe("org-flow");
    expect(slots.find((s) => s.type === "dashboardWidget")?.id).toBe("org-flow-widget");
    expect(manifest.tools?.map((t) => t.name)).toEqual([TOOL_REPORT_PROGRESS]);
    for (const cap of ["agent.tools.register", "ui.page.register", "ui.sidebar.register", "ui.dashboardWidget.register"] as const) {
      expect(manifest.capabilities).toContain(cap);
    }
    const props = (manifest.instanceConfigSchema as { properties: Record<string, { default: unknown }> }).properties;
    expect(props.sleepAfterMinutes.default).toBe(15);
    expect(props.keepClosedHours.default).toBe(24);
    expect(props.enableSimulation.default).toBe(true);
  });
});
