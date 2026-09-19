import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "stack_fingerprint.py"


def fingerprint(files: dict[str, str]) -> dict:
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        for rel, content in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        proc = subprocess.run([sys.executable, str(SCRIPT), str(root), "--json"], text=True, capture_output=True, check=True)
        return json.loads(proc.stdout)


def test_normal_full_stack_repo_gets_stack_adapters_without_staff_tax():
    out = fingerprint({
        "package.json": json.dumps({
            "dependencies": {"react": "^19", "next": "^16", "express": "^5", "pg": "^8"}
        })
    })
    refs = set(out["suggested_references"])
    assert "references/stack-react-nextjs.md" in refs
    assert "references/stack-node-typescript.md" in refs
    assert "references/stack-postgres-redis.md" in refs
    assert "references/staff-engineering-execution.md" not in refs


def test_proven_monorepo_shape_may_add_staff_execution_reference():
    out = fingerprint({
        "package.json": json.dumps({"workspaces": ["apps/*"], "dependencies": {"react": "^19"}}),
        "pnpm-workspace.yaml": "packages:\n  - apps/*\n",
    })
    refs = set(out["suggested_references"])
    assert out["monorepo"] is True
    assert "references/staff-engineering-execution.md" in refs
