# Cesium 三维地图调试报告

## 当前结论

本轮重点处理三维页面在无 Google API key、无 Cesium ion token、在线瓦片不可用时中央画布容易呈现深色空场的问题。当前页面可以从 `http://127.0.0.1:5173` 打开，并在无 token 情况下显示：

1. Cesium Viewer 外壳与三维交互能力。
2. 本地 `GridImageryProvider` 基础网格底图。
3. 基于真实经纬度投影的离线数据叠加层，用于显示 KML 航线、航点、杆塔和基站候选点。
4. 顶部态势统计、左侧图层/航线开关、KML 导入入口、右侧属性面板和选中航线后的通信遮挡演示。

验证截图：`output/cesium-visual-current.png`。

## 已发现问题

1. 原始实现移除了全部 imagery layer，在当前浏览器/无 token 环境中，Cesium globe 可能只显示背景色，看起来像黑屏或空场。
2. 开启在线 OSM 瓦片时，曾出现浏览器渲染错误：`The source image could not be decoded`。因此默认不强制启用 OSM。
3. 关闭 Cesium 默认天空/日月贴图时，部分 Cesium 对象在当前版本可能为 `undefined`，已增加存在性判断，避免初始化中断。
4. 无真实 DEM/DSM 时，所有高度仍为 KML altitude 或默认展示高度，不代表真实地形高程或离地高度。

## 当前 fallback 链路

1. 如果 `VITE_USE_GOOGLE_3D_TILES=true` 且 `VITE_GOOGLE_MAPS_API_KEY` 存在，尝试加载 Google Photorealistic 3D Tiles。
2. 如果 `VITE_CESIUM_ION_TOKEN` 存在且 `VITE_USE_CESIUM_WORLD_TERRAIN=true`，尝试加载 Cesium World Terrain。
3. 如果 `VITE_USE_OSM_FALLBACK=true`，尝试加载 OSM imagery。
4. 如果以上不可用或失败，使用本地 Cesium grid imagery + 数据叠加层，保证页面不崩溃且可看见真实数据分布。

## 验证命令

```powershell
python .\scripts\process_data.py
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
cd frontend
npm install
npm run dev -- --port 5173
```

构建验证：

```powershell
cd frontend
npm run build
```

截图验证：

```powershell
npx playwright screenshot --wait-for-timeout=9000 http://127.0.0.1:5173 .\output\cesium-visual-current.png
```
