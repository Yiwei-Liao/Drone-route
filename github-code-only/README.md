# 泰安区域无人机巡检仿真原型项目

## 项目简介

本项目用于构建泰安区域无人机巡检仿真与可视化原型。项目基于巡检任务统计表、线路台账中的杆塔经纬度、DJI KML 航线文件，逐步实现数据清点、航线解析、杆塔匹配、仿真指标计算、地图可视化和后续地形/通信增强接口。

当前项目定位为“可验证的工程原型”，不是一次性完成高保真三维数字孪生。

## 推荐目录结构

```text
taian-uav-inspection-sim/
├── AGENTS.md
├── README.md
├── data/
│   ├── raw/
│   │   ├── tasks/
│   │   │   └── 泰安巡检任务统计.xlsx
│   │   ├── ledger/
│   │   │   └── 线路台账（科技项目数据收集）.xlsx
│   │   ├── kml/
│   │   │   ├── 35kV(东平)35kV驻张线(东平)35kV驻张线#12.kml
│   │   │   ├── 35kV35kV中天Ⅰ线35kV中天Ⅰ线#092.kml
│   │   │   └── 220kV220kV金山线220kV金山线#009.kml
│   │   └── dem/
│   │       └── README.md
│   └── processed/
├── docs/
│   ├── project_background.md
│   ├── data_schema.md
│   ├── stage_plan.md
│   └── assumptions_and_limits.md
├── matlab/
├── backend/
├── frontend/
├── notebooks/
└── output/
```

## 输入文件

### 必须输入

1. 巡检任务统计表  
   位置：`data/raw/tasks/`

2. 线路台账  
   位置：`data/raw/ledger/`

3. KML 航线文件  
   位置：`data/raw/kml/`

### 当前仓库数据状态

当前仓库中的原始文件实际位于 `raw/` 目录。阶段 0 清点脚本会优先扫描规范目录
`data/raw/tasks/`、`data/raw/ledger/`、`data/raw/kml/`；如果规范目录为空，会只读回退扫描
现有 `raw/`，并在 `docs/data_inventory.md` 中记录该目录偏差。

### 后续可选输入

1. DEM/DSM 地形数据  
   位置：`data/raw/dem/`

2. 通信基站参数  
   后续可放入 `data/raw/communication/`

3. 无人机型号参数  
   后续可放入 `data/raw/uav_models/`

## 阶段目标

### 阶段 0：数据清点

目标是扫描原始数据，识别 Excel 字段、KML 航点和可用属性，生成 `docs/data_inventory.md`。

运行命令：

```powershell
python .\scripts\inventory_data.py
```

输出文件：

- `docs/data_inventory.md`

验证命令：

```powershell
python -m py_compile .\scripts\inventory_data.py
```

### 阶段 1：MATLAB 仿真验证

目标是用 MATLAB 快速验证航线解析、杆塔匹配、航线长度计算和地图绘制逻辑。

运行命令：

```matlab
run("matlab/main.m")
```

输出文件：

- `matlab/output/route_metrics.csv`
- `matlab/output/route_tower_matching.csv`
- `matlab/output/inspection_map.png`
- `matlab/output/stage1_summary.md`

说明：当前 MATLAB 脚本同样优先读取 `data/raw/` 规范目录；如果规范目录为空，会只读回退读取现有 `raw/`。

### 阶段 2：Python 数据标准化

目标是把验证过的逻辑迁移到 Python，输出标准化 CSV 和 GeoJSON。

### 阶段 3：Web/GIS 可视化

目标是用 FastAPI + React + CesiumJS 搭建三维低空数字沙盘原型。

### 阶段 4：地形与通信增强

目标是预留 DEM/DSM 和通信链路接口，不在缺少数据时虚构结果。

## 给 Codex 的推荐启动指令

```text
请先阅读 AGENTS.md、README.md 和 docs/project_background.md，并扫描 data/raw 目录。不要写代码，先给出你理解的项目目标、输入文件、阶段计划和你发现的数据风险。
```

确认理解正确后，再使用 Goal mode 执行 `docs/stage_plan.md` 中的阶段任务。

## 关键原则

1. 原始数据只读，不覆盖。
2. 先验证数据，再做界面。
3. 先做 MATLAB/Python 计算，再做 Web 展示。
4. 不虚构地形。
5. 不虚构通信覆盖。
6. 不默认 KML 是完整巡线航迹。
7. 不把无法解析的字段写成已解析。
8. 所有推断结论必须标记为“推断”或“需验证”。

## 当前限制

当前缺少真实 DEM/DSM 数据、通信参数和无人机动力学参数，因此第一版只能做数据驱动的区域巡检仿真原型，不能作为严格飞行安全评估或高保真数字孪生结果。

## 安装依赖

阶段 2 Python 数据管线需要 pandas、openpyxl 和 pytest：

```powershell
python -m pip install -r .\requirements.txt
```

## 阶段 2：Python 数据标准化

运行命令：

```powershell
python .\scripts\process_data.py
```

输出文件：

- `data/processed/towers.csv`
- `data/processed/lines.csv`
- `data/processed/airports.csv`
- `data/processed/base_stations.csv`
- `data/processed/flight_tasks.csv`
- `data/processed/routes.csv`
- `data/processed/route_waypoints.csv`
- `data/processed/route_tower_matches.csv`
- `data/processed/*.geojson`
- `data/processed/manifest.json`
- `output/data_pipeline_log.json`

测试命令：

```powershell
python -m pytest -q
```

说明：阶段 2 会优先读取 `data/raw/` 规范目录；如果规范目录未放入完整原始文件，会只读回退扫描当前 `raw/` 目录。

## 阶段 3：Web/GIS 可视化原型

后端使用 FastAPI，启动前请先运行阶段 2 管线生成 `data/processed/` 文件。

启动后端：

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

后端 API：

- `http://127.0.0.1:8000/api/towers`
- `http://127.0.0.1:8000/api/lines`
- `http://127.0.0.1:8000/api/routes`
- `http://127.0.0.1:8000/api/tasks`
- `http://127.0.0.1:8000/api/metrics`
- `http://127.0.0.1:8000/api/risk`

前端使用 React + CesiumJS 三维地图，代码通过 `/api/geojson/*` 和 `/api/metrics` 读取标准空间数据。默认不依赖 Google API key；没有 3D Tiles key 时使用 Cesium 椭球基础场景，并显示提示。

安装并启动前端：

```powershell
cd frontend
npm install
copy .env.example .env
npm run dev -- --port 5173
```

访问页面：

```text
http://127.0.0.1:5173
```

构建验证：

```powershell
cd frontend
npm run build
```

可选环境变量见 `frontend/.env.example`：

- `VITE_API_BASE`：后端 API 地址，默认 `http://127.0.0.1:8000`。
- `VITE_CESIUM_ION_TOKEN`：Cesium Ion token，可为空。
- `VITE_USE_GOOGLE_3D_TILES`：是否尝试加载 Google Photorealistic 3D Tiles，默认 `false`。
- `VITE_GOOGLE_MAPS_API_KEY`：Google 3D Tiles API key，可为空，不得提交真实 key。

三维页面能力：

- 杆塔以三维光柱和顶部发光点展示。
- KML 航线以三维发光线展示，包含起点、终点和航点。
- 基站/机场候选点以三维锥体展示；当前机场缺少真实坐标，因此实际展示的是任务表基站点。
- 支持线路/杆号筛选、图层开关、航线开关。
- 支持点击杆塔、航线、航点、基站查看属性。
- 当前 KML 无真实时间戳，因此页面已移除无人机飞行动画回放；航线只按真实解析航点展示。
- 选择某一条 KML 航线后，才显示该航线对应的半透明视距 / 菲涅尔走廊通信遮挡演示。

## 阶段 4：地形与通信增强预留

当前没有真实 DEM/DSM 数据，`backend/taishan_pipeline/terrain.py` 的 `TerrainSampler` 只返回 `DEM not provided`，不会生成虚假地形高程或 AGL。

通信接口位于 `backend/taishan_pipeline/communication.py`，当前只计算航点到基站直线距离和阈值提示，不推断真实通信覆盖。

预留 API：

- `http://127.0.0.1:8000/api/terrain/sample?longitude=117&latitude=36`
- `http://127.0.0.1:8000/api/communication/check?waypoint_longitude=117&waypoint_latitude=36&station_longitude=117.1&station_latitude=36.1`

## 三维可视化调试补充

当前三维页面地址：

```text
http://127.0.0.1:5173
```

稳定的无 token 启动方式：

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
cd frontend
npm run dev -- --port 5173
```

`frontend/.env.example` 中预留了：

- `VITE_CESIUM_ION_TOKEN`：可选 Cesium ion token。
- `VITE_GOOGLE_MAPS_API_KEY`：可选 Google Photorealistic 3D Tiles key。
- `VITE_USE_GOOGLE_3D_TILES`：默认 `false`，启用后才尝试 Google 3D Tiles。
- `VITE_USE_CESIUM_WORLD_TERRAIN`：有 Cesium ion token 时可尝试 Cesium World Terrain。
- `VITE_USE_OSM_FALLBACK`：`.env.example` 中列为 `true` 以演示公开瓦片 fallback；如遇 OSM 图片解码或网络错误，可设为 `false`，系统仍会使用本地 grid/data fallback。

没有 key 或在线底图失败时，前端会回退到本地 Cesium grid imagery，并叠加一层基于真实经纬度数据的离线沙盘示意层；该层只用于保证无底图环境下可见，不代表真实地形或影像。调试记录见 `docs/map_debug_report.md`，当前截图见 `output/cesium-visual-current.png`。

## Cesium ion / World Terrain

真实 Cesium ion token 只放在本机 `frontend/.env`，不要写入代码、文档或提交记录。示例文件 `frontend/.env.example` 只保留变量名：

```text
VITE_CESIUM_ION_TOKEN=
VITE_USE_CESIUM_WORLD_TERRAIN=true
```

Windows PowerShell 启动前端：

```powershell
cd "H:\drone signal taishan\frontend"
notepad .env
npm install
npm run dev
```

修改 `.env` 后需要重启 `npm run dev`。配置 token 后，页面状态面板应显示 `Cesium ion = configured`，并且 `地形来源 = Cesium World Terrain`。没有 token 时系统继续回退到 fallback basic scene；token 无效或请求失败时回退到 Ellipsoid terrain，并在“最近地形错误”中显示原因。

Cesium World Terrain 仅用于前端三维地形展示，不作为本项目工程高程计算源，不输出真实 AGL。更详细设置见 `docs/terrain_setup.md`。

## 三维地图视觉模式

本轮地图视觉调试以 `terrain_imagery` 为默认模式：中心工作区优先显示 ArcGIS World Topographic Map 真实地图瓦片，提供道路、水系、山体晕渲和地名背景；Cesium World Terrain 仍保留在底层作为三维地形能力。页面右侧状态面板会分别显示 `terrain provider`、`imagery provider`、`3D tiles provider`、相机高度、相机 pitch、地形夸张倍数和最近地图加载错误。

地图模式说明：

- `terrain_imagery`：真实地图瓦片 + Cesium World Terrain，是当前推荐模式。
- `basic_grid`：本地网格 fallback，用于无 token 或在线瓦片失败时保证页面可见。
- `photorealistic_3d_tiles`：Google Photorealistic 3D Tiles 预留；没有 Google key 时显示 `not configured`。
- `local_terrain_future`：后续本地 DEM / terrain tiles 预留，本轮不实现。

若配置 token 后仍看到网格，请检查状态面板中的 `imagery provider` 和 `last map loading error`；只有 `imagery provider` 显示 ion imagery 或 OSM 时，才说明真实影像底图已经加载。修改 `.env` 后需要重启 `npm run dev`。

### 地图瓦片加载与缓存

Cesium 和在线地图底图不会在启动时一次性加载完整地图；它们会根据当前视野、缩放层级和倾斜角按需请求瓦片。因此快速拖拽、放大或倾斜时，短时间内出现局部等待是正常现象。当前前端会预热初始泰安视野、增大 Cesium 运行时 tile cache，并把 `Map data not yet available` 这类临时瓦片状态作为后台重试处理，不再把它显示为地图故障。

当前缓存边界：

- 后端 `/api/tiles/arcgis-topo/{z}/{y}/{x}` 只对成功返回的显示用影像瓦片设置浏览器缓存；上游失败时生成的透明占位瓦片不缓存。
- 默认缓存时间由后端环境变量 `TAISHAN_TILE_CACHE_SECONDS` 控制，默认 `86400` 秒。设为 `0` 可关闭该代理瓦片缓存。
- 前端 Cesium 运行时缓存由 `VITE_CESIUM_TILE_CACHE_SIZE` 控制，默认 `512` 个 tile；这是 RAM/GPU 侧缓存，不是磁盘离线包。
- 初始视野预热时间由 `VITE_CESIUM_TILE_WARMUP_MS` 控制，默认 `4500` 毫秒。
- 当前采用 `visible first` 瓦片策略：屏幕内瓦片使用高优先级立即加载，屏幕外缓冲瓦片使用低优先级延迟加载。
- DOM 地图缓冲范围由 `VITE_STREET_MAP_TILE_PADDING` 控制，默认 `2` 格；值越大拖动越顺滑，但放大时会请求更多屏幕外瓦片。
- Cesium 周边 sibling 预加载由 `VITE_CESIUM_PRELOAD_SIBLINGS` 控制，默认 `false`，以便优先加载当前屏幕视野。
- Cesium terrain 细节阈值由 `VITE_CESIUM_MAXIMUM_SCREEN_SPACE_ERROR` 控制，默认 `3`；数值越小地形越精细但加载更慢。
- 默认影像底图由 `VITE_PREFERRED_IMAGERY_SOURCE=osm` 控制。ArcGIS World Topographic Map 在泰安局部高 zoom 会返回写有 `Map data not yet available` 的占位图片，因此已降为备用源。
- 不对 Google Photorealistic 3D Tiles 做提取、缓存或反向解析。
- Cesium World Terrain 仍按 Cesium ion / 浏览器自身缓存策略工作；本项目不建立离线地形数据库，也不把它作为工程高程计算源。

## 一键启动与验收

重启电脑后可用两个 PowerShell 分别启动：

```powershell
cd "H:\drone signal taishan"
powershell -ExecutionPolicy Bypass -File scripts\start_backend.ps1
```

```powershell
cd "H:\drone signal taishan"
powershell -ExecutionPolicy Bypass -File scripts\start_frontend.ps1
```

检查服务和数据：

```powershell
cd "H:\drone signal taishan"
powershell -ExecutionPolicy Bypass -File scripts\check_status.ps1
```

浏览器自动验收真实地图、图层数量和点击属性：

```powershell
cd "H:\drone signal taishan\frontend"
npm run verify:map
```

验收通过后会生成：

```text
output/verified-map.png
output/map_verification_report.json
```

当前验收脚本会检查真实地图瓦片、831 个杆塔、3 条 KML 航线、72 个航点、10 个基站/机场候选点，并实际点击杆塔、航线、数据质量问题和坐标补录入口，确认右侧属性面板更新。`map_verification_report.json` 会记录每项检查的 `expected`、`actual` 和 `passed`，失败时会同时写入错误原因和 `output/verify-map-failure.png`。

前端右侧面板现在会直接显示数据质量摘要：

- 有效杆塔坐标：`831/849`
- 缺失坐标：`18`
- 经纬度反置风险：`0`
- 航线匹配 high：`3/3`
- 标准 ID 重复：`0`
- 质量问题：`18`

## 数据质量与可复现管线

运行完整数据处理、质量检查和 SQLite 重建：

```powershell
cd "H:\drone signal taishan"
powershell -ExecutionPolicy Bypass -File scripts\run_data_pipeline.ps1
```

该命令会生成或更新：

- `data/processed/*.csv`
- `data/processed/*.geojson`
- `data/processed/inspection.sqlite`
- `data/processed/data_quality_issues.csv`
- `data/processed/manifest.json`
- `output/data_pipeline_log.json`
- `output/data_quality_report.json`

后端提供处理清单和数据质量接口：

```text
http://127.0.0.1:8000/api/manifest
http://127.0.0.1:8000/api/data-quality
http://127.0.0.1:8000/api/data-quality/issues
```

`/api/manifest` 对应 `data/processed/manifest.json`，记录本轮数据管线使用的原始 Excel/KML 文件、`sha256`、处理产物、行数/feature 数和质量统计。它只用于数据追溯和验收，不代表工程高程、通信覆盖或飞行安全结论。

当前质量检查会验证：

- 标准 ID 是否缺失或重复：`tower_id`、`route_id`、`waypoint_id`、`station_id`、`task_id`
- 经纬度字段是否存在、是否可转数字、是否在泰安经验范围内
- 经纬度是否存在反置风险
- 航线与最近杆塔匹配置信度和距离统计

当前已知数据风险：

- 台账中共有 849 条杆塔记录，其中 831 条有有效经纬度，18 条缺失坐标。
- 已解析的 72 个 KML 航点均在泰安经验范围内。
- 当前 3 条 KML 航线与最近杆塔匹配置信度均为 `high`，最近距离约 `0.83 m` 到 `2.63 m`。
- 这些质量结论只用于数据验收，不代表飞行安全或工程高程结论。

## 前端质量问题明细

三维沙盘右侧面板现在不仅显示数据质量摘要，还会读取：

```text
http://127.0.0.1:8000/api/data-quality/issues
```

并展示可点击的问题明细。点击任一问题后，右侧属性表会显示：

- `issue_type`
- `severity`
- `entity_id`
- 对应线路和杆号
- 是否可在地图上定位
- 建议处理动作
- 对应报告文件

当前 18 条问题均为杆塔台账缺失经纬度或经纬度无法转为数字；这些杆塔不会被伪造位置，也不会出现在地图点图层中。补齐台账坐标后，重新运行：

```powershell
cd "H:\drone signal taishan"
powershell -ExecutionPolicy Bypass -File scripts\run_data_pipeline.ps1
```

然后重启或刷新前后端页面即可复核。
## 质量问题源记录定位补充

`data/processed/data_quality_issues.csv` 和 `/api/data-quality/issues` 现在包含源记录定位字段：

- `source_file`
- `source_row`
- `line_name`
- `tower_no`
- `longitude`
- `latitude`

当前 18 条缺失坐标问题已经定位到 `线路台账（科技项目数据收集）.xlsx` 的具体源行。例如 `35kV金茅线 #1` 对应源行 `811`。修复时应回到该 Excel 源记录补齐经纬度，再运行 `scripts/run_data_pipeline.ps1` 重建处理数据和 SQLite。

坐标补录模板同步生成在：

```text
data/processed/coordinate_backfill_template.csv
http://127.0.0.1:8000/api/data-quality/coordinate-backfill-template
```

模板中的 `longitude_to_fill` 和 `latitude_to_fill` 保持空白，需要人工回到原始台账确认后填写；不要直接修改 `data/processed/` 生成文件作为源数据。

补录模板校验同步生成：

```text
data/processed/coordinate_backfill_validation.csv
output/coordinate_backfill_validation_report.json
http://127.0.0.1:8000/api/data-quality/coordinate-backfill-validation
http://127.0.0.1:8000/api/data-quality/coordinate-backfill-validation-report
```

校验规则只检查人工填写的 `longitude_to_fill` / `latitude_to_fill`：是否为空、是否只填了一列、是否能转成数字、是否落在泰安经验范围、是否疑似经纬度反置。当前模板尚未补录，校验结果为 `pending_rows = 18`。

Python 脚本现在优先使用项目内 `.venv\Scripts\python.exe`。首次运行可执行：

```powershell
cd "H:\drone signal taishan"
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```
## Windows Python 环境初始化

首次运行或更换电脑后，先执行：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup_python_env.ps1
```

该脚本会创建 `.venv`、安装 `requirements.txt`，并验证 `pandas/openpyxl/pytest/fastapi/uvicorn` 可导入。

后续脚本会优先使用 `.venv\Scripts\python.exe`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run_data_pipeline.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_backend.ps1
```

如果依赖缺失，管线和后端启动脚本会提示先运行 `scripts\setup_python_env.ps1`。

## Windows 一键启动网页

启动前端、后端并自动做健康检查：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_web.ps1
```

启动成功后打开：

```text
http://127.0.0.1:5173
```

停止当前网页服务：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\stop_web.ps1
```

只检查状态：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_status.ps1
```

`start_web.ps1` 会在缺少 `.venv` 时调用 `setup_python_env.ps1`，在缺少 `data/processed/inspection.sqlite` 时运行数据管线，并把运行日志写入 `output/runtime/`。
## Windows 项目一键验收

运行核心验收，不启动浏览器点击测试：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_project.ps1
```

该脚本会依次执行：

- 验证 `.venv` Python 依赖；
- 运行数据管线并重建 SQLite；
- 运行 Python 测试；
- 构建前端；
- 启动或复用前后端服务；
- 检查关键 API，包括坐标补录校验报告。

如需运行 Playwright 浏览器验收并生成 `output/verified-map.png`：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\verify_project.ps1 -RunBrowser
```

如果当前环境不允许启动浏览器，先运行不带 `-RunBrowser` 的核心验收。

验收通过后会写入机器可读报告：

```text
output/project_verification_report.json
```

报告包含生成时间、前后端 URL、数据计数、质量问题统计、坐标补录校验摘要和关键输出文件是否存在，可作为当前项目状态的验收证据。

带 `-RunBrowser` 时，报告还会嵌入 `output/map_verification_report.json` 的结果，并把浏览器地图验收作为硬门禁；不带 `-RunBrowser` 时，浏览器截图和地图 JSON 只作为可选证据。

报告还包含 `gates` 验收门禁数组。当前门禁会检查：

- 航线指标、杆塔、KML 航线和航点数量达到最小验收阈值；
- 航线指标数量覆盖已解析 KML 航线；
- 数据质量摘要与质量问题明细数量一致；
- 缺失坐标问题数量与坐标补录校验行数一致；
- 坐标补录校验行全部归入明确状态；
- `data/processed/manifest.json` 已生成，输入文件带 `sha256`，且 manifest 中的杆塔/航线/航点行数与 API 计数一致；
- 关键 `data/processed/` 和 `output/` 证据文件存在且非空。

任一门禁失败时，脚本会先写入 `output/project_verification_report.json`，将 `status` 标记为 `failed`，然后以失败退出。未加 `-RunBrowser` 时，`output/verified-map.png` 只作为可选证据；加 `-RunBrowser` 后会作为必需截图证据。

## 完整命令流程（Windows PowerShell）

以下命令用于从环境准备、数据导入、数据处理、启动服务到验收验证的完整流程。真实 token、`.env` 和新导入的原始数据不要提交。

### 1. 准备环境

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_python_env.ps1

cd "H:\drone signal taishan\frontend"
npm.cmd install
```

如果需要 Cesium ion token：

```powershell
cd "H:\drone signal taishan\frontend"
notepad .env
```

`.env` 中只在本机填写，例如：

```text
VITE_CESIUM_ION_TOKEN=
VITE_USE_CESIUM_WORLD_TERRAIN=true
```

### 2. 暂存导入未来新增数据

导入接口只把文件保存到 `data/raw/imports/<batch_id>/` 并生成 manifest，不会自动覆盖原始数据，也不会自动刷新 `data/processed/`。

查看导入规则：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/schema"
```

如果要把新的 KML 立即增加为可展示航线，使用专用命令。它会把 `.kml` 新增到 `data/raw/kml/`，不覆盖同名文件，并自动重建 `data/processed/` 和 SQLite：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_kml_routes.ps1 `
  -FilePath "H:\new_data\route_001.kml" `
  -Note "新增航线，待核对线路和杆号"
```

如果只想先暂存 KML、暂不进入当前展示结果，再使用通用暂存命令：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 `
  -Category kml `
  -FilePath "H:\new_data\route_001.kml" `
  -Note "新增航线，待核对线路和杆号"
```

上传新的任务表或台账：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 `
  -Category tasks `
  -FilePath "H:\new_data\tasks.xlsx" `
  -Note "新增巡检任务统计表，待核对字段"

powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 `
  -Category ledger `
  -FilePath "H:\new_data\ledger.xlsx" `
  -Note "新增线路台账，待核对经纬度字段"
```

上传 DEM/DSM、通信参数或无人机参数：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 -Category dem -FilePath "H:\new_data\taian_dem.tif"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 -Category communication -FilePath "H:\new_data\stations.csv"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 -Category uav_models -FilePath "H:\new_data\uav_models.json"
```

查看已暂存批次：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/batches"
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/batches/<batch_id>"
```

人工确认暂存文件后，再放入正式原始数据目录。例如确认 KML 后：

```powershell
cd "H:\drone signal taishan"
New-Item -ItemType Directory -Force -Path ".\data\raw\kml" | Out-Null
Copy-Item -LiteralPath ".\data\raw\imports\<batch_id>\route_001.kml" -Destination ".\data\raw\kml\"
```

### 3. 重新生成标准化数据

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_data_pipeline.ps1
```

输出包括：

- `data/processed/*.csv`
- `data/processed/*.geojson`
- `data/processed/inspection.sqlite`
- `data/processed/manifest.json`
- `output/data_pipeline_log.json`
- `output/data_quality_report.json`

### 4. 启动前后端

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_web.ps1
```

访问：

```text
http://127.0.0.1:5173
```

单独启动后端：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_backend.ps1 -Port 8000
```

单独启动前端：

```powershell
cd "H:\drone signal taishan\frontend"
npm.cmd run dev -- --port 5173
```

### 5. 检查状态和接口

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check_status.ps1

Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/metrics"
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/manifest"
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/data-quality"
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/import/schema"
```

### 6. 完整验收

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1 -RunBrowser
```

快速验收，不跑浏览器：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1
```

前端地图专项验收：

```powershell
cd "H:\drone signal taishan\frontend"
npm.cmd run verify:map
```

### 7. 停止服务

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop_web.ps1
```

更多导入接口说明见 `docs/data_import_api.md`。

## 软著候选版封装

当前项目已整理为 V0.1.0 软著候选原型版。相关材料：

- `docs/software_copyright_materials.md`：软件名称、版本、模块、技术特点和申请材料建议。
- `docs/software_copyright_application_template.md`：申请表信息模板和需人工确认字段。
- `docs/source_code_manifest.md`：核心源码清单。
- `docs/user_manual.md`：用户使用手册。
- `docs/release_notes.md`：版本说明。
- `docs/release_checklist.md`：发布与验收检查清单。

发布前检查：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check_release_readiness.ps1
```

生成发布包：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package_release.ps1
```

默认输出：

```text
release/taishan-uav-sandtable-v0.1.0/
release/taishan-uav-sandtable-v0.1.0.zip
```

发布包默认包含后端、前端、脚本、测试、MATLAB 原型、Markdown 文档、processed 示例数据、源码清单和 SHA-256 manifest；默认不包含 `frontend/.env`、真实 token、`.venv`、`node_modules`、`frontend/dist`、`raw/` 和 `data/raw/` 原始数据。
