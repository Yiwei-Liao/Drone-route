"""Excel 原始表读取与标准表转换。"""

from __future__ import annotations

import re
from pathlib import Path

import pandas as pd


def read_raw_excel(path: Path, sheet_name: str = "Sheet1") -> pd.DataFrame:
    """使用 pandas/openpyxl 读取 Excel，保留原始混合字段。"""

    return pd.read_excel(path, sheet_name=sheet_name, header=None, engine="openpyxl")


def to_number(value: object) -> float | None:
    """稳健转换数字字段，空值或异常值返回 None。"""

    if pd.isna(value) or str(value).strip() == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_text(value: object) -> str | None:
    """稳健转换中文/特殊符号字段，空字符串返回 None。"""

    if pd.isna(value):
        return None
    text = str(value).strip()
    return text if text else None


def normalize_tower_no(value: object) -> str | None:
    """统一杆号格式，#009 与 #9 会归一为 #9。"""

    text = to_text(value)
    if not text:
        return None
    match = re.search(r"#\s*0*(\d+)", text)
    if not match:
        return text
    return f"#{int(match.group(1))}"


def make_id(*parts: object) -> str:
    """生成稳定 ID，保留中文但清理不适合作文件/键值的符号。"""

    raw = "_".join(str(part) for part in parts if part is not None and str(part).strip())
    safe = re.sub(r"[^\w\u4e00-\u9fff]+", "_", raw, flags=re.UNICODE).strip("_")
    return safe or "unknown"


def split_task_tower(value: object) -> tuple[str | None, str | None]:
    """从任务表的“线路名#杆号”字段拆出线路名和杆号。"""

    text = to_text(value)
    if not text:
        return None, None
    match = re.match(r"^(.*?)(#\s*\d+.*)$", text)
    if not match:
        return None, normalize_tower_no(text)
    return match.group(1).strip() or None, normalize_tower_no(match.group(2))


def parse_lon_lat(value: object) -> tuple[float | None, float | None]:
    """解析“经度,纬度”格式的基站坐标。"""

    text = to_text(value)
    if not text or "," not in text:
        return None, None
    parts = text.split(",")
    if len(parts) < 2:
        return None, None
    return to_number(parts[0]), to_number(parts[1])


def read_towers(ledger_file: Path) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """读取线路台账，输出 towers 和 airports，并记录数据质量问题。"""

    raw = read_raw_excel(ledger_file)
    rows: list[dict[str, object]] = []
    airport_rows: dict[str, dict[str, object]] = {}
    warnings: list[str] = []
    current_line: str | None = None

    for index, row in raw.iloc[1:].iterrows():
        line_value = to_text(row.get(1))
        if line_value:
            current_line = line_value
        tower_no = normalize_tower_no(row.get(2))
        longitude = to_number(row.get(3))
        latitude = to_number(row.get(4))
        if not tower_no and longitude is None and latitude is None:
            continue

        if longitude is None or latitude is None:
            warnings.append(f"线路台账第 {index + 1} 行缺少有效经纬度：{current_line or 'unknown'} {tower_no or 'unknown'}")
        elif not (70 <= longitude <= 140 and 15 <= latitude <= 55):
            warnings.append(f"线路台账第 {index + 1} 行经纬度超出中国常见范围：{longitude}, {latitude}")

        airport_name = to_text(row.get(8))
        if airport_name and airport_name not in airport_rows:
            # 台账只有机场名称和距离，没有机场经纬度；坐标暂为空，避免伪造。
            airport_rows[airport_name] = {
                "airport_id": make_id("airport", airport_name),
                "airport_name": airport_name,
                "longitude": None,
                "latitude": None,
                "altitude": None,
                "source_file": ledger_file.name,
                "note": "台账未提供机场经纬度，待补充",
            }

        rows.append(
            {
                "tower_id": make_id(current_line, tower_no),
                "line_name": current_line,
                "tower_no": tower_no,
                "longitude": longitude,
                "latitude": latitude,
                "tower_height": to_number(row.get(5)),
                "span_large_side": to_number(row.get(6)),
                "span_small_side": to_number(row.get(7)),
                "airport_name": airport_name,
                "distance_to_airport": to_number(row.get(9)),
                "source_file": ledger_file.name,
                "source_row": int(index + 1),
            }
        )

    towers = pd.DataFrame(rows)
    duplicate_mask = towers.duplicated(["line_name", "tower_no"], keep=False)
    for _, duplicate in towers[duplicate_mask].iterrows():
        warnings.append(f"发现重复杆塔键：{duplicate.get('line_name')} {duplicate.get('tower_no')}")

    airports = pd.DataFrame(airport_rows.values())
    return towers, airports, warnings


def make_lines(towers: pd.DataFrame) -> pd.DataFrame:
    """由台账杆塔点汇总线路表；线路几何顺序暂按台账行顺序，需后续校核。"""

    rows: list[dict[str, object]] = []
    for line_name, group in towers.dropna(subset=["line_name"]).groupby("line_name", sort=False):
        valid = group.dropna(subset=["longitude", "latitude"])
        voltage_match = re.search(r"(\d+\s*kV)", str(line_name), flags=re.IGNORECASE)
        rows.append(
            {
                "line_id": make_id("line", line_name),
                "line_name": line_name,
                "voltage_level": voltage_match.group(1).replace(" ", "") if voltage_match else None,
                "tower_count": int(len(group)),
                "valid_coordinate_count": int(len(valid)),
                "geometry_source": "tower_order_in_ledger_pending_verification",
                "source_file": ";".join(sorted(group["source_file"].dropna().unique())),
            }
        )
    return pd.DataFrame(rows)


def read_flight_tasks(task_file: Path) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """读取巡检任务统计表，输出 flight_tasks 和 base_stations。"""

    raw = read_raw_excel(task_file)
    rows: list[dict[str, object]] = []
    stations: dict[str, dict[str, object]] = {}
    warnings: list[str] = ["任务表第 8、9 列原始表头同为运行日志开始时间，第 9 列暂按 end_time_raw_pending_confirm 处理。"]

    for index, row in raw.iloc[3:].iterrows():
        if row.isna().all():
            continue
        line_name, tower_no = split_task_tower(row.get(2))
        station_lon, station_lat = parse_lon_lat(row.get(19))
        station_id = to_text(row.get(18))
        if station_id:
            stations.setdefault(
                station_id,
                {
                    "station_id": station_id,
                    "station_name": station_id,
                    "longitude": station_lon,
                    "latitude": station_lat,
                    "altitude": to_number(row.get(20)),
                    "source_file": task_file.name,
                },
            )

        rows.append(
            {
                "task_id": to_text(row.get(4)) or make_id("task", index + 1),
                "route_file_hint": to_text(row.get(1)),
                "line_name": line_name,
                "tower_no": tower_no,
                "tower_full_name": to_text(row.get(2)),
                "uav_model": to_text(row.get(3)),
                "sortie_id": to_text(row.get(4)),
                "route_id_raw": to_text(row.get(6)),
                "flight_height": to_number(row.get(5)),
                "start_time_raw": to_text(row.get(7)),
                "end_time_raw_pending_confirm": to_text(row.get(8)),
                "temperature": to_number(row.get(9)),
                "humidity": to_number(row.get(10)),
                "pressure": to_number(row.get(11)),
                "wind_speed": to_number(row.get(12)),
                "wind_direction": to_text(row.get(13)),
                "rainfall": to_number(row.get(14)),
                "duration": to_number(row.get(15)),
                "flight_distance": to_number(row.get(16)),
                "battery_remaining": to_number(row.get(17)),
                "station_id": station_id,
                "station_longitude": station_lon,
                "station_latitude": station_lat,
                "station_altitude": to_number(row.get(20)),
                "source_file": task_file.name,
                "source_row": int(index + 1),
            }
        )

    tasks = pd.DataFrame(rows)
    missing_pressure = int(tasks["pressure"].isna().sum()) if "pressure" in tasks else 0
    missing_battery = int(tasks["battery_remaining"].isna().sum()) if "battery_remaining" in tasks else 0
    warnings.append(f"任务表气压缺失 {missing_pressure} 行。")
    warnings.append(f"任务表电池余量缺失 {missing_battery} 行；原字段名为电池电量（V），单位需确认。")
    return tasks, pd.DataFrame(stations.values()), warnings

