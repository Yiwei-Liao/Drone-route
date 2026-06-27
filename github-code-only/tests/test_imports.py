from pathlib import Path

import pytest

from backend.taishan_pipeline.imports import (
    StagedFile,
    create_manifest,
    get_import_schema,
    list_import_batches,
    read_import_manifest,
    safe_filename,
    validate_extension,
)


def test_import_schema_lists_expected_categories(tmp_path: Path) -> None:
    schema = get_import_schema(tmp_path)
    assert schema["status"] == "available"
    assert {"tasks", "ledger", "kml", "dem", "communication", "uav_models"}.issubset(
        set(schema["categories"])
    )


def test_validate_extension_by_category() -> None:
    assert validate_extension("kml", "route.kml") == ".kml"
    assert validate_extension("dem", "terrain.tif") == ".tif"
    with pytest.raises(ValueError):
        validate_extension("kml", "route.xlsx")


def test_safe_filename_removes_path_and_windows_reserved_chars() -> None:
    assert safe_filename("../bad:name?.kml") == "bad_name_.kml"


def test_create_and_list_import_manifest(tmp_path: Path) -> None:
    batch_id = "20260626T010203Z_abcdef12"
    manifest = create_manifest(
        project_root=tmp_path,
        batch_id=batch_id,
        category="kml",
        note="unit test",
        files=[
            StagedFile(
                original_filename="route.kml",
                stored_filename="route.kml",
                relative_path="data/raw/imports/20260626T010203Z_abcdef12/route.kml",
                bytes=12,
                sha256="0" * 64,
                extension=".kml",
            )
        ],
    )

    assert manifest["status"] == "staged_for_review"
    assert manifest["canonical_review_target"] == "data/raw/kml/"
    assert read_import_manifest(tmp_path, batch_id)["batch_id"] == batch_id

    batches = list_import_batches(tmp_path)
    assert len(batches) == 1
    assert batches[0]["batch_id"] == batch_id
    assert batches[0]["file_count"] == 1
