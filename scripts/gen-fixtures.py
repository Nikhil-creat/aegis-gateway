"""Regenerate the web parity fixtures and site data from the Python reference implementation.

Run from the repo root after changing the dataset, router, agent or knowledge base:
    python scripts/gen-fixtures.py
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATEWAY = ROOT / "gateway"
WEB = ROOT / "web"
sys.path.insert(0, str(GATEWAY))

from app.kb import DEFAULT_CHUNKS  # noqa: E402
from evals.dataset import TASKS  # noqa: E402

subprocess.run([sys.executable, "-m", "evals.benchmark"], cwd=GATEWAY, check=True)
subprocess.run([sys.executable, "-m", "evals.train_router"], cwd=GATEWAY, check=True)
report = GATEWAY / "artifacts" / "benchmark_report.json"

fixtures = WEB / "scripts" / "fixtures"
fixtures.mkdir(parents=True, exist_ok=True)
tasks = [{"id": t.id, "category": t.category, "mode": t.mode, "prompt": t.prompt, "chaos": t.chaos} for t in TASKS]
(fixtures / "tasks.json").write_text(json.dumps(tasks, indent=1) + "\n")
shutil.copy(report, fixtures / "benchmark_report.json")
shutil.copy(report, WEB / "src" / "data" / "benchmark.json")
shutil.copy(GATEWAY / "artifacts" / "benchmark_report.png", WEB / "public" / "benchmark_report.png")
shutil.copy(GATEWAY / "artifacts" / "router_study.json", WEB / "src" / "data" / "router_study.json")
kb = [{"doc": c.doc, "id": c.id, "text": c.text} for c in DEFAULT_CHUNKS]
(WEB / "lib" / "kb.ts").write_text(
    "// GENERATED from gateway/app/kb.py by scripts/gen-fixtures.py. Do not edit by hand.\n"
    "export interface KBChunk { doc: string; id: string; text: string }\n"
    f"export const DEFAULT_CHUNKS: KBChunk[] = {json.dumps(kb, indent=2)};\n"
)
print(f"wrote {len(tasks)} tasks and copied the benchmark report into web/")
