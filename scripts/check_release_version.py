from __future__ import annotations

import argparse
import json
import os
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify that all release-facing version declarations agree."
    )
    parser.add_argument(
        "--tag",
        help="Optional release tag to validate, for example v1.4.0. Tag pushes are detected automatically in GitHub Actions.",
    )
    args = parser.parse_args()

    cargo = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))
    desktop_package = load_json(ROOT / "apps/desktop/package.json")
    desktop_lock = load_json(ROOT / "apps/desktop/package-lock.json")
    tauri_config = load_json(ROOT / "apps/desktop/src-tauri/tauri.conf.json")

    versions = {
        "Cargo workspace": str(cargo["workspace"]["package"]["version"]),
        "desktop package.json": str(desktop_package["version"]),
        "desktop package-lock.json": str(desktop_lock.get("version", "")),
        "desktop package-lock root package": str(
            desktop_lock.get("packages", {}).get("", {}).get("version", "")
        ),
        "Tauri config": str(tauri_config["version"]),
    }

    missing = [name for name, version in versions.items() if not version]
    if missing:
        print("Missing release version declarations:", file=sys.stderr)
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        return 1

    unique_versions = set(versions.values())
    if len(unique_versions) != 1:
        print("Release version declarations are inconsistent:", file=sys.stderr)
        for name, version in versions.items():
            print(f"  - {name}: {version}", file=sys.stderr)
        return 1

    version = next(iter(unique_versions))
    tag = args.tag
    if tag is None and os.environ.get("GITHUB_REF", "").startswith("refs/tags/"):
        tag = os.environ.get("GITHUB_REF_NAME")

    if tag:
        expected_tag = f"v{version}"
        if tag != expected_tag:
            print(
                f"Release tag mismatch: expected {expected_tag!r} from project version, got {tag!r}.",
                file=sys.stderr,
            )
            return 1

    print(f"Release version consistent: {version}")
    if tag:
        print(f"Release tag consistent: {tag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
