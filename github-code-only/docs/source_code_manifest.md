# 源代码清单

本文档列出 V0.1.0 软著候选版本的核心源代码范围。实际申请时，可使用 `scripts/package_release.ps1` 生成发布包中的 `release_materials/source_code_listing.txt` 作为源代码打印或电子材料基础。

## 一、后端源码

| 路径 | 说明 |
|---|---|
| `backend/app.py` | FastAPI 接口入口，提供数据、GeoJSON、导入、地形和通信预留 API。 |
| `backend/db.py` | SQLite 数据库构建和表查询封装。 |
| `backend/taishan_pipeline/process_data.py` | Python 标准化数据管线入口。 |
| `backend/taishan_pipeline/excel.py` | Excel 巡检任务表和线路台账读取逻辑。 |
| `backend/taishan_pipeline/kml.py` | DJI KML 航线和航点解析逻辑。 |
| `backend/taishan_pipeline/geojson.py` | CSV 到 GeoJSON 的输出逻辑。 |
| `backend/taishan_pipeline/geometry.py` | 经纬度、距离、航线长度和空间匹配计算。 |
| `backend/taishan_pipeline/data_quality.py` | 数据质量检查、坐标补录模板和校验报告。 |
| `backend/taishan_pipeline/manifest.py` | 处理清单、输入哈希和输出证据记录。 |
| `backend/taishan_pipeline/imports.py` | 未来数据导入类别、暂存 manifest 和命名规则。 |
| `backend/taishan_pipeline/terrain.py` | DEM/DSM 地形采样接口预留。 |
| `backend/taishan_pipeline/communication.py` | 通信距离检查接口预留。 |
| `backend/taishan_pipeline/paths.py` | 原始数据和处理数据路径约定。 |

## 二、前端源码

| 路径 | 说明 |
|---|---|
| `frontend/src/App.jsx` | React/Cesium 三维沙盘主界面、图层控制、对象点击、导入、通信遮挡演示和验收调试状态。 |
| `frontend/src/main.jsx` | React 应用挂载入口。 |
| `frontend/src/styles.css` | 三维沙盘布局、面板、地图叠加层和交互样式。 |
| `frontend/index.html` | Vite 前端 HTML 入口。 |
| `frontend/vite.config.js` | Vite 和 Cesium 静态资源配置。 |
| `frontend/package.json` | 前端依赖、构建和地图验收命令。 |

## 三、数据处理与运维脚本

| 路径 | 说明 |
|---|---|
| `scripts/inventory_data.py` | 原始数据清点和字段识别脚本。 |
| `scripts/process_data.py` | 调用 Python 标准化数据管线。 |
| `scripts/run_data_pipeline.ps1` | Windows 一键运行数据处理和 SQLite 重建。 |
| `scripts/setup_python_env.ps1` | Python 虚拟环境初始化。 |
| `scripts/start_backend.ps1` | 启动 FastAPI 后端。 |
| `scripts/start_frontend.ps1` | 启动 Vite 前端。 |
| `scripts/start_web.ps1` | 一键启动前后端并做健康检查。 |
| `scripts/stop_web.ps1` | 停止前后端端口进程。 |
| `scripts/check_status.ps1` | 检查接口、端口和数据计数。 |
| `scripts/import_data.ps1` | 暂存导入未来数据。 |
| `scripts/import_kml_routes.ps1` | 立即导入新增 KML 航线并重建 processed 数据。 |
| `scripts/verify_project.ps1` | 项目级验收脚本。 |
| `scripts/verify_map.mjs` | Playwright 前端地图和交互验收脚本。 |
| `scripts/check_release_readiness.ps1` | 软著候选版结构和发布材料检查脚本。 |
| `scripts/package_release.ps1` | 生成软著候选发布包、源码清单和文件 manifest。 |

## 四、MATLAB 原型源码

| 路径 | 说明 |
|---|---|
| `matlab/main.m` | MATLAB 原型主入口。 |
| `matlab/readFlightTasks.m` | 巡检任务表读取原型。 |
| `matlab/readTowerLedger.m` | 线路台账读取原型。 |
| `matlab/parseDJIKML.m` | DJI KML 解析原型。 |
| `matlab/computeRouteMetrics.m` | 航线指标计算原型。 |
| `matlab/matchRouteToTower.m` | 航线与杆塔匹配原型。 |
| `matlab/plotInspectionMap.m` | 二维验证图绘制原型。 |

## 五、测试源码

| 路径 | 说明 |
|---|---|
| `tests/test_kml.py` | KML 解析测试。 |
| `tests/test_geometry.py` | 空间距离和几何计算测试。 |
| `tests/test_manifest.py` | 处理清单测试。 |
| `tests/test_data_quality.py` | 数据质量检查测试。 |
| `tests/test_imports.py` | 数据导入规则测试。 |

## 六、不纳入软著源码的内容

以下内容默认不纳入发布包或源码打印材料：

1. `frontend/.env`、`.env.local`：本机 token 和私有配置。
2. `.venv/`、`node_modules/`、`frontend/dist/`：第三方依赖或构建产物。
3. `raw/`、`data/raw/`：原始业务数据，默认不打包。
4. `output/runtime/`、`test-results/`、`.pytest_cache/`：运行时和测试临时文件。
5. Google、Cesium、OSM、ArcGIS 等外部地图或地形服务数据。
