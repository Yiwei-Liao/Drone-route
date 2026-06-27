"""阶段 0 数据清点脚本。

本脚本只读取原始 Excel/KML 文件，生成 docs/data_inventory.md。
它优先扫描 data/raw/tasks、data/raw/ledger、data/raw/kml；如果这些规范目录
暂时为空，则回退扫描项目根目录下已有的 raw/，并在报告中明确说明。
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SPREADSHEET_NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


@dataclass
class InputFile:
    """记录一个输入文件的分类和实际路径。"""

    category: str
    path: Path
    source_root: str


def is_empty(value: object) -> bool:
    """统一判断 Excel 单元格是否为空。"""

    return value is None or str(value).strip() == ""


def column_number(cell_ref: str) -> int:
    """将 Excel 单元格列号（如 AB12）转换为数字列序号。"""

    match = re.match(r"([A-Z]+)", cell_ref or "")
    if not match:
        return 0
    number = 0
    for char in match.group(1):
        number = number * 26 + ord(char) - ord("A") + 1
    return number


def file_size_text(size_bytes: int) -> str:
    """用便于报告阅读的方式显示文件大小。"""

    if size_bytes >= 1024 * 1024:
        return f"{size_bytes / 1024 / 1024:.2f} MB"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes} B"


def markdown_escape(text: object) -> str:
    """转义 Markdown 表格中的竖线和换行。"""

    if text is None:
        return ""
    return str(text).replace("|", "\\|").replace("\n", "<br>")


def discover_inputs(project_root: Path) -> tuple[list[InputFile], list[str]]:
    """发现阶段 0 输入文件。

    规范路径为空时，回退扫描 legacy raw/，但不会移动或修改原始文件。
    """

    expected = {
        "tasks": project_root / "data" / "raw" / "tasks",
        "ledger": project_root / "data" / "raw" / "ledger",
        "kml": project_root / "data" / "raw" / "kml",
    }
    files: list[InputFile] = []
    notes: list[str] = []

    for category, folder in expected.items():
        if folder.exists():
            patterns = ["*.xlsx"] if category in {"tasks", "ledger"} else ["*.kml"]
            for pattern in patterns:
                for path in sorted(folder.glob(pattern)):
                    files.append(InputFile(category, path, "data/raw"))

    if files:
        return files, notes

    legacy_raw = project_root / "raw"
    if legacy_raw.exists():
        notes.append(
            "规范目录 data/raw/tasks、data/raw/ledger、data/raw/kml 当前为空；"
            "本次清点回退扫描项目现有 raw/ 目录。"
        )
        for path in sorted(legacy_raw.iterdir()):
            if path.suffix.lower() == ".kml":
                files.append(InputFile("kml", path, "raw"))
            elif path.suffix.lower() == ".xlsx":
                name = path.name
                if "台账" in name:
                    category = "ledger"
                elif "巡检" in name or "任务" in name:
                    category = "tasks"
                else:
                    category = "unknown_excel"
                files.append(InputFile(category, path, "raw"))

    return files, notes


def read_shared_strings(zip_file: zipfile.ZipFile) -> list[str]:
    """读取 xlsx 内部共享字符串表。"""

    try:
        root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    strings: list[str] = []
    for item in root.findall("main:si", SPREADSHEET_NS):
        text = "".join(t.text or "" for t in item.findall(".//main:t", SPREADSHEET_NS))
        strings.append(text)
    return strings


def read_sheet_paths(zip_file: zipfile.ZipFile) -> list[tuple[str, str]]:
    """读取 workbook 中 sheet 名称及其 XML 路径。"""

    workbook = ET.fromstring(zip_file.read("xl/workbook.xml"))
    rels = ET.fromstring(zip_file.read("xl/_rels/workbook.xml.rels"))
    rel_map = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}

    sheets: list[tuple[str, str]] = []
    for sheet in workbook.findall("main:sheets/main:sheet", SPREADSHEET_NS):
        rel_id = sheet.attrib.get(f"{{{SPREADSHEET_NS['rel']}}}id")
        target = rel_map.get(rel_id, "")
        if not target.startswith("xl/"):
            target = "xl/" + target.lstrip("/")
        sheets.append((sheet.attrib.get("name", "unknown"), target))
    return sheets


def read_cell_value(cell: ET.Element, shared_strings: list[str]) -> str | None:
    """解析 xlsx 单元格值，保留原始文本/数字字符串。"""

    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        value = "".join(t.text or "" for t in cell.findall(".//main:t", SPREADSHEET_NS))
        return value

    value_element = cell.find("main:v", SPREADSHEET_NS)
    if value_element is None:
        return None

    raw_value = value_element.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)]
        except (TypeError, ValueError, IndexError):
            return raw_value
    return raw_value


def read_xlsx_rows(path: Path, sheet_xml_path: str) -> tuple[str | None, list[list[str | None]]]:
    """从 xlsx 压缩包中读取指定 sheet 的二维单元格数据。"""

    with zipfile.ZipFile(path) as zip_file:
        shared_strings = read_shared_strings(zip_file)
        sheet_root = ET.fromstring(zip_file.read(sheet_xml_path))
        dimension = sheet_root.find("main:dimension", SPREADSHEET_NS)
        rows: list[list[str | None]] = []

        for row in sheet_root.findall("main:sheetData/main:row", SPREADSHEET_NS):
            values_by_col: dict[int, str | None] = {}
            for cell in row.findall("main:c", SPREADSHEET_NS):
                col = column_number(cell.attrib.get("r", ""))
                if col:
                    values_by_col[col] = read_cell_value(cell, shared_strings)
            width = max(values_by_col) if values_by_col else 0
            rows.append([values_by_col.get(i) for i in range(1, width + 1)])

        return (dimension.attrib.get("ref") if dimension is not None else None), rows


def forward_fill(row: list[str | None], width: int) -> list[str | None]:
    """对复合表头第一层做前向填充，模拟 Excel 合并单元格语义。"""

    result: list[str | None] = []
    last: str | None = None
    for index in range(width):
        value = row[index] if index < len(row) else None
        if not is_empty(value):
            last = value
        result.append(last)
    return result


def make_unique_fields(fields: Iterable[str]) -> list[str]:
    """字段重名时增加序号，避免空值比例统计混淆。"""

    seen: dict[str, int] = {}
    unique: list[str] = []
    for field in fields:
        base = field or "unknown"
        seen[base] = seen.get(base, 0) + 1
        unique.append(base if seen[base] == 1 else f"{base} ({seen[base]})")
    return unique


def infer_header_rows(path: Path, category: str, sheet_name: str, rows: list[list[str | None]]) -> tuple[list[str], int, list[str]]:
    """根据文件类型推断字段名和数据起始行。"""

    warnings: list[str] = []
    if not rows:
        return [], 0, ["空工作表或未发现有效单元格。"]

    if category == "tasks" and sheet_name == "Sheet1" and len(rows) >= 3:
        width = max(len(rows[1]), len(rows[2]))
        parent = forward_fill(rows[1], width)
        child = rows[2] + [None] * (width - len(rows[2]))
        fields: list[str] = []
        for index in range(width):
            top = parent[index]
            sub = child[index]
            if not is_empty(top) and not is_empty(sub) and str(top).strip() != str(sub).strip():
                fields.append(f"{top} / {sub}")
            else:
                fields.append(str(top or sub or f"column_{index + 1}"))
        warnings.append("巡检任务表检测为复合表头：第 2 行为主表头，第 3 行为子表头。")
        return make_unique_fields(fields), 3, warnings

    if category == "ledger" and sheet_name == "Sheet1":
        fields = [str(value or f"column_{index + 1}") for index, value in enumerate(rows[0])]
        return make_unique_fields(fields), 1, warnings

    # 兜底：选择前 10 行中非空字段最多的一行作为表头。
    candidates = rows[:10]
    header_index = max(range(len(candidates)), key=lambda i: sum(not is_empty(v) for v in candidates[i]))
    fields = [str(value or f"column_{index + 1}") for index, value in enumerate(candidates[header_index])]
    warnings.append(f"表头行由启发式推断为第 {header_index + 1} 行，需人工确认。")
    return make_unique_fields(fields), header_index + 1, warnings


def null_ratios(fields: list[str], data_rows: list[list[str | None]]) -> list[tuple[str, int, float]]:
    """计算每个字段的非空数量和空值比例。"""

    valid_rows = [row for row in data_rows if any(not is_empty(value) for value in row)]
    row_count = len(valid_rows)
    ratios: list[tuple[str, int, float]] = []
    for index, field in enumerate(fields):
        non_empty = 0
        for row in valid_rows:
            if index < len(row) and not is_empty(row[index]):
                non_empty += 1
        null_ratio = 0.0 if row_count == 0 else (row_count - non_empty) / row_count
        ratios.append((field, non_empty, null_ratio))
    return ratios


def scan_excel(input_file: InputFile) -> dict[str, object]:
    """扫描 Excel 文件的工作表、字段和空值比例。"""

    with zipfile.ZipFile(input_file.path) as zip_file:
        sheets = read_sheet_paths(zip_file)

    sheet_reports = []
    for sheet_name, sheet_path in sheets:
        dimension, rows = read_xlsx_rows(input_file.path, sheet_path)
        fields, data_start, warnings = infer_header_rows(input_file.path, input_file.category, sheet_name, rows)
        data_rows = rows[data_start:]
        valid_data_rows = [row for row in data_rows if any(not is_empty(value) for value in row)]
        sheet_reports.append(
            {
                "name": sheet_name,
                "dimension": dimension,
                "row_count": len(valid_data_rows),
                "field_count": len(fields),
                "fields": fields,
                "null_ratios": null_ratios(fields, data_rows),
                "warnings": warnings,
            }
        )

    return {"path": input_file.path, "category": input_file.category, "sheets": sheet_reports}


def local_name(tag: str) -> str:
    """去掉 XML 命名空间，便于识别 KML/MIS/DJI 标签。"""

    return tag.split("}", 1)[-1]


def parse_coordinates(text: str | None) -> list[tuple[float, float, float | None]]:
    """解析 KML coordinates 文本为 lon/lat/alt 元组。"""

    coordinates: list[tuple[float, float, float | None]] = []
    if not text:
        return coordinates
    for chunk in text.split():
        parts = chunk.split(",")
        if len(parts) < 2:
            continue
        try:
            longitude = float(parts[0])
            latitude = float(parts[1])
            altitude = float(parts[2]) if len(parts) >= 3 and parts[2] != "" else None
        except ValueError:
            continue
        coordinates.append((longitude, latitude, altitude))
    return coordinates


def collect_coordinates_by_geometry(root: ET.Element, geometry_name: str) -> list[tuple[float, float, float | None]]:
    """按 Point 或 LineString 几何类型收集坐标。"""

    result: list[tuple[float, float, float | None]] = []
    for element in root.iter():
        if local_name(element.tag) != geometry_name:
            continue
        for child in element.iter():
            if local_name(child.tag) == "coordinates":
                result.extend(parse_coordinates(child.text))
    return result


def scan_kml(input_file: InputFile) -> dict[str, object]:
    """扫描 KML 航点、高度和扩展字段。"""

    text = input_file.path.read_text(encoding="utf-8-sig", errors="replace")
    root = ET.fromstring(text)

    point_coordinates = collect_coordinates_by_geometry(root, "Point")
    line_coordinates = collect_coordinates_by_geometry(root, "LineString")
    all_coordinates = point_coordinates or line_coordinates
    altitudes = [coord[2] for coord in all_coordinates if coord[2] is not None]

    tag_counts: dict[str, int] = {}
    for element in root.iter():
        name = local_name(element.tag)
        tag_counts[name] = tag_counts.get(name, 0) + 1

    extension_fields = [
        field
        for field in ["speed", "heading", "gimbalPitch", "turnMode", "useWaylineAltitude", "actions"]
        if tag_counts.get(field, 0) > 0
    ]
    namespace_prefixes = sorted(set(re.findall(r"xmlns(?::([A-Za-z0-9_\-]+))?=", text)))

    return {
        "path": input_file.path,
        "category": input_file.category,
        "point_waypoint_count": len(point_coordinates),
        "line_coordinate_count": len(line_coordinates),
        "has_height": len(altitudes) > 0,
        "altitude_min": min(altitudes) if altitudes else None,
        "altitude_max": max(altitudes) if altitudes else None,
        "has_mis_extension": "mis:" in text or "mis" in namespace_prefixes,
        "has_dji_extension": "dji:" in text or "wpml:" in text,
        "extension_fields": extension_fields,
        "namespace_prefixes": namespace_prefixes,
    }


def make_file_table(files: list[InputFile], project_root: Path) -> str:
    """生成输入文件基本信息表。"""

    lines = [
        "| 类别 | 文件 | 来源目录 | 大小 | 修改时间 |",
        "|---|---|---|---:|---|",
    ]
    for item in files:
        stat = item.path.stat()
        rel = item.path.relative_to(project_root)
        modified = dt.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
        lines.append(
            f"| {item.category} | `{markdown_escape(rel)}` | `{item.source_root}` | "
            f"{file_size_text(stat.st_size)} | {modified} |"
        )
    return "\n".join(lines)


def make_excel_section(report: dict[str, object], project_root: Path) -> str:
    """生成单个 Excel 文件的 Markdown 清点内容。"""

    path = Path(report["path"])  # type: ignore[arg-type]
    rel = path.relative_to(project_root)
    lines = [f"### `{markdown_escape(rel)}`", ""]

    for sheet in report["sheets"]:  # type: ignore[index]
        lines.extend(
            [
                f"#### Sheet：{markdown_escape(sheet['name'])}",
                "",
                f"- 使用范围：`{markdown_escape(sheet['dimension'])}`",
                f"- 数据行数（不含表头/说明行）：{sheet['row_count']}",
                f"- 字段数：{sheet['field_count']}",
            ]
        )
        for warning in sheet["warnings"]:
            lines.append(f"- 注意：{markdown_escape(warning)}")
        lines.append("")

        if sheet["fields"]:
            lines.append("字段：")
            lines.append("")
            lines.append("| 字段 | 非空行数 | 空值比例 |")
            lines.append("|---|---:|---:|")
            for field, non_empty, ratio in sheet["null_ratios"]:
                lines.append(f"| {markdown_escape(field)} | {non_empty} | {ratio:.1%} |")
            lines.append("")
        else:
            lines.append("未发现可用字段。")
            lines.append("")

    return "\n".join(lines)


def make_kml_section(reports: list[dict[str, object]], project_root: Path) -> str:
    """生成 KML 文件清点表。"""

    lines = [
        "| 文件 | Point 航点数 | LineString 坐标数 | 含高度 | 高度范围 | MIS 扩展 | DJI/WPML 扩展 | 可见扩展字段 |",
        "|---|---:|---:|---|---|---|---|---|",
    ]
    for report in reports:
        path = Path(report["path"])  # type: ignore[arg-type]
        rel = path.relative_to(project_root)
        alt_range = "无"
        if report["has_height"]:
            alt_range = f"{report['altitude_min']:.3f} - {report['altitude_max']:.3f}"
        lines.append(
            f"| `{markdown_escape(rel)}` | {report['point_waypoint_count']} | "
            f"{report['line_coordinate_count']} | {'是' if report['has_height'] else '否'} | "
            f"{alt_range} | {'是' if report['has_mis_extension'] else '否'} | "
            f"{'是' if report['has_dji_extension'] else '否'} | "
            f"{markdown_escape(', '.join(report['extension_fields']) or '未发现')} |"
        )
    return "\n".join(lines)


def write_report(
    project_root: Path,
    output_path: Path,
    files: list[InputFile],
    notes: list[str],
    excel_reports: list[dict[str, object]],
    kml_reports: list[dict[str, object]],
) -> None:
    """写出 docs/data_inventory.md。"""

    generated_at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        "# 数据清点报告",
        "",
        f"生成时间：{generated_at}",
        "",
        "本报告由 `python scripts/inventory_data.py` 生成。脚本只读取原始数据，不移动、不覆盖、不修改原始文件。",
        "",
        "## 目录状态",
        "",
    ]

    if notes:
        for note in notes:
            lines.append(f"- {note}")
    else:
        lines.append("- 已在规范目录 `data/raw/tasks`、`data/raw/ledger`、`data/raw/kml` 中发现输入文件。")
    lines.extend(
        [
            "- DEM/DSM 目录已预留为 `data/raw/dem`；当前未发现真实 DEM/DSM 数据。",
            "",
            "## 输入文件总览",
            "",
            make_file_table(files, project_root) if files else "未发现输入文件。",
            "",
            "## Excel 文件清点",
            "",
        ]
    )

    if excel_reports:
        for report in excel_reports:
            lines.append(make_excel_section(report, project_root))
            lines.append("")
    else:
        lines.append("未发现 Excel 输入文件。")
        lines.append("")

    lines.extend(["## KML 文件清点", ""])
    if kml_reports:
        lines.append(make_kml_section(kml_reports, project_root))
    else:
        lines.append("未发现 KML 输入文件。")

    lines.extend(
        [
            "",
            "## 当前可用字段与数据风险",
            "",
            "1. 巡检任务表为复合表头，字段映射需要保留主表头和子表头，重复字段必须人工确认。",
            "2. 线路台账存在大量线路名单元格为空的情况，后续解析应按合并单元格语义进行前向填充，并保留处理日志。",
            "3. KML 文件当前更像单塔或局部巡检航线，不能直接视为完整线路巡检航迹。",
            "4. KML 高度字段含义尚未由数据证明，只能暂记为 KML 坐标高度或航线高度候选。",
            "5. 当前未发现 DEM/DSM 数据，不能计算真实地形高程、AGL 离地高度或地形遮挡风险。",
            "6. 当前通信数据不足以证明覆盖质量，后续最多先计算航点到基站直线距离和阈值提示。",
            "",
            "## 阶段 0 完成情况",
            "",
            "1. 已完成：目录骨架初始化、原始 Excel/KML 只读扫描、数据清点报告生成。",
            "2. 使用输入文件：见“输入文件总览”。",
            "3. 生成输出文件：`docs/data_inventory.md`。",
            "4. 可验证结论：文件数量、sheet 名、字段名、行数、空值比例、KML 航点数量、高度存在性和扩展字段存在性。",
            "5. 假设：规范目录为空时回退使用现有 `raw/` 目录作为当前原始数据位置。",
            "6. 需要补充：是否将原始文件正式归档到 `data/raw/tasks`、`data/raw/ledger`、`data/raw/kml`；KML 高度含义；任务表重复时间字段含义；真实 DEM/DSM。",
            "7. 下一阶段依赖：MATLAB 读取 Excel/KML 的稳定性验证，以及航线指标和杆塔匹配逻辑验证。",
            "",
        ]
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="生成阶段 0 数据清点报告")
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="项目根目录")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs") / "data_inventory.md",
        help="输出 Markdown 报告路径",
    )
    args = parser.parse_args()

    project_root = args.root.resolve()
    output_path = args.output if args.output.is_absolute() else project_root / args.output

    files, notes = discover_inputs(project_root)
    excel_reports = [scan_excel(item) for item in files if item.path.suffix.lower() == ".xlsx"]
    kml_reports = [scan_kml(item) for item in files if item.path.suffix.lower() == ".kml"]
    write_report(project_root, output_path, files, notes, excel_reports, kml_reports)

    print(f"已生成数据清点报告：{output_path}")
    print(f"扫描输入文件数量：{len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
