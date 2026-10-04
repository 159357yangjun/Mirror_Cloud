from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github/workflows"
USES_RE = re.compile(r"^\s*(?:-\s*)?uses:\s*['\"]?([^\s#'\"]+)")
FULL_SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")


def main() -> int:
    errors: list[str] = []
    checked = 0

    workflow_paths = sorted(
        list(WORKFLOW_DIR.rglob("*.yml")) + list(WORKFLOW_DIR.rglob("*.yaml"))
    )
    if not workflow_paths:
        print("No GitHub Actions workflow files found.", file=sys.stderr)
        return 1

    for path in workflow_paths:
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = USES_RE.match(line)
            if not match:
                continue

            action = match.group(1)
            if action.startswith(("./", "$/", "docker://")):
                continue

            checked += 1
            if "@" not in action:
                errors.append(f"{path.relative_to(ROOT)}:{line_number}: missing @ref in {action!r}")
                continue

            _, ref = action.rsplit("@", 1)
            if not FULL_SHA_RE.fullmatch(ref):
                errors.append(
                    f"{path.relative_to(ROOT)}:{line_number}: external action must be pinned "
                    f"to a full 40-character commit SHA, got {action!r}"
                )

    if errors:
        print("GitHub Actions pin validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        print(
            "Resolve the desired upstream release tag to its commit in the original action repository, "
            "then keep the human-readable release tag in a trailing YAML comment.",
            file=sys.stderr,
        )
        return 1

    print(f"GitHub Actions pin validation passed for {checked} external action reference(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
