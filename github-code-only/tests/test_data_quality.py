import pandas as pd

from backend.taishan_pipeline.data_quality import (
    build_coordinate_backfill_template,
    build_coordinate_backfill_validation,
    build_quality_report,
)


def test_quality_report_checks_each_table_id_field_independently():
    tables = {
        "towers": pd.DataFrame({"tower_id": ["t1"], "longitude": [117.0], "latitude": [36.0]}),
        "routes": pd.DataFrame({"route_id": ["r1"]}),
        "route_waypoints": pd.DataFrame({"waypoint_id": ["w1"], "longitude": [117.0], "latitude": [36.0]}),
        "base_stations": pd.DataFrame({"station_id": ["s1"], "longitude": [117.0], "latitude": [36.0]}),
        "flight_tasks": pd.DataFrame({"task_id": ["task1"]}),
        "route_tower_matches": pd.DataFrame({"route_id": ["r1"], "match_confidence": ["high"], "min_distance_to_tower": [2.0]}),
    }

    report, issues = build_quality_report(tables)

    assert report["id_checks"]["towers"]["duplicate_id_count"] == 0
    assert report["id_checks"]["routes"]["unique_id_count"] == 1
    assert report["id_checks"]["route_waypoints"]["unique_id_count"] == 1
    assert report["id_checks"]["flight_tasks"]["unique_id_count"] == 1
    assert issues.empty


def test_quality_report_flags_missing_coordinates():
    tables = {
        "towers": pd.DataFrame({
            "tower_id": ["t1"],
            "line_name": ["35kV test line"],
            "tower_no": ["#1"],
            "longitude": [None],
            "latitude": [36.0],
            "source_file": ["ledger.xlsx"],
            "source_row": [12],
        }),
        "routes": pd.DataFrame({"route_id": ["r1"]}),
        "route_waypoints": pd.DataFrame({"waypoint_id": ["w1"], "longitude": [117.0], "latitude": [36.0]}),
        "base_stations": pd.DataFrame({"station_id": ["s1"], "longitude": [117.0], "latitude": [36.0]}),
        "flight_tasks": pd.DataFrame({"task_id": ["task1"]}),
        "route_tower_matches": pd.DataFrame({"route_id": ["r1"], "match_confidence": ["high"], "min_distance_to_tower": [2.0]}),
    }

    report, issues = build_quality_report(tables)

    assert report["issue_counts"]["by_type"]["missing_coordinate"] == 1
    assert issues.iloc[0]["entity_id"] == "t1"
    assert issues.iloc[0]["source_file"] == "ledger.xlsx"
    assert issues.iloc[0]["source_row"] == "12"
    assert issues.iloc[0]["line_name"] == "35kV test line"
    assert issues.iloc[0]["tower_no"] == "#1"

    backfill = build_coordinate_backfill_template(issues)

    assert len(backfill) == 1
    assert backfill.iloc[0]["entity_id"] == "t1"
    assert backfill.iloc[0]["source_file"] == "ledger.xlsx"
    assert backfill.iloc[0]["source_row"] == "12"
    assert backfill.iloc[0]["longitude_to_fill"] == ""
    assert backfill.iloc[0]["latitude_to_fill"] == ""
    assert backfill.iloc[0]["review_status"] == "pending"

    validation, validation_report = build_coordinate_backfill_validation(backfill)

    assert validation.iloc[0]["validation_status"] == "pending"
    assert validation_report["pending_rows"] == 1


def test_coordinate_backfill_validation_flags_valid_and_swapped_coordinates():
    backfill = pd.DataFrame({
        "source_file": ["ledger.xlsx", "ledger.xlsx"],
        "source_row": [12, 13],
        "entity_id": ["t1", "t2"],
        "line_name": ["line", "line"],
        "tower_no": ["#1", "#2"],
        "current_longitude": ["", ""],
        "current_latitude": ["", ""],
        "longitude_to_fill": ["117.1", "36.1"],
        "latitude_to_fill": ["36.1", "117.1"],
        "coordinate_source": ["manual", "manual"],
        "reviewer": ["tester", "tester"],
        "review_status": ["pending", "pending"],
        "notes": ["", ""],
    })

    validation, report = build_coordinate_backfill_validation(backfill)

    assert validation.iloc[0]["validation_status"] == "valid"
    assert validation.iloc[1]["validation_status"] == "possible_lon_lat_swapped"
    assert report["valid_rows"] == 1
    assert report["possible_lon_lat_swapped_rows"] == 1
