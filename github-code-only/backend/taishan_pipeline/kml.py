"""DJI/MIS KML 解析和航线指标计算。"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from .geometry import haversine_m, route_segment_distances, total_heading_change


@dataclass(frozen=True)
class ParsedRoute:
    """单个 KML 解析结果。"""

    route: dict[str, object]
    waypoints: list[dict[str, object]]


def local_name(tag: str) -> str:
    """去掉 XML 命名空间，便于兼容 DJI/MIS 扩展标签。"""

    return tag.split("}", 1)[-1]


def text_to_float(value: str | None) -> float | None:
    """文本转浮点数，无法解析时返回 None。"""

    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def parse_coordinate_text(text: str | None) -> list[tuple[float, float, float | None]]:
    """解析 KML coordinates 文本，输出 longitude、latitude、altitude。"""

    coordinates: list[tuple[float, float, float | None]] = []
    if not text:
        return coordinates
    for chunk in text.split():
        parts = chunk.split(",")
        if len(parts) < 2:
            continue
        lon = text_to_float(parts[0])
        lat = text_to_float(parts[1])
        alt = text_to_float(parts[2]) if len(parts) >= 3 else None
        if lon is not None and lat is not None:
            coordinates.append((lon, lat, alt))
    return coordinates


def collect_geometry_coordinates(root: ET.Element, geometry_name: str) -> list[tuple[float, float, float | None]]:
    """从 Point 或 LineString 几何节点中读取坐标。"""

    result: list[tuple[float, float, float | None]] = []
    for element in root.iter():
        if local_name(element.tag) != geometry_name:
            continue
        for child in element.iter():
            if local_name(child.tag) == "coordinates":
                result.extend(parse_coordinate_text(child.text))
    return result


def collect_tag_values(root: ET.Element, tag_name: str) -> list[str]:
    """按本地标签名读取扩展字段，如 speed、heading、gimbalPitch。"""

    values: list[str] = []
    for element in root.iter():
        if local_name(element.tag) == tag_name and element.text is not None:
            values.append(element.text.strip())
    return values


def make_route_id(kml_file: Path) -> str:
    """生成稳定 route_id，保留文件顺序可追溯性。"""

    stem = re.sub(r"\s+", "_", kml_file.stem)
    safe = re.sub(r"[^\w\u4e00-\u9fff]+", "_", stem, flags=re.UNICODE).strip("_")
    return f"route_{safe or 'unknown'}"


def pad(values: list[str], count: int, numeric: bool) -> list[float | str | None]:
    """将扩展字段对齐到航点数量；缺失字段保留为空。"""

    output: list[float | str | None] = []
    for index in range(count):
        if index >= len(values):
            output.append(None)
        elif numeric:
            output.append(text_to_float(values[index]))
        else:
            output.append(values[index])
    return output


def parse_kml(kml_file: Path) -> ParsedRoute:
    """解析单个 KML 文件，优先使用 Point 航点，缺失时回退 LineString。"""

    text = kml_file.read_text(encoding="utf-8-sig", errors="replace")
    root = ET.fromstring(text)
    point_coordinates = collect_geometry_coordinates(root, "Point")
    line_coordinates = collect_geometry_coordinates(root, "LineString")
    coordinates = point_coordinates or line_coordinates
    geometry_used = "Point" if point_coordinates else "LineString"

    speed_values = pad(collect_tag_values(root, "speed"), len(coordinates), numeric=True)
    heading_values = pad(collect_tag_values(root, "heading"), len(coordinates), numeric=True)
    gimbal_values = pad(collect_tag_values(root, "gimbalPitch"), len(coordinates), numeric=True)
    turn_values = pad(collect_tag_values(root, "turnMode"), len(coordinates), numeric=False)

    route_id = make_route_id(kml_file)
    waypoints: list[dict[str, object]] = []
    for index, coordinate in enumerate(coordinates):
        waypoints.append(
            {
                "waypoint_id": f"{route_id}_wp_{index + 1:04d}",
                "route_id": route_id,
                "sequence": index + 1,
                "longitude": coordinate[0],
                "latitude": coordinate[1],
                "altitude": coordinate[2],
                "speed": speed_values[index],
                "heading": heading_values[index],
                "gimbal_pitch": gimbal_values[index],
                "turn_mode": turn_values[index],
                "source_file": kml_file.name,
            }
        )

    altitudes = [item["altitude"] for item in waypoints if item["altitude"] is not None]
    headings = [item["heading"] for item in waypoints]
    points = [(float(item["longitude"]), float(item["latitude"])) for item in waypoints]
    segments = route_segment_distances(points)
    centroid_lon = sum(point[0] for point in points) / len(points) if points else None
    centroid_lat = sum(point[1] for point in points) / len(points) if points else None
    route_radius = None
    if centroid_lon is not None and centroid_lat is not None:
        route_radius = max(haversine_m(centroid_lon, centroid_lat, point[0], point[1]) for point in points)

    route = {
        "route_id": route_id,
        "route_name": kml_file.stem,
        "kml_file": kml_file.name,
        "geometry_used": geometry_used,
        "waypoint_count": len(waypoints),
        "total_length": sum(segments),
        "mean_segment_distance": sum(segments) / len(segments) if segments else None,
        "max_segment_distance": max(segments) if segments else None,
        "min_height": min(altitudes) if altitudes else None,
        "max_height": max(altitudes) if altitudes else None,
        "avg_height": sum(altitudes) / len(altitudes) if altitudes else None,
        "avg_speed": _mean([item["speed"] for item in waypoints]),
        "heading_change": total_heading_change(headings),  # type: ignore[arg-type]
        "route_radius": route_radius,
        "route_type_guess": classify_route(len(waypoints), sum(segments), route_radius),
        "source_file": kml_file.name,
    }
    return ParsedRoute(route=route, waypoints=waypoints)


def classify_route(waypoint_count: int, total_length_m: float, route_radius_m: float | None) -> str:
    """规则化航线类型推断；结果必须在报告/界面标记为推断。"""

    if waypoint_count <= 35 and route_radius_m is not None and route_radius_m <= 80:
        return "单塔巡检（推断）"
    if total_length_m <= 1500:
        return "局部巡检（推断）"
    return "线路巡检候选（待验证）"


def routes_to_frames(kml_files: list[Path]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """批量解析 KML，返回 routes 和 route_waypoints 两张标准表。"""

    routes: list[dict[str, object]] = []
    waypoints: list[dict[str, object]] = []
    for kml_file in kml_files:
        parsed = parse_kml(kml_file)
        routes.append(parsed.route)
        waypoints.extend(parsed.waypoints)
    return pd.DataFrame(routes), pd.DataFrame(waypoints)


def _mean(values: list[object]) -> float | None:
    numbers = [float(value) for value in values if value is not None and not (isinstance(value, float) and math.isnan(value))]
    return sum(numbers) / len(numbers) if numbers else None

