"""输入输出路径发现工具。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PipelineInputs:
    """阶段 2 管线需要的原始输入文件。"""

    task_file: Path
    ledger_file: Path
    kml_files: list[Path]
    source_root: Path
    notes: list[str]


def discover_inputs(project_root: Path) -> PipelineInputs:
    """优先扫描 data/raw 规范目录，必要时合并只读回退 raw/。"""

    task_dir = project_root / "data" / "raw" / "tasks"
    ledger_dir = project_root / "data" / "raw" / "ledger"
    kml_dir = project_root / "data" / "raw" / "kml"
    notes: list[str] = []

    task_files = sorted(task_dir.glob("*.xlsx"))
    ledger_files = sorted(ledger_dir.glob("*.xlsx"))
    kml_files = sorted(kml_dir.glob("*.kml"))
    source_root = project_root / "data" / "raw"

    if not task_files or not ledger_files or not kml_files:
        legacy_raw = project_root / "raw"
        excel_files = sorted(legacy_raw.glob("*.xlsx")) if legacy_raw.exists() else []
        if not task_files:
            task_files = [path for path in excel_files if "巡检" in path.name or "任务" in path.name]
        if not ledger_files:
            ledger_files = [path for path in excel_files if "台账" in path.name]
        legacy_kml_files = sorted(legacy_raw.glob("*.kml")) if legacy_raw.exists() else []
        canonical_kml_files = sorted(kml_dir.glob("*.kml"))
        kml_files = sorted({*legacy_kml_files, *canonical_kml_files})
        source_root = legacy_raw
        notes.append("data/raw 规范目录未放入完整 Excel 原始文件；Excel 回退读取 raw/，KML 合并读取 raw/ 与 data/raw/kml/。")

    if not task_files:
        raise FileNotFoundError("未找到巡检任务统计 Excel。")
    if not ledger_files:
        raise FileNotFoundError("未找到线路台账 Excel。")
    if not kml_files:
        raise FileNotFoundError("未找到 KML 航线文件。")

    return PipelineInputs(
        task_file=task_files[0],
        ledger_file=ledger_files[0],
        kml_files=kml_files,
        source_root=source_root,
        notes=notes,
    )
