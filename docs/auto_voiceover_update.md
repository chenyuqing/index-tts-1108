# Auto Voiceover 功能更新摘要

面向本分支新增的自动配音功能做一个集中记录，便于查阅与后续合并。

## 1. 启动脚本与默认行为
- `start_auto_voiceover.sh` 负责一键执行 dry-run、启动 Flask UI，并默认使用 `test_input/scripts/what is understanding-hinton-CN.md`。若脚本不存在，可通过参数传入，脚本本身会提示缺失而不会默默修改路径。
- Dry-run 阶段生成的 manifest 会保存到 `outputs/auto_voiceover/<episode>_manifest.json`，输出目录统一为 `<out_root>/<脚本名>/chXX/`，避免与旧数据混淆。

## 2. 全新的 Flask WebUI
- 新增 `auto_voiceover_server.py` + `auto_voiceover_ui/index.html`：
  - Step1 卡片可浏览本地脚本/配置/输出/模型目录，并在界面上直接查看当前路径；
  - Step2 自动配音在同一面板中显示状态与实时日志（通过 `/api/state` 轮询 `job_control.logs`）；
  - 逐句微调入口：`http://<host>:<port>/review`。
- 所有 API（dry-run、generate、review、单段重配）都复用了 `tools/auto_voiceover.prepare_manifest()` 和新的输出目录规约，确保 DUB 目录与 manifest 一致。

## 3. 逐句微调 / Review 页面
- 访问 `/review` 可：
  - 加载章节 → 右侧“章节切换”仅显示一章的段落，页面不会无限下拉；
  - 对每段音频输入新的情绪描述并点击“生成/重新生成”触发 `/api/segment/regenerate`；
  - 音频不存在时按钮文案自动变为“生成”，并提示“尚未生成音频”。
- API 会在音频缺失时根据 `segment_id` 推导 `chXX/chXX-NN-<speaker>.wav`，并重新生成可播放链接。

## 4. CLI / Parser 改动
- Markdown 章节编号严格按照 `##` 的出现顺序自增（`ch00/ch01/...`），`---` 不再触发新章节，避免章号跳跃。
- `synthesize_segments()` 在处理前按章节 + 段落序号排序，即使“仅处理未完成”也会严格遵循 `ch00 → ch01 → ch02`。
- 支持 per-segment overrides：逐句微调页可传入新的情绪文本或覆盖文本，生成后会写回 manifest。

## 5. 逐句控制与日志
- 增加 `/api/control`（暂停/恢复/停止）与 `/api/state` 日志返回，目前暂停功能已留接口，但默认 UI 按钮已禁用，待后续完善。
- `job_control.logs` 在运行中会采集最新 200 条合成日志，前端实时展示。

## 6. 未完成事项
- 逐句微调页面的音频依赖已有输出，若首次生成需先跑一次整集。
- Pause/Resume 后端接口仍保留，但 UI 按钮默认禁用，待确认稳定后再开放。

> 上传到 GitHub：请在当前分支自检 `git status`、`git add/commit` 后，由本地执行 `git push`. CLI/脚本未内置 push 逻辑。
