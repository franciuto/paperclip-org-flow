import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginContext, type PluginEvent } from "@paperclipai/plugin-sdk";
import { pushRecent, recordFromIssueEvent, recordFromRunEvent, type FeedRecord, type Party } from "./worker/feed.js";

const CHANNEL = "feed";
const MAX_RECENT = 100;

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const recent = new Map<string, FeedRecord[]>();
    const agentNames = new Map<string, string>();
    let openedFor: string | null = null;

    const stateKey = (companyId: string) => ({ scopeKind: "company" as const, scopeId: companyId, stateKey: "recent-feed" });

    async function load(companyId: string): Promise<FeedRecord[]> {
      let list = recent.get(companyId);
      if (!list) {
        const stored = await ctx.state.get(stateKey(companyId)).catch(() => null);
        list = Array.isArray(stored) ? (stored as FeedRecord[]) : [];
        recent.set(companyId, list);
      }
      return list;
    }

    async function nameOf(p: Party | undefined, companyId: string): Promise<Party | undefined> {
      if (!p || p.kind !== "agent") return p;
      let name = agentNames.get(p.id);
      if (!name) {
        const agent = await ctx.agents.get(p.id, companyId).catch(() => null);
        if (agent?.name) { name = agent.name; agentNames.set(p.id, name); }
      }
      return name ? { ...p, name } : p;
    }

    async function enrich(rec: FeedRecord, companyId: string): Promise<FeedRecord> {
      const out: FeedRecord = { ...rec };
      out.from = await nameOf(rec.from, companyId);
      out.to = await nameOf(rec.to, companyId);
      out.actor = await nameOf(rec.actor, companyId);
      if (rec.issueId && (!rec.title || !rec.identifier)) {
        const issue = await ctx.issues.get(rec.issueId, companyId).catch(() => null);
        if (issue) {
          out.title = rec.title ?? issue.title ?? null;
          out.identifier = rec.identifier ?? issue.identifier ?? null;
        }
      }
      return out;
    }

    async function publish(companyId: string, raw: FeedRecord): Promise<FeedRecord> {
      const rec = await enrich(raw, companyId);
      const next = pushRecent(await load(companyId), rec, MAX_RECENT);
      recent.set(companyId, next);
      await ctx.state.set(stateKey(companyId), next).catch((err: unknown) => {
        ctx.logger.warn("org-flow: salvataggio dello storico non riuscito", { error: String(err) });
      });
      if (openedFor !== companyId) { ctx.streams.open(CHANNEL, companyId); openedFor = companyId; }
      ctx.streams.emit(CHANNEL, rec);
      return rec;
    }

    const onIssue = async (ev: PluginEvent) => {
      const rec = recordFromIssueEvent(ev);
      if (rec) await publish(ev.companyId, rec);
    };
    const onRun = async (ev: PluginEvent) => {
      const rec = recordFromRunEvent(ev);
      if (rec) await publish(ev.companyId, rec);
    };
    ctx.events.on("issue.created", onIssue);
    ctx.events.on("issue.updated", onIssue);
    ctx.events.on("agent.run.started", onRun);
    ctx.events.on("agent.run.finished", onRun);
    ctx.events.on("agent.run.failed", onRun);

    ctx.data.register("recent", async (params) => {
      const companyId = typeof params?.companyId === "string" ? params.companyId : "";
      if (!companyId) return { records: [] };
      return { records: await load(companyId) };
    });

    ctx.actions.register("ping", async (params) => {
      const companyId = typeof params?.companyId === "string" ? params.companyId : "";
      if (!companyId) throw new Error("companyId mancante");
      await publish(companyId, { id: randomUUID(), at: new Date().toISOString(), kind: "ping" });
      return { ok: true };
    });

    ctx.logger.info("org-flow: in ascolto su issue.* e agent.run.*");
  },

  async onHealth() {
    return { status: "ok", message: "Org Flow in ascolto" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
