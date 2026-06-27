"""坐标与航线指标计算工具。

本模块只做可复现的基础几何计算，不引入地形、通信覆盖或风险假设。
"""

from __future__ import annotations

import math
from collections.abc import Sequence


EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """使用 Haversine 公式计算两点之间的近似球面距离，单位为米。"""

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def route_segment_distances(points: Sequence[tuple[float, float]]) -> list[float]:
    """计算连续航点之间的距离序列，输入顺序为 (longitude, latitude)。"""

    distances: list[float] = []
    for first, second in zip(points, points[1:]):
        distances.append(haversine_m(first[0], first[1], second[0], second[1]))
    return distances


def normalize_angle_delta(delta: float) -> float:
    """将航向角差值规整到 [-180, 180]，避免 359 到 1 度被误算为 358 度。"""

    return (delta + 180) % 360 - 180


def total_heading_change(headings: Sequence[float | None]) -> float | None:
    """计算航向累计变化量；全部缺失时返回 None。"""

    valid = [value for value in headings if value is not None and not math.isnan(value)]
    if len(valid) < 2:
        return None
    return sum(abs(normalize_angle_delta(b - a)) for a, b in zip(valid, valid[1:]))

