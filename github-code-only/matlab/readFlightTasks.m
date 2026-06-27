function tasks = readFlightTasks(taskFile)
% 读取巡检任务统计表。
% 原始表第 2、3 行为复合表头，且两个时间列同名；这里保留 raw 字段并标注待确认。

raw = readcell(taskFile, 'Sheet', 'Sheet1', 'TextType', 'string');

varTypes = {'string', 'string', 'string', 'string', 'string', 'double', ...
    'string', 'string', 'string', 'double', 'double', 'double', 'double', ...
    'string', 'double', 'double', 'double', 'double', 'string', 'double', ...
    'double', 'double', 'string'};
varNames = {'route_file_hint', 'tower_full_name', 'line_name_guess', 'tower_no_guess', ...
    'uav_model', 'flight_height_m', 'sortie_id', 'route_id', 'start_time_raw', ...
    'temperature_c', 'humidity_percent', 'pressure_kpa', 'wind_speed_mps', ...
    'wind_direction_raw', 'rainfall_mm', 'duration_min', ...
    'flight_distance_unknown_unit', 'battery_remaining_raw', 'station_id', ...
    'station_longitude', 'station_latitude', 'station_altitude_m', 'source_file'};
tasks = table('Size', [0 numel(varNames)], 'VariableTypes', varTypes, 'VariableNames', varNames);

[~, sourceName, sourceExt] = fileparts(taskFile);
sourceFile = string(sourceName + sourceExt);

for r = 4:size(raw, 1)
    if isRowEmpty(raw(r, :))
        continue;
    end

    towerFullName = cellToString(raw{r, 3});
    [lineGuess, towerGuess] = splitTowerName(towerFullName);
    [stationLon, stationLat] = parseLonLat(cellToString(raw{r, 20}));

    newRow = table(cellToString(raw{r, 2}), towerFullName, lineGuess, towerGuess, ...
        cellToString(raw{r, 4}), cellToDouble(raw{r, 6}), cellToString(raw{r, 5}), ...
        cellToString(raw{r, 7}), cellToString(raw{r, 8}), cellToDouble(raw{r, 10}), ...
        cellToDouble(raw{r, 11}), cellToDouble(raw{r, 12}), cellToDouble(raw{r, 13}), ...
        cellToString(raw{r, 14}), cellToDouble(raw{r, 15}), cellToDouble(raw{r, 16}), ...
        cellToDouble(raw{r, 17}), cellToDouble(raw{r, 18}), cellToString(raw{r, 19}), ...
        stationLon, stationLat, cellToDouble(raw{r, 21}), sourceFile, ...
        'VariableNames', varNames);
    tasks = [tasks; newRow]; %#ok<AGROW>
end
end

function [lineName, towerNo] = splitTowerName(value)
% 从“线路名#杆号”中提取线路和杆号；无法识别时保留待确认信息。
    text = string(value);
    token = regexp(text, "^(.*?)(#\s*\d+.*)$", "tokens", "once");
    if isempty(token)
        lineName = "unknown";
        towerNo = "unknown";
    else
        lineName = string(token{1});
        towerNo = string(token{2});
    end
end

function [longitude, latitude] = parseLonLat(text)
% 解析“经度,纬度”字符串，无法解析时返回 NaN。
    parts = split(string(text), ",");
    if numel(parts) >= 2
        longitude = str2double(parts(1));
        latitude = str2double(parts(2));
    else
        longitude = NaN;
        latitude = NaN;
    end
end

function tf = isRowEmpty(row)
% 判断整行是否为空。
    tf = true;
    for i = 1:numel(row)
        if ~ismissingValue(row{i})
            tf = false;
            return;
        end
    end
end

function value = cellToString(item)
    if ismissingValue(item)
        value = "";
    elseif isstring(item)
        value = strtrim(item);
    elseif ischar(item)
        value = string(strtrim(item));
    else
        value = string(item);
    end
end

function value = cellToDouble(item)
    if ismissingValue(item)
        value = NaN;
    elseif isnumeric(item)
        value = double(item);
    else
        value = str2double(string(item));
    end
end

function tf = ismissingValue(item)
    tf = isempty(item) || (isstring(item) && (ismissing(item) || strlength(strtrim(item)) == 0)) ...
        || (ischar(item) && strlength(strtrim(string(item))) == 0);
end
