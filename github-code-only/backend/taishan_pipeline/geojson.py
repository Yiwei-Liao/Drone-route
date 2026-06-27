"""标准表到 GeoJSON 的轻量转换。"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


def write_point_geojson(df: pd.DataFrame, output_path: Path, lon_col: str = "longitude", lat_col: str = "latitude") -> None:
    """写点 GeoJSON；缺失经纬度的记录不会写入几何。"""

    features = []
    for _, row in df.dropna(subset=[lon_col, lat_col]).iterrows():
        props = _props(row)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(row[lon_col]), float(row[lat_col])]},
                "properties": props,
            }
        )
    _write_collection(features, output_path)


def write_routes_geojson(waypoints: pd.DataFrame, routes: pd.DataFrame, output_path: Path) -> None:
    """按 route_id 聚合航点，写航线 LineString GeoJSON。"""

    route_props = {row["route_id"]: _props(row) for _, row in routes.iterrows()}
    features = []
    for route_id, group in waypoints.dropna(subset=["longitude", "latitude"]).groupby("route_id", sort=False):
        ordered = group.sort_values("sequence")
        coordinates = [[float(row.longitude), float(row.latitude), _safe_alt(row.altitude)] for row in ordered.itertuples()]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "properties": route_props.get(route_id, {"route_id": route_id}),
            }
        )
    _write_collection(features, output_path)


def write_lines_geojson(towers: pd.DataFrame, lines: pd.DataFrame, output_path: Path) -> None:
    """按台账顺序连接杆塔点，写线路 LineString GeoJSON；该顺序需人工校核。"""

    line_props = {row["line_name"]: _props(row) for _, row in lines.iterrows()}
    features = []
    for line_name, group in towers.dropna(subset=["line_name", "longitude", "latitude"]).groupby("line_name", sort=False):
        if len(group) < 2:
            continue
        coordinates = [[float(row.longitude), float(row.latitude)] for row in group.sort_values("source_row").itertuples()]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coordinates},
                "properties": line_props.get(line_name, {"line_name": line_name}),
            }
        )
    _write_collection(features, output_path)


def _props(row: pd.Series) -> dict[str, object]:
    """将 pandas 行转为 JSON 可序列化属性。"""

    output: dict[str, object] = {}
    for key, value in row.items():
        if pd.isna(value):
            output[key] = None
        else:
            output[key] = value.item() if hasattr(value, "item") else value
    return output


def _safe_alt(value: object) -> float | None:
    return None if pd.isna(value) else float(value)


def _write_collection(features: list[dict[str, object]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

