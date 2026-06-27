# 数据导入接口说明

本文档说明未来新增数据的暂存导入接口。该接口用于把新 Excel、KML、DEM/DSM、通信参数或无人机参数文件上传到项目工作区，但不会自动覆盖原始数据，也不会自动生成新的分析结论。

## 设计原则

1. 上传文件只进入 `data/raw/imports/<batch_id>/` 暂存区。
2. 每次上传都会生成 `import_manifest.json`，记录文件名、大小、SHA-256、类别和后续处理建议。
3. 暂存文件不会自动进入 `data/processed/`，也不会自动改变前端展示结果。
4. 人工确认字段含义、坐标规范、单位和来源后，才能把文件放入正式 `data/raw/*` 目录并重新运行数据管线。
5. DEM/DSM、通信参数和无人机参数只做暂存；在没有正式管线前，不输出真实地形、通信覆盖或能耗结论。

## 支持类别

| category | 用途 | 支持扩展名 | 人工确认后的正式目录 |
|---|---|---|---|
| `tasks` | 巡检任务统计表 | `.xlsx`, `.xls`, `.csv` | `data/raw/tasks/` |
| `ledger` | 线路台账/杆塔台账 | `.xlsx`, `.xls`, `.csv` | `data/raw/ledger/` |
| `kml` | DJI KML/KMZ 航线 | `.kml`, `.kmz` | `data/raw/kml/` |
| `dem` | 本地 DEM/DSM 地形 | `.tif`, `.tiff`, `.hgt`, `.asc`, `.vrt`, `.img`, `.zip` | `data/raw/dem/` |
| `communication` | 通信基站/链路参数 | `.csv`, `.xlsx`, `.xls`, `.json` | `data/raw/communication/` |
| `uav_models` | 无人机型号/能耗参数 | `.csv`, `.xlsx`, `.xls`, `.json` | `data/raw/uav_models/` |

## API

查看导入规则：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/schema"
```

## 立即增加 KML 航线

如果目标是把新的 `.kml` 直接加入当前可视化航线，使用：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_kml_routes.ps1 `
  -FilePath "H:\new_data\route_001.kml" `
  -Note "新增航线，待核对线路和杆号"
```

该命令调用 `POST /api/import/kml-routes`，会执行以下操作：

1. 把 KML 新增到 `data/raw/kml/`，如果同名则自动生成不覆盖的文件名。
2. 运行现有标准化数据管线。
3. 重建 `data/processed/inspection.sqlite`。
4. 让 `/api/routes`、`/api/metrics`、`/api/geojson/routes` 和前端航线列表读取到新增航线。

如果 KML 无法解析，接口会删除本次刚上传的文件，并尝试恢复原有 processed 数据。

接口示例：

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/import/kml-routes" `
  -F "note=新增航线" `
  -F "files=@H:\new_data\route_001.kml"
```

当前立即导入只支持 `.kml`，不支持 `.kmz` 自动解压。

## 暂存未来数据

上传文件到暂存区：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 `
  -Category kml `
  -FilePath "H:\new_data\route_001.kml" `
  -Note "新增航线，待核对线路和杆号"
```

上传多个文件：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 `
  -Category kml `
  -FilePath "H:\new_data\route_001.kml","H:\new_data\route_002.kml" `
  -Note "同一批 KML 航线"
```

查看已暂存批次：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/batches"
```

查看某个批次 manifest：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/batches/<batch_id>"
```

## 人工确认后进入正式管线

暂存上传完成后，请先查看 `data/raw/imports/<batch_id>/import_manifest.json`。确认文件来源、字段含义、坐标顺序和单位后，再把可接受的文件放入对应正式目录。

示例：确认 KML 后放入正式目录并重新处理。

```powershell
cd "H:\drone signal taishan"
New-Item -ItemType Directory -Force -Path ".\data\raw\kml" | Out-Null
Copy-Item -LiteralPath ".\data\raw\imports\<batch_id>\route_001.kml" -Destination ".\data\raw\kml\"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_data_pipeline.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1 -RunBrowser
```

如果导入 DEM/DSM，当前只是保存文件。后续还需要实现地形采样管线，才能把 DEM/DSM 用于工程高程、剖面和通信遮挡分析。

## 边界

1. 导入接口不覆盖已有原始数据。
2. 导入接口不自动更新 SQLite、GeoJSON 或前端图层。
3. 导入接口不推断字段含义。
4. 导入接口不把 DEM/DSM 变成项目高程源，除非后续实现并验证地形管线。
5. 导入接口不生成真实通信覆盖、最大通信半径或无人机能耗结论。
