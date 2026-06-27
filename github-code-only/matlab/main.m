% 阶段 1 主入口：读取台账、任务和 KML，输出航线指标、杆塔匹配和叠加图。
clear; clc;

projectRoot = fileparts(fileparts(mfilename("fullpath")));
outputDir = fullfile(projectRoot, "matlab", "output");
if ~isfolder(outputDir)
    mkdir(outputDir);
end

inputs = findStageInputs(projectRoot);
fprintf("阶段 1 输入目录：%s\n", inputs.sourceRoot);
fprintf("KML 文件数量：%d\n", numel(inputs.kmlFiles));

towers = readTowerLedger(inputs.ledgerFile);
tasks = readFlightTasks(inputs.taskFile);

routes = cell(numel(inputs.kmlFiles), 1);
routeMetrics = table();
routeMatches = table();

for i = 1:numel(inputs.kmlFiles)
    route = parseDJIKML(inputs.kmlFiles(i));
    metrics = computeRouteMetrics(route);
    match = matchRouteToTower(route, towers);

    routes{i} = route;
    routeMetrics = [routeMetrics; metrics]; %#ok<AGROW>
    routeMatches = [routeMatches; match]; %#ok<AGROW>

    fprintf("已处理 KML：%s，航点 %d 个，长度 %.2f m，最近杆塔距离 %.2f m\n", ...
        route.source_file, metrics.waypoint_count, metrics.total_length_m, match.min_distance_to_tower_m);
end

writetable(routeMetrics, fullfile(outputDir, "route_metrics.csv"), "Encoding", "UTF-8");
writetable(routeMatches, fullfile(outputDir, "route_tower_matching.csv"), "Encoding", "UTF-8");
plotInspectionMap(towers, routes, routeMatches, tasks, outputDir);
writeStageSummary(routeMetrics, routeMatches, outputDir);

fprintf("阶段 1 输出目录：%s\n", outputDir);

function inputs = findStageInputs(projectRoot)
% 优先使用规范 data/raw 目录；为空时回退使用当前已有 raw 目录。
    taskDir = fullfile(projectRoot, "data", "raw", "tasks");
    ledgerDir = fullfile(projectRoot, "data", "raw", "ledger");
    kmlDir = fullfile(projectRoot, "data", "raw", "kml");

    taskFiles = dir(fullfile(taskDir, "*.xlsx"));
    ledgerFiles = dir(fullfile(ledgerDir, "*.xlsx"));
    kmlFiles = dir(fullfile(kmlDir, "*.kml"));
    sourceRoot = fullfile(projectRoot, "data", "raw");

    if isempty(taskFiles) || isempty(ledgerFiles) || isempty(kmlFiles)
        legacyRaw = fullfile(projectRoot, "raw");
        allExcel = dir(fullfile(legacyRaw, "*.xlsx"));
        taskFiles = allExcel(contains({allExcel.name}, "巡检") | contains({allExcel.name}, "任务"));
        ledgerFiles = allExcel(contains({allExcel.name}, "台账"));
        kmlFiles = dir(fullfile(legacyRaw, "*.kml"));
        sourceRoot = legacyRaw;
    end

    if isempty(taskFiles)
        error("未找到巡检任务统计 Excel。");
    end
    if isempty(ledgerFiles)
        error("未找到线路台账 Excel。");
    end
    if isempty(kmlFiles)
        error("未找到 KML 航线文件。");
    end

    inputs.taskFile = string(fullfile(taskFiles(1).folder, taskFiles(1).name));
    inputs.ledgerFile = string(fullfile(ledgerFiles(1).folder, ledgerFiles(1).name));
    inputs.kmlFiles = string(fullfile({kmlFiles.folder}, {kmlFiles.name}));
    inputs.sourceRoot = string(sourceRoot);
end

function writeStageSummary(routeMetrics, routeMatches, outputDir)
% 生成轻量阶段说明，明确哪些结论是推断而非事实。
    summaryFile = fullfile(outputDir, "stage1_summary.md");
    fid = fopen(summaryFile, "w", "n", "UTF-8");
    cleaner = onCleanup(@() fclose(fid));

    fprintf(fid, "# MATLAB 阶段 1 验证摘要\n\n");
    fprintf(fid, "本文件由 `matlab/main.m` 生成。结论仅基于当前 Excel 与 KML 数据。\n\n");
    fprintf(fid, "## 航线类型推断\n\n");
    fprintf(fid, "| KML 文件 | 航点数 | 航线长度 m | 高度范围 m | 最近杆塔 | 匹配距离 m | 类型推断 |\n");
    fprintf(fid, "|---|---:|---:|---|---|---:|---|\n");
    for i = 1:height(routeMetrics)
        heightRange = sprintf("%.3f - %.3f", routeMetrics.min_altitude_m(i), routeMetrics.max_altitude_m(i));
        fprintf(fid, "| `%s` | %d | %.2f | %s | %s%s | %.2f | %s |\n", ...
            routeMetrics.source_file(i), routeMetrics.waypoint_count(i), routeMetrics.total_length_m(i), ...
            heightRange, routeMatches.line_name(i), routeMatches.tower_no(i), ...
            routeMatches.min_distance_to_tower_m(i), routeMetrics.route_type_guess(i));
    end
    fprintf(fid, "\n## 边界\n\n");
    fprintf(fid, "1. KML 高度含义仍为待确认，不能直接视为真实 AGL。\n");
    fprintf(fid, "2. 当前没有 DEM/DSM，因此不输出地形风险。\n");
    fprintf(fid, "3. 航线类型为规则推断，不代表人工复核结论。\n");
end
