#!/usr/bin/env python3
"""Mirror Cloud 静态基线指标（P0/P4 各采集一次，便于对比）。

只做静态统计，不构建、不启动应用、不访问网络：
- workspace crate 行数/文件数
- src-tauri 行数、#[tauri::command] 数量
- 前端 ts/tsx 行数与 invoke( 调用点数量
- 页面数、脚本数、文档数
- check_user_flow.py 中 require( 静态出现次数（可执行检查数的近似）

用法：
    py -3 scripts/baseline_metrics.py
    py -3 scripts/baseline_metrics.py --out .ai/baseline/2026-11-16.md
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:  # pragma: no cover
        return f"<unavailable: {exc.__class__.__name__}>"


def count_lines(paths):
    files = 0
    loc = 0
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        files += 1
        loc += text.count("\n") + (0 if text.endswith("\n") else 1)
    return files, loc


def walk(pattern: str, base: Path):
    return sorted(p for p in base.glob(pattern) if p.is_file())


def crate_metrics():
    rows = []
    crates = ROOT / "crates"
    if not crates.is_dir():
        return rows
    for crate in sorted(p for p in crates.iterdir() if p.is_dir()):
        files, loc = count_lines(walk("src/**/*.rs", crate))
        if files or loc:
            rows.append((crate.name, files, loc))
    return rows


def command_metrics():
    base = ROOT / "apps/desktop/src-tauri/src"
    pattern = re.compile(
        r"#\[tauri::command[^\]]*\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)"
    )
    per_file = {}
    total = 0
    for path in walk("**/*.rs", base):
        names = pattern.findall(path.read_text(encoding="utf-8", errors="replace"))
        if names:
            rel = path.relative_to(base).as_posix()
            per_file[rel] = names
            total += len(names)
    return per_file, total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", help="markdown 输出路径（默认打印到 stdout）")
    args = parser.parse_args()

    crates = crate_metrics()
    tauri_files, tauri_loc = count_lines(walk("**/*.rs", ROOT / "apps/desktop/src-tauri/src"))
    fe_files, fe_loc = count_lines(
        walk("**/*.ts", ROOT / "apps/desktop/src") + walk("**/*.tsx", ROOT / "apps/desktop/src")
    )
    fe_tsx = len(walk("**/*.tsx", ROOT / "apps/desktop/src"))
    per_file, command_total = command_metrics()

    invoke_total = 0
    for path in walk("**/*.ts", ROOT / "apps/desktop/src") + walk("**/*.tsx", ROOT / "apps/desktop/src"):
        invoke_total += len(re.findall(r"\binvoke\s*\(", path.read_text(encoding="utf-8", errors="replace")))

    flow_path = ROOT / "scripts/check_user_flow.py"
    flow_requires = 0
    if flow_path.is_file():
        flow_requires = len(re.findall(r"\brequire\s*\(", flow_path.read_text(encoding="utf-8", errors="replace")))

    docs = len([p for p in (ROOT / "docs").rglob("*") if p.is_file()])
    scripts = len([p for p in (ROOT / "scripts").rglob("*") if p.is_file()])
    pages = len(walk("*.tsx", ROOT / "apps/desktop/src/pages"))

    total_crate_loc = sum(loc for _, _, loc in crates)
    timestamp = dt.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")
    lines = [
        "# Mirror Cloud 静态基线",
        "",
        f"- 采集时间：{timestamp}",
        f"- 提交：`{git('rev-parse', 'HEAD')}`",
        f"- 分支/状态：`{git('rev-parse', '--abbrev-ref', 'HEAD')}` / {git('status', '--short') or 'clean'}",
        "- 采集方式：`py -3 scripts/baseline_metrics.py`（静态扫描，不构建）",
        "",
        "## 规模",
        "",
        "| 指标 | 值 |",
        "|---|---|",
        f"| crate 代码行（不含测试夹具） | {total_crate_loc} |",
        f"| src-tauri Rust 文件 / 行 | {tauri_files} / {tauri_loc} |",
        f"| 前端 ts/tsx 文件 / 行（其中 tsx {fe_tsx}） | {fe_files} / {fe_loc} |",
        f"| `#[tauri::command]` 总数 | {command_total} |",
        f"| 前端 `invoke(` 调用点 | {invoke_total} |",
        f"| 页面文件（src/pages/*.tsx） | {pages} |",
        f"| `check_user_flow.py` 中 `require(` 静态出现 | {flow_requires} |",
        f"| docs 文件数 / scripts 文件数 | {docs} / {scripts} |",
        "",
        "## 各 crate",
        "",
        "| crate | 文件 | 行 |",
        "|---|---|---|",
    ]
    for name, files, loc in crates:
        lines.append(f"| `{name}` | {files} | {loc} |")

    lines += ["", "## 命令分布", "", "| 文件 | 命令数 |", "|---|---|"]
    for rel in sorted(per_file):
        lines.append(f"| `{rel}` | {len(per_file[rel])} |")

    lines += [
        "",
        "## 说明",
        "",
        "- 行数为**原始行数**（含空行与注释，等价 `wc -l`），与「代码行/非空行」口径不同；",
        "  跨阶段对比必须使用本脚本的同一口径，不要与旧记录里的代码行数直接相减。",
        "- `invoke(` 计数不含 `invoke<…>(` 泛型写法（当前另有 3 处，两类合计 101）。",
        "- 运行时性能基线（发布 p95、冷启动、RSS、安装包体积）需要真实构建与目标环境，",
        "  按 `AGENTS.md` 由云端 CI 采集，不在本脚本内伪造；缺口记录在 `.ai/WORKLOG.md`。",
        "- `require(` 计数是静态近似，实际通过数由 `python scripts/check_user_flow.py` 运行时给出。",
        "",
    ]

    markdown = "\n".join(lines)
    if args.out:
        out_path = (ROOT / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(markdown + "\n", encoding="utf-8")
        print(f"wrote {out_path}")
        print(json.dumps({"command_total": command_total, "invoke_total": invoke_total}, ensure_ascii=False))
    else:
        print(markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
