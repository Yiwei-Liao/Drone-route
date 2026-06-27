"""FastAPI 后端：提供杆塔、线路、航线、任务、指标和风险 API。"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.db import PROJECT_ROOT, ensure_database, query_table
from backend.taishan_pipeline.communication import check_link_distance
from backend.taishan_pipeline.imports import (
    StagedFile,
    create_manifest,
    get_import_root,
    get_import_schema,
    list_import_batches,
    make_stored_filename,
    new_batch_id,
    read_import_manifest,
    validate_category,
    validate_extension,
)
from backend.taishan_pipeline.process_data import run_pipeline
from backend.taishan_pipeline.terrain import TerrainSampler


app = FastAPI(title="泰安区域无人机巡检仿真原型 API")
terrain_sampler = TerrainSampler(PROJECT_ROOT / "data" / "raw" / "dem")
ARCGIS_TOPO_TILE_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


DISPLAY_TILE_CACHE_SECONDS = _int_env("TAISHAN_TILE_CACHE_SECONDS", 86400)
IMPORT_MAX_FILE_BYTES = _int_env("TAISHAN_IMPORT_MAX_FILE_MB", 500) * 1024 * 1024
TRANSPARENT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    """启动时确保 SQLite 可用。"""

    ensure_database()


@app.get("/api/towers")
def get_towers(
    line_name: Annotated[str | None, Query(description="线路名称过滤")] = None,
    tower_no: Annotated[str | None, Query(description="杆号过滤")] = None,
) -> list[dict[str, object]]:
    return query_table("towers", line_name=line_name, tower_no=tower_no)


@app.get("/api/lines")
def get_lines(line_name: str | None = None) -> list[dict[str, object]]:
    return query_table("lines", line_name=line_name)


@app.get("/api/routes")
def get_routes(kml_file: str | None = None) -> list[dict[str, object]]:
    return query_table("routes", kml_file=kml_file)


@app.get("/api/tasks")
def get_tasks(line_name: str | None = None, tower_no: str | None = None) -> list[dict[str, object]]:
    return query_table("flight_tasks", limit=2000, line_name=line_name, tower_no=tower_no)


@app.get("/api/metrics")
def get_metrics() -> list[dict[str, object]]:
    routes = query_table("routes")
    matches = {row["route_id"]: row for row in query_table("route_tower_matches") if row.get("route_id")}
    output = []
    for route in routes:
        output.append({**route, "tower_match": matches.get(route.get("route_id"))})
    return output


@app.get("/api/manifest")
def get_manifest() -> dict[str, object]:
    """Return the latest processed-data manifest."""

    path = PROJECT_ROOT / "data" / "processed" / "manifest.json"
    if not path.exists():
        return {"status": "not_generated", "message": "请先运行 scripts/run_data_pipeline.ps1"}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/import/schema")
def get_data_import_schema() -> dict[str, object]:
    """Return supported future-data import categories and staging rules."""

    return get_import_schema(PROJECT_ROOT)


@app.get("/api/import/batches")
def get_data_import_batches() -> list[dict[str, object]]:
    """List staged import batches. Staged files are not processed automatically."""

    return list_import_batches(PROJECT_ROOT)


@app.get("/api/import/batches/{batch_id}")
def get_data_import_batch(batch_id: str) -> dict[str, object]:
    """Return one staged import manifest."""

    try:
        return read_import_manifest(PROJECT_ROOT, batch_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="import batch not found") from exc


@app.post("/api/import/files")
async def stage_data_import_files(
    category: Annotated[str, Form(description="Import category, such as tasks, ledger, kml, dem")],
    files: Annotated[list[UploadFile], File(description="One or more files to stage for review")],
    note: Annotated[str | None, Form(description="Optional operator note")] = None,
) -> dict[str, object]:
    """Stage future input files without replacing canonical raw data.

    The route is for future data ingestion workflows. It saves uploads under
    data/raw/imports/<batch_id>/ and writes a manifest, but it does not update
    data/processed or draw conclusions from the uploaded files.
    """

    try:
        validate_category(category)
        for upload in files:
            validate_extension(category, upload.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not files:
        raise HTTPException(status_code=400, detail="at least one file is required")

    batch_id = new_batch_id()
    batch_dir = get_import_root(PROJECT_ROOT) / batch_id
    batch_dir.mkdir(parents=True, exist_ok=False)

    used_names: set[str] = set()
    staged_files: list[StagedFile] = []
    for upload in files:
        original_filename = upload.filename or "upload.bin"
        extension = validate_extension(category, original_filename)
        stored_filename = make_stored_filename(original_filename, used_names)
        destination = batch_dir / stored_filename
        digest = hashlib.sha256()
        size = 0
        try:
            with destination.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > IMPORT_MAX_FILE_BYTES:
                        destination.unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=413,
                            detail=f"file exceeds TAISHAN_IMPORT_MAX_FILE_MB limit: {original_filename}",
                        )
                    digest.update(chunk)
                    handle.write(chunk)
        finally:
            await upload.close()

        if size <= 0:
            destination.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=f"empty upload is not allowed: {original_filename}")

        staged_files.append(
            StagedFile(
                original_filename=original_filename,
                stored_filename=stored_filename,
                relative_path=str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                bytes=size,
                sha256=digest.hexdigest(),
                extension=extension,
            )
        )

    manifest = create_manifest(
        project_root=PROJECT_ROOT,
        batch_id=batch_id,
        category=category,
        note=note,
        files=staged_files,
    )
    return {
        "status": "staged_for_review",
        "batch_id": batch_id,
        "category": category,
        "file_count": len(staged_files),
        "manifest": manifest,
    }


@app.post("/api/import/kml-routes")
async def import_kml_routes(
    files: Annotated[list[UploadFile], File(description="One or more .kml files to add as routes")],
    note: Annotated[str | None, Form(description="Optional operator note")] = None,
) -> dict[str, object]:
    """Add KML files to the canonical KML folder and rebuild processed route data.

    This endpoint is intentionally limited to KML route imports. It never
    overwrites an existing KML file. If the processing pipeline rejects the new
    file, the uploaded file is removed again so the project is not left with a
    broken canonical input.
    """

    if not files:
        raise HTTPException(status_code=400, detail="at least one KML file is required")
    for upload in files:
        extension = validate_extension("kml", upload.filename or "")
        if extension != ".kml":
            raise HTTPException(status_code=400, detail="active route import currently supports .kml only")

    kml_dir = PROJECT_ROOT / "data" / "raw" / "kml"
    kml_dir.mkdir(parents=True, exist_ok=True)
    used_names = {path.name.lower() for path in kml_dir.glob("*")}
    imported_files: list[StagedFile] = []
    written_paths: list[Path] = []

    try:
        for upload in files:
            original_filename = upload.filename or "route.kml"
            stored_filename = make_stored_filename(original_filename, used_names)
            destination = kml_dir / stored_filename
            digest = hashlib.sha256()
            size = 0
            try:
                with destination.open("wb") as handle:
                    while True:
                        chunk = await upload.read(1024 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > IMPORT_MAX_FILE_BYTES:
                            destination.unlink(missing_ok=True)
                            raise HTTPException(
                                status_code=413,
                                detail=f"file exceeds TAISHAN_IMPORT_MAX_FILE_MB limit: {original_filename}",
                            )
                        digest.update(chunk)
                        handle.write(chunk)
            finally:
                await upload.close()

            if size <= 0:
                destination.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=f"empty upload is not allowed: {original_filename}")

            written_paths.append(destination)
            imported_files.append(
                StagedFile(
                    original_filename=original_filename,
                    stored_filename=stored_filename,
                    relative_path=str(destination.relative_to(PROJECT_ROOT)).replace("\\", "/"),
                    bytes=size,
                    sha256=digest.hexdigest(),
                    extension=".kml",
                )
            )

        run_pipeline(PROJECT_ROOT)
        ensure_database()
        manifest = get_manifest()
        return {
            "status": "imported_and_processed",
            "category": "kml",
            "note": note or "",
            "file_count": len(imported_files),
            "files": [file.__dict__ for file in imported_files],
            "row_counts": manifest.get("row_counts", {}),
            "message": "KML files were added without overwriting existing raw files; processed route data has been rebuilt.",
        }
    except HTTPException:
        for path in written_paths:
            path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        for path in written_paths:
            path.unlink(missing_ok=True)
        try:
            run_pipeline(PROJECT_ROOT)
            ensure_database()
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"KML import failed and uploaded files were removed: {exc}") from exc


@app.get("/api/tiles/arcgis-topo/{z}/{y}/{x}")
def get_arcgis_topo_tile(z: int, y: int, x: int) -> Response:
    """Display-only public basemap tile proxy for Cesium WebGL imagery."""

    if z < 0 or z > 19:
        raise HTTPException(status_code=400, detail="unsupported tile zoom")
    tile_count = 2**z
    if x < 0 or x >= tile_count or y < 0 or y >= tile_count:
        raise HTTPException(status_code=400, detail="tile coordinate out of range")

    url = ARCGIS_TOPO_TILE_URL.format(z=z, y=y, x=x)
    request = urllib.request.Request(url, headers={"User-Agent": "taishan-drone-visualization/0.1"})
    tile_ok = True
    try:
        with urllib.request.urlopen(request, timeout=10) as remote:
            content = remote.read()
            media_type = remote.headers.get_content_type() or "image/png"
    except urllib.error.HTTPError as exc:
        content = TRANSPARENT_PNG
        media_type = "image/png"
        tile_ok = False
    except urllib.error.URLError as exc:
        content = TRANSPARENT_PNG
        media_type = "image/png"
        tile_ok = False
    if not media_type.startswith("image/"):
        content = TRANSPARENT_PNG
        media_type = "image/png"
        tile_ok = False

    cache_control = (
        f"public, max-age={DISPLAY_TILE_CACHE_SECONDS}, stale-while-revalidate=86400"
        if tile_ok and DISPLAY_TILE_CACHE_SECONDS > 0
        else "no-store"
    )
    tile_status = "display-only-browser-cache" if tile_ok and DISPLAY_TILE_CACHE_SECONDS > 0 else "display-only-no-cache"

    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Cache-Control": cache_control,
            "X-Taishan-Tile-Use": f"{tile_status}-no-terrain-extraction",
        },
    )


@app.get("/api/risk")
def get_risk() -> dict[str, object]:
    """基础规则风险评分；只做数据探索，不代表真实安全评估。"""

    tasks = query_table("flight_tasks", limit=5000)
    towers = query_table("towers", limit=5000)
    routes = query_table("routes", limit=5000)
    matches = query_table("route_tower_matches", limit=5000)
    risks = []

    for task in tasks:
        score = 0
        reasons = []
        battery = _to_float(task.get("battery_remaining"))
        wind_speed = _to_float(task.get("wind_speed"))
        distance = _to_float(task.get("flight_distance"))
        height = _to_float(task.get("flight_height"))

        if battery is not None and battery < 45:
            score += 2
            reasons.append("电池余量偏低（按原表 V 字段经验阈值）")
        if wind_speed is not None and wind_speed >= 8:
            score += 2
            reasons.append("风速偏大")
        if distance is not None and distance >= 8:
            score += 1
            reasons.append("航程偏长（原字段单位待确认）")
        if height is not None and (height < 30 or height > 350):
            score += 1
            reasons.append("航线设定高度异常候选")
        if reasons:
            risks.append(
                {
                    "entity_type": "task",
                    "entity_id": task.get("task_id"),
                    "score": score,
                    "level": _risk_level(score),
                    "reasons": reasons,
                }
            )

    for tower in towers:
        airport_distance = _to_float(tower.get("distance_to_airport"))
        if airport_distance is not None and airport_distance > 5000:
            risks.append(
                {
                    "entity_type": "tower",
                    "entity_id": tower.get("tower_id"),
                    "score": 1,
                    "level": "low",
                    "reasons": ["与机场距离偏远候选（原字段单位待确认）"],
                }
            )

    for match in matches:
        if match.get("match_confidence") == "low":
            risks.append(
                {
                    "entity_type": "route",
                    "entity_id": match.get("route_id"),
                    "score": 2,
                    "level": "medium",
                    "reasons": ["与杆塔匹配异常或置信度低"],
                }
            )

    for route in routes:
        min_height = _to_float(route.get("min_height"))
        max_height = _to_float(route.get("max_height"))
        if min_height is not None and max_height is not None and (min_height < 10 or max_height > 1000):
            risks.append(
                {
                    "entity_type": "route",
                    "entity_id": route.get("route_id"),
                    "score": 1,
                    "level": "low",
                    "reasons": ["KML 高度范围异常候选，高度含义待确认"],
                }
            )

    return {"risk_model": "rule_based_prototype_not_safety_assessment", "items": risks[:500]}


@app.get("/api/data-quality")
def get_data_quality() -> dict[str, object]:
    """返回结构化数据质量报告。"""

    path = PROJECT_ROOT / "output" / "data_quality_report.json"
    if not path.exists():
        return {"status": "not_generated", "message": "请先运行 scripts/run_data_pipeline.ps1"}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/data-quality/issues")
def get_data_quality_issues() -> list[dict[str, object]]:
    """返回数据质量问题明细。"""

    return query_table("data_quality_issues", limit=5000)


@app.get("/api/data-quality/coordinate-backfill-template")
def get_coordinate_backfill_template() -> list[dict[str, object]]:
    """Return manual coordinate backfill rows for missing-coordinate issues."""

    return query_table("coordinate_backfill_template", limit=5000)


@app.get("/api/data-quality/coordinate-backfill-validation")
def get_coordinate_backfill_validation() -> list[dict[str, object]]:
    """Return validation rows for the manual coordinate backfill template."""

    return query_table("coordinate_backfill_validation", limit=5000)


@app.get("/api/data-quality/coordinate-backfill-validation-report")
def get_coordinate_backfill_validation_report() -> dict[str, object]:
    """Return validation summary for the manual coordinate backfill template."""

    path = PROJECT_ROOT / "output" / "coordinate_backfill_validation_report.json"
    if not path.exists():
        return {"status": "not_generated", "message": "Please run scripts/run_data_pipeline.ps1 first"}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/geojson/{name}")
def get_geojson(name: str) -> dict[str, object]:
    """读取阶段 2 生成的 GeoJSON，供前端地图使用。"""

    allowed = {"towers", "lines", "routes", "route_waypoints", "base_stations"}
    if name not in allowed:
        return {"type": "FeatureCollection", "features": []}
    path = PROJECT_ROOT / "data" / "processed" / f"{name}.geojson"
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/terrain/sample")
def sample_terrain(longitude: float, latitude: float, altitude_m: float | None = None) -> dict[str, object]:
    """DEM/DSM 接口预留：当前无 DEM 时明确返回 DEM not provided。"""

    return terrain_sampler.sample(longitude, latitude, altitude_m).__dict__


@app.get("/api/communication/check")
def check_communication(
    waypoint_longitude: float,
    waypoint_latitude: float,
    station_longitude: float,
    station_latitude: float,
    threshold_m: float = 5000,
) -> dict[str, object]:
    """通信距离接口预留：只返回直线距离和是否需视距分析。"""

    return check_link_distance(
        waypoint_longitude,
        waypoint_latitude,
        station_longitude,
        station_latitude,
        threshold_m,
    ).__dict__


def _to_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _risk_level(score: int) -> str:
    if score >= 4:
        return "high"
    if score >= 2:
        return "medium"
    return "low"
