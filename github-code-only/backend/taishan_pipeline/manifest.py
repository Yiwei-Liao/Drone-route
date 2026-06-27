"""Processing manifest for reproducible data handoff."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from .paths import PipelineInputs


def write_processing_manifest(
    project_root: Path,
    inputs: PipelineInputs,
    tables: dict[str, pd.DataFrame],
    outputs: dict[str, Path],
    quality_report: dict[str, Any],
    warnings: list[str],
) -> Path:
    """Write a manifest describing inputs, generated files, counts, and hashes."""

    manifest = build_processing_manifest(project_root, inputs, tables, outputs, quality_report, warnings)
    path = project_root / "data" / "processed" / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def build_processing_manifest(
    project_root: Path,
    inputs: PipelineInputs,
    tables: dict[str, pd.DataFrame],
    outputs: dict[str, Path],
    quality_report: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any]:
    """Build a machine-readable manifest without inventing missing data."""

    input_files = [
        file_entry("task_file", inputs.task_file, project_root),
        file_entry("ledger_file", inputs.ledger_file, project_root),
    ]
    input_files.extend(file_entry("kml_file", path, project_root) for path in inputs.kml_files)

    return {
        "schema_version": "1.0",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_root": relative_path(inputs.source_root, project_root),
        "notes": list(inputs.notes),
        "input_files": input_files,
        "processed_files": [
            processed_file_entry(name, path, project_root, tables)
            for name, path in sorted(outputs.items())
            if path.name != "manifest.json"
        ],
        "row_counts": {name: int(len(frame)) for name, frame in tables.items()},
        "quality_issue_counts": quality_report.get("issue_counts", {}),
        "coordinate_expectation": quality_report.get("coordinate_expectation", {}),
        "warnings": list(warnings),
        "boundaries": [
            "Manifest records file provenance, counts, and hashes only.",
            "It does not certify engineering altitude, DEM/DSM terrain, communication coverage, or flight safety.",
            "data/processed outputs are generated artifacts; raw source files remain read-only inputs.",
        ],
    }


def file_entry(role: str, path: Path, project_root: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "role": role,
        "path": relative_path(path, project_root),
        "name": path.name,
        "bytes": int(stat.st_size),
        "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        "sha256": sha256_file(path),
    }


def processed_file_entry(name: str, path: Path, project_root: Path, tables: dict[str, pd.DataFrame]) -> dict[str, Any]:
    entry = file_entry(name, path, project_root)
    entry["format"] = path.suffix.lower().lstrip(".") or "unknown"

    if name in tables:
        frame = tables[name]
        entry["rows"] = int(len(frame))
        entry["field_count"] = int(len(frame.columns))
        entry["fields"] = list(frame.columns)
        return entry

    if path.suffix.lower() == ".geojson":
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            entry["features"] = int(len(payload.get("features", [])))
        except (OSError, json.JSONDecodeError):
            entry["features"] = None
        return entry

    if path.suffix.lower() == ".csv":
        try:
            frame = pd.read_csv(path, dtype="string")
            entry["rows"] = int(len(frame))
            entry["field_count"] = int(len(frame.columns))
            entry["fields"] = list(frame.columns)
        except (OSError, pd.errors.EmptyDataError, UnicodeDecodeError):
            entry["rows"] = None
        return entry

    return entry


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_path(path: Path, project_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(project_root.resolve())).replace("\\", "/")
    except ValueError:
        return str(path)
