function plotInspectionMap(towers, routes, routeMatches, tasks, outputDir)
% 绘制杆塔、KML 航线和基站位置叠加图。
% 不使用在线底图，避免把展示效果误当作外部地理数据来源。

fig = figure("Visible", "off", "Color", "white", "Position", [100 100 1100 800]);
hold on;
grid on;
box on;

validTowers = towers(~isnan(towers.longitude) & ~isnan(towers.latitude), :);
scatter(validTowers.longitude, validTowers.latitude, 18, [0.20 0.32 0.56], "filled", ...
    "DisplayName", "杆塔");

colors = lines(max(numel(routes), 1));
for i = 1:numel(routes)
    route = routes{i};
    wp = route.waypoints;
    plot(wp.longitude, wp.latitude, "-o", "Color", colors(i, :), ...
        "LineWidth", 1.4, "MarkerSize", 3.5, "DisplayName", route.source_file);
end

if ~isempty(tasks) && all(ismember(["station_longitude", "station_latitude"], string(tasks.Properties.VariableNames)))
    stations = unique(tasks(~isnan(tasks.station_longitude) & ~isnan(tasks.station_latitude), ...
        ["station_id", "station_longitude", "station_latitude"]));
    if ~isempty(stations)
        scatter(stations.station_longitude, stations.station_latitude, 45, [0.85 0.28 0.16], ...
            "^", "filled", "DisplayName", "基站/机场候选");
    end
end

for i = 1:height(routeMatches)
    text(routeMatches.tower_longitude(i), routeMatches.tower_latitude(i), ...
        "  " + routeMatches.line_name(i) + routeMatches.tower_no(i), ...
        "FontSize", 8, "Color", [0.15 0.15 0.15], "Interpreter", "none");
end

xlabel("longitude");
ylabel("latitude");
title("泰安区域无人机巡检：杆塔与 KML 航线叠加验证图");
legend("Location", "bestoutside", "Interpreter", "none");
axis equal;

outputFile = fullfile(outputDir, "inspection_map.png");
exportgraphics(fig, outputFile, "Resolution", 180);
close(fig);
end
