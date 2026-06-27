# 发布与软著候选版检查清单

本文档用于检查 V0.1.0 是否具备“可运行、可验收、可封装、可准备软著材料”的状态。

## 一、发布前检查

运行：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check_release_readiness.ps1
```

检查内容：

1. 版本号文件和前端 package 版本存在。
2. `.gitignore` 已排除 `.env`、`frontend/.env`、`.venv`、`node_modules`、`release/` 等敏感或临时目录。
3. `frontend/.env.example` 只保留变量名，不包含真实 token。
4. README、用户手册、软著材料说明、源码清单、版本说明和验收文档存在。
5. 后端、前端、脚本、测试和 processed 示例数据的关键文件存在。
6. 发布脚本和项目验收脚本存在。

检查报告写入：

```text
output/release_readiness_report.json
```

## 二、项目级验收

快速验收：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1
```

完整浏览器验收：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify_project.ps1 -RunBrowser
```

验收报告：

```text
output/project_verification_report.json
output/map_verification_report.json
output/verified-map.png
```

## 三、发布包生成

生成软著候选发布包：

```powershell
cd "H:\drone signal taishan"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package_release.ps1
```

生成结果：

```text
release/taishan-uav-sandtable-v0.1.0/
release/taishan-uav-sandtable-v0.1.0.zip
```

发布包内关键文件：

1. `README.md`
2. `VERSION`
3. `backend/`
4. `frontend/`
5. `scripts/`
6. `tests/`
7. `matlab/`
8. `docs/software_copyright_materials.md`
9. `docs/source_code_manifest.md`
10. `docs/user_manual.md`
11. `docs/release_notes.md`
12. `release_materials/source_code_listing.txt`
13. `RELEASE_MANIFEST.json`

## 四、敏感信息检查

发布包默认不得包含：

1. `.env`
2. `.env.local`
3. `frontend/.env`
4. `frontend/.env.local`
5. 真实 Cesium ion token
6. Google Maps API key
7. `.venv/`
8. `node_modules/`
9. 原始业务数据 `raw/`、`data/raw/`

说明：`frontend/.env.example` 可以包含变量名，但 token 和 key 必须为空。

## 五、软著材料交付建议

登记材料可从发布包中提取：

1. 软件说明书：`docs/user_manual.md`
2. 源代码文档：`release_materials/source_code_listing.txt`
3. 源码清单：`docs/source_code_manifest.md`
4. 功能和技术说明：`docs/software_copyright_materials.md`
5. 版本说明：`docs/release_notes.md`
6. 截图证据：`output/verified-map.png`，如需纳入请从工作区单独导出。

## 六、当前不可声称的内容

软著说明或项目汇报中不要把当前版本描述为：

1. 已实现真实 DEM/DSM 工程高程计算。
2. 已实现真实通信覆盖预测。
3. 已实现真实无人机能耗模型。
4. 已实现 Google Earth 级别实景三维数字孪生。
5. 可直接指导真实飞行安全决策。

可以描述为：

1. 基于真实巡检数据的标准化处理和三维展示原型。
2. 数据质量核验和杆塔航线匹配原型。
3. 山体通信影响的视距 / 菲涅尔可视化演示原型。
4. 为后续 DEM/DSM、通信模型和能耗模型接入预留接口。
