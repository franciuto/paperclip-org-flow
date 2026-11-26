"""Tiny static server for the Org Flow visual harness.

Serves the repo root, maps
  /                                         -> tests/ui/harness.html
  /harness.js                               -> tests/ui/out/harness.js
  /api/agent-avatars/cap-v1/<pal>/<pose>.png -> prototype/poses/<pal>-<pose>.png
  /fonts/InterVariable.woff2                -> the host's font (read-only), if installed
Usage: python3 tests/ui/serve.py [port]
"""
import http.server
import pathlib
import re
import sys
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[2]
HOST_FONT = pathlib.Path.home() / ".paperclip/cli/current/node_modules/@paperclipai/server/ui-dist/fonts/InterVariable.woff2"
HOST_ASSETS = pathlib.Path.home() / ".paperclip/cli/current/node_modules/@paperclipai/server/ui-dist/assets"
AVATAR = re.compile(r"^/api/agent-avatars/cap-v1/([a-z0-9-]+)/([a-z]+)\.png$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def translate_path(self, path):
        p = urlparse(path).path
        if p in ("/", "/index.html"):
            return str(ROOT / "tests/ui/harness.html")
        if p == "/harness.js":
            return str(ROOT / "tests/ui/out/harness.js")
        if p == "/host.css":
            # Paperclip's full stylesheet (Tailwind preflight etc.), to catch host CSS side effects
            css = sorted(HOST_ASSETS.glob("index-*.css"), key=lambda f: f.stat().st_size)
            return str(css[-1]) if css else str(ROOT / "tests/ui/harness.html")
        if p == "/fonts/InterVariable.woff2":
            return str(HOST_FONT)
        m = AVATAR.match(p)
        if m:
            return str(ROOT / "prototype/poses" / f"{m.group(1)}-{m.group(2)}.png")
        if p.startswith("/api/assets/"):
            return str(ROOT / "tests/ui/photos/sample.png")
        if p.startswith("/ACME/"):
            return str(ROOT / "tests/ui/harness.html")
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
