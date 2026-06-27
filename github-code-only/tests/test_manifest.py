from pathlib import Path

import pandas as pd

from backend.taishan_pipeline.manifest import build_processing_manifest
from backend.taishan_pipeline.paths import PipelineInputs


def test_manifest_records_input_hashes_and_processed_counts(tmp_path: Path):
    project_root = tmp_path
    raw_dir = project_root / "raw"
    processed_dir = project_root / "data" / "processed"
    raw_dir.mkdir()
    processed_dir.mkdir(parents=True)

    task_file = raw_dir / "tasks.xlsx"
    ledger_file = raw_dir / "ledger.xlsx"
    kml_file = raw_dir / "route.kml"
    task_file.write_bytes(b"task bytes")
    ledger_file.write_bytes(b"ledger bytes")
    kml_file.write_text("<kml />", encoding="utf-8")

    towers = pd.DataFrame({
        "tower_id": ["t1", "t2"],
        "longitude": [117.0, 117.1],
        "latitude": [36.0, 36.1],
    })
    routes = pd.DataFrame({"route_id": ["r1"]})
    tables = {"towers": towers, "routes": routes}
    towers_csv = processed_dir / "towers.csv"
    routes_csv = processed_dir / "routes.csv"
    towers.to_csv(towers_csv, index=False, encoding="utf-8-sig")
    routes.to_csv(routes_csv, index=False, encoding="utf-8-sig")

    inputs = PipelineInputs(
        task_file=task_file,
        ledger_file=ledger_file,
        kml_files=[kml_file],
        source_root=raw_dir,
        notes=["test note"],
    )
    manifest = build_processing_manifest(
        project_root,
        inputs,
        tables,
        {"towers": towers_csv, "routes": routes_csv},
        {"issue_counts": {"total": 0}},
        ["test warning"],
    )

    assert manifest["schema_version"] == "1.0"
    assert manifest["source_root"] == "raw"
    assert manifest["row_counts"] == {"towers": 2, "routes": 1}
    assert manifest["quality_issue_counts"]["total"] == 0
    assert manifest["warnings"] == ["test warning"]
    assert {item["role"] for item in manifest["input_files"]} == {"task_file", "ledger_file", "kml_file"}
    assert all(len(item["sha256"]) == 64 for item in manifest["input_files"])

    processed = {item["role"]: item for item in manifest["processed_files"]}
    assert processed["towers"]["rows"] == 2
    assert processed["towers"]["field_count"] == 3
    assert processed["routes"]["rows"] == 1
