"""Data import staging helpers.

The import area is intentionally separated from the canonical raw-data
folders. Uploaded files are staged for review and never overwrite existing
raw files or processed outputs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any
from uuid import uuid4


IMPORT_SCHEMA_VERSION = "1.0"
IMPORT_ROOT_RELATIVE = Path("data") / "raw" / "imports"
MANIFEST_NAME = "import_manifest.json"

IMPORT_CATEGORIES: dict[str, dict[str, object]] = {
    "tasks": {
        "label": "inspection task table",
        "accepted_extensions": [".xlsx", ".xls", ".csv"],
        "canonical_review_target": "data/raw/tasks/",
    },
    "ledger": {
        "label": "line and tower ledger",
        "accepted_extensions": [".xlsx", ".xls", ".csv"],
        "canonical_review_target": "data/raw/ledger/",
    },
    "kml": {
        "label": "DJI KML/KMZ route files",
        "accepted_extensions": [".kml", ".kmz"],
        "canonical_review_target": "data/raw/kml/",
    },
    "dem": {
        "label": "local DEM/DSM terrain files",
        "accepted_extensions": [".tif", ".tiff", ".hgt", ".asc", ".vrt", ".img", ".zip"],
        "canonical_review_target": "data/raw/dem/",
    },
    "communication": {
        "label": "communication station or link parameters",
        "accepted_extensions": [".csv", ".xlsx", ".xls", ".json"],
        "canonical_review_target": "data/raw/communication/",
    },
    "uav_models": {
        "label": "UAV model and energy parameters",
        "accepted_extensions": [".csv", ".xlsx", ".xls", ".json"],
        "canonical_review_target": "data/raw/uav_models/",
    },
}


@dataclass(frozen=True)
class StagedFile:
    original_filename: str
    stored_filename: str
    relative_path: str
    bytes: int
    sha256: str
    extension: str


def get_import_root(project_root: Path) -> Path:
    return project_root / IMPORT_ROOT_RELATIVE


def get_import_schema(project_root: Path) -> dict[str, object]:
    return {
        "schema_version": IMPORT_SCHEMA_VERSION,
        "status": "available",
        "staging_root": str(IMPORT_ROOT_RELATIVE).replace("\\", "/"),
        "categories": IMPORT_CATEGORIES,
        "rules": [
            "Uploads are staged for review and do not overwrite raw files.",
            "Staged uploads do not update data/processed until the operator reviews the files and reruns the pipeline.",
            "Original Excel/KML/DEM files remain the source of truth; unresolved fields must stay unknown or pending.",
        ],
        "review_command_hint": (
            "After manual review, place accepted files into data/raw/tasks, data/raw/ledger, "
            "data/raw/kml, or data/raw/dem, then rerun scripts/run_data_pipeline.ps1."
        ),
    }


def new_batch_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{timestamp}_{uuid4().hex[:8]}"


def validate_category(category: str) -> dict[str, object]:
    if category not in IMPORT_CATEGORIES:
        allowed = ", ".join(sorted(IMPORT_CATEGORIES))
        raise ValueError(f"Unsupported import category '{category}'. Allowed: {allowed}")
    return IMPORT_CATEGORIES[category]


def validate_extension(category: str, filename: str) -> str:
    info = validate_category(category)
    extension = Path(filename).suffix.lower()
    accepted = set(info["accepted_extensions"])  # type: ignore[arg-type]
    if extension not in accepted:
        accepted_text = ", ".join(sorted(accepted))
        raise ValueError(f"Unsupported file extension '{extension}' for {category}. Accepted: {accepted_text}")
    return extension


def safe_filename(filename: str) -> str:
    name = Path(filename or "upload.bin").name.strip()
    if not name:
        name = "upload.bin"
    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]+', "_", name)
    return name[:180]


def make_stored_filename(original_filename: str, used_names: set[str]) -> str:
    name = safe_filename(original_filename)
    stem = Path(name).stem or "upload"
    suffix = Path(name).suffix
    candidate = name
    index = 2
    while candidate.lower() in used_names:
        candidate = f"{stem}_{index}{suffix}"
        index += 1
    used_names.add(candidate.lower())
    return candidate


def create_manifest(
    *,
    project_root: Path,
    batch_id: str,
    category: str,
    note: str | None,
    files: list[StagedFile],
) -> dict[str, Any]:
    info = validate_category(category)
    batch_dir = get_import_root(project_root) / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": IMPORT_SCHEMA_VERSION,
        "batch_id": batch_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "staged_for_review",
        "category": category,
        "category_label": info["label"],
        "note": note or "",
        "staging_directory": str(batch_dir.relative_to(project_root)).replace("\\", "/"),
        "canonical_review_target": info["canonical_review_target"],
        "files": [file.__dict__ for file in files],
        "next_steps": [
            "Review staged files and confirm their source, field meanings, coordinate convention, and units.",
            f"Move or copy accepted files into {info['canonical_review_target']} only after manual review.",
            "Run scripts/run_data_pipeline.ps1 to regenerate data/processed and SQLite outputs.",
            "Run scripts/verify_project.ps1 to validate counts, data quality, API responses, and the map.",
        ],
        "boundaries": [
            "This import does not overwrite original raw files.",
            "This import does not generate processed data automatically.",
            "DEM/DSM files are staged only; they are not used as engineering elevation sources until a terrain pipeline is implemented.",
            "Communication and UAV model files are staged only; no real coverage or energy model is inferred automatically.",
        ],
    }
    manifest_path = batch_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def list_import_batches(project_root: Path) -> list[dict[str, object]]:
    import_root = get_import_root(project_root)
    if not import_root.exists():
        return []
    batches: list[dict[str, object]] = []
    for manifest_path in sorted(import_root.glob(f"*/{MANIFEST_NAME}"), reverse=True):
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        batches.append(
            {
                "batch_id": manifest.get("batch_id"),
                "created_at": manifest.get("created_at"),
                "status": manifest.get("status"),
                "category": manifest.get("category"),
                "file_count": len(manifest.get("files", [])),
                "staging_directory": manifest.get("staging_directory"),
            }
        )
    return batches


def read_import_manifest(project_root: Path, batch_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z_[0-9a-f]{8}", batch_id):
        raise FileNotFoundError(batch_id)
    manifest_path = get_import_root(project_root) / batch_id / MANIFEST_NAME
    if not manifest_path.exists():
        raise FileNotFoundError(batch_id)
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
