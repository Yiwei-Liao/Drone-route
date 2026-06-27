# 用户使用手册

软件名称：泰安低空无人机巡检三维沙盘仿真系统

版本：V0.1.0

## 一、软件用途

本软件用于对泰安区域无人机巡检数据进行标准化处理和三维可视化展示。用户可以查看杆塔、KML 航线、航点、基站/机场候选点、数据质量问题，并对选定 KML 航线进行视距 / 菲涅尔走廊通信遮挡演示。

当前版本是工程原型，不作为真实飞行安全评估、真实通信覆盖评估或正式高程计算系统。

## 二、运行环境

1. Windows 10/11。
2. Python 3.10 或更高版本。
3. Node.js 20 或 22 及以上版本。
4. Microsoft Edge、Chrome 或其他现代 Chromium 浏览器。
5. 可选：Cesium ion token，用于加载 Cesium World Terrain。

## 三、首次安装

打开 Windows PowerShell：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup_python_env.ps1

cd "H:\drone signal taishan\frontend"
npm.cmd install
```

如果需要 Cesium 地形，在前端目录创建本机 `.env`：

```powershell
cd "H:\drone signal taishan\frontend"
notepad .env
```

`.env` 示例：

```text
VITE_CESIUM_ION_TOKEN=
VITE_USE_CESIUM_WORLD_TERRAIN=true
```

不要把真实 `.env` 或 token 提交、打包或发送到聊天中。

## 四、启动软件

一键启动前端和后端：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start_web.ps1
```

启动成功后，在浏览器打开：

```text
http://127.0.0.1:5173
```

停止服务：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop_web.ps1
```

检查服务：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check_status.ps1
```

## 五、主要界面

1. 顶部态势条：显示线路数量、杆塔数量、KML 航线数量和任务数量。
2. 左侧面板：提供线路/杆号筛选、图层开关、地图模式、KML 导入和航线选择。
3. 中央沙盘：显示真实地图瓦片、Cesium 三维地形、杆塔、航线、航点和通信遮挡演示。
4. 右侧面板：显示当前选中杆塔、航线、航点、基站或数据质量问题的属性。
5. 通信遮挡面板：选择航线后显示通信源、链路距离、菲涅尔净空和地形采样状态。

## 六、基本操作

1. 鼠标拖动地图：平移或旋转视角。
2. 鼠标滚轮：放大或缩小地图。
3. 点击杆塔：查看线路名称、杆号、经纬度、高度和来源字段。
4. 点击 KML 航线：查看航点数、航线长度、高度范围、最近杆塔和匹配距离。
5. 点击航点：查看航点序号、高度、所属航线和最近杆塔。
6. 点击左侧航线名称或复选框：切换当前通信遮挡演示航线。
7. 勾选或取消图层开关：控制杆塔、线路、航线、航点、基站/机场候选点和通信遮挡图层。
8. 点击数据质量问题：查看缺失坐标、源文件、源行和建议处理动作。

## 七、导入新增 KML

如果要把新的 KML 立即加入当前航线列表：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_kml_routes.ps1 `
  -FilePath "H:\new_data\route_001.kml" `
  -Note "新增航线，待核对线路和杆号"
```

该命令会把 `.kml` 加入 `data/raw/kml/`，不覆盖同名文件，并重新生成 `data/processed/`。

如果只是暂存未来数据，不希望立刻进入展示结果：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import_data.ps1 `
  -Category kml `
  -FilePath "H:\new_data\route_001.kml" `
  -Note "新增航线，待人工确认"
```

## 八、重新处理数据

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_data_pipeline.ps1
```

输出文件包括：

1. `data/processed/*.csv`
2. `data/processed/*.geojson`
3. `data/processed/manifest.json`
4. `output/data_quality_report.json`
5. `output/data_pipeline_log.json`

## 九、项目验收

核心验收：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1
```

带浏览器地图验收：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1 -RunBrowser
```

单独地图验收：

```powershell
cd "H:\drone signal taishan\frontend"
npm.cmd run verify:map
```

验收结果写入：

```text
output/project_verification_report.json
output/map_verification_report.json
output/verified-map.png
```

## 十、已知边界

1. 当前未接入真实本地 DEM/DSM。
2. Cesium World Terrain 只用于三维展示，不作为工程高程计算源。
3. 当前通信遮挡演示使用简化视距和菲涅尔规则，不是实测通信覆盖。
4. 当前 KML 没有真实时间戳，因此不推断真实飞行速度或飞行回放时间。
5. 线路候选几何按台账顺序生成，真实线路拓扑仍需人工确认。
6. 缺失坐标的杆塔不会被伪造位置。
