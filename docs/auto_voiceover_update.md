# Auto Voiceover 功能更新摘要

面向本分支新增的自动配音功能做一个集中记录，便于查阅与后续合并。

## 1. 启动脚本与默认行为
- `start_auto_voiceover.sh` 负责一键执行 dry-run、启动 Flask UI，并默认使用 `test_input/scripts/what is understanding-hinton-CN.md`。若脚本不存在，会在 `test_input/scripts` 下自动查找首个 `.md` 脚本并提示 fallback 结果；也可以通过参数显式传入。
- Dry-run 阶段生成的 manifest 会保存到 `outputs/auto_voiceover/<脚本文件名>_manifest.json`（包含完整脚本名以避免中英文版本冲突），输出目录统一为 `<out_root>/<脚本名>/chXX/`，避免与旧数据混淆。
- Flask `/api/defaults`、UI 文件浏览器都复用了相同的 fallback 逻辑，确保“脚本/配置/输出/模型”输入框随时有可见路径，不会出现“目录都是空的”。

## 2. 全新的 Flask WebUI
- 新增 `auto_voiceover_server.py` + `auto_voiceover_ui/index.html`：
  - Step1 卡片可浏览本地脚本/配置/输出/模型目录，并在界面上直接查看当前路径；
  - Step2 自动配音在同一面板中显示状态与实时日志（通过 `/api/state` 轮询 `job_control.logs`）；
  - 逐句微调入口：`http://<host>:<port>/review`。
- 所有 API（dry-run、generate、review、单段重配）都复用了 `tools/auto_voiceover.prepare_manifest()` 和新的输出目录规约，确保 DUB 目录与 manifest 一致。

## 3. 逐句微调 / Review 页面
- 访问 `/review` 可：
  - 加载章节 → 右侧“章节切换”仅显示一章的段落，页面不会无限下拉；
  - 每个段落都提供“脚本文本 + 情绪描述”两个 textarea，可直接编辑脚本内容、微调情绪后点击“生成/重新生成”触发 `/api/segment/regenerate`；
  - Audio 不存在时按钮文案自动变为“生成”，提示“尚未生成音频”；重新生成成功后自动刷新音频链接；
  - 主站首页顶部和侧边导航都增加了“逐句微调”跳转按钮，切换更快捷。
- 所有 review 输出写入 `DUB/<脚本名>/review/chXX/<segment>-<speaker>.wav`，不会覆盖自动配音主流程产物；API 会在音频缺失时根据 `segment_id` 推导目标路径。

## 4. CLI / Parser 改动
- Markdown 章节编号严格按照 `##` 的出现顺序自增（`ch00/ch01/...`），`---` 不再触发新章节，避免章号跳跃。
- 新增语言检测：parser 会采样正文自动识别 `zh/en`，并在 manifest/segments 的 `metadata.language`、顶层 `manifest["language"]` 写入实际语言；如识别为中文，会把正文中的 `Larei/Leo` 自动替换为 `翠花/里奥`（但保留 `**Larei:**` 这样的发言头）。
- `normalize_segment_text()` 去掉了 Markdown 粗体/斜体残留（比如 `**`/`__`），逐句微调加载的文本更加干净。
- `synthesize_segments()` 在处理前按章节 + 段落序号排序，即使“仅处理未完成”也会严格遵循 `ch00 → ch01 → ch02`。
- Review 页面传入的 overrides 同时支持 `emotion` 与 `text`，输入框内的修改会直接用于实时生成，并写回 manifest。

## 5. 逐句控制与日志
- 增加 `/api/control`（暂停/恢复/停止）与 `/api/state` 日志返回，目前暂停功能已留接口，但默认 UI 按钮已禁用，待后续完善。
- `job_control.logs` 在运行中会采集最新 200 条合成日志，前端实时展示。

## 6. Speaker 检测逻辑改进
- **问题**: 正则表达式 `[<span class="highlight">w\u4e00-\u9fff]+</span>` 过于宽泛，会将长句如"它回到了最根本的问题"误识别为 speaker 名称
- **解决方案**:
  - 新增 `is_valid_speaker_name()` 方法：限制 speaker 名称为 1-8 字符，排除包含句子标志的长词组
  - 改进 `_looks_like_speaker_header()` 方法：智能区分情绪标记和 Markdown 格式，优先检查 `【情绪=xxx】` 等标记
  - 双重验证：speaker 匹配现在需要同时通过名称验证和头部验证
- **效果**: 行如"它回到了最根本的问题：**数据质量 (Data Quality)**..."现在正确识别为 Larei 的内容，而不是新 speaker

## 7. 未完成事项
- 逐句微调页面的音频依赖已有输出，若首次生成需先跑一次整集。
- Pause/Resume 后端接口仍保留，但 UI 按钮默认禁用，待确认稳定后再开放。

> 上传到 GitHub：请在当前分支自检 `git status`、`git add/commit` 后，由本地执行 `git push`. CLI/脚本未内置 push 逻辑。
