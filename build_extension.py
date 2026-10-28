#!/usr/bin/env python3
"""Build the Velin browser extension zip.

Usage:
    python build_extension.py                    # -> dist/velin-extension.zip
    python build_extension.py --expect-tag v1.0.0  # fail if tag != manifest version

The zip contains only the files the extension needs, with manifest.json at the
zip root. The app files are used as-is, so there is no second copy to keep in sync.
"""
import argparse
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "velin-extension.zip"

# Everything the extension ships. Landing page files are deliberately not here.
FILES = [
    "manifest.json",
    "app.html",
    "storage.js",
    "script.js",
    "styles.css",
    "favicon-dark.svg",
    "favicon-light.svg",
    "icons/icon-16.png",
    "icons/icon-48.png",
    "icons/icon-128.png",
]


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--expect-tag", help="release tag (e.g. v1.0.0) that must match the manifest version")
    args = ap.parse_args()

    try:
        manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        fail(f"cannot read manifest.json: {e}")

    version = manifest.get("version")
    if not version:
        fail("manifest.json has no version")
    if args.expect_tag and args.expect_tag != f"v{version}":
        fail(f"tag {args.expect_tag} does not match manifest version v{version}")

    missing = [f for f in FILES if not (ROOT / f).is_file()]
    if missing:
        fail("missing files: " + ", ".join(missing))

    # Every file the manifest points at must be in the zip.
    referenced = [manifest.get("chrome_url_overrides", {}).get("newtab")]
    referenced += list(manifest.get("icons", {}).values())
    not_shipped = [r for r in referenced if r and r not in FILES]
    if not_shipped:
        fail("manifest references files not in FILES: " + ", ".join(not_shipped))

    OUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for f in FILES:
            z.write(ROOT / f, f)

    print(f"built {OUT.relative_to(ROOT)} (v{version}, {len(FILES)} files, {OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
