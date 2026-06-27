# 三维地图视觉诊断报告

日期：2026-05-31

## 诊断结论

当前问题不是业务 API 未拉取数据。前端已能读取杆塔、KML 航线、航点、基站/机场候选点和任务统计数据；视觉效果接近 fallback 网格的主要原因是地图底图链路缺少清晰的 imagery provider 状态、相机默认视角偏俯视、terrain / imagery / 3D Tiles 三类来源没有在页面中明确区分，并且原先业务实体刷新时会无条件叠加一个 fallback 范围网格框。

本轮已将默认地图模式调整为 `terrain_imagery`，优先使用公开地形/街道瓦片 + Cesium World Terrain，以获得接近截图的道路、绿地、山体和地名底图效果；如果公开地形瓦片失败，则尝试 OSM，再尝试 Cesium ion imagery，最后才回退本地 grid。业务图层继续保留。

已修复：fallback 范围网格框现在只在 `basic_grid` 模式显示，不再覆盖 `terrain_imagery` 模式下的真实地形和影像底图。

## 当前状态检查

1. `Cesium.Ion.defaultAccessToken`：代码只在 `VITE_CESIUM_ION_TOKEN` 存在时设置，未写死 token，未读取或打印真实 token。页面状态以 `Cesium ion = configured / not configured / failed` 显示。
2. terrain provider：当 `VITE_CESIUM_ION_TOKEN` 存在且 `VITE_USE_CESIUM_WORLD_TERRAIN=true` 时，优先使用 `Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true, requestWaterMask: true })`；页面状态显示 `terrain provider`。
3. imagery provider：新增明确的影像底图加载链路，优先公开 `ArcGIS World Topographic Map`，再回退 `OpenStreetMapImageryProvider`，再兼容尝试 `Cesium createWorldImageryAsync` / `IonImageryProvider.fromAssetId(2)`，最后回退 `GridImageryProvider`。
4. 是否加载影像底图：页面状态显示 `imagery provider`。若显示 `ArcGIS World Topo`、`OpenStreetMapImageryProvider`、`IonImageryProvider` 或 `BingMapsImageryProvider`，说明不是纯 terrain；若显示 `fallback grid`，说明真实地图瓦片未加载成功。
5. 是否只是加载 terrain 没有 imagery：修复前存在这种风险；修复后 `terrain_imagery` 模式会同时尝试 terrain 和 imagery，并分别显示状态。
6. `viewer.scene.globe.show`：初始化时显式设置为 `true`。
7. `viewer.scene.globe.depthTestAgainstTerrain`：当前为 `false`，目的是避免杆塔光柱、KML 航线和航点被地形遮挡到不可见。该设置只影响展示遮挡，不代表真实 AGL 计算。
8. 相机高度、pitch、heading：初始视角改为倾斜观察，默认 heading 约 `28 deg`、pitch 约 `-38 deg` 到 `-40 deg`，高度按数据范围限制在约 `12 km` 到 `52 km`，比原先更适合观察地形起伏。
9. terrain exaggeration：页面提供 `1x / 1.5x / 2x / 3x` 视觉夸张切换，并在状态面板显示。该值只用于视觉增强，不作为工程高程计算依据。
10. Google Photorealistic 3D Tiles 或其他 3D Tiles：本轮不新增加载。若未配置 `VITE_GOOGLE_MAPS_API_KEY` 且未启用 `VITE_USE_GOOGLE_3D_TILES=true`，状态显示 `not configured`，不会伪装成已加载。

## 页面状态面板新增字段

- `当前地图模式`
- `底图来源`
- `terrain provider`
- `imagery provider`
- `地形来源`
- `3D tiles provider`
- `terrain exaggeration`
- `camera height`
- `camera pitch`
- `camera heading`
- `last map loading error`
- `最近地形错误`

## 地图模式

| 模式 | 含义 | 当前实现 |
|---|---|---|
| `basic_grid` | 本地网格基础场景 | 已实现，作为最终 fallback |
| `terrain_imagery` | Cesium World Terrain + 影像底图 | 已实现，是本轮核心模式 |
| `photorealistic_3d_tiles` | Google 或其他实景 3D Tiles | 仅预留；无 key 时显示 `not configured` |
| `local_terrain_future` | 后续本地 DEM / terrain tiles | 仅预留，本轮不实现 |

## 仍需现场确认

打开 `http://127.0.0.1:5173` 后，若页面仍像网格 fallback，请优先看状态面板：

1. `imagery provider` 是否为 `fallback grid`。如果是，说明影像底图没有成功加载。
2. `last map loading error` 是否出现 ion imagery 或 OSM tile 错误。
3. `terrain provider` 是否为 `CesiumTerrainProvider`，且 `地形来源` 是否为 `Cesium World Terrain`。
4. `当前地图模式` 是否为 `terrain_imagery`。
5. 修改 `frontend/.env` 后是否已经重启 `npm run dev`。

当前没有 Google Photorealistic 3D Tiles 或本地倾斜摄影 3D Tiles 时，页面不会达到 Google Earth 级别的真实三维城市/山体实景；本轮目标是先达到真实地形起伏 + 影像底图 + 倾斜视角。
