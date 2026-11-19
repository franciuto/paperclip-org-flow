import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { INSTANCE_CONFIG_SCHEMA } from "./worker/settings.js";
import { REPORT_PROGRESS_TOOL } from "./worker/tool.js";

const manifest: PaperclipPluginManifestV1 = {
  id: "franciuto.org-flow",
  apiVersion: 1,
  version: "1.2.0",
  displayName: "Org Flow",
  description:
    "Organigramma live della company: chi sta lavorando a cosa, avanzamento dei task raggruppati per task padre, passaggi di mano animati e feed di attività. Include lo strumento report_progress per gli agenti.",
  author: "franciuto",
  categories: ["ui"],
  capabilities: [
    "events.subscribe",
    "agents.read",
    "issues.read",
    "issue.subtree.read",
    "issue.documents.read",
    "plugin.state.read",
    "plugin.state.write",
    "agent.tools.register",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: INSTANCE_CONFIG_SCHEMA as unknown as Record<string, unknown>,
  tools: [
    {
      name: REPORT_PROGRESS_TOOL.name,
      displayName: REPORT_PROGRESS_TOOL.displayName,
      description: REPORT_PROGRESS_TOOL.description,
      parametersSchema: REPORT_PROGRESS_TOOL.parametersSchema as unknown as Record<string, unknown>,
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: "org-flow-page",
        displayName: "Org Flow",
        exportName: "OrgFlowPage",
        routePath: "org-flow",
      },
      {
        type: "sidebar",
        id: "org-flow-link",
        displayName: "Org Flow",
        exportName: "OrgFlowSidebarLink",
      },
      {
        type: "dashboardWidget",
        id: "org-flow-widget",
        displayName: "Org Flow",
        exportName: "OrgFlowDashboardWidget",
      },
    ],
  },
};

export default manifest;
