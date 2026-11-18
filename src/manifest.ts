import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "franciuto.org-flow",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Org Flow",
  description: "Attività live: passaggi di mano dei task, cambi di stato e run degli agenti. Versione minima per verificare eventi e streaming.",
  author: "franciuto",
  categories: ["ui"],
  capabilities: [
    "events.subscribe",
    "agents.read",
    "issues.read",
    "plugin.state.read",
    "plugin.state.write",
    "ui.page.register",
    "ui.sidebar.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
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
    ],
  },
};

export default manifest;
