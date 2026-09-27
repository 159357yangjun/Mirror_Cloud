from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_CARGO = ROOT / "apps/desktop/src-tauri/Cargo.toml"
CARGO_LOCK = ROOT / "Cargo.lock"
DESKTOP_PACKAGE = ROOT / "apps/desktop/package.json"

EXACT_SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")

DIRECT_RUST_TAURI = {
    "tauri-build": "build-dependencies",
    "tauri": "dependencies",
    "tauri-plugin-dialog": "dependencies",
    "tauri-plugin-opener": "dependencies",
    "tauri-plugin-clipboard-manager": "dependencies",
    "tauri-plugin-global-shortcut": "dependencies",
}

# This is the Windows-bundle-tested Tauri 2.11 compatibility line for this repository.
# Patch releases for transitive crates may vary only inside these minor lines when an
# intentional dependency update regenerates Cargo.lock.
LOCK_FAMILY_PREFIXES = {
    "tauri": "2.11.",
    "tauri-runtime": "2.11.",
    "tauri-runtime-wry": "2.11.",
    "tauri-build": "2.6.",
    "tauri-codegen": "2.6.",
    "tauri-macros": "2.6.",
    "tauri-plugin": "2.6.",
    "tauri-utils": "2.9.",
}

PLUGIN_PAIRS = {
    "@tauri-apps/plugin-dialog": "tauri-plugin-dialog",
    "@tauri-apps/plugin-opener": "tauri-plugin-opener",
    "@tauri-apps/plugin-clipboard-manager": "tauri-plugin-clipboard-manager",
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def exact_rust_version(value: Any, dependency: str, errors: list[str]) -> str | None:
    if isinstance(value, str):
        spec = value
    elif isinstance(value, dict):
        spec = value.get("version")
    else:
        spec = None

    if not isinstance(spec, str):
        errors.append(f"Rust dependency {dependency!r} has no explicit version.")
        return None
    if not spec.startswith("="):
        errors.append(
            f"Rust dependency {dependency!r} must use an exact '=x.y.z' version, got {spec!r}."
        )
        return None

    version = spec[1:]
    if not EXACT_SEMVER.fullmatch(version):
        errors.append(
            f"Rust dependency {dependency!r} has an unsupported exact version {spec!r}."
        )
        return None
    return version


def major_minor(version: str) -> tuple[str, str]:
    parts = version.split(".", 2)
    if len(parts) < 2:
        return (version, "")
    return (parts[0], parts[1])


def main() -> int:
    errors: list[str] = []

    cargo_manifest = tomllib.loads(DESKTOP_CARGO.read_text(encoding="utf-8"))
    cargo_lock = tomllib.loads(CARGO_LOCK.read_text(encoding="utf-8"))
    package_json = read_json(DESKTOP_PACKAGE)

    rust_versions: dict[str, str] = {}
    for dependency, section in DIRECT_RUST_TAURI.items():
        table = cargo_manifest.get(section, {})
        if dependency not in table:
            errors.append(f"Missing required Rust Tauri dependency {dependency!r} in [{section}].")
            continue
        version = exact_rust_version(table[dependency], dependency, errors)
        if version:
            rust_versions[dependency] = version

    lock_versions: dict[str, set[str]] = {}
    for package in cargo_lock.get("package", []):
        name = package.get("name")
        version = package.get("version")
        if isinstance(name, str) and isinstance(version, str):
            lock_versions.setdefault(name, set()).add(version)

    # Every exact direct Tauri dependency must resolve to that same version in Cargo.lock.
    for dependency, expected in rust_versions.items():
        resolved = lock_versions.get(dependency, set())
        if expected not in resolved:
            errors.append(
                f"Cargo.lock does not contain {dependency} {expected}; resolved versions: "
                f"{', '.join(sorted(resolved)) or 'none'}."
            )

    # Catch the exact class of regression that previously allowed 2.11 and 2.12 Tauri
    # runtime/core crates to coexist and break the Windows bundle with incompatible types.
    for package, prefix in LOCK_FAMILY_PREFIXES.items():
        resolved = lock_versions.get(package, set())
        if not resolved:
            errors.append(f"Cargo.lock is missing required Tauri family package {package!r}.")
            continue
        outside_family = sorted(version for version in resolved if not version.startswith(prefix))
        if outside_family:
            errors.append(
                f"{package} escaped the tested {prefix}x line: {', '.join(outside_family)}."
            )

    npm_tauri: dict[str, str] = {}
    for section in ("dependencies", "devDependencies"):
        for dependency, version in package_json.get(section, {}).items():
            if not dependency.startswith("@tauri-apps/"):
                continue
            if not isinstance(version, str) or not EXACT_SEMVER.fullmatch(version):
                errors.append(
                    f"JS dependency {dependency!r} must use an exact x.y.z version, got {version!r}."
                )
                continue
            npm_tauri[dependency] = version

    rust_tauri = rust_versions.get("tauri")
    if rust_tauri:
        rust_line = major_minor(rust_tauri)
        for dependency in ("@tauri-apps/api", "@tauri-apps/cli"):
            js_version = npm_tauri.get(dependency)
            if js_version is None:
                errors.append(f"Missing required JS dependency {dependency!r}.")
            elif major_minor(js_version) != rust_line:
                errors.append(
                    f"{dependency} {js_version} is not on the Rust tauri {rust_tauri} major/minor line."
                )

    for js_dependency, rust_dependency in PLUGIN_PAIRS.items():
        js_version = npm_tauri.get(js_dependency)
        rust_version = rust_versions.get(rust_dependency)
        if js_version is None:
            errors.append(f"Missing required JS plugin {js_dependency!r}.")
        elif rust_version and js_version != rust_version:
            errors.append(
                f"Plugin version mismatch: {js_dependency}={js_version}, "
                f"{rust_dependency}={rust_version}."
            )

    if errors:
        print("Tauri dependency family validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        print(
            "Update Rust/JS Tauri manifests and Cargo/npm locks together, then run a real Windows Tauri bundle.",
            file=sys.stderr,
        )
        return 1

    family_summary = ", ".join(
        f"{name}={','.join(sorted(lock_versions[name]))}" for name in LOCK_FAMILY_PREFIXES
    )
    print("Tauri dependency family is compatible.")
    print(f"Rust direct tauri: {rust_versions['tauri']}")
    print(f"JS API/CLI: {npm_tauri['@tauri-apps/api']} / {npm_tauri['@tauri-apps/cli']}")
    print(f"Locked family: {family_summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
