# Cesium ion 与 World Terrain 设置

## 目标

本项目的三维沙盘可选接入 Cesium ion token，用于加载 Cesium World Terrain 和 Cesium ion 影像底图。World Terrain 只用于前端三维地形展示，不作为工程高程计算源，不输出真实 AGL，也不替代后续 DEM/DSM 高程服务。

## Token 放置位置

真实 token 只放在本机文件：

```text
frontend/.env
```

不要把 token 粘贴到聊天、文档、代码或提交记录中。仓库已在 `.gitignore` 中忽略：

```text
.env
.env.local
frontend/.env
frontend/.env.local
```

`frontend/.env.example` 只保留变量名，不包含真实 token。

## Windows PowerShell 启动

```powershell
cd "H:\drone signal taishan\frontend"
notepad .env
npm install
npm run dev
```

修改 `.env` 后需要停止并重新运行 `npm run dev`，Vite 才会重新读取环境变量。

后端另开一个 PowerShell：

```powershell
cd "H:\drone signal taishan"
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

访问：

```text
http://127.0.0.1:5173
```

## 环境变量

```text
VITE_CESIUM_ION_TOKEN=
VITE_USE_CESIUM_WORLD_TERRAIN=true
VITE_USE_OSM_FALLBACK=true
```

`VITE_USE_OSM_FALLBACK=true` 表示 ion imagery 加载失败时允许尝试 OpenStreetMap 公开瓦片。Google 3D Tiles 仍为预留能力，本轮不强制加载。

## 页面状态判断

配置正确时，状态面板应显示：

```text
Cesium ion = configured
地形来源 = Cesium World Terrain
imagery provider = IonImageryProvider / BingMapsImageryProvider / 其他 Cesium ion imagery provider
当前地图模式 = terrain_imagery
```

没有 token 时：

```text
Cesium ion = not configured
地形来源 = fallback basic scene
```

token 无效、网络失败或 Cesium ion 请求失败时：

```text
Cesium ion = failed
地形来源 = Ellipsoid terrain
最近地形错误 = Cesium World Terrain failed: ...
```

页面不会白屏，会继续使用 fallback basic scene / Ellipsoid terrain。

若地形已经成功但画面仍像网格，请继续检查：

```text
imagery provider = fallback grid
last map loading error = ...
```

这表示只成功进入了地形或 fallback，可视纹理没有加载成功。真实三维地图观感需要 terrain 和 imagery 同时可用；terrain 负责起伏，imagery 负责地表纹理。

## 当前边界

1. Cesium World Terrain 只用于三维可视化地形起伏。
2. 当前不使用 Cesium World Terrain 计算工程高程、离地高度或安全裕度。
3. 杆塔、航线、航点使用 `display_height_offset_m` 展示偏移，以避免真实地形开启后图层被遮挡；该偏移只是可视化偏移，不是 AGL。
4. 后续若要计算 AGL，应接入独立 DEM/DSM 或高程服务，并在数据管线中明确单位和来源。
5. Google Photorealistic 3D Tiles 或本地倾斜摄影 3D Tiles 才能提供接近 Google Earth 的真实三维实景；没有相应 key 或本地 3D Tiles 时，当前页面只承诺 `terrain_imagery` 效果。
