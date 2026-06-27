function route = parseDJIKML(kmlFile)
% 解析 DJI/MIS KML 文件中的航点坐标和扩展字段。
% 优先使用 Point 航点；如果没有 Point，则回退使用 LineString 坐标。

doc = xmlread(kmlFile);
[~, sourceName, sourceExt] = fileparts(kmlFile);
sourceFile = string(sourceName + sourceExt);

coordinates = readGeometryCoordinates(doc, "Point");
geometryUsed = "Point";
if isempty(coordinates)
    coordinates = readGeometryCoordinates(doc, "LineString");
    geometryUsed = "LineString";
end

n = size(coordinates, 1);
speed = padNumericValues(readTagValues(doc, "speed"), n);
heading = padNumericValues(readTagValues(doc, "heading"), n);
gimbalPitch = padNumericValues(readTagValues(doc, "gimbalPitch"), n);
turnMode = padStringValues(readTagValues(doc, "turnMode"), n);

waypoints = table((1:n)', coordinates(:, 1), coordinates(:, 2), coordinates(:, 3), ...
    speed, heading, gimbalPitch, turnMode, ...
    'VariableNames', {'sequence', 'longitude', 'latitude', 'altitude_m', ...
    'speed_mps', 'heading_deg', 'gimbal_pitch_deg', 'turn_mode'});

route.route_id = matlab.lang.makeValidName(sourceName);
route.route_name = string(sourceName);
route.source_file = sourceFile;
route.kml_file = string(kmlFile);
route.geometry_used = geometryUsed;
route.waypoints = waypoints;
end

function coordinates = readGeometryCoordinates(doc, geometryName)
% 从指定几何类型下读取 coordinates 文本。
    geometries = doc.getElementsByTagName(char(geometryName));
    coordinates = zeros(0, 3);
    for i = 0:geometries.getLength - 1
        geometry = geometries.item(i);
        coordNodes = geometry.getElementsByTagName("coordinates");
        for j = 0:coordNodes.getLength - 1
            text = string(char(coordNodes.item(j).getTextContent));
            coordinates = [coordinates; parseCoordinateText(text)]; %#ok<AGROW>
        end
    end
end

function coordinates = parseCoordinateText(text)
% 将 KML coordinates 字符串解析为 longitude/latitude/altitude。
    chunks = split(strtrim(text));
    coordinates = zeros(0, 3);
    for i = 1:numel(chunks)
        parts = split(chunks(i), ",");
        if numel(parts) < 2
            continue;
        end
        lon = str2double(parts(1));
        lat = str2double(parts(2));
        if numel(parts) >= 3
            alt = str2double(parts(3));
        else
            alt = NaN;
        end
        if ~isnan(lon) && ~isnan(lat)
            coordinates = [coordinates; lon, lat, alt]; %#ok<AGROW>
        end
    end
end

function values = readTagValues(doc, localTag)
% 读取 namespaced 或非 namespaced 扩展字段，如 mis:speed。
    values = strings(0, 1);
    nodes = doc.getElementsByTagNameNS("*", char(localTag));
    if nodes.getLength == 0
        nodes = doc.getElementsByTagName(char("mis:" + localTag));
    end
    if nodes.getLength == 0
        nodes = doc.getElementsByTagName(char(localTag));
    end
    for i = 0:nodes.getLength - 1
        values(end + 1, 1) = string(strtrim(char(nodes.item(i).getTextContent))); %#ok<AGROW>
    end
end

function values = padNumericValues(rawValues, n)
% 将扩展字段补齐到航点数，缺失位置为 NaN。
    values = NaN(n, 1);
    count = min(numel(rawValues), n);
    for i = 1:count
        values(i) = str2double(rawValues(i));
    end
end

function values = padStringValues(rawValues, n)
% 将字符串扩展字段补齐到航点数。
    values = strings(n, 1);
    count = min(numel(rawValues), n);
    for i = 1:count
        values(i) = rawValues(i);
    end
end
