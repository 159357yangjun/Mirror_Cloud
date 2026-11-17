#!/usr/bin/env python3
"""内核依赖方向守卫（ADR 0001/0002）。

规则（越界即失败）：
- `crates/kernel-api` 只能依赖 workspace 的 async-trait / serde / serde_json / thiserror，不得有 path 依赖；
- `crates/plugin-host` 只能依赖 async-trait / kernel-api / serde_json / thiserror；
- `crates/kernel` 只能依赖 async-trait / kernel-api / plugin-host / serde_json；
- 三个 crate 都必须是 workspace 成员，且 desktop 依赖 kernel + kernel-api。

用法：py -3 scripts/check_kernel_deps.py
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ALLOWED = {
    "crates/kernel-api": {"async-trait", "serde", "serde_json", "thiserror"},
    "crates/plugin-host": {"async-trait", "kernel-api", "serde_json", "thiserror"},
    "crates/kernel": {"async-trait", "kernel-api", "plugin-host", "serde_json"},
}

FORBIDDEN_PREFIXES = ("domain", "storage-", "persistence-", "tauri", "reqwest", "tokio")


def parse_dependencies(cargo_toml: Path) -> dict[str, str]:
    """返回 [dependencies] 段内 `name = value` 的原始映射（不解析 TOML 语义）。"""
    text = cargo_toml.read_text(encoding="utf-8")
    deps: dict[str, str] = {}
    in_section = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if line.startswith("["):
            in_section = line == "[dependencies]"
            continue
        if not in_section or not line or line.startswith("#"):
            continue
        name, _, value = line.partition("=")
        # 兼容 `serde.workspace = true` 这种 dotted key 写法。
        name = name.strip().split(".")[0]
        deps[name] = value.strip()
    return deps


def main() -> int:
    failures: list[str] = []

    workspace = (ROOT / "Cargo.toml").read_text(encoding="utf-8")
    for member in ALLOWED:
        if f'"{member}"' not in workspace:
            failures.append(f"{member} is not listed as a workspace member")

    for member, allowed in ALLOWED.items():
        cargo_toml = ROOT / member / "Cargo.toml"
        if not cargo_toml.is_file():
            failures.append(f"missing {member}/Cargo.toml")
            continue
        for name, value in parse_dependencies(cargo_toml).items():
            if name not in allowed:
                failures.append(f"{member} may not depend on {name} ({value})")
            if "path" in value and name in {"domain", "storage-core", "storage-opendal"}:
                failures.append(f"{member} must not take a path dependency on {name}")
            if name.startswith(FORBIDDEN_PREFIXES) or name == "tauri":
                failures.append(f"{member} must stay free of {name}")

    desktop = parse_dependencies(ROOT / "apps/desktop/src-tauri/Cargo.toml")
    for required in ("kernel", "kernel-api"):
        if required not in desktop:
            failures.append(f"apps/desktop/src-tauri must depend on {required}")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print(f"kernel deps ok ({len(ALLOWED)} crates checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
