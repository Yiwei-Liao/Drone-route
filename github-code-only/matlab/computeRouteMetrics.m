function metrics = computeRouteMetrics(route)
% 计算航点数、航线长度、高度范围、平均速度和航向变化等指标。

wp = route.waypoints;
n = height(wp);

if n >= 2
    segmentDistances = haversineMeters(wp.longitude(1:end-1), wp.latitude(1:end-1), ...
        wp.longitude(2:end), wp.latitude(2:end));
else
    segmentDistances = zeros(0, 1);
end

totalLength = sum(segmentDistances, "omitnan");
altitudes = wp.altitude_m;
speeds = wp.speed_mps;
headings = wp.heading_deg;

routeRadius = max(haversineMeters(mean(wp.longitude, "omitnan"), mean(wp.latitude, "omitnan"), ...
    wp.longitude, wp.latitude), [], "omitnan");
headingChange = sum(abs(normalizeAngleDiff(diff(headings))), "omitnan");
routeTypeGuess = classifyRoute(n, totalLength, routeRadius);

metrics = table(string(route.route_id), string(route.source_file), n, totalLength, ...
    mean(segmentDistances, "omitnan"), max(segmentDistances, [], "omitnan"), ...
    min(altitudes, [], "omitnan"), max(altitudes, [], "omitnan"), mean(altitudes, "omitnan"), ...
    mean(speeds, "omitnan"), headingChange, routeRadius, routeTypeGuess, ...
    'VariableNames', {'route_id', 'source_file', 'waypoint_count', 'total_length_m', ...
    'mean_segment_distance_m', 'max_segment_distance_m', 'min_altitude_m', ...
    'max_altitude_m', 'mean_altitude_m', 'avg_speed_mps', ...
    'heading_change_deg', 'route_radius_m', 'route_type_guess'});
end

function routeType = classifyRoute(waypointCount, totalLength, routeRadius)
% 基于当前少量 KML 的经验规则，只输出“推断”，不作为确定结论。
    if waypointCount <= 35 && routeRadius <= 80
        routeType = "单塔巡检（推断）";
    elseif totalLength <= 1500
        routeType = "局部巡检（推断）";
    else
        routeType = "线路巡检候选（待验证）";
    end
end

function diffValue = normalizeAngleDiff(diffValue)
% 将航向差归一到 [-180, 180]，避免 359 到 1 度被算成 358 度。
    diffValue = mod(diffValue + 180, 360) - 180;
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
