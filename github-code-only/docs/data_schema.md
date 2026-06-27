# 数据字段设计说明

本文档定义项目中各类标准化数据表。字段设计用于指导 Codex 后续构建 Python 数据管线、数据库表和 Web/GIS API。

当前字段为建议版，实际实现时应以原始 Excel 和 KML 的可解析字段为准。无法确认含义的字段必须标记为“待确认”。

## 1. towers：杆塔表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| tower_id | string | - | 生成 | 杆塔唯一编号，建议由线路名称+杆号生成 |
| line_name | string | - | 线路台账 | 所属线路名称 |
| tower_no | string | - | 线路台账 | 杆号 |
| longitude | float | degree | 线路台账 | 经度 |
| latitude | float | degree | 线路台账 | 纬度 |
| tower_height | float | m | 线路台账 | 杆塔全高 |
| span_large_side | float | m | 线路台账 | 大号侧档距 |
| span_small_side | float | m | 线路台账 | 小号侧档距 |
| airport_name | string | - | 线路台账 | 关联机场/机巢 |
| distance_to_airport | float | m/km | 线路台账 | 与机场距离，单位需根据原始字段确认 |
| source_file | string | - | 生成 | 原始文件名 |

## 2. lines：线路表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| line_id | string | - | 生成 | 线路唯一编号 |
| line_name | string | - | 线路台账/任务统计 | 线路名称 |
| voltage_level | string | kV | 文件名/线路名 | 电压等级，例如 35kV、220kV |
| tower_count | int | - | 统计 | 该线路下杆塔数量 |
| geometry | geometry | - | 生成 | 由杆塔点拟合的线路空间结构 |
| source_file | string | - | 生成 | 原始文件名 |

注意：线路连线顺序不能简单按 Excel 行号确定，必须结合杆号规则或人工校核。

## 3. airports：机场/机巢表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| airport_id | string | - | 生成 | 机场/机巢唯一编号 |
| airport_name | string | - | 线路台账/任务统计 | 机场或机巢名称 |
| longitude | float | degree | 任务统计/台账 | 经度 |
| latitude | float | degree | 任务统计/台账 | 纬度 |
| altitude | float | m | 任务统计 | 海拔，若有 |
| source_file | string | - | 生成 | 原始文件名 |

## 4. base_stations：基站表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| station_id | string | - | 任务统计 | 基站编号 |
| station_name | string | - | 任务统计 | 基站名称 |
| longitude | float | degree | 任务统计 | 基站经度 |
| latitude | float | degree | 任务统计 | 基站纬度 |
| altitude | float | m | 任务统计 | 基站海拔 |
| source_file | string | - | 生成 | 原始文件名 |

## 5. flight_tasks：飞行任务表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| task_id | string | - | 生成/任务统计 | 任务唯一编号 |
| line_name | string | - | 任务统计 | 巡检线路 |
| tower_no | string | - | 任务统计 | 巡检杆塔编号 |
| uav_model | string | - | 任务统计 | 无人机型号 |
| route_id | string | - | 任务统计/KML | 航线编号 |
| flight_height | float | m | 任务统计 | 航线设定高度 |
| start_time | datetime | - | 任务统计 | 开始时间 |
| end_time | datetime | - | 任务统计 | 结束时间 |
| duration | float | s/min | 任务统计 | 飞行时长，单位需确认 |
| flight_distance | float | m/km | 任务统计 | 飞行距离，单位需确认 |
| battery_remaining | float | % | 任务统计 | 任务结束电池余量 |
| wind_speed | float | m/s | 任务统计 | 风速 |
| wind_direction | string/float | -/degree | 任务统计 | 风向 |
| temperature | float | ℃ | 任务统计 | 温度 |
| humidity | float | % | 任务统计 | 湿度 |
| rainfall | float | mm | 任务统计 | 雨量 |
| station_id | string | - | 任务统计 | 关联基站 |
| source_file | string | - | 生成 | 原始文件名 |

## 6. routes：航线表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| route_id | string | - | KML/生成 | 航线唯一编号 |
| route_name | string | - | KML/文件名 | 航线名称 |
| kml_file | string | - | KML | KML 文件名 |
| waypoint_count | int | - | KML | 航点数量 |
| total_length | float | m | 计算 | 航线总长度 |
| min_height | float | m | KML | 最小高度 |
| max_height | float | m | KML | 最大高度 |
| avg_height | float | m | KML | 平均高度 |
| avg_speed | float | m/s | KML | 平均速度，若可解析 |
| route_type_guess | string | - | 推断 | 可能为单塔巡检、局部巡检、线路巡检，需标记为推断 |
| source_file | string | - | 生成 | 原始文件名 |

## 7. route_waypoints：航点表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| waypoint_id | string | - | 生成 | 航点唯一编号 |
| route_id | string | - | KML/生成 | 所属航线 |
| sequence | int | - | KML | 航点序号 |
| longitude | float | degree | KML | 经度 |
| latitude | float | degree | KML | 纬度 |
| altitude | float | m | KML | 高度 |
| speed | float | m/s | KML 扩展字段 | 速度，若可解析 |
| heading | float | degree | KML 扩展字段 | 航向角，若可解析 |
| gimbal_pitch | float | degree | KML 扩展字段 | 云台俯仰角，若可解析 |
| turn_mode | string | - | KML 扩展字段 | 转弯模式，若可解析 |
| source_file | string | - | 生成 | 原始文件名 |

## 8. route_tower_matches：航线-杆塔匹配表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| match_id | string | - | 生成 | 匹配记录唯一编号 |
| route_id | string | - | 生成 | 航线编号 |
| tower_id | string | - | 生成 | 最近杆塔编号 |
| line_name | string | - | 台账/KML 文件名 | 线路名称 |
| tower_no | string | - | 台账/KML 文件名 | 杆号 |
| min_distance_to_tower | float | m | 计算 | 航线到最近杆塔的最小距离 |
| avg_distance_to_tower | float | m | 计算 | 航线到最近杆塔的平均距离 |
| max_distance_to_tower | float | m | 计算 | 航线覆盖半径 |
| match_confidence | string | - | 推断 | high/medium/low |
| match_reason | string | - | 推断 | 匹配依据 |
| source_file | string | - | 生成 | 原始文件名 |

## 9. risk_metrics：风险指标表

| 字段名 | 类型 | 单位 | 来源 | 说明 |
|---|---|---:|---|---|
| risk_id | string | - | 生成 | 风险记录编号 |
| task_id | string | - | 任务统计 | 任务编号 |
| route_id | string | - | KML/生成 | 航线编号 |
| battery_risk | string | - | 规则 | 电池风险 |
| distance_risk | string | - | 规则 | 航程风险 |
| wind_risk | string | - | 规则 | 风速风险 |
| height_risk | string | - | 规则 | 高度异常风险 |
| tower_match_risk | string | - | 规则 | 航线与杆塔匹配异常风险 |
| overall_risk | string | - | 规则 | 综合风险 |
| risk_explanation | string | - | 生成 | 风险说明 |

## 字段处理原则

1. 经纬度必须保持 WGS84 坐标系，除非明确转换。
2. 所有距离计算应使用大地测量距离或近似投影距离，不建议直接用经纬度差。
3. 高度字段必须区分：
   - KML 航点高度；
   - 任务表航线设定高度；
   - 杆塔全高；
   - DEM 地形高程；
   - AGL 离地高度。
4. 当前无 DEM 数据时，不得输出真实 AGL。
5. 所有推断字段必须标记为“推断”或“需验证”。

## 阶段 2 实际输出文件

阶段 2 Python 管线由 `python scripts/process_data.py` 生成，输出目录为 `data/processed/`。

| 标准表 | 输出文件 | GeoJSON | 说明 |
|---|---|---|---|
| towers | `data/processed/towers.csv` | `data/processed/towers.geojson` | 线路台账杆塔点 |
| lines | `data/processed/lines.csv` | `data/processed/lines.geojson` | 由台账杆塔点按原表顺序生成的线路候选几何，需人工校核拓扑 |
| airports | `data/processed/airports.csv` | 暂无 | 台账中的机场/机巢名称；当前无经纬度，不生成点几何 |
| base_stations | `data/processed/base_stations.csv` | `data/processed/base_stations.geojson` | 任务表基站编号与经纬度 |
| flight_tasks | `data/processed/flight_tasks.csv` | 暂无 | 巡检任务标准表 |
| routes | `data/processed/routes.csv` | `data/processed/routes.geojson` | KML 航线指标 |
| route_waypoints | `data/processed/route_waypoints.csv` | `data/processed/route_waypoints.geojson` | KML 航点 |
| route_tower_matches | `data/processed/route_tower_matches.csv` | 暂无 | 航线到最近杆塔的空间匹配 |

质量日志与字段映射保存在 `output/data_pipeline_log.json`。

处理清单保存在 `data/processed/manifest.json`，并通过 `/api/manifest` 提供给验收脚本和前端使用。该清单记录：

- 原始任务表、线路台账和 KML 文件的相对路径、文件大小、修改时间和 `sha256`；
- 处理后 CSV/GeoJSON/JSON 文件的相对路径、文件大小和 `sha256`；
- 标准表行数、字段数和 GeoJSON feature 数；
- 数据质量问题统计、坐标字段约定和本轮管线 warnings。

`manifest.json` 只用于数据追溯和验收，不代表 DEM/DSM 高程、通信覆盖或飞行安全结论。

## 阶段 2 字段、单位、来源与可空性

### towers

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| tower_id | - | 生成 | 否 | 线路名和杆号生成的键 |
| line_name | - | 线路台账 | 是 | 空白线路名按合并单元格语义前向填充 |
| tower_no | - | 线路台账 | 是 | 杆号，`#009` 归一为 `#9` |
| longitude | degree | 线路台账 | 是 | WGS84 经度；缺失会写入日志 |
| latitude | degree | 线路台账 | 是 | WGS84 纬度；缺失会写入日志 |
| tower_height | m | 线路台账 | 是 | 杆塔全高 |
| span_large_side | m | 线路台账 | 是 | 大号侧档距 |
| span_small_side | m | 线路台账 | 是 | 小号侧档距 |
| airport_name | - | 线路台账 | 是 | 机场/机巢名称 |
| distance_to_airport | unknown | 线路台账 | 是 | 原表未明确单位，待确认 |
| source_file | - | 生成 | 否 | 原始文件名 |
| source_row | - | 生成 | 否 | 原 Excel 行号 |

### lines

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| line_id | - | 生成 | 否 | 线路唯一键 |
| line_name | - | 线路台账 | 否 | 线路名称 |
| voltage_level | kV | 线路名解析 | 是 | 从线路名提取，无法提取则为空 |
| tower_count | - | 统计 | 否 | 线路下杆塔记录数 |
| valid_coordinate_count | - | 统计 | 否 | 有效坐标杆塔数 |
| geometry_source | - | 生成 | 否 | 当前为台账行序，需人工验证 |
| source_file | - | 生成 | 否 | 来源文件 |

### airports

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| airport_id | - | 生成 | 否 | 机场/机巢键 |
| airport_name | - | 线路台账 | 否 | 机场/机巢名称 |
| longitude | degree | 待补充 | 是 | 当前原始数据未提供，不伪造 |
| latitude | degree | 待补充 | 是 | 当前原始数据未提供，不伪造 |
| altitude | m | 待补充 | 是 | 当前原始数据未提供 |
| source_file | - | 生成 | 否 | 来源文件 |
| note | - | 生成 | 否 | 缺失说明 |

### base_stations

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| station_id | - | 任务统计 | 否 | 基站编号 |
| station_name | - | 任务统计 | 否 | 当前同基站编号 |
| longitude | degree | 任务统计 | 是 | 基站经度 |
| latitude | degree | 任务统计 | 是 | 基站纬度 |
| altitude | m | 任务统计 | 是 | 基站海拔 |
| source_file | - | 生成 | 否 | 来源文件 |

### flight_tasks

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| task_id | - | 任务统计 | 否 | 飞行架次编号或生成键 |
| route_file_hint | - | 任务统计 | 是 | 原表“无人机巡检线路名称”，样例中更像 KML 文件提示 |
| line_name | - | 任务统计解析 | 是 | 从杆塔全名拆出 |
| tower_no | - | 任务统计解析 | 是 | 从杆塔全名拆出 |
| tower_full_name | - | 任务统计 | 是 | 原始巡检杆塔编号 |
| uav_model | - | 任务统计 | 是 | 无人机型号 |
| sortie_id | - | 任务统计 | 是 | 飞行架次编号 |
| route_id_raw | - | 任务统计 | 是 | 飞行航线编号 |
| flight_height | m | 任务统计 | 是 | 航线设定高度 |
| start_time_raw | unknown | 任务统计 | 是 | Excel 原始时间值 |
| end_time_raw_pending_confirm | unknown | 任务统计 | 是 | 原表重复“运行日志开始时间”，暂按结束时间候选处理 |
| temperature | ℃ | 任务统计 | 是 | 温度 |
| humidity | % | 任务统计 | 是 | 湿度 |
| pressure | kPa | 任务统计 | 是 | 气压 |
| wind_speed | m/s | 任务统计 | 是 | 风速 |
| wind_direction | degree/text | 任务统计 | 是 | 风向，可能为角度或中文风向 |
| rainfall | mm | 任务统计 | 是 | 雨量 |
| duration | min | 任务统计 | 是 | 飞行时长 |
| flight_distance | unknown | 任务统计 | 是 | 原字段单位为 `mk`，待确认 |
| battery_remaining | V | 任务统计 | 是 | 原字段为电池电量（V），不是百分比 |
| station_id | - | 任务统计 | 是 | 基站编号 |
| station_longitude | degree | 任务统计 | 是 | 基站经度 |
| station_latitude | degree | 任务统计 | 是 | 基站纬度 |
| station_altitude | m | 任务统计 | 是 | 基站海拔 |
| source_file | - | 生成 | 否 | 来源文件 |
| source_row | - | 生成 | 否 | 原 Excel 行号 |

### routes

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| route_id | - | KML/生成 | 否 | 航线键 |
| route_name | - | KML 文件名 | 否 | 航线名称 |
| kml_file | - | KML | 否 | 文件名 |
| geometry_used | - | KML | 否 | 当前优先使用 Point 航点 |
| waypoint_count | - | KML | 否 | 航点数 |
| total_length | m | 计算 | 否 | Haversine 分段累计 |
| mean_segment_distance | m | 计算 | 是 | 平均航点间距 |
| max_segment_distance | m | 计算 | 是 | 最大航点间距 |
| min_height | m | KML | 是 | KML 高度，含义待确认 |
| max_height | m | KML | 是 | KML 高度，含义待确认 |
| avg_height | m | KML | 是 | KML 高度，含义待确认 |
| avg_speed | m/s | KML 扩展字段 | 是 | speed 可解析时填充 |
| heading_change | degree | KML 扩展字段/计算 | 是 | 航向累计变化 |
| route_radius | m | 计算 | 是 | 航点到航线中心的最大距离 |
| route_type_guess | - | 规则推断 | 否 | 单塔/局部/线路巡检候选，必须标记为推断 |
| source_file | - | 生成 | 否 | 来源 KML |

### route_waypoints

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| waypoint_id | - | 生成 | 否 | 航点键 |
| route_id | - | 生成 | 否 | 所属航线 |
| sequence | - | KML | 否 | 航点序号 |
| longitude | degree | KML | 否 | 经度 |
| latitude | degree | KML | 否 | 纬度 |
| altitude | m | KML | 是 | 高度含义待确认 |
| speed | m/s | KML 扩展字段 | 是 | `speed` |
| heading | degree | KML 扩展字段 | 是 | `heading` |
| gimbal_pitch | degree | KML 扩展字段 | 是 | `gimbalPitch` |
| turn_mode | - | KML 扩展字段 | 是 | `turnMode` |
| source_file | - | 生成 | 否 | 来源 KML |

### route_tower_matches

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| match_id | - | 生成 | 否 | 匹配键 |
| route_id | - | 生成 | 否 | 航线键 |
| tower_id | - | 台账匹配 | 是 | 最近杆塔键 |
| line_name | - | 台账匹配 | 是 | 最近杆塔线路 |
| tower_no | - | 台账匹配 | 是 | 最近杆塔杆号 |
| min_distance_to_tower | m | 计算 | 是 | 航点到该杆塔的最小距离 |
| avg_distance_to_tower | m | 计算 | 是 | 航点到该杆塔的平均距离 |
| max_distance_to_tower | m | 计算 | 是 | 航点到该杆塔的最大距离 |
| match_confidence | - | 规则推断 | 否 | high/medium/low |
| match_reason | - | 规则推断 | 否 | 匹配理由 |
| source_file | - | 生成 | 否 | 来源 KML |
### coordinate_backfill_template

由 `data_quality_issues` 中的 `missing_coordinate` 问题派生，用于人工补录坐标，不是原始数据源。

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| source_file | - | 数据管线 | 否 | 应回到的原始 Excel 文件 |
| source_row | - | 数据管线 | 否 | 应回到的原始 Excel 行号 |
| entity_id | - | 数据管线 | 否 | 缺失坐标对象 ID |
| line_name | - | 台账 | 否 | 线路名称 |
| tower_no | - | 台账 | 否 | 杆号 |
| current_longitude | degree | 台账 | 是 | 当前经度，缺失问题中通常为空 |
| current_latitude | degree | 台账 | 是 | 当前纬度，缺失问题中通常为空 |
| longitude_to_fill | degree | 人工补录 | 是 | 待人工补录经度，不由系统生成 |
| latitude_to_fill | degree | 人工补录 | 是 | 待人工补录纬度，不由系统生成 |
| coordinate_source | - | 人工补录 | 是 | 坐标来源说明 |
| reviewer | - | 人工补录 | 是 | 复核人 |
| review_status | - | 生成/人工更新 | 否 | 默认 `pending` |
| notes | - | 生成 | 否 | 补录说明；补齐后应回写原始台账并重跑管线 |

### coordinate_backfill_validation

由 `coordinate_backfill_template` 派生，用于校验人工填写的待补坐标；不回写原始台账。

| 字段名 | 单位 | 来源 | 可为空 | 说明 |
|---|---:|---|---|---|
| source_file | - | 补录模板 | 否 | 原始 Excel 文件 |
| source_row | - | 补录模板 | 否 | 原始 Excel 行号 |
| entity_id | - | 补录模板 | 否 | 缺失坐标对象 ID |
| line_name | - | 补录模板 | 否 | 线路名称 |
| tower_no | - | 补录模板 | 否 | 杆号 |
| longitude_to_fill | degree | 人工补录 | 是 | 人工填写经度 |
| latitude_to_fill | degree | 人工补录 | 是 | 人工填写纬度 |
| coordinate_source | - | 人工补录 | 是 | 坐标来源说明 |
| reviewer | - | 人工补录 | 是 | 复核人 |
| review_status | - | 补录模板/人工更新 | 否 | 复核状态 |
| validation_status | - | 校验规则 | 否 | `pending`、`incomplete`、`invalid_numeric`、`possible_lon_lat_swapped`、`out_of_taian_range` 或 `valid` |
| validation_issue | - | 校验规则 | 是 | 校验原因 |
