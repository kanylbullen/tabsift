#!/usr/bin/env python3
"""Take the store screenshots (1280 x 800) with headless Chrome.

    python3 scripts/screenshots/shoot.py

Serves the repository over HTTP (Chrome refuses ES modules from file://), opens
harness.html once per language and view, and writes
store/screenshots/<lang>-<n>-<view>.png. The tabs in them are made up in
stub.js, so no real browsing shows up in a store listing.
"""

from __future__ import annotations

import functools
import http.server
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "store" / "screenshots"
VIEWS = ["search", "dedupe", "stale", "matches"]
LANGS = ["en", "sv"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def chrome() -> str:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        if path := shutil.which(name):
            return path
    sys.exit("shoot: no Chrome/Chromium found")


def main() -> int:
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]

    OUT.mkdir(parents=True, exist_ok=True)
    try:
        for lang in LANGS:
            for n, view in enumerate(VIEWS, 1):
                target = OUT / f"{lang}-{n}-{view}.png"
                subprocess.run(
                    [
                        chrome(), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--force-device-scale-factor=1", "--window-size=1280,800",
                        "--virtual-time-budget=4000", f"--screenshot={target}",
                        f"http://127.0.0.1:{port}/scripts/screenshots/harness.html?lang={lang}&mode={view}",
                    ],
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                print(f"wrote {target.relative_to(ROOT)}")
    finally:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
