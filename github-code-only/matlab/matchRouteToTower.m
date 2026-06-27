function match = matchRouteToTower(route, towers)
% 将航线与最近杆塔进行空间匹配。
% 匹配依据仅为空间距离，不假设 KML 一定完整覆盖线路。

wp = route.waypoints;
validTowers = towers(~isnan(towers.longitude) & ~isnan(towers.latitude), :);

if isempty(validTowers) || isempty(wp)
    match = emptyMatch(route);
    return;
end

minDistances = NaN(height(validTowers), 1);
avgDistances = NaN(height(validTowers), 1);
maxDistances = NaN(height(validTowers), 1);

for i = 1:height(validTowers)
    distances = haversineMeters(validTowers.longitude(i), validTowers.latitude(i), ...
        wp.longitude, wp.latitude);
    minDistances(i) = min(distances, [], "omitnan");
    avgDistances(i) = mean(distances, "omitnan");
    maxDistances(i) = max(distances, [], "omitnan");
end

[nearestDistance, idx] = min(minDistances);
nearestTower = validTowers(idx, :);
routeRadius = max(haversineMeters(mean(wp.longitude, "omitnan"), mean(wp.latitude, "omitnan"), ...
    wp.longitude, wp.latitude), [], "omitnan");

if nearestDistance <= 20 && routeRadius <= 80
    inspectionFlag = true;
    confidence = "high";
    reason = "航线围绕最近杆塔且最小距离小于 20 m（推断）";
elseif nearestDistance <= 80
    inspectionFlag = true;
    confidence = "medium";
    reason = "航线接近最近杆塔但覆盖范围较大（推断）";
else
    inspectionFlag = false;
    confidence = "low";
    reason = "航线与最近杆塔距离偏大，需人工复核";
end

match = table(string(route.route_id), string(route.source_file), nearestTower.line_name, ...
    nearestTower.tower_no, nearestTower.longitude, nearestTower.latitude, nearestDistance, ...
    avgDistances(idx), maxDistances(idx), inspectionFlag, confidence, reason, ...
    'VariableNames', {'route_id', 'source_file', 'line_name', 'tower_no', ...
    'tower_longitude', 'tower_latitude', 'min_distance_to_tower_m', ...
    'avg_distance_to_tower_m', 'max_distance_to_tower_m', ...
    'possible_tower_inspection', 'match_confidence', 'match_reason'});
end

function match = emptyMatch(route)
% 无有效杆塔或航点时，输出可写表的空匹配记录。
    match = table(string(route.route_id), string(route.source_file), "unknown", "unknown", ...
        NaN, NaN, NaN, NaN, NaN, false, "low", "缺少有效杆塔坐标或航点", ...
        'VariableNames', {'route_id', 'source_file', 'line_name', 'tower_no', ...
        'tower_longitude', 'tower_latitude', 'min_distance_to_tower_m', ...
        'avg_distance_to_tower_m', 'max_distance_to_tower_m', ...
        'possible_tower_inspection', 'match_confidence', 'match_reason'});
end

function distance = haversineMeters(lon1, lat1, lon2, lat2)
% 使用 Haversine 公式计算 WGS84 经纬度近似球面距离。
    earthRadius = 6371000;
    lon1 = deg2rad(lon1);
    lat1 = deg2rad(lat1);
    lon2 = deg2rad(lon2);
    lat2 = deg2rad(lat2);
    dlon = lon2 - lon1;
    dlat = lat2 - lat1;
    a = sin(dlat ./ 2).^2 + cos(lat1) .* cos(lat2) .* sin(dlon ./ 2).^2;
    distance = 2 .* earthRadius .* asin(sqrt(a));
end
