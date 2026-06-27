function towers = readTowerLedger(ledgerFile)
% 读取线路台账，输出标准杆塔表。
% 注意：线路名称存在 Excel 合并单元格/空白行语义，这里进行前向填充。

raw = readcell(ledgerFile, 'Sheet', 'Sheet1', 'TextType', 'string');

varTypes = {'string', 'string', 'double', 'double', 'double', 'double', ...
    'double', 'string', 'double', 'string'};
varNames = {'line_name', 'tower_no', 'longitude', 'latitude', 'tower_height_m', ...
    'span_large_side_m', 'span_small_side_m', 'airport_name', ...
    'distance_to_airport_unknown_unit', 'source_file'};
towers = table('Size', [0 numel(varNames)], 'VariableTypes', varTypes, 'VariableNames', varNames);

currentLine = "";
[~, sourceName, sourceExt] = fileparts(ledgerFile);
sourceFile = string(sourceName + sourceExt);

for r = 2:size(raw, 1)
    lineValue = cellToString(raw{r, 2});
    if strlength(lineValue) > 0
        currentLine = lineValue;
    end

    towerNo = cellToString(raw{r, 3});
    longitude = cellToDouble(raw{r, 4});
    latitude = cellToDouble(raw{r, 5});

    % 缺少杆号且缺少坐标的行不作为有效杆塔。
    if strlength(towerNo) == 0 && (isnan(longitude) || isnan(latitude))
        continue;
    end

    newRow = table(currentLine, towerNo, longitude, latitude, ...
        cellToDouble(raw{r, 6}), cellToDouble(raw{r, 7}), cellToDouble(raw{r, 8}), ...
        cellToString(raw{r, 9}), cellToDouble(raw{r, 10}), sourceFile, ...
        'VariableNames', varNames);
    towers = [towers; newRow]; %#ok<AGROW>
end
end

function value = cellToString(item)
% 将 readcell 的混合类型值稳定转为 string。
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
% 将数字或文本数字转成 double，无法解析时返回 NaN。
    if ismissingValue(item)
        value = NaN;
    elseif isnumeric(item)
        value = double(item);
    else
        value = str2double(string(item));
    end
end

function tf = ismissingValue(item)
% 统一识别空单元格、missing 和空字符串。
    tf = isempty(item) || (isstring(item) && (ismissing(item) || strlength(strtrim(item)) == 0)) ...
        || (ischar(item) && strlength(strtrim(string(item))) == 0);
end
