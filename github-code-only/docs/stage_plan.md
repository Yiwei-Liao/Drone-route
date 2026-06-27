# 阶段计划

## 总体目标

构建“泰安区域无人机巡检仿真原型项目”，形成从原始巡检数据到航线分析、杆塔匹配、地图展示和后续地形增强的工程闭环。

项目不应直接跳到复杂三维数字孪生，而应优先完成可验证的数据链路和基础仿真逻辑。

## 阶段 0：项目初始化与数据清点

### 目标

建立项目目录，读取 `data/raw/` 下的 Excel 和 KML 文件，输出数据清点报告。

### 输入文件

- `data/raw/tasks/泰安巡检任务统计.xlsx`
- `data/raw/ledger/线路台账（科技项目数据收集）.xlsx`
- `data/raw/kml/*.kml`

### 主要任务

1. 自动扫描 `data/raw/tasks/`、`data/raw/ledger/`、`data/raw/kml/`。
2. 输出每个文件的基本信息。
3. 对 Excel 输出 sheet 名、字段名、行数、空值比例。
4. 对 KML 输出航点数量、是否包含高度、是否包含 DJI/MIS 扩展字段。
5. 生成 `docs/data_inventory.md`。

### 完成标准

1. 能运行一个脚本完成数据清点。
2. `docs/data_inventory.md` 中列出所有输入文件及可用字段。
3. 不修改原始数据文件。

## 阶段 1：MATLAB 仿真验证原型

### 目标

先用 MATLAB 完成航线与杆塔数据的基础建模，验证数据是否能支撑仿真。

### 主要任务

1. 在 `matlab/` 下建立模块化脚本：
   - `main.m`
   - `readTowerLedger.m`
   - `readFlightTasks.m`
   - `parseDJIKML.m`
   - `computeRouteMetrics.m`
   - `matchRouteToTower.m`
   - `plotInspectionMap.m`
2. 读取线路台账中的杆塔经纬度。
3. 读取巡检任务统计中的飞行任务。
4. 解析 KML 中每个航点的经度、纬度、高度。
5. 尽量解析 DJI 扩展字段，例如 speed、heading、gimbalPitch、turnMode。
6. 计算每条航线的航点数、总长度、航点间距、高度范围、平均速度、航向变化。
7. 将 KML 航线与最近杆塔进行空间匹配，输出最近杆塔、距离、是否可能为绕塔巡检。
8. 绘制杆塔点、航线和基站/机场位置。
9. 输出 `matlab/output/route_metrics.csv` 和 `route_tower_matching.csv`。

### 完成标准

1. MATLAB 脚本可以从 `main.m` 一键运行。
2. 能生成至少一张航线与杆塔叠加图。
3. 能输出每条 KML 的航线指标表。
4. 能说明每条 KML 更像单塔巡检、局部巡检还是线路巡检。
5. 如果某些字段无法解析，必须在报告中说明原因，不要假装解析成功。

## 阶段 2：Python 数据管线与标准化

### 目标

将 MATLAB 验证过的逻辑迁移为 Python 数据处理管线，为后续 Web/GIS 系统做准备。

### 技术要求

1. 使用 Python。
2. 使用 pandas/openpyxl 读取 Excel。
3. 使用 XML 解析或 geospatial 库读取 KML。
4. 输出标准 CSV 和 GeoJSON。

### 主要任务

1. 建立 `backend/` 或 `scripts/` 数据处理模块。
2. 定义标准数据表：
   - `towers`
   - `lines`
   - `airports`
   - `base_stations`
   - `flight_tasks`
   - `routes`
   - `route_waypoints`
   - `route_tower_matches`
3. 输出 `data/processed/` 下的标准文件。
4. 生成 `docs/data_schema.md`，说明每张表字段、单位、来源文件、是否可为空。
5. 加入基础单元测试，验证坐标、距离、航线长度计算。

### 完成标准

1. Python 脚本能从原始 Excel 和 KML 生成标准化 CSV/GeoJSON。
2. 保留原始字段到标准字段的映射关系。
3. 对缺失字段、异常坐标、重复杆号进行检查并输出日志。
4. 测试可运行。

## 阶段 3：Web/GIS 可视化原型

### 目标

搭建一个可展示给项目组的 Web/GIS 原型。

### 技术要求

1. 后端使用 FastAPI。
2. 前端使用 React。
3. 地图优先使用 CesiumJS；如果三维实现复杂，可先用 Leaflet 做二维版本，但代码结构要支持后续切换到 CesiumJS。
4. 第一版数据库可使用 SQLite。

### 主要任务

1. 后端提供 API：
   - `/api/towers`
   - `/api/lines`
   - `/api/routes`
   - `/api/tasks`
   - `/api/metrics`
   - `/api/risk`
2. 前端地图展示：
   - 杆塔点
   - 线路连线
   - KML 航线
   - 机场/机巢
   - 基站
3. 支持点击杆塔查看台账信息。
4. 支持点击航线查看航点数量、航线长度、高度范围、最近杆塔、匹配距离。
5. 支持按线路名称、杆号、航线文件筛选。
6. 实现基础风险评分：
   - 航程过长
   - 电池余量偏低
   - 风速偏大
   - 航线高度异常
   - 距离机场过远
   - 与杆塔匹配异常
7. 生成 `README.md`，说明如何安装、运行、导入数据和查看页面。

### 完成标准

1. 后端能启动。
2. 前端能启动。
3. 地图能显示至少 3 条 KML 航线和线路台账中的杆塔。
4. 点击对象能看到对应属性。
5. README 中有完整运行步骤。

## 阶段 4：地形与通信增强预留

### 目标

不要求立即完成高保真仿真，但要为 DEM/DSM 地形和通信链路分析预留接口。

### 主要任务

1. 在代码中预留 DEM/DSM 数据目录 `data/raw/dem/`。
2. 设计 `terrain_sampler` 接口：
   - 输入经纬度。
   - 输出地形高程。
   - 计算 AGL 离地高度。
3. 设计通信链路接口：
   - 输入无人机航点和基站经纬度。
   - 输出距离、是否超阈值、是否需要进一步视距分析。
4. 文档中说明当前暂未接入真实地形数据，不允许生成虚假地形结果。

### 完成标准

1. `docs/assumptions_and_limits.md` 说明当前系统的边界。
2. terrain 和 communication 模块有清晰接口，但可以先返回 `DEM not provided`。
3. 不虚构地形高程、不虚构通信覆盖。
