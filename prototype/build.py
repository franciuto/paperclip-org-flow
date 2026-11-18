"""Builds org-flow.html from org-flow.src.html, inlining the Paperclip character poses as data URIs."""
import base64, json, pathlib
here = pathlib.Path(__file__).parent
pals = ["cherry-pop","golden-hour","orchid-peach","pink-lemonade","coral-current","lime-lagoon","tangerine-cobalt","violet-ember"]
poses = ["idle","listening","thinking","working","success","confused","sleepy"]
data = {p: {q: "data:image/png;base64," + base64.b64encode((here/"poses"/f"{p}-{q}.png").read_bytes()).decode() for q in poses} for p in pals}
src = (here/"org-flow.src.html").read_text()
assert src.count("__POSES__") == 1
(here/"org-flow.html").write_text(src.replace("__POSES__", json.dumps(data, separators=(",",":"))))
print("ok", len(src), "->", (here/"org-flow.html").stat().st_size)
