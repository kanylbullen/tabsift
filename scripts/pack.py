#!/usr/bin/env python3
"""Pack the extension into the zip both stores take.

    python3 scripts/pack.py         # -> dist/tabsift-<version>.zip

Chrome Web Store and Edge Add-ons both want a plain zip with `manifest.json` at
its root. Only what the browser loads goes in: the manifest, `_locales/`,
`src/` and `icons/`. Tests, scripts, docs and store images stay out.

The zip is reproducible: fixed order and fixed timestamps, so two runs on the
same tree give the same sha256 and anyone can check what was uploaded.

See docs/store-listing.md for the rest of the submission.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHIP = ["manifest.json", "_locales", "src", "icons"]
JUNK = {"Thumbs.db", "desktop.ini"}

# The Chrome Web Store shows the manifest description as the summary and caps it.
SUMMARY_MAX = 132


def fail(msg: str) -> None:
    sys.exit(f"pack: {msg}")


def check_manifest(manifest: dict) -> None:
    for field in ("name", "version", "description"):
        if not manifest.get(field):
            fail(f"manifest.json: `{field}` is required by both stores")
    if "key" in manifest:
        fail("manifest.json has a `key`; the stores assign the id and refuse a foreign key")

    # The description is a __MSG_…__ reference; check it in every language.
    m = re.fullmatch(r"__MSG_(\w+)__", manifest["description"])
    if not m:
        texts = {"(manifest)": manifest["description"]}
    else:
        texts = {}
        for catalog in sorted((ROOT / "_locales").glob("*/messages.json")):
            msgs = json.loads(catalog.read_text(encoding="utf-8"))
            if m.group(1) not in msgs:
                fail(f"{catalog.relative_to(ROOT)}: missing `{m.group(1)}`")
            texts[catalog.parent.name] = msgs[m.group(1)]["message"]
    for lang, text in texts.items():
        if len(text) > SUMMARY_MAX:
            fail(f"description ({lang}) is {len(text)} chars; the Chrome Web Store caps it at {SUMMARY_MAX}")

    # Every file the manifest points at must be in the zip.
    referenced = [
        manifest["background"]["service_worker"],
        manifest["action"]["default_popup"],
        manifest["options_page"],
        *manifest["icons"].values(),
        *manifest["action"].get("default_icon", {}).values(),
    ]
    for rel in referenced:
        if not (ROOT / rel).is_file():
            fail(f"manifest.json points at {rel}, which does not exist")


def files_to_ship() -> list[Path]:
    out: list[Path] = []
    for entry in SHIP:
        path = ROOT / entry
        paths = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
        for p in paths:
            rel = p.relative_to(ROOT)
            if p.name.startswith(".") or p.name in JUNK or p.name.endswith(("~", ".swp")):
                continue
            if p.suffix == ".pem":
                fail(f"refusing to pack a private key: {rel}")
            out.append(rel)
    return sorted(out)


def main() -> int:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    check_manifest(manifest)

    out_dir = ROOT / "dist"
    out_dir.mkdir(exist_ok=True)
    target = out_dir / f"tabsift-{manifest['version']}.zip"

    # 1980-01-01 is the earliest timestamp a zip can hold.
    stamp = (1980, 1, 1, 0, 0, 0)
    shipped = files_to_ship()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in shipped:
            info = zipfile.ZipInfo(rel.as_posix(), date_time=stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, (ROOT / rel).read_bytes())

    with zipfile.ZipFile(target) as zf:
        assert "manifest.json" in zf.namelist()

    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    print(f"{manifest['name']} {manifest['version']} -> {target.relative_to(ROOT)}")
    print(f"  {len(shipped)} files")
    print(f"sha256 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
