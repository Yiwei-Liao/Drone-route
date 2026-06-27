"""阶段 2 Python 标准化数据管线。"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from .data_quality import build_quality_report, write_quality_outputs
from .excel import make_lines, read_flight_tasks, read_towers
from .geojson import write_lines_geojson, write_point_geojson, write_routes_geojson
from .geometry import haversine_m
from .kml import routes_to_frames
from .manifest import write_processing_manifest
from .paths import discover_inputs


def run_pipeline(project_root: Path) -> dict[str, Path]:
    """从原始 Excel/KML 生成标准 CSV、GeoJSON 和日志。"""

    inputs = discover_inputs(project_root)
    processed_dir = project_root / "data" / "processed"
    log_dir = project_root / "output"
    processed_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    towers, airports, ledger_warnings = read_towers(inputs.ledger_file)
    lines = make_lines(towers)
    flight_tasks, base_stations, task_warnings = read_flight_tasks(inputs.task_file)
    routes, route_waypoints = routes_to_frames(inputs.kml_files)
    route_tower_matches = match_routes_to_towers(routes, route_waypoints, towers)

    tables = {
        "towers": towers,
        "lines": lines,
        "airports": airports,
        "base_stations": base_stations,
        "flight_tasks": flight_tasks,
        "routes": routes,
        "route_waypoints": route_waypoints,
        "route_tower_matches": route_tower_matches,
    }

    outputs: dict[str, Path] = {}
    for name, frame in tables.items():
        output_file = processed_dir / f"{name}.csv"
        frame.to_csv(output_file, index=False, encoding="utf-8-sig")
        outputs[name] = output_file

    quality_report, quality_issues = build_quality_report(tables)
    outputs.update(write_quality_outputs(quality_report, quality_issues, processed_dir, log_dir))

    geojson_outputs = {
        "towers_geojson": processed_dir / "towers.geojson",
        "lines_geojson": processed_dir / "lines.geojson",
        "base_stations_geojson": processed_dir / "base_stations.geojson",
        "routes_geojson": processed_dir / "routes.geojson",
        "route_waypoints_geojson": processed_dir / "route_waypoints.geojson",
    }
    write_point_geojson(towers, geojson_outputs["towers_geojson"])
    write_lines_geojson(towers, lines, geojson_outputs["lines_geojson"])
    write_point_geojson(base_stations, geojson_outputs["base_stations_geojson"])
    write_routes_geojson(route_waypoints, routes, geojson_outputs["routes_geojson"])
    write_point_geojson(route_waypoints, geojson_outputs["route_waypoints_geojson"])
    outputs.update(geojson_outputs)

    warnings = ledger_warnings + task_warnings + route_quality_warnings(routes, route_tower_matches)
    log = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_root": str(inputs.source_root),
        "notes": inputs.notes,
        "input_files": {
            "task_file": str(inputs.task_file),
            "ledger_file": str(inputs.ledger_file),
            "kml_files": [str(path) for path in inputs.kml_files],
        },
        "row_counts": {name: int(len(frame)) for name, frame in tables.items()},
        "warnings": warnings,
        "quality_issue_counts": quality_report["issue_counts"],
        "field_mapping": field_mapping(),
    }
    log_path = log_dir / "data_pipeline_log.json"
    log_path.write_text(json.dumps(log, ensure_ascii=False, indent=2), encoding="utf-8")
    outputs["log"] = log_path
    outputs["manifest"] = write_processing_manifest(project_root, inputs, tables, outputs, quality_report, warnings)
    return outputs


def match_routes_to_towers(routes: pd.DataFrame, waypoints: pd.DataFrame, towers: pd.DataFrame) -> pd.DataFrame:
    """按航点到杆塔的最小距离匹配最近杆塔。"""

    valid_towers = towers.dropna(subset=["longitude", "latitude"]).copy()
    rows: list[dict[str, object]] = []
    for _, route in routes.iterrows():
        route_points = waypoints[waypoints["route_id"] == route["route_id"]].dropna(subset=["longitude", "latitude"])
        best: dict[str, object] | None = None
        for _, tower in valid_towers.iterrows():
            distances = [
                haversine_m(float(tower["longitude"]), float(tower["latitude"]), float(point["longitude"]), float(point["latitude"]))
                for _, point in route_points.iterrows()
            ]
            if not distances:
                continue
            candidate = {
                "route_id": route["route_id"],
                "tower_id": tower["tower_id"],
                "line_name": tower["line_name"],
                "tower_no": tower["tower_no"],
                "min_distance_to_tower": min(distances),
                "avg_distance_to_tower": sum(distances) / len(distances),
                "max_distance_to_tower": max(distances),
            }
            if best is None or candidate["min_distance_to_tower"] < best["min_distance_to_tower"]:
                best = candidate

        if best is None:
            best = {
                "route_id": route["route_id"],
                "tower_id": None,
                "line_name": None,
                "tower_no": None,
                "min_distance_to_tower": None,
                "avg_distance_to_tower": None,
                "max_distance_to_tower": None,
            }
        confidence, reason = classify_match(best["min_distance_to_tower"], route.get("route_radius"))
        best.update(
            {
                "match_id": f"match_{route['route_id']}",
                "match_confidence": confidence,
                "match_reason": reason,
                "source_file": route["source_file"],
            }
        )
        rows.append(best)
    return pd.DataFrame(rows)


def classify_match(distance: object, route_radius: object) -> tuple[str, str]:
    """输出匹配置信度和原因，均为规则推断。"""

    if distance is None or pd.isna(distance):
        return "low", "缺少航点或杆塔坐标"
    radius = None if route_radius is None or pd.isna(route_radius) else float(route_radius)
    distance = float(distance)
    if distance <= 20 and radius is not None and radius <= 80:
        return "high", "航线接近杆塔且半径较小，可能为绕塔巡检（推断）"
    if distance <= 80:
        return "medium", "航线接近杆塔，但需人工确认巡检对象（推断）"
    return "low", "航线与最近杆塔距离偏大，需复核"


def route_quality_warnings(routes: pd.DataFrame, matches: pd.DataFrame) -> list[str]:
    """生成航线解析和匹配质量日志。"""

    warnings: list[str] = []
    for _, route in routes.iterrows():
        if route.get("waypoint_count", 0) == 0:
            warnings.append(f"KML 未解析出航点：{route.get('source_file')}")
        if pd.isna(route.get("min_height")) or pd.isna(route.get("max_height")):
            warnings.append(f"KML 未解析出高度：{route.get('source_file')}")
    for _, match in matches.iterrows():
        if match.get("match_confidence") == "low":
            warnings.append(f"航线匹配置信度低：{match.get('source_file')} -> {match.get('line_name')} {match.get('tower_no')}")
    return warnings


def field_mapping() -> dict[str, dict[str, str]]:
    """保留原始字段到标准字段的关键映射关系。"""

    return {
        "towers": {
            "线路名称": "line_name",
            "杆号": "tower_no",
            "坐标（经度）": "longitude",
            "坐标（纬度）": "latitude",
            "杆塔全高": "tower_height",
            "大号侧档距": "span_large_side",
            "小号侧档距": "span_small_side",
            "机场站点": "airport_name",
            "与机场距离": "distance_to_airport",
        },
        "flight_tasks": {
            "无人机巡检线路名称": "route_file_hint",
            "无人机巡检杆塔编号": "tower_full_name",
            "部署机场和无人机的型号": "uav_model",
            "飞行架次编号": "task_id",
            "航线高度": "flight_height",
            "飞行航线编号": "route_id_raw",
            "机场监测的现场环境参数/风速": "wind_speed",
            "无人机飞行巡检距离（mk）": "flight_distance",
            "该架次结束后剩余的电池电量（V）": "battery_remaining",
            "基站经纬度": "station_longitude/station_latitude",
        },
        "route_waypoints": {
            "KML coordinates longitude": "longitude",
            "KML coordinates latitude": "latitude",
            "KML coordinates altitude": "altitude",
            "mis:speed": "speed",
            "mis:heading": "heading",
            "mis:gimbalPitch": "gimbal_pitch",
            "mis:turnMode": "turn_mode",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="运行阶段 2 Python 数据标准化管线")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="项目根目录")
    args = parser.parse_args()
    outputs = run_pipeline(args.root.resolve())
    print("阶段 2 数据管线已完成，输出文件：")
    for name, path in outputs.items():
        print(f"- {name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
