/**
 * Builds the visual harness and takes screenshots with headless Chromium.
 * Usage: node tests/ui/shoot.mjs [name ...]   (no names = all captures)
 * Output: tests/ui/out/*.png (gitignored)
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = resolve(here, "out");
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(here, "harness.tsx")],
  outfile: resolve(out, "harness.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: false,
  sourcemap: false,
  absWorkingDir: root,
  alias: { "@paperclipai/plugin-sdk/ui": "./tests/ui/sdk-stub.tsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const CAPTURES = [
  { name: "busy-light", q: "fixture=busy", size: "1440,1300" },
  { name: "busy-dark", q: "fixture=busy&dark=1", size: "1440,1300" },
  { name: "busy-selected-task", q: "fixture=busy&select=FRA-59&script=0", size: "1440,1300" },
  { name: "busy-selected-person", q: "fixture=busy&select=person:Daniel&script=0&dark=1", size: "1440,1300" },
  { name: "quiet-light", q: "fixture=quiet", size: "1440,1300" },
  { name: "quiet-dark", q: "fixture=quiet&dark=1", size: "1440,1300" },
  { name: "phone", q: "fixture=busy", size: "400,900" },
  { name: "phone-sheet", q: "fixture=busy&select=FRA-59&script=0", size: "400,900" },
  { name: "phone-sections", q: "fixture=busy&compact=1", size: "400,2000" },
  { name: "busy-sections", q: "fixture=busy&compact=1&collapse=kpi", size: "1440,1500" },
  { name: "quiet-sections", q: "fixture=quiet&compact=1&dark=1", size: "1440,1400" },
  { name: "widget", q: "view=widget&fixture=busy", size: "1100,520" },
  { name: "widget-quiet-dark", q: "view=widget&fixture=quiet&dark=1", size: "1100,520" },
  { name: "simulation", q: "fixture=busy&sim=1&script=0", size: "1440,1300", budget: 12000 },
  { name: "chips-closeup", q: "view=chips", size: "1440,560", budget: 3000 },
  { name: "slow-replies", q: "fixture=busy&slow=5000", size: "1440,560", budget: 26000 },
  { name: "orphan-holder", q: "fixture=busy&orphan=1&script=0", size: "1440,1300" },
  { name: "ping", q: "fixture=quiet&ping=1", size: "1440,560", budget: 6000 },
  { name: "offline", q: "fixture=busy&eventsFail=1&script=0", size: "1440,500", budget: 12000 },
];

const only = process.argv.slice(2);
const chromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!chromium) {
  console.error("Chromium non trovato");
  process.exit(1);
}

const port = 8700 + Math.floor(Math.random() * 200);
const server = spawn("python3", [resolve(here, "serve.py"), String(port)], { stdio: "inherit" });
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(base);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 100));
}

let failed = 0;
try {
  for (const c of CAPTURES) {
    if (only.length && !only.includes(c.name)) continue;
    const file = resolve(out, `${c.name}.png`);
    const t0 = Date.now();
    const res = spawnSync(chromium, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
      `--window-size=${c.size}`, `--virtual-time-budget=${c.budget ?? 8000}`, `--screenshot=${file}`, `${base}?${c.q}`,
    ], { encoding: "utf8", timeout: 120_000 });
    const ok = res.status === 0 && existsSync(file);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${c.name.padEnd(22)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${ok ? file : (res.stderr || "").slice(-400)}`);
  }
} finally {
  server.kill();
}
process.exit(failed ? 1 : 0);
