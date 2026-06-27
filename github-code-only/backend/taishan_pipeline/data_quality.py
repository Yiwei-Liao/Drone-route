"""结构化数据质量检查。

这些检查只验证数据可用性与一致性，不产生飞行安全结论。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


TAIAN_LON_RANGE = (116.0, 118.5)
TAIAN_LAT_RANGE = (35.0, 37.5)


@dataclass(frozen=True)
class QualityIssue:
    table: str
    entity_id: str
    severity: str
    issue_type: str
    message: str
    source_file: str = ""
    source_row: str = ""
    line_name: str = ""
    tower_no: str = ""
    longitude: str = ""
    latitude: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "table": self.table,
            "entity_id": self.entity_id,
            "severity": self.severity,
            "issue_type": self.issue_type,
            "message": self.message,
            "source_file": self.source_file,
            "source_row": self.source_row,
            "line_name": self.line_name,
            "tower_no": self.tower_no,
            "longitude": self.longitude,
            "latitude": self.latitude,
        }


def build_quality_report(tables: dict[str, pd.DataFrame]) -> tuple[dict[str, Any], pd.DataFrame]:
    """生成结构化质量报告和问题明细表。"""

    issues: list[QualityIssue] = []
    for table_name, id_field in {
        "towers": "tower_id",
        "routes": "route_id",
        "route_waypoints": "waypoint_id",
        "base_stations": "station_id",
        "flight_tasks": "task_id",
    }.items():
        frame = tables.get(table_name, pd.DataFrame())
        issues.extend(check_duplicate_ids(table_name, frame, id_field))

    for table_name, id_field in {
        "towers": "tower_id",
        "route_waypoints": "waypoint_id",
        "base_stations": "station_id",
    }.items():
        frame = tables.get(table_name, pd.DataFrame())
        issues.extend(check_coordinates(table_name, frame, id_field))

    issues.extend(check_route_matches(tables.get("route_tower_matches", pd.DataFrame())))

    report = {
        "coordinate_expectation": {
            "longitude_field": "longitude",
            "latitude_field": "latitude",
            "taian_longitude_range": list(TAIAN_LON_RANGE),
            "taian_latitude_range": list(TAIAN_LAT_RANGE),
            "longitude_latitude_order": "GeoJSON coordinates use [longitude, latitude]",
        },
        "tables": {name: summarize_table(name, frame) for name, frame in tables.items()},
        "coordinate_ranges": {
            name: coordinate_summary(frame)
            for name, frame in tables.items()
            if {"longitude", "latitude"}.issubset(frame.columns)
        },
        "id_checks": {
            table_name: id_summary(tables[table_name], id_field)
            for table_name, id_field in {
                "towers": "tower_id",
                "routes": "route_id",
                "route_waypoints": "waypoint_id",
                "base_stations": "station_id",
                "flight_tasks": "task_id",
            }.items()
            if table_name in tables
        },
        "route_match_summary": route_match_summary(tables.get("route_tower_matches", pd.DataFrame())),
        "issue_counts": issue_counts(issues),
        "issues": [issue.as_dict() for issue in issues],
        "notes": [
            "质量检查只用于数据可信度验收，不代表飞行安全评估。",
            "坐标范围基于泰安区域经验范围，越界记录需要人工复核。",
            "匹配置信度来自规则推断，不能替代现场线路拓扑确认。",
        ],
    }
    return report, pd.DataFrame([issue.as_dict() for issue in issues])


def write_quality_outputs(report: dict[str, Any], issues: pd.DataFrame, processed_dir: Path, output_dir: Path) -> dict[str, Path]:
    """写入 JSON 报告和 CSV 问题明细。"""

    import json

    quality_json = output_dir / "data_quality_report.json"
    quality_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    issues_csv = processed_dir / "data_quality_issues.csv"
    if issues.empty:
        issues = pd.DataFrame(columns=quality_issue_columns())
    issues.to_csv(issues_csv, index=False, encoding="utf-8-sig")
    backfill_csv = processed_dir / "coordinate_backfill_template.csv"
    backfill = build_coordinate_backfill_template(issues)
    backfill = preserve_coordinate_backfill_entries(backfill, backfill_csv)
    backfill.to_csv(backfill_csv, index=False, encoding="utf-8-sig")
    validation, validation_report = build_coordinate_backfill_validation(backfill)
    validation_csv = processed_dir / "coordinate_backfill_validation.csv"
    validation.to_csv(validation_csv, index=False, encoding="utf-8-sig")
    validation_json = output_dir / "coordinate_backfill_validation_report.json"
    validation_json.write_text(json.dumps(validation_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "quality_report": quality_json,
        "quality_issues": issues_csv,
        "coordinate_backfill_template": backfill_csv,
        "coordinate_backfill_validation": validation_csv,
        "coordinate_backfill_validation_report": validation_json,
    }


def build_coordinate_backfill_template(issues: pd.DataFrame) -> pd.DataFrame:
    """Build a manual coordinate remediation sheet from missing-coordinate issues."""

    columns = coordinate_backfill_columns()
    if issues.empty or "issue_type" not in issues.columns:
        return pd.DataFrame(columns=columns)
    missing = issues[issues["issue_type"] == "missing_coordinate"].copy()
    if missing.empty:
        return pd.DataFrame(columns=columns)
    output = pd.DataFrame({
        "source_file": missing.get("source_file", ""),
        "source_row": missing.get("source_row", ""),
        "entity_id": missing.get("entity_id", ""),
        "line_name": missing.get("line_name", ""),
        "tower_no": missing.get("tower_no", ""),
        "current_longitude": missing.get("longitude", ""),
        "current_latitude": missing.get("latitude", ""),
        "longitude_to_fill": "",
        "latitude_to_fill": "",
        "coordinate_source": "",
        "reviewer": "",
        "review_status": "pending",
        "notes": "补齐后回写原始台账，再重新运行 scripts/run_data_pipeline.ps1；不要直接修改 data/processed 生成文件。",
    })
    return output[columns]


def preserve_coordinate_backfill_entries(backfill: pd.DataFrame, existing_path: Path) -> pd.DataFrame:
    """Preserve manually filled remediation fields when regenerating the template."""

    if backfill.empty or not existing_path.exists():
        return backfill
    try:
        existing = pd.read_csv(existing_path, dtype="string").fillna("")
    except Exception:
        return backfill
    key_columns = ["entity_id", "source_file", "source_row"]
    preserve_columns = [
        "longitude_to_fill",
        "latitude_to_fill",
        "coordinate_source",
        "reviewer",
        "review_status",
        "notes",
    ]
    if not set(key_columns).issubset(existing.columns):
        return backfill
    merged = backfill.copy()
    existing_index = {
        tuple(str(row.get(column, "")) for column in key_columns): row
        for _, row in existing.iterrows()
    }
    for index, row in merged.iterrows():
        key = tuple(str(row.get(column, "")) for column in key_columns)
        old = existing_index.get(key)
        if old is None:
            continue
        for column in preserve_columns:
            if column not in merged.columns or column not in existing.columns:
                continue
            value = old.get(column, "")
            if value is not None and not pd.isna(value) and str(value) != "":
                merged.at[index, column] = str(value)
    return merged


def build_coordinate_backfill_validation(backfill: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Validate manually filled coordinates without writing them back to source data."""

    columns = coordinate_backfill_validation_columns()
    if backfill.empty:
        empty = pd.DataFrame(columns=columns)
        return empty, coordinate_backfill_validation_report(empty)

    rows: list[dict[str, Any]] = []
    for _, row in backfill.iterrows():
        lon_raw = row.get("longitude_to_fill", "")
        lat_raw = row.get("latitude_to_fill", "")
        lon_text = "" if lon_raw is None or pd.isna(lon_raw) else str(lon_raw).strip()
        lat_text = "" if lat_raw is None or pd.isna(lat_raw) else str(lat_raw).strip()
        status = "valid"
        issue = ""
        lon_value = pd.to_numeric(pd.Series([lon_text]), errors="coerce").iloc[0]
        lat_value = pd.to_numeric(pd.Series([lat_text]), errors="coerce").iloc[0]

        if lon_text == "" and lat_text == "":
            status = "pending"
            issue = "longitude_to_fill and latitude_to_fill are empty"
        elif lon_text == "" or lat_text == "":
            status = "incomplete"
            issue = "one coordinate field is empty"
        elif pd.isna(lon_value) or pd.isna(lat_value):
            status = "invalid_numeric"
            issue = "filled coordinates cannot be parsed as numbers"
        elif TAIAN_LAT_RANGE[0] <= float(lon_value) <= TAIAN_LAT_RANGE[1] and TAIAN_LON_RANGE[0] <= float(lat_value) <= TAIAN_LON_RANGE[1]:
            status = "possible_lon_lat_swapped"
            issue = "filled longitude/latitude look swapped"
        elif not (TAIAN_LON_RANGE[0] <= float(lon_value) <= TAIAN_LON_RANGE[1] and TAIAN_LAT_RANGE[0] <= float(lat_value) <= TAIAN_LAT_RANGE[1]):
            status = "out_of_taian_range"
            issue = "filled coordinates are outside Taian empirical range"

        rows.append({
            "source_file": row.get("source_file", ""),
            "source_row": row.get("source_row", ""),
            "entity_id": row.get("entity_id", ""),
            "line_name": row.get("line_name", ""),
            "tower_no": row.get("tower_no", ""),
            "longitude_to_fill": lon_text,
            "latitude_to_fill": lat_text,
            "coordinate_source": row.get("coordinate_source", ""),
            "reviewer": row.get("reviewer", ""),
            "review_status": row.get("review_status", ""),
            "validation_status": status,
            "validation_issue": issue,
        })
    validation = pd.DataFrame(rows, columns=columns)
    return validation, coordinate_backfill_validation_report(validation)


def coordinate_backfill_validation_report(validation: pd.DataFrame) -> dict[str, Any]:
    if validation.empty:
        counts: dict[str, int] = {}
    else:
        counts = {str(key): int(value) for key, value in validation["validation_status"].value_counts(dropna=False).items()}
    return {
        "rows": int(len(validation)),
        "status_counts": counts,
        "valid_rows": counts.get("valid", 0),
        "pending_rows": counts.get("pending", 0),
        "incomplete_rows": counts.get("incomplete", 0),
        "invalid_numeric_rows": counts.get("invalid_numeric", 0),
        "possible_lon_lat_swapped_rows": counts.get("possible_lon_lat_swapped", 0),
        "out_of_taian_range_rows": counts.get("out_of_taian_range", 0),
        "notes": [
            "This validation only checks the manual backfill template.",
            "It does not write coordinates back to raw ledger data.",
            "Taian empirical coordinate ranges are used as a data quality threshold, not an engineering boundary.",
        ],
    }


def coordinate_backfill_columns() -> list[str]:
    return [
        "source_file",
        "source_row",
        "entity_id",
        "line_name",
        "tower_no",
        "current_longitude",
        "current_latitude",
        "longitude_to_fill",
        "latitude_to_fill",
        "coordinate_source",
        "reviewer",
        "review_status",
        "notes",
    ]


def coordinate_backfill_validation_columns() -> list[str]:
    return [
        "source_file",
        "source_row",
        "entity_id",
        "line_name",
        "tower_no",
        "longitude_to_fill",
        "latitude_to_fill",
        "coordinate_source",
        "reviewer",
        "review_status",
        "validation_status",
        "validation_issue",
    ]


def quality_issue_columns() -> list[str]:
    return [
        "table",
        "entity_id",
        "severity",
        "issue_type",
        "message",
        "source_file",
        "source_row",
        "line_name",
        "tower_no",
        "longitude",
        "latitude",
    ]


def summarize_table(name: str, frame: pd.DataFrame) -> dict[str, Any]:
    return {
        "rows": int(len(frame)),
        "fields": list(frame.columns),
        "field_count": int(len(frame.columns)),
        "empty_rows": int(frame.isna().all(axis=1).sum()) if not frame.empty else 0,
    }


def coordinate_summary(frame: pd.DataFrame) -> dict[str, Any]:
    lon = pd.to_numeric(frame["longitude"], errors="coerce")
    lat = pd.to_numeric(frame["latitude"], errors="coerce")
    valid = lon.notna() & lat.notna()
    in_range = valid & lon.between(*TAIAN_LON_RANGE) & lat.between(*TAIAN_LAT_RANGE)
    swapped_risk = valid & lon.between(*TAIAN_LAT_RANGE) & lat.between(*TAIAN_LON_RANGE)
    return {
        "valid_coordinate_count": int(valid.sum()),
        "missing_coordinate_count": int((~valid).sum()),
        "in_taian_range_count": int(in_range.sum()),
        "out_of_taian_range_count": int((valid & ~in_range).sum()),
        "possible_lon_lat_swapped_count": int(swapped_risk.sum()),
        "longitude_min": none_if_nan(lon.min()),
        "longitude_max": none_if_nan(lon.max()),
        "latitude_min": none_if_nan(lat.min()),
        "latitude_max": none_if_nan(lat.max()),
    }


def id_summary(frame: pd.DataFrame, id_field: str) -> dict[str, int | str]:
    if id_field not in frame.columns:
        return {"id_field": id_field, "missing_field": 1}
    ids = frame[id_field].astype("string")
    return {
        "id_field": id_field,
        "missing_id_count": int(ids.isna().sum() + (ids.fillna("").str.strip() == "").sum()),
        "unique_id_count": int(ids.dropna().nunique()),
        "duplicate_id_count": int(ids.dropna().duplicated().sum()),
    }


def check_duplicate_ids(table: str, frame: pd.DataFrame, id_field: str) -> list[QualityIssue]:
    if id_field not in frame.columns:
        return [QualityIssue(table, "", "high", "missing_id_field", f"缺少标准 ID 字段 {id_field}")]
    ids = frame[id_field].astype("string").fillna("")
    issues: list[QualityIssue] = []
    for value in ids[ids.str.strip() == ""].index:
        issues.append(QualityIssue(table, str(value), "medium", "missing_id", f"{id_field} 为空"))
    duplicated = ids[ids.ne("") & ids.duplicated(keep=False)]
    for index, value in duplicated.items():
        issues.append(QualityIssue(table, str(value), "high", "duplicate_id", f"{id_field} 重复：{value}，行索引 {index}"))
    return issues


def _check_coordinates_legacy(table: str, frame: pd.DataFrame, id_field: str) -> list[QualityIssue]:
    if frame.empty:
        return []
    if not {"longitude", "latitude"}.issubset(frame.columns):
        return [QualityIssue(table, "", "high", "missing_coordinate_fields", "缺少 longitude/latitude 字段")]
    lon = pd.to_numeric(frame["longitude"], errors="coerce")
    lat = pd.to_numeric(frame["latitude"], errors="coerce")
    issues: list[QualityIssue] = []
    for index, row in frame.iterrows():
        entity_id = str(row.get(id_field, index))
        context = issue_context(row)
        lon_value = lon.loc[index]
        lat_value = lat.loc[index]
        if pd.isna(lon_value) or pd.isna(lat_value):
            issues.append(QualityIssue(table, entity_id, "high", "missing_coordinate", "经纬度缺失或无法转为数字"))
            continue
        if not (TAIAN_LON_RANGE[0] <= lon_value <= TAIAN_LON_RANGE[1] and TAIAN_LAT_RANGE[0] <= lat_value <= TAIAN_LAT_RANGE[1]):
            severity = "high" if TAIAN_LAT_RANGE[0] <= lon_value <= TAIAN_LAT_RANGE[1] and TAIAN_LON_RANGE[0] <= lat_value <= TAIAN_LON_RANGE[1] else "medium"
            issue_type = "possible_lon_lat_swapped" if severity == "high" else "coordinate_out_of_taian_range"
            issues.append(
                QualityIssue(
                    table,
                    entity_id,
                    severity,
                    issue_type,
                    f"坐标超出泰安经验范围：longitude={lon_value}, latitude={lat_value}",
                )
            )
    return issues


def issue_context(row: pd.Series) -> dict[str, str]:
    """Return optional source fields for an issue without inventing missing data."""

    def clean(value: Any) -> str:
        if value is None or pd.isna(value):
            return ""
        return str(value)

    return {
        "source_file": clean(row.get("source_file")),
        "source_row": clean(row.get("source_row")),
        "line_name": clean(row.get("line_name")),
        "tower_no": clean(row.get("tower_no")),
        "longitude": clean(row.get("longitude")),
        "latitude": clean(row.get("latitude")),
    }


def check_coordinates(table: str, frame: pd.DataFrame, id_field: str) -> list[QualityIssue]:
    """Check coordinates and keep source row context for remediation."""

    if frame.empty:
        return []
    if not {"longitude", "latitude"}.issubset(frame.columns):
        return [QualityIssue(table, "", "high", "missing_coordinate_fields", "missing longitude/latitude fields")]
    lon = pd.to_numeric(frame["longitude"], errors="coerce")
    lat = pd.to_numeric(frame["latitude"], errors="coerce")
    issues: list[QualityIssue] = []
    for index, row in frame.iterrows():
        entity_id = str(row.get(id_field, index))
        context = issue_context(row)
        lon_value = lon.loc[index]
        lat_value = lat.loc[index]
        if pd.isna(lon_value) or pd.isna(lat_value):
            issues.append(
                QualityIssue(
                    table,
                    entity_id,
                    "high",
                    "missing_coordinate",
                    "经纬度缺失或无法转为数字",
                    **context,
                )
            )
            continue
        if not (TAIAN_LON_RANGE[0] <= lon_value <= TAIAN_LON_RANGE[1] and TAIAN_LAT_RANGE[0] <= lat_value <= TAIAN_LAT_RANGE[1]):
            severity = "high" if TAIAN_LAT_RANGE[0] <= lon_value <= TAIAN_LAT_RANGE[1] and TAIAN_LON_RANGE[0] <= lat_value <= TAIAN_LON_RANGE[1] else "medium"
            issue_type = "possible_lon_lat_swapped" if severity == "high" else "coordinate_out_of_taian_range"
            issues.append(
                QualityIssue(
                    table,
                    entity_id,
                    severity,
                    issue_type,
                    f"坐标超出泰安经验范围：longitude={lon_value}, latitude={lat_value}",
                    **context,
                )
            )
    return issues


def check_route_matches(matches: pd.DataFrame) -> list[QualityIssue]:
    if matches.empty:
        return [QualityIssue("route_tower_matches", "", "medium", "empty_route_matches", "没有航线-杆塔匹配结果")]
    issues: list[QualityIssue] = []
    for _, match in matches.iterrows():
        route_id = str(match.get("route_id", ""))
        confidence = str(match.get("match_confidence", ""))
        distance = pd.to_numeric(pd.Series([match.get("min_distance_to_tower")]), errors="coerce").iloc[0]
        if confidence == "low":
            issues.append(QualityIssue("route_tower_matches", route_id, "medium", "low_match_confidence", str(match.get("match_reason", ""))))
        if pd.notna(distance) and float(distance) > 200:
            issues.append(QualityIssue("route_tower_matches", route_id, "medium", "route_far_from_nearest_tower", f"最近杆塔距离 {float(distance):.1f} m"))
    return issues


def route_match_summary(matches: pd.DataFrame) -> dict[str, Any]:
    if matches.empty:
        return {"rows": 0, "confidence_counts": {}}
    distances = pd.to_numeric(matches.get("min_distance_to_tower"), errors="coerce")
    return {
        "rows": int(len(matches)),
        "confidence_counts": {str(key): int(value) for key, value in matches.get("match_confidence", pd.Series(dtype=str)).value_counts(dropna=False).items()},
        "min_distance_m_min": none_if_nan(distances.min()),
        "min_distance_m_max": none_if_nan(distances.max()),
        "min_distance_m_mean": none_if_nan(distances.mean()),
    }


def issue_counts(issues: list[QualityIssue]) -> dict[str, Any]:
    by_severity: dict[str, int] = {}
    by_type: dict[str, int] = {}
    for issue in issues:
        by_severity[issue.severity] = by_severity.get(issue.severity, 0) + 1
        by_type[issue.issue_type] = by_type.get(issue.issue_type, 0) + 1
    return {"total": len(issues), "by_severity": by_severity, "by_type": by_type}


def none_if_nan(value: Any) -> float | None:
    if pd.isna(value):
        return None
    return float(value)
