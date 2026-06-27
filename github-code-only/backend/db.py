"""SQLite 数据库导入与查询工具。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
DB_PATH = PROCESSED_DIR / "inspection.sqlite"

TABLES = [
    "towers",
    "lines",
    "airports",
    "base_stations",
    "flight_tasks",
    "routes",
    "route_waypoints",
    "route_tower_matches",
    "data_quality_issues",
    "coordinate_backfill_template",
    "coordinate_backfill_validation",
]


def ensure_database() -> Path:
    """将 data/processed CSV 导入 SQLite；不会写入 raw 原始数据。"""

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        for table in TABLES:
            csv_path = PROCESSED_DIR / f"{table}.csv"
            if not csv_path.exists():
                continue
            frame = pd.read_csv(csv_path)
            frame.to_sql(table, conn, if_exists="replace", index=False)
    return DB_PATH


def query_table(table: str, limit: int = 5000, **filters: str | None) -> list[dict[str, object]]:
    """查询标准表，支持少量文本模糊过滤。"""

    if table not in TABLES:
        raise ValueError(f"不支持的表：{table}")

    clauses: list[str] = []
    params: list[object] = []
    for key, value in filters.items():
        if value is None or value == "":
            continue
        clauses.append(f"{key} LIKE ?")
        params.append(f"%{value}%")

    sql = f"SELECT * FROM {table}"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " LIMIT ?"
    params.append(limit)

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]
