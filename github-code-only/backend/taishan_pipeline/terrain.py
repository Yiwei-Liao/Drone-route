"""DEM/DSM 地形接口预留。

当前仓库没有真实 DEM/DSM 数据，因此本模块不会返回伪造高程。
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class TerrainSample:
    """地形采样结果。"""

    longitude: float
    latitude: float
    elevation_m: float | None
    agl_m: float | None
    status: str


class TerrainSampler:
    """DEM/DSM 采样器接口；后续可替换为 GeoTIFF/HGT 实现。"""

    def __init__(self, dem_dir: Path) -> None:
        self.dem_dir = dem_dir

    def sample(self, longitude: float, latitude: float, altitude_m: float | None = None) -> TerrainSample:
        """输入经纬度和无人机高度，输出地形高程和 AGL；缺 DEM 时返回明确状态。"""

        _ = altitude_m
        return TerrainSample(
            longitude=longitude,
            latitude=latitude,
            elevation_m=None,
            agl_m=None,
            status=f"DEM not provided: {self.dem_dir}",
        )

