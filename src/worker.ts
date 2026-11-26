import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import {
  ACTION_PING, ACTION_REFRESH, DATA_EVENTS, DATA_SNAPSHOT, TOOL_REPORT_PROGRESS,
} from "./shared/types.js";
import { createOrgFlowService, type OrgFlowService } from "./worker/service.js";
import { validateSettings } from "./worker/settings.js";
import { REPORT_PROGRESS_TOOL } from "./worker/tool.js";

/** Events that change what the org chart shows. */
const SUBSCRIBED_EVENTS = [
  "issue.created",
  "issue.updated",
  "issue.document.created",
  "issue.document.updated",
  "issue.document.deleted",
  "agent.created",
  "agent.updated",
  "agent.status_changed",
  "agent.error_cleared",
  "agent.run.started",
  "agent.run.finished",
  "agent.run.failed",
  "agent.run.cancelled",
] as const;

let service: OrgFlowService | null = null;

/** Host-authorized company wins over the one in params (the host injects it for data calls). */
function companyOf(params: Record<string, unknown> | undefined, scoped?: string | null): string | null {
  if (typeof scoped === "string" && scoped) return scoped;
  const c = params?.companyId;
  return typeof c === "string" && c ? c : null;
}

const plugin = definePlugin({
  multiCompanyConfig: true,

  async setup(ctx: PluginContext) {
    const svc = createOrgFlowService(ctx);
    service = svc;

    for (const name of SUBSCRIBED_EVENTS) ctx.events.on(name, (ev) => svc.handleEvent(ev));

    ctx.data.register(DATA_SNAPSHOT, async (params) => {
      const companyId = companyOf(params);
      if (!companyId) return null;
      return svc.getSnapshot(companyId);
    });

    ctx.data.register(DATA_EVENTS, async (params) => {
      const companyId = companyOf(params);
      if (!companyId) return { records: [], cursor: null, snapshotAt: null };
      const after = typeof params?.after === "string" && params.after ? params.after : null;
      return svc.getEvents(companyId, after);
    });

    ctx.actions.register(ACTION_PING, async (params, context) => {
      const companyId = companyOf(params, context?.companyId);
      if (!companyId) throw new Error("companyId missing");
      return svc.ping(companyId);
    });

    ctx.actions.register(ACTION_REFRESH, async (params, context) => {
      const companyId = companyOf(params, context?.companyId);
      if (!companyId) throw new Error("companyId missing");
      return svc.refresh(companyId);
    });

    ctx.tools.register(
      TOOL_REPORT_PROGRESS,
      {
        displayName: REPORT_PROGRESS_TOOL.displayName,
        description: REPORT_PROGRESS_TOOL.description,
        parametersSchema: REPORT_PROGRESS_TOOL.parametersSchema as unknown as Record<string, unknown>,
      },
      (params, runCtx) => svc.reportProgress(params, runCtx),
    );

    ctx.logger.info("org-flow: listening to tasks, agents and runs");
  },

  async onHealth() {
    if (!service) return { status: "ok", message: "Org Flow starting" };
    return service.health();
  },

  async onValidateConfig(config) {
    return validateSettings(config);
  },

  async onConfigChanged(newConfig, context) {
    service?.onConfigChanged(newConfig ?? {}, context?.companyId ?? null);
  },

  async onShutdown() {
    service?.shutdown();
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
