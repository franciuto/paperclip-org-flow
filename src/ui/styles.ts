/**
 * All Org Flow CSS, injected once as <style id="of-styles">. Classes are prefixed `of-`.
 * Colours come from Paperclip's theme variables (light/dark follow the host's `.dark` class),
 * with fallbacks so the UI still renders outside the host.
 */
import { useEffect } from "react";

export const STYLE_ID = "of-styles";

const DARK_VARS = `
  --of-edge: oklch(100% 0 0 / .24);
  --of-accent: oklch(72% .15 264);
  --of-accent-soft: oklch(72% .15 264 / .16);
  --of-st-todo: oklch(74% .12 250);
  --of-st-progress: oklch(80% .15 75);
  --of-st-review: oklch(75% .15 300);
  --of-st-blocked: oklch(71% .18 25);
  --of-st-done: oklch(77% .15 150);
  --of-warn: oklch(80% .15 75);
  --of-crit: oklch(71% .18 25);
  --of-bubble: oklch(30% 0 0);
  --of-shadow: 0 1px 2px oklch(0% 0 0 / .4);
`;

export const CSS = `
.of-root{
  --of-bg: var(--background, oklch(100% 0 0));
  --of-fg: var(--foreground, oklch(14.5% 0 0));
  --of-card: var(--card, var(--of-bg));
  --of-muted-fg: var(--muted-foreground, oklch(55.6% 0 0));
  --of-sunken: var(--muted, oklch(97% 0 0));
  --of-border: var(--border, oklch(92.2% 0 0));
  --of-edge: oklch(80% 0 0);
  --of-accent: oklch(52% .22 264);
  --of-accent-soft: oklch(52% .22 264 / .1);
  --of-st-todo: oklch(58% .14 250);
  --of-st-progress: oklch(66% .16 70);
  --of-st-review: oklch(55% .2 300);
  --of-st-blocked: oklch(57% .22 25);
  --of-st-done: oklch(56% .15 150);
  --of-warn: oklch(64% .16 70);
  --of-crit: oklch(57% .22 25);
  --of-bubble: var(--of-bg);
  --of-shadow: 0 1px 2px oklch(0% 0 0 / .06);
  --of-font: var(--font-sans, "InterVariable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  --of-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
  --of-r: 10px;
  color: var(--of-fg);
  font-family: var(--of-font);
  font-size: 14px;
  line-height: 1.45;
}
.dark .of-root, .of-root.of-dark{${DARK_VARS}}
.of-root *, .of-root *::before, .of-root *::after{box-sizing:border-box}
.of-root button{font:inherit;color:inherit}
.of-root a{color:inherit}
.of-root :focus-visible{outline:2px solid var(--of-accent);outline-offset:2px}
.of-root svg :focus-visible{outline:none}
.of-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* page */
.of-page{display:flex;flex-direction:column;gap:14px;padding:20px 16px 40px;max-width:1480px;margin:0 auto;min-width:0}
@media (min-width:720px){.of-page{padding:22px 28px 48px}}
.of-titlerow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
.of-h1{font-size:22px;font-weight:650;letter-spacing:-.01em;margin:0}
.of-h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--of-muted-fg);margin:0}
.of-sub{margin:4px 0 0;color:var(--of-muted-fg);max-width:78ch;font-size:13.5px}
.of-conn{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--of-st-done)}
.of-conn i{width:8px;height:8px;border-radius:50%;background:currentColor;animation:of-blink 1.6s infinite}
.of-conn.of-connecting{color:var(--of-warn)}
.of-conn.of-offline{color:var(--of-crit)}
.of-conn.of-offline i{animation:none}
.of-conn.of-sim{color:var(--of-accent)}
@keyframes of-blink{0%,100%{opacity:1}50%{opacity:.25}}
.of-clock{font-family:var(--of-mono);font-size:12.5px;color:var(--of-muted-fg);font-variant-numeric:tabular-nums}
.of-controls{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.of-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--of-border);background:var(--of-card);border-radius:8px;padding:5px 11px;cursor:pointer;font-size:13px;line-height:1.3}
.of-btn:hover{background:var(--of-sunken)}
.of-btn[aria-pressed="true"]{border-color:var(--of-accent);background:var(--of-accent-soft)}
.of-switch{width:26px;height:15px;border-radius:999px;background:var(--of-edge);position:relative;flex:none;transition:background .2s}
.of-switch::after{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:var(--of-bg);transition:transform .2s}
.of-btn[aria-pressed="true"] .of-switch{background:var(--of-accent)}
.of-btn[aria-pressed="true"] .of-switch::after{transform:translateX(11px)}
.of-banner{display:flex;align-items:center;gap:10px;border:1px dashed var(--of-accent);background:var(--of-accent-soft);border-radius:var(--of-r);padding:9px 14px;font-size:13px;font-weight:600}
.of-banner svg{flex:none;color:var(--of-accent)}
.of-banner span{font-weight:400;color:var(--of-muted-fg)}
.of-error{border:1px solid var(--of-crit);border-radius:var(--of-r);padding:10px 14px;font-size:13px;color:var(--of-crit)}
.of-note{font-size:12px;color:var(--of-muted-fg)}

/* parent strip */
.of-parents{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
@media (max-width:640px){.of-parents{grid-auto-flow:column;grid-auto-columns:minmax(230px,80%);grid-template-columns:none;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px}.of-pcard{scroll-snap-align:start}}
.of-pcard{border:1px solid var(--of-border);border-radius:var(--of-r);background:var(--of-card);padding:10px 12px;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:7px;min-width:0;transition:opacity .3s,border-color .2s;box-shadow:var(--of-shadow)}
.of-pcard:hover{border-color:var(--of-edge)}
.of-pcard[aria-pressed="true"]{border-color:var(--of-gc);box-shadow:inset 0 0 0 1px var(--of-gc)}
.of-pcard.of-dim{opacity:.45}
.of-ptop{display:flex;align-items:center;gap:8px;min-width:0}
.of-sw{width:10px;height:10px;border-radius:3px;flex:none;background:var(--of-gc)}
.of-ptitle{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-bar{height:6px;border-radius:3px;background:var(--of-sunken);overflow:hidden;display:block}
.of-bar i{display:block;height:100%;background:var(--of-gc,var(--of-fg));border-radius:3px;transition:width .8s ease}
.of-pmeta{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--of-muted-fg);min-height:20px}
.of-pmeta b{color:var(--of-fg);font-variant-numeric:tabular-nums;font-weight:600}
.of-done-tag{color:var(--of-st-done);font-weight:600}
.of-heads{display:flex;align-items:center}
.of-heads > *{margin-left:-5px}
.of-heads > :first-child{margin-left:0}
.of-heads .of-more-heads{font-size:11px;color:var(--of-muted-fg);margin-left:4px}
.of-idm{font-family:var(--of-mono);font-size:12px;color:var(--of-muted-fg);white-space:nowrap;flex:none}

/* quiet strip */
.of-quiet{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:10px}
@media (max-width:800px){.of-quiet{grid-template-columns:minmax(0,1fr)}}
.of-calm{border:1px solid var(--of-border);border-radius:var(--of-r);background:var(--of-card);padding:12px 14px;display:flex;align-items:center;gap:14px;min-width:0}
.of-calm-faces{display:flex;flex:none}
.of-calm-faces > *{margin-left:-14px}
.of-calm-faces > :first-child{margin-left:0}
.of-calm b{display:block;font-size:14px;font-weight:600}
.of-calm p{margin:2px 0 0;font-size:12.5px;color:var(--of-muted-fg)}
.of-closed{border:1px solid var(--of-border);border-radius:var(--of-r);background:var(--of-card);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.of-closed ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.of-closed li button{width:100%;display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;gap:8px;align-items:center;border:0;background:transparent;padding:4px 6px;border-radius:6px;cursor:pointer;text-align:left;font-size:12.5px}
.of-closed li button:hover{background:var(--of-sunken)}
.of-closed .of-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-check{color:var(--of-st-done);display:inline-flex}
.of-empty{font-size:12.5px;color:var(--of-muted-fg);margin:0}

/* KPI strip */
.of-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--of-border);border-radius:var(--of-r);background:var(--of-card);overflow:hidden}
.of-kpi{padding:9px 14px;border:0;border-right:1px solid var(--of-border);background:transparent;text-align:left;display:flex;align-items:center;gap:10px;min-width:0}
.of-kpi:last-child{border-right:0}
.of-kpi .of-av{flex:none}
.of-kpi .of-v{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}
.of-kpi .of-l{font-size:12px;color:var(--of-muted-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.of-kpi.of-click{cursor:pointer}
.of-kpi.of-click:hover{background:var(--of-sunken)}
.of-kpi.of-warn .of-v{color:var(--of-warn)}
@media (max-width:640px){.of-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.of-kpi:nth-child(2){border-right:0}.of-kpi:nth-child(-n+2){border-bottom:1px solid var(--of-border)}}

/* main */
.of-main{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:start}
@media (max-width:1000px){.of-main{grid-template-columns:minmax(0,1fr)}}
.of-stage{border:1px solid var(--of-border);border-radius:var(--of-r);background:var(--of-card);min-width:0;overflow:hidden}
.of-scroll{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding:6px 0}
.of-org{display:block;margin:0 auto;max-width:none}
.of-scrollhint{position:sticky;left:0;margin:0;padding:2px 14px 4px;font-size:11.5px;color:var(--of-muted-fg);width:fit-content}
.of-legend{display:flex;flex-wrap:wrap;gap:6px 16px;padding:10px 14px;border-top:1px solid var(--of-border);font-size:12px;color:var(--of-muted-fg);align-items:center}
.of-legend svg{width:12px;height:12px;vertical-align:-2px;margin-right:5px}
.of-legend .of-hint{margin-left:auto}
@media (max-width:640px){.of-legend .of-hint{margin-left:0}}

/* svg: org */
.of-edge{fill:none;stroke:var(--of-edge);stroke-width:1.3}
.of-edge.of-dashed{stroke-dasharray:4 4}
.of-nm{fill:var(--of-fg);font-size:12.5px;font-weight:600;font-family:var(--of-font)}
.of-stl{font-size:10.5px;font-family:var(--of-font);fill:var(--of-muted-fg)}
.of-node{cursor:pointer;outline:none}
.of-node .of-hit{fill:transparent}
.of-node .of-focus{fill:none;stroke:transparent;stroke-width:2;rx:10}
.of-node:focus-visible .of-focus{stroke:var(--of-accent)}
.of-halo{fill:none;stroke:transparent;stroke-width:3}
.of-node.of-sel .of-halo{stroke:var(--of-accent)}
.of-node.of-touched .of-halo{stroke:var(--of-tc)}
.of-node.of-touched .of-halo-bg{fill:color-mix(in oklch, var(--of-tc) 12%, transparent)}
.of-halo-bg{fill:transparent}
.of-node.of-sel .of-halo-bg{fill:var(--of-accent-soft)}
.of-node-wrap{transition:opacity .3s}
.of-node-wrap.of-dimmed{opacity:.32}
.of-node[data-state="working"] .of-stl{fill:var(--of-st-progress);font-weight:600}
.of-node[data-state="thinking"] .of-stl{fill:var(--of-st-review);font-weight:600}
.of-node[data-state="listening"] .of-stl{fill:var(--of-accent);font-weight:600}
.of-node[data-state="success"] .of-stl{fill:var(--of-st-done);font-weight:600}
.of-node[data-state="confused"] .of-stl{fill:var(--of-crit);font-weight:600}
.of-node[data-state="waiting"] .of-stl{fill:var(--of-warn);font-weight:600}
.of-node[data-state="sleepy"] .of-stl{font-style:italic}
.of-node[data-state="paused"] .of-stl{font-style:italic}
.of-node[data-state="paused"] .of-bob{opacity:.6;filter:grayscale(.7)}
.of-bob{transform-box:fill-box;transform-origin:50% 92%}
.of-node[data-state="idle"] .of-bob{animation:of-breathe 3.2s ease-in-out infinite}
.of-node[data-state="working"] .of-bob{animation:of-bobbing .5s ease-in-out infinite alternate}
.of-node[data-state="thinking"] .of-bob{animation:of-sway 2.6s ease-in-out infinite}
.of-node[data-state="sleepy"] .of-bob{animation:of-breathe 4.8s ease-in-out infinite;opacity:.85}
.of-node[data-state="listening"] .of-bob{animation:of-hop .45s ease-out 2}
.of-node[data-state="success"] .of-bob{animation:of-jump .7s ease-out 3}
.of-node[data-state="confused"] .of-bob{animation:of-wobble .45s ease-in-out 4}
.of-node[data-state="waiting"] .of-bob{animation:of-breathe 1.6s ease-in-out infinite}
@keyframes of-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.035,.965)}}
@keyframes of-bobbing{from{transform:translateY(0)}to{transform:translateY(-3px)}}
@keyframes of-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
@keyframes of-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-9px)}}
@keyframes of-jump{0%,100%{transform:translateY(0) scale(1)}30%{transform:translateY(-13px) scale(1.04)}60%{transform:translateY(0) scale(1.07,.93)}}
@keyframes of-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}
.of-fx > g{display:none}
.of-node[data-state="sleepy"] .of-zzz,
.of-node[data-state="working"] .of-typing,
.of-node[data-state="thinking"] .of-thought,
.of-node[data-state="listening"] .of-bang,
.of-node[data-state="waiting"] .of-bang,
.of-node[data-state="success"] .of-spark,
.of-node[data-state="confused"] .of-huh{display:block}
.of-zzz text{fill:var(--of-muted-fg);font-weight:700;font-family:var(--of-font);opacity:0;animation:of-zfloat 3s linear infinite}
.of-zzz text:nth-child(2){animation-delay:1s}
.of-zzz text:nth-child(3){animation-delay:2s}
@keyframes of-zfloat{0%{transform:translate(0,0);opacity:0}15%{opacity:.9}100%{transform:translate(8px,-14px);opacity:0}}
.of-typing rect{fill:var(--of-bubble);stroke:var(--of-border)}
.of-typing circle{fill:var(--of-st-progress);animation:of-dot 1s infinite}
.of-typing circle:nth-of-type(2){animation-delay:.15s}
.of-typing circle:nth-of-type(3){animation-delay:.3s}
@keyframes of-dot{0%,100%{opacity:.25}50%{opacity:1}}
.of-thought ellipse,.of-thought circle.of-b{fill:var(--of-bubble);stroke:var(--of-border)}
.of-thought circle.of-d{fill:var(--of-st-review);animation:of-dot 1.2s infinite}
.of-thought circle.of-d:nth-of-type(2){animation-delay:.2s}
.of-thought circle.of-d:nth-of-type(3){animation-delay:.4s}
.of-bang{transform-box:fill-box;transform-origin:center;animation:of-popin .4s ease-out}
.of-bang circle{fill:var(--of-accent)}
.of-node[data-state="waiting"] .of-bang circle{fill:var(--of-warn)}
.of-bang text,.of-huh text{fill:#fff;font-weight:800;font-size:12px;font-family:var(--of-font)}
.of-huh circle{fill:var(--of-crit)}
.of-huh{transform-box:fill-box;transform-origin:center;animation:of-popin .4s ease-out}
.of-spark path{fill:var(--of-st-done);transform-box:fill-box;transform-origin:center;animation:of-spark 1s ease-out infinite}
.of-spark path:nth-child(2n){fill:var(--of-warn);animation-delay:.2s}
@keyframes of-spark{0%{transform:scale(.2);opacity:0}30%{opacity:1}100%{transform:scale(1.2) translate(0,-4px);opacity:0}}
@keyframes of-popin{0%{transform:scale(.4);opacity:.3}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
.of-user-av{fill:var(--of-sunken);stroke:var(--of-edge);stroke-dasharray:3 3}
.of-user-ic{fill:var(--of-muted-fg)}
.of-badge circle{fill:var(--of-fg)}
.of-badge text{fill:var(--of-bg);font-size:10px;font-weight:700;font-family:var(--of-font)}
.of-chip{cursor:pointer;outline:none}
.of-chip .of-in{transform-box:fill-box;transform-origin:center;animation:of-popin .35s ease-out}
.of-chip .of-cbg{stroke-width:1}
.of-cfill{transition:width .8s ease}
.of-chip text{fill:var(--of-fg);font-size:9.5px;font-family:var(--of-mono)}
.of-chip text.of-pc{font-weight:700}
.of-chip:hover .of-cbg{stroke-width:1.8}
.of-chip:focus-visible .of-cbg{stroke:var(--of-accent);stroke-width:2.4}
.of-chip.of-csel .of-cbg{stroke-width:2.4}
.of-chip.of-cdim{opacity:.2}
.of-glyph{fill:none;stroke:var(--of-fg);stroke-width:1.2}
.of-glyph-f{fill:var(--of-fg);stroke:none}
.of-more{fill:var(--of-muted-fg);font-size:10.5px;font-family:var(--of-font)}
.of-fly .of-cbg{stroke-width:1.4}
.of-fly text{fill:var(--of-fg);font-size:9.5px;font-family:var(--of-mono);font-weight:700}

/* panel */
.of-panel{border:1px solid var(--of-border);border-radius:var(--of-r);background:var(--of-card);display:flex;flex-direction:column;min-width:0;max-height:min(940px, calc(100vh - 120px))}
@media (max-width:1000px){.of-panel{max-height:none}.of-feed{max-height:460px}}
.of-panel > header{padding:12px 14px 8px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.of-count{font-size:12px;color:var(--of-muted-fg);font-variant-numeric:tabular-nums}
.of-card{margin:12px 12px 4px;border:1px solid var(--of-border);border-radius:9px;background:var(--of-bg);padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.of-card-top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.of-card h3{margin:0;font-size:15px;font-weight:600;line-height:1.3;text-wrap:balance}
.of-card h3 a{text-decoration:none}
.of-card h3 a:hover{text-decoration:underline}
.of-x{border:0;background:transparent;cursor:pointer;color:var(--of-muted-fg);font-size:18px;line-height:1;padding:2px 6px;border-radius:6px}
.of-x:hover{background:var(--of-sunken)}
.of-meta{font-size:12.5px;color:var(--of-muted-fg)}
.of-meta b{color:var(--of-fg);font-weight:600}
.of-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.of-pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:500;padding:1px 8px;border-radius:999px;border:1px solid var(--of-border);white-space:nowrap}
.of-pill i{width:7px;height:7px;border-radius:50%}
.of-gline{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--of-muted-fg);min-width:0}
.of-gline > span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-bigbar{display:flex;align-items:center;gap:10px}
.of-bigbar .of-bar{flex:1;height:8px}
.of-bigbar b{font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}
.of-src{font-size:12px;color:var(--of-muted-fg);margin-top:-4px}
.of-path{list-style:none;margin:0;padding:0}
.of-path li{display:grid;grid-template-columns:18px 22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:5px 0;border-top:1px solid var(--of-border);font-size:12.5px}
.of-path li:first-child{border-top:0}
.of-path .of-n{font-size:11px;color:var(--of-muted-fg);font-variant-numeric:tabular-nums;text-align:right}
.of-path .of-d{font-family:var(--of-mono);font-size:11.5px;color:var(--of-muted-fg);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.of-path li.of-cur{font-weight:600}
.of-path .of-who-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-plain{border:0;background:none;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;text-align:left}
.of-plain:hover{text-decoration:underline}
.of-link{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;text-decoration:none;border:1px solid var(--of-border);border-radius:7px;padding:5px 10px;align-self:flex-start;background:var(--of-card)}
.of-link:hover{background:var(--of-sunken)}
.of-who{display:flex;align-items:center;gap:12px;min-width:0}
.of-who h3 a{text-decoration:none}
.of-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.of-stats div{background:var(--of-sunken);border-radius:7px;padding:6px 8px;min-width:0}
.of-stats b{display:block;font-size:17px;font-variant-numeric:tabular-nums}
.of-stats span{font-size:11px;color:var(--of-muted-fg);white-space:nowrap}
.of-tgroup{display:flex;flex-direction:column;gap:5px}
.of-tgroup + .of-tgroup{margin-top:4px}
.of-tgroup-h{display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:600;color:var(--of-muted-fg);min-width:0}
.of-tgroup-h span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-trow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;text-align:left;border:1px solid var(--of-border);background:var(--of-card);border-radius:7px;padding:6px 8px;cursor:pointer;font-size:12.5px;width:100%}
.of-trow:hover{border-color:var(--of-edge)}
.of-trow .of-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-trow .of-p{font-family:var(--of-mono);font-size:11.5px;color:var(--of-muted-fg)}
.of-feed{list-style:none;margin:0;padding:0 6px 8px;overflow-y:auto;min-height:0;flex:1}
.of-feed li > button{width:100%;display:grid;grid-template-columns:40px minmax(0,1fr);gap:8px;text-align:left;border:0;background:transparent;padding:7px 8px;border-radius:7px;cursor:pointer}
.of-feed li > button:hover{background:var(--of-sunken)}
.of-feed li.of-on > button{background:var(--of-accent-soft)}
.of-feed li.of-new > button{animation:of-newrow 2.4s ease}
@keyframes of-newrow{from{background:var(--of-accent-soft)}to{background:transparent}}
.of-ft{font-family:var(--of-mono);font-size:11.5px;color:var(--of-muted-fg);padding-top:2px;font-variant-numeric:tabular-nums}
.of-fl1{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px;min-width:0}
.of-fl1 .of-arrow{color:var(--of-muted-fg)}
.of-fl1 em{font-style:normal;color:var(--of-muted-fg)}
.of-fl1 .of-ok{color:var(--of-st-done);font-weight:600}
.of-fl1 .of-bad{color:var(--of-crit);font-weight:600}
.of-fl2{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--of-muted-fg);margin-top:2px;min-width:0}
.of-fl2 .of-sw{width:8px;height:8px}
.of-fl2 span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-feed-empty{padding:6px 16px 16px;font-size:12.5px;color:var(--of-muted-fg);margin:0}

/* avatars (HTML) */
.of-av{display:inline-block;flex:none;object-fit:contain;vertical-align:middle}
.of-av-photo{border-radius:50%;object-fit:cover}
.of-av-user{border-radius:50%;background:var(--of-sunken);border:1px dashed var(--of-edge);display:inline-grid;place-items:center;color:var(--of-muted-fg)}
.of-av-user svg{width:60%;height:60%}
.of-av-wrap{position:relative;display:inline-flex;flex:none}

/* widget */
.of-widget{display:flex;flex-direction:column;gap:10px;font-size:13px;min-width:0}
.of-wtop{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;color:var(--of-muted-fg)}
.of-wrow{display:grid;grid-template-columns:minmax(0,1fr) minmax(60px,110px) 38px;gap:10px;align-items:center;font-size:12.5px}
.of-wrow .of-t{display:flex;gap:7px;align-items:center;min-width:0}
.of-wrow .of-t span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.of-wrow b{font-variant-numeric:tabular-nums;text-align:right;font-weight:600}
.of-wfoot{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;padding-top:8px;border-top:1px solid var(--of-border);align-items:center}
.of-wfoot b{font-variant-numeric:tabular-nums}
.of-wfoot .of-w{color:var(--of-warn);font-weight:600}
.of-wfoot a{margin-left:auto;font-weight:600;text-decoration:none}
.of-wfoot a:hover{text-decoration:underline}
.of-wquiet{display:flex;align-items:center;gap:10px;font-size:12.5px;color:var(--of-muted-fg)}

/* sidebar link */
.of-side{display:flex;align-items:center;gap:10px;margin:0 8px;border-radius:8px;padding:6px 8px;font-size:13px;font-weight:500;text-decoration:none;color:color-mix(in oklch, var(--of-fg) 80%, transparent)}
.of-side:hover,.of-side.of-active{background:var(--sidebar-accent, var(--of-sunken));color:var(--sidebar-accent-foreground, var(--of-fg))}
.of-side svg{width:16px;height:16px;flex:none}

@media (prefers-reduced-motion: reduce){
  .of-bob,.of-zzz text,.of-typing circle,.of-thought circle.of-d,.of-spark path,.of-bang,.of-huh,.of-chip .of-in,.of-conn i{animation:none!important}
  .of-zzz text{opacity:.8}
  .of-feed li.of-new > button{animation:none}
  .of-bar i,.of-cfill,.of-node-wrap,.of-pcard{transition:none}
}
`;

/** Inject the stylesheet once per document (shared by page, widget and sidebar). */
export function ensureStyles(doc: Document | undefined = typeof document === "undefined" ? undefined : document): void {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export function useStyles(): void {
  // Insert before paint where possible; effect fallback keeps SSR-safe.
  if (typeof document !== "undefined") ensureStyles(document);
  useEffect(() => ensureStyles(), []);
}
