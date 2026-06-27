"""通信链路基础接口。

当前只计算航点到基站的直线距离和阈值提示，不推断真实覆盖质量。
"""

from __future__ import annotations

from dataclasses import dataclass

from .geometry import haversine_m


@dataclass(frozen=True)
class LinkCheck:
    """通信链路距离检查结果。"""

    waypoint_longitude: float
    waypoint_latitude: float
    station_longitude: float
    station_latitude: float
    distance_m: float
    threshold_m: float
    exceeds_threshold: bool
    needs_los_analysis: bool
    status: str


def check_link_distance(
    waypoint_longitude: float,
    waypoint_latitude: float,
    station_longitude: float,
    station_latitude: float,
    threshold_m: float = 5_000,
) -> LinkCheck:
    """计算航点到基站距离；是否可通信需要地形、天线和链路预算进一步分析。"""

    distance = haversine_m(waypoint_longitude, waypoint_latitude, station_longitude, station_latitude)
    exceeds = distance > threshold_m
    return LinkCheck(
        waypoint_longitude=waypoint_longitude,
        waypoint_latitude=waypoint_latitude,
        station_longitude=station_longitude,
        station_latitude=station_latitude,
        distance_m=distance,
        threshold_m=threshold_m,
        exceeds_threshold=exceeds,
        needs_los_analysis=True,
        status="distance-only; coverage not inferred",
    )

