# 版本说明

## V0.1.0

发布日期：2026-06-26

版本定位：软著候选原型版。

## 一、核心能力

1. 完成巡检任务统计表、线路台账和 DJI KML 航线的数据读取与标准化处理。
2. 生成 `data/processed/` 下的 CSV、GeoJSON、manifest 和数据质量报告。
3. 提供 FastAPI 后端接口，支持杆塔、线路、航线、航点、任务、指标、质量问题和导入接口。
4. 提供 React + CesiumJS 三维沙盘前端，展示杆塔、KML 航线、航点和基站/机场候选点。
5. 支持对象点击属性查看、图层开关、航线选择、地图模式切换和 KML 导入。
6. 支持选择航线后的视距 / 菲涅尔走廊通信遮挡演示。
7. 提供项目级验收脚本、地图专项验收脚本、软著发布检查脚本和发布包生成脚本。

## 二、数据状态

当前处理结果：

1. 杆塔记录：849 条，其中 831 条具有有效经纬度。
2. 缺失坐标问题：18 条。
3. KML 航线：3 条。
4. KML 航点：72 个。
5. 航线与最近杆塔匹配置信度：当前 3 条均为 high。

以上为当前输入数据下的可验证处理结果，不代表所有泰安区域线路完整覆盖。

## 三、技术栈

1. 后端：Python、FastAPI、uvicorn、pandas、openpyxl。
2. 前端：React、Vite、CesiumJS、lucide-react。
3. 验收：pytest、Playwright、PowerShell。
4. 数据格式：CSV、GeoJSON、SQLite、JSON manifest。

## 四、边界声明

1. 当前版本未接入真实本地 DEM/DSM。
2. 当前版本未接入真实通信链路预算、实测信号质量或基站工程参数。
3. 当前版本未接入真实无人机能耗模型。
4. Cesium World Terrain 和在线地图瓦片只用于展示，不作为工程计算数据源。
5. 通信遮挡演示是视觉原型，不作为飞行安全或通信覆盖结论。

## 五、发布包说明

使用以下命令生成发布包：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package_release.ps1
```

默认发布包包含：

1. 后端、前端、脚本、测试和 MATLAB 原型源码。
2. Markdown 文档和软著辅助材料。
3. `data/processed/` 中的示例 processed 数据。
4. 源代码清单和文件 SHA-256 manifest。

默认不包含：

1. `frontend/.env` 和真实 token。
2. `.venv/`、`node_modules/`、`frontend/dist/`。
3. `raw/` 和 `data/raw/` 原始数据。
4. 运行时日志和临时测试目录。
