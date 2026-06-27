# GitHub 上传说明

此目录是代码-only 上传版本，已排除原始数据、处理结果、运行输出、虚拟环境、前端依赖目录、构建产物和 Word/PPT/Excel 等大文件。

## 推荐方式：Git 命令行上传

1. 在 GitHub 网页新建一个空仓库，建议先选 Private。
2. 打开 PowerShell，进入本目录：

```powershell
cd "H:\drone signal taishan\release\github-code-only"
```

3. 初始化并提交：

```powershell
git init
git branch -M main
git add .
git commit -m "Initial code-only release"
```

4. 绑定你的 GitHub 仓库并推送：

```powershell
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

把 `<你的用户名>` 和 `<仓库名>` 换成你的实际 GitHub 地址。

## 如果安装了 GitHub CLI

```powershell
cd "H:\drone signal taishan\release\github-code-only"
gh auth login
gh repo create <仓库名> --private --source . --remote origin --push
```

## 上传前确认

- 不包含 `data/raw/` 原始数据。
- 不包含 `raw/` 原始数据。
- 不包含 `output/` 运行输出。
- 不包含 `frontend/node_modules/` 和 `frontend/dist/`。
- 不包含 `.env` 本地环境文件。
- 不包含 Word/PPT/Excel/图片/数据库等生成或大文件。

需要运行项目时，请按 `README.md` 安装依赖，并自行放入本地数据文件。原始数据不应提交到 GitHub。
