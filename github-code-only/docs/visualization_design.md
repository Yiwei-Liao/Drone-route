# 三维可视化设计说明

## 目标

本阶段将原有二维 Leaflet/静态叠加验证图升级为 CesiumJS 三维低空数字沙盘原型。目标是展示真实解析出的杆塔、KML 航线、航点、基站/机场候选点，并在选择某条航线后展示该航线的通信视距 / 菲涅尔走廊原型。

该原型仍以数据正确性和边界说明为优先，不作为高保真三维数字孪生或飞行安全评估系统。

## 数据来源

前端不直接读取 Excel/KML，而是复用阶段 2 已生成的标准化数据和 FastAPI 接口：

| 图层/面板 | API | 数据来源 |
|---|---|---|
| 杆塔 | `/api/geojson/towers` | `data/processed/towers.geojson` |
| 线路候选 | `/api/geojson/lines` | `data/processed/lines.geojson` |
| KML 航线 | `/api/geojson/routes` | `data/processed/routes.geojson` |
| 航点 | `/api/geojson/route_waypoints` | `data/processed/route_waypoints.geojson` |
| 基站/机场候选 | `/api/geojson/base_stations` | `data/processed/base_stations.geojson` |
| 航线指标与最近杆塔 | `/api/metrics` | `routes.csv` + `route_tower_matches.csv` |
| 任务数量 | `/api/tasks` | `flight_tasks.csv` |
| KML 导入 | `/api/import/kml-routes` | 新增 `.kml` 到 `data/raw/kml/` 后重建 `data/processed/` |

当前机场/机巢在台账中只有名称，没有经纬度，因此三维场景中实际展示的是任务表基站点；机场点位等待真实坐标补充。

## 三维地图

前端使用 `frontend/src/App.jsx` 初始化 Cesium Viewer：

1. 默认地图模式为 `terrain_imagery`，中心工作区优先加载 ArcGIS World Topographic Map 公开地形/街道瓦片，形成类似道路、绿地、山体和地名标注的真实地图背景。
2. 支持旋转、缩放、倾斜等 Cesium 原生三维交互。
3. 初始视角根据杆塔坐标中心自动飞到泰安巡检数据区域，并使用倾斜视角观察地形起伏。
4. 页面顶部和右侧状态面板显示当前地图模式、terrain provider、imagery provider、3D tiles provider、相机高度、pitch、heading 和地形夸张倍数。
5. Cesium 影像或 WebGL 渲染失败时，中心工作区仍由 DOM 地图瓦片层保证可见；在线瓦片最终失败时再回退到本地 grid basic scene，页面不应白屏。

## 稳定交互层

为了避免 Cesium canvas 受 WebGL、夜侧光照或影像解码影响导致黑屏，前端增加了独立的真实地图 DOM 图层：

1. `StreetMapLayer` 使用 Web Mercator 瓦片显示真实地图背景。
2. 杆塔、KML 航线、航点、基站/机场候选点按真实经纬度投影到该地图层。
3. SVG 对象带有可点击热区和 `data-selection` 属性，点击后更新右侧属性面板。
4. 航线额外显示“航线 1/2/3”标签，避免细线难以命中。
5. Cesium 三维地形仍保留为底层能力，但当前验收视图优先保证真实地图和对象点击稳定。

自动验收脚本：

```powershell
cd "H:\drone signal taishan\frontend"
npm run verify:map
```

脚本会打开浏览器、保存 `output/verified-map.png`，并验证真实地图瓦片、杆塔、航线、航点、基站数量以及杆塔/航线点击属性。

## 数据质量摘要

右侧面板新增数据质量摘要，数据来自 `/api/data-quality`，对应 `output/data_quality_report.json`。当前展示：

1. 有效杆塔坐标 `831/849`。
2. 缺失坐标 `18`。
3. 经纬度反置风险 `0`。
4. 航线匹配 high `3/3`。
5. 标准 ID 重复 `0`。
6. 质量问题 `18`。

这些值来自真实数据质量检查，不是模拟值。质量问题当前主要是杆塔台账中 18 条记录缺失经纬度；这些杆塔不会被伪造位置，也不会进入可点击地图点图层。

## 地图数据源边界

Cesium 页面明确区分三种不同数据源：

1. Cesium World Terrain：只提供地形起伏，用于三维视觉展示。
2. 影像底图 imagery：提供真实地表纹理，例如 Cesium ion imagery 或 OSM fallback。只有 terrain 没有 imagery 时，地形仍可能看起来像纯色或网格，不会有真实地图纹理。
3. 3D Tiles：用于实景三维城市、建筑、倾斜摄影或 Google Photorealistic 3D Tiles 等体块化/网格化三维内容。

接近 Google Earth 的真实三维实景通常需要 Google Photorealistic 3D Tiles、当地倾斜摄影 3D Tiles 或其他高质量三维瓦片。本项目当前没有 Google Maps API key 或本地 3D Tiles 时，不会显示 Google Earth 级别的真实三维城市/山体实景。

当前免费的优先路线是 `terrain_imagery`：真实地形起伏 + 影像底图 + 倾斜视角。工程高程计算后续仍应接入本地 DEM/DSM 或受控高程服务，不应从 Cesium World Terrain 或 3D Tiles 反推高程。

## Google 3D Tiles 预留

前端预留 Google Photorealistic 3D Tiles 接口，但不强依赖：

```text
VITE_USE_GOOGLE_3D_TILES=false
VITE_GOOGLE_MAPS_API_KEY=
```

当 `VITE_USE_GOOGLE_3D_TILES=true` 且存在 API key 时，前端尝试加载 Google 3D Tiles 作为展示底图。没有 key 或加载失败时，系统自动回退 Cesium 基础场景。

边界：

1. API key 必须从 `.env` 读取，不得写入代码。
2. 不从 Google 3D Tiles 提取、缓存、反向解析地形或建筑高度。
3. Google 3D Tiles 只作为展示底图，不作为 DEM/DSM 数据源。

## 杆塔图层

杆塔使用三维光柱和顶部发光点展示：

1. 坐标来自 `towers.geojson`。
2. 展示高度优先使用台账 `tower_height`。
3. 如果杆塔高度缺失，使用默认展示高度 `35 m`，并在点击属性中标注 `height_source = default height`。
4. 点击杆塔显示线路名称、杆号、经纬度、杆塔高度、机场距离、来源文件、展示高度来源。

## KML 航线图层

KML 航线使用三维发光线展示：

1. 航线坐标来自 `routes.geojson`。
2. 航点来自 `route_waypoints.geojson`。
3. 起点、终点和航点分别作为独立三维点显示。
4. 高度优先使用 KML altitude。
5. 如果高度缺失，使用默认展示高度 `80 m`，并在属性中标注 `simulated/default height`。
6. 点击航线显示航点数、航线长度、高度范围、最近杆塔、匹配距离、KML 文件名和数据来源。

当前初始数据包含 3 条 KML 航线，均可在三维场景中显示。前端左侧提供 KML 导入入口，上传 `.kml` 后调用 `/api/import/kml-routes`，该接口会把文件以不覆盖方式新增到 `data/raw/kml/`，重新运行标准化数据管线并刷新航线列表。导入成功只代表 KML 已进入现有解析流程，不代表航线与任务、线路或杆塔关系已经人工确认。

## 航线时间戳与回放边界

当前 KML 文件没有真实时间戳，因此前端不再提供无人机飞行动画回放。航点序列只用于：

1. 展示 KML 航线和航点位置。
2. 点击航线或航点查看属性。
3. 在选中某条航线后，为通信视距 / 菲涅尔走廊演示提供采样点。

边界：

1. 不根据航点顺序推断真实飞行速度。
2. 不生成模拟无人机实体、播放进度或悬停时间。
3. 如未来提供真实时间戳或飞控日志，可重新设计回放模块。

## 态势面板

页面布局：

1. 顶部态势条：线路数量、杆塔数量、KML 航线数量、任务数量。
2. 左侧面板：线路/杆号筛选、KML 导入、图层开关、航线开关和航线选择。
3. 右侧面板：当前选中杆塔、航线、航点或基站属性。
4. 通信遮挡演示：选择某条 KML 航线后，显示该航线对应的半透明视距 / 菲涅尔走廊和状态读数。

## 山体通信影响半透明图层

当前 demo 增加 `通信遮挡演示` 图层，用于表达“山体可能影响无人机通信链路”的可视化思路：

1. 左侧面板提供 `半透明菲涅尔走廊` 开关；未选择 KML 航线时该开关禁用，地图不显示走廊。
2. 系统自动选择距离当前选中 KML 航线起点最近的基站/机场候选点作为通信源。
3. 基站到当前选中航点之间显示一条半透明 Fresnel 通信走廊和发光中心线；如果只选中航线，默认使用该航线第一个航点。
4. 选中航线按采样航点叠加风险色带：绿色表示视距样本充足，黄色表示菲涅尔区风险，红色表示山体遮挡风险，青色表示当前地形采样仍在等待或不足。
5. 地图上显示通信源、所需覆盖半径圆、当前链路距离和风险标签。
6. 右侧面板显示通信源、航点序号、链路距离、所需半径、频段、地形采样数量、最小净空和航线风险摘要。

边界说明：

1. 该图层是半透明视觉原型，不是工程通信覆盖结论。
2. 当前默认使用 `2.4 GHz`、基站天线高度 `25 m AGL assumed` 和简化第一菲涅尔区规则，参数可通过前端环境变量调整。
3. 前端只读取 Cesium 场景中已经缓存的 terrain height 用于演示级判断；没有本地 DEM/DSM 时，结果应标记为 `terrain pending` 或视觉提示。
4. Cesium World Terrain 仍不是项目工程高程计算源；后续严肃分析应接入本地 DEM/DSM，并使用真实通信设备参数或实测链路数据。

## 当前限制

1. 当前没有真实 DEM/DSM，Cesium 中的高度只是展示高度，不代表真实 AGL。
2. 线路候选图层按台账行顺序连接，真实线路拓扑需人工校核。
3. 风险评分仍来自规则原型，不作为真实安全结论。
4. 当前没有真实通信覆盖模型，基站只作为点位展示。
5. 当前没有真实无人机能耗模型。

## 无 token / 无在线底图时的可见性保障

为避免页面在没有 Google API key、没有 Cesium ion token 或在线瓦片解码失败时变成深色空场，当前前端增加了两级本地 fallback：

1. Cesium `GridImageryProvider`：生成本地网格底图，不访问外网，不代表真实影像或地形。
2. 数据叠加层：把 `towers`、`routes`、`route_waypoints` 和 `base_stations` 的真实经纬度投影到中央沙盘区域，显示杆塔、KML 航线、航点和基站候选点分布。

该叠加层只解决“无底图环境仍可看见数据”的验收问题，不参与高程计算，不生成 DEM/DSM，不反推地形，也不替代 Cesium 实体图层。点击属性、图层开关、KML 导入状态和通信遮挡演示仍由现有 React/Cesium 页面状态驱动。

当前默认环境变量建议：

```text
VITE_USE_GOOGLE_3D_TILES=false
VITE_USE_OSM_FALLBACK=true
```

如需在线底图，可在 `.env` 中配置 Cesium ion 或 Google key；OSM 瓦片仅建议在网络与图片解码稳定时开启，如出现图片解码错误可把 `VITE_USE_OSM_FALLBACK` 设为 `false`。
## 数据质量问题明细交互

右侧面板现在包含 `数据质量问题明细` 区域，数据来自 `/api/data-quality/issues`，与 `data/processed/data_quality_issues.csv` 保持一致。

交互规则：

1. 每条问题显示 `issue_type`、目标对象和原始质量检查消息。
2. 点击问题后，右侧属性表切换到 `数据质量问题`。
3. 缺失坐标问题会明确显示 `not_mappable_missing_coordinate`，说明该对象无法在地图上定位。
4. 缺失坐标的杆塔不会被伪造经纬度，也不会显示为地图点。
5. 页面只给出数据修复建议，例如补齐台账坐标并重新运行 `scripts/run_data_pipeline.ps1`；不把质量问题解释为真实飞行安全风险。

浏览器验收脚本 `npm run verify:map` 已覆盖质量问题明细：它会检查列表存在、点击第一条质量问题，并确认属性面板显示 `not_mappable_missing_coordinate`。

质量问题明细现在还显示源记录定位字段：`source_file`、`source_row`、`line_name`、`tower_no`、`longitude`、`latitude`。这些字段来自标准化数据管线，不是前端推断。缺失坐标杆塔仍不会被渲染成地图点；页面只帮助定位应回到哪个 Excel 文件和哪一行补数据。

右侧面板还显示 `坐标补录模板` 摘要，数据来自 `/api/data-quality/coordinate-backfill-template`，对应文件 `data/processed/coordinate_backfill_template.csv`。该模板只列出待人工补录的坐标字段，不在前端生成默认经纬度。

坐标补录模板旁边显示校验摘要，数据来自 `/api/data-quality/coordinate-backfill-validation-report`。当前摘要字段为 `pending`、`valid` 和 `issues`：`pending` 表示仍未填写经纬度，`valid` 表示填写值通过泰安经验范围校验，`issues` 汇总不完整、非数字、疑似经纬度反置和超出范围的行。该摘要不代表工程验收通过，只用于人工补录前后的数据检查。
