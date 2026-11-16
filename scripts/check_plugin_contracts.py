#!/usr/bin/env python3
"""插件契约守卫（ADR 0002/0003/0004）。

检查项：
1. 内核内置插件清单：14 个唯一 id、贡献 id 唯一、贡献前缀与贡献点匹配；
2. `docs/schemas/plugin-manifest-v2.schema.json` 可解析，且贡献点枚举/插件 id 正则与契约一致；
3. 4 份 ADR、命令映射、前端 registry、`plugin_invoke` 命令与注册项存在。

用法：py -3 scripts/check_plugin_contracts.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILTIN_RS = ROOT / "crates/kernel/src/builtin.rs"
SCHEMA_JSON = ROOT / "docs/schemas/plugin-manifest-v2.schema.json"

POINT_PREFIX = {
    "Provider": "provider",
    "ImageOp": "image",
    "WorkflowStep": "workflow",
    "Hook": "hook",
    "Settings": "settings",
    "Page": "page",
    "Command": "command",
    "PublishStrategy": "strategy",
    "TrayItem": "tray",
}

EXPECTED_PLUGINS = {
    "provider-github",
    "provider-gitee",
    "provider-opendal-extra",
    "image-transform",
    "workflow",
    "publish-strategy",
    "reconcile",
    "cloud-browser",
    "portable-migration",
    "task-console",
    "integrations-os",
    "ai-assistant",
    "themes",
    "diagnostics",
}


def fail(failures: list[str], message: str) -> None:
    failures.append(message)


def main() -> int:
    failures: list[str] = []

    text = BUILTIN_RS.read_text(encoding="utf-8")
    plugin_ids = re.findall(r'native\(\s*"([^"]+)"', text)
    if len(plugin_ids) != len(set(plugin_ids)):
        fail(failures, "builtin.rs declares duplicate plugin ids")
    if set(plugin_ids) != EXPECTED_PLUGINS:
        missing = EXPECTED_PLUGINS - set(plugin_ids)
        extra = set(plugin_ids) - EXPECTED_PLUGINS
        fail(failures, f"plugin id drift (missing={sorted(missing)}, extra={sorted(extra)})")

    seen_contributions: set[tuple[str, str]] = set()
    for point, contribution_id in re.findall(
        r'contribution\(\s*ContributionPoint::(\w+),\s*"([^"]+)"', text
    ):
        if point not in POINT_PREFIX:
            fail(failures, f"unknown contribution point in builtin.rs: {point}")
            continue
        if not contribution_id.startswith(f"{POINT_PREFIX[point]}."):
            fail(failures, f"{contribution_id} does not start with {POINT_PREFIX[point]}.")
        key = (point, contribution_id)
        if key in seen_contributions:
            fail(failures, f"duplicate contribution {point}/{contribution_id}")
        seen_contributions.add(key)

    try:
        schema = json.loads(SCHEMA_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(failures, f"plugin manifest schema unreadable: {error}")
        schema = {}

    defs = schema.get("$defs", {})
    properties = schema.get("properties", {})
    for field in ("api_version", "schema_version", "id", "name", "version", "contributes", "permissions"):
        if field not in properties:
            fail(failures, f"schema is missing property {field}")
    id_pattern = str(defs.get("pluginId", {}).get("pattern", ""))
    if not id_pattern.startswith("^[a-z]"):
        fail(failures, "schema plugin id pattern does not start with ^[a-z]")
    if "$defs/contributions" not in str(properties.get("contributes", {}).get("$ref", "")):
        fail(failures, "schema contributes does not reference $defs/contributions")
    contribution_props = defs.get("contributions", {}).get("properties", {})
    for field in ("providers", "transform_steps", "publish_strategies", "hooks", "commands", "ui", "tray_items"):
        if field not in contribution_props:
            fail(failures, f"schema contributions is missing {field}")
    permissions = set(properties.get("permissions", {}).get("items", {}).get("enum", []))
    for permission in ("provider_config", "fs_paths"):
        if permission not in permissions:
            fail(failures, f"schema permissions is missing {permission}")

    for adr in ("0001-kernel-boundary", "0002-plugin-manifest-v2", "0003-command-dispatch", "0004-ui-slots"):
        if not (ROOT / f"docs/adr/{adr}.md").is_file():
            fail(failures, f"missing ADR docs/adr/{adr}.md")
    if not (ROOT / "docs/PLUGIN_COMMAND_MAP.md").is_file():
        fail(failures, "missing docs/PLUGIN_COMMAND_MAP.md")
    if not (ROOT / "apps/desktop/src/plugin-ui/registry.ts").is_file():
        fail(failures, "missing apps/desktop/src/plugin-ui/registry.ts")
    if not (ROOT / "apps/desktop/src-tauri/src/commands/plugin_invoke.rs").is_file():
        fail(failures, "missing commands/plugin_invoke.rs")
    lib_rs = (ROOT / "apps/desktop/src-tauri/src/lib.rs").read_text(encoding="utf-8")
    if "commands::plugin_invoke" not in lib_rs:
        fail(failures, "plugin_invoke is not registered in invoke_handler")

    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print(
        f"plugin contracts ok (plugins={len(plugin_ids)}, contributions={len(seen_contributions)}, "
        f"points={len(POINT_PREFIX)})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
