# 自动化播客配音技术方案（PRD）

## 1. 背景与目标
- **背景**：现有播客内容需要人工录制或半自动拼接，效率低且不易复用。团队已拥有 IndexTTS2 推理能力，希望构建一条“Markdown 脚本 → 多主持人自动配音 → 成品音频”的流水线。
- **目标**：
  - 解析含多主持人台词的 Markdown 脚本，自动生成分段语音文件。
  - 支持中文、英文脚本，保持与示例目录一致的输出结构（`DUB/chXX/chXX-NN-<speaker>.wav`）。
  - 允许自定义音色、情感参数、停顿、背景音乐等播客要素。
  - 输出章节级与整集母带，并产出可追溯的生成清单。
- **成果物**：自动配音 CLI 工具、配置模板、文档与测试用例。

## 2. 术语说明
- **Segment**：脚本中一条主持人台词或指令，是 TTS 的最小处理单元。
- **Chapter**：与 Markdown 中的章节标题对应，编号规则 `ch00`、`ch01`…。
- **Directive**：脚本中的舞台指令（背景音乐、停顿、音量提示等）。
- **Speaker Profile**：主持人配置，包含音色参考、情感默认值、参数预设。
- **Manifest**：记录每个 Segment 的文本、参数、输出路径、耗时等信息的 JSON。

## 3. 用户画像与使用场景
- **核心用户**：播客制作人、内容团队编辑、需要批量生成语音内容的运营人员。
- **使用场景**：
  1. 将长篇播客脚本一次性转换为多个章节音频，快速获得初版 Demo。
  2. 对脚本做轻微修改后重新生成对应 Segment，实现增量更新（断点续跑）。
  3. 切换中文 / 英文版本脚本，生成双语节目以服务不同受众。
  4. 将舞台指令、背景音乐、停顿时长等嵌入脚本，实现自动化“听觉设计”。

## 4. 功能范围
### 4.1 必备功能
1. **Markdown 解析**
   - 识别章节标题、主持人台词（形如 `**Larei：**`）、舞台指令（括号或行内标签）。
   - 支持 `---` 分隔章节，引导输出目录 `ch00`（开场）及后续章节编号。
2. **任务规划**
   - 将脚本解析为有序 Segment 列表（含 `chapter_id`、`seq_no`、`speaker_id`、`text`、`directives`）。
   - 生成 manifest 草案，dry-run 模式仅打印执行计划。
3. **TTS 调度**
   - 基于 `IndexTTS2` 推理，加载并缓存每位主持人的音色参考与情感参数。
   - 支持多种情感控制模式（参考音频、向量、情感描述文本）。
   - 允许配置停顿时长、重试策略、并发/串行执行模式。
4. **音频后处理**
   - 对每个 Segment 进行响度归一化，可选静音 padding。
   - 根据 Directive 插入背景音乐、淡入淡出、停顿音频。
   - 拼接章节音频与整集母带，保存至约定目录。
5. **双语支持**
   - 可指定脚本语言，对应加载不同 speaker profile 与参数。
   - 允许为中文、英文分别输出目录或在 manifest 中标注配对关系。
6. **输出成品**
   - 分段音频：`DUB/chXX/chXX-NN-<speaker>.wav`。
   - 章节混音：可选 `DUB/chXX/chXX_mix.wav`。
   - 整集母带：`DUB/episode_master.wav`。
   - Manifest JSON、日志文件、可选字幕（SRT / JSONL）。

### 4.2 扩展功能（可选）
- GUI 或 WebUI 集成。
- 生成对齐时间戳用于字幕 / 口型对齐。
- 背景音乐自动剪辑、淡入淡出曲线编辑器。
- 版本管理：记录脚本 hash、语音参数以便回滚。

### 4.3 非目标
- 不提供 TTS 模型训练或调优流程。
- 不涉及在线实时合成；仅面向离线批处理。
- 暂不支持多语言混读（单 Segment 内中英交替需后续扩展）。

## 5. 系统流程概述
```
脚本输入 (Markdown)
        │
        ▼
Markdown Parser ──► Segment 列表 + Directives
        │
        ▼
任务规划器 ──► Manifest (dry-run/执行计划)
        │
        ▼
TTS 执行器 (IndexTTS2)
        │
        ├─► 分段 WAV 输出
        ▼
后处理管线 ──► 背景音乐、静音、响度
        │
        ├─► 章节混音
        └─► 整集母带 & Manifest & 日志
```

## 6. 技术方案
### 6.1 目录与文件组织
- 脚本：`scripts/<episode>.<lang>.md`
- Speaker 配置：`assets/speakers.yaml`
- 输出：`DUB/<lang?>/chXX/chXX-NN-<speaker>.wav`
- Manifest：`outputs/auto_voiceover/<脚本文件名>_manifest.json`
  - 示例：`22-the-gods-of-modern-ai-CN.md_manifest.json`
  - 示例：`22-the-gods-of-modern-ai-EN.md_manifest.json`
- 日志：`logs/auto_voiceover/<episode>.log`
- 样例脚本与说明：`docs/auto_voiceover/`

### 6.2 Markdown 解析策略
- 使用 `markdown-it-py` 或 `mistune` 获取 AST，再做二次解析；若依赖受限，可实现轻量级行解析器。
- 规则：
  - `#` / `##` 生成章节，自动编号（开场 Hook 强制 `ch00`）。
  - `**Name：**` / `**Name:**` 识别 speaker，支持中英文冒号。
  - 括号内容（`（音乐淡入）`/`(Music fades in)`）识别为 Directive。
  - `---` 作为章节分隔，若脚本无标题也可启动新章节。
  - 忽略非对白块（如代码块、引用），或写入日志。
- 解析输出结构：
```python
Segment = {
  "chapter": "ch01",
  "chapter_title": "第一章：AI 正在进入科学的“黄金十年”",
  "sequence": "ch01-03",
  "speaker": "leo",
  "language": "zh",
  "text": "我特别喜欢他们那句……",
  "directives": [
     {"type": "music", "action": "fade_out"},
     {"type": "pause", "duration": 1.5}
  ]
}
```

### 6.3 Speaker Profile 配置
- YAML 结构示例：
```yaml
speakers:
  leo:
    locale: zh
    voice_prompt: "prompts/leo_reference.wav"
    emo_mode: text  # audio / vector / text
    emo_vector: [0.2, 0.4, ...]
    emo_text: "沉稳、理性、富有洞察力"
    interval_silence: 0.15
    tts_params:
      top_p: 0.7
      temperature: 0.8
  leo_en:
    locale: en
    voice_prompt: "prompts/leo_en.wav"
    emo_text: "confident and warm"
```
- 支持引用情感参考音频、随机权重、默认停顿配置。

#### 逐句情感注入策略
- **情绪文本提示**：在脚本行内追加语气/情绪说明（或在前端“情感描述”中选择预设），由 TTS 按语义理解生成语调。实现成本低、适合快速调优，但模型对复杂描述的理解有限，需保持指令简洁。  
  **脚本示例**：
  ```markdown
  **Larei：** 【情绪=温暖而富有激情】如果有一天，AI 能在一分钟内解决科学家花三个月都没解开的实验难题……
  **Leo：** 【情绪=沉稳、理性】听起来像科幻片。可这事，真的发生了。
  ```
  ```markdown
  **Leo:** [Tone = Analytical, Neutral] Over the past year and a half, the finance industry has undergone a major shift.
  ```
  **解析流程**：Markdown 解析完成后，先执行一轮“情绪标记解析”，将 `【情绪=...】` 或 `Emotion:` 等语法抽取为 Segment 的情感提示字段，再把清洗后的正文送入配音执行。这样既能保留脚本文本可读性，也能保证在配音前情感指令已结构化。
- **参考音频驱动**：为关键台词指定短参考音频，让系统模仿其中的韵律与情绪。能复现真实说话风格、适合高潮段落；缺点是需要整理额外的情绪素材，建议每位主持人维护 2~3 条常用参考片段。
- **情绪向量调参**：通过滑杆或 JSON 设置“高兴/愤怒/悲伤/恐惧/反感/低落/惊讶/自然”等权重，直接驱动声学模型。可编程、易自动化，适用于批量脚本，但需要少量试验确定权重组合；可先以“自然=1.0”作为基线再叠加其他分量。
- **混合使用建议**：常规句子采用文本提示维持节奏，关键情绪句补充参考音频，自动化批量流程使用情绪向量调节，确保整体一致性的同时突出重点段落。

### 6.4 TTS 执行器设计
- 初始化 `IndexTTS2` 实例（加载 cfg、checkpoints、缓存），与 WebUI 共用推理套路。
- 缓存策略：同一 speaker 多次合成时复用 `cache_spk_cond`、`cache_s2mel_*` 等属性；脚本改动时允许清理缓存。
- 参数合并顺序：Segment 指定 > Speaker 默认 > 全局默认。
- 支持重试（异常/超过最大 token 触发），记录失败 Segment 并输出错误报告。
- 并发模型：默认串行，提供 `--workers N` 以线程池/进程池方式调度，但需注意 GPU 显存。

### 6.5 Directive 处理
- `music`：标记背景音乐事件，由后处理阶段决定淡入淡出。
- `pause`：生成静音音频；也可直接在 TTS 输出后插入。
- `gain`：调节音量（线性或 LUFS）。
- 自定义标签支持：如 `[速度:快]`、`[情绪:激动]` 映射到 TTS 参数。

### 6.6 后处理与混音
- 对每段音频执行：
  1. 转换为目标采样率（默认 22050Hz，视模型决定）。
  2. 响度归一化（含 LUFS 目标或 RMS）。
  3. 根据 Directive 插入静音 / 背景音乐占位。
- 章节混音：按 `chapter` 聚合 Segment，连接后输出 `chXX_mix.wav`。
- 整集母带：按章节顺序拼接，必要时插入章节间过渡音乐。
- 背景音乐（若配置）：读取 BGM 音频，按指令裁剪、淡入淡出，与语音混合。

### 6.7 Manifest 与日志
- Manifest JSON 字段：`segment_id`、`chapter`、`speaker`、`text_hash`、`output_path`、`duration`、`params`、`status`、`created_at`。
- 日志记录：解析警告、TTS 耗时、音频后处理细节、重试次数。
- Dry-run：打印 Segment 列表与计划输出路径，便于审核脚本。

### 6.8 WebUI 增强功能
- **逐句情绪微调面板**：解析 manifest 后按章节分组展示所有片段，支持在线试听、编辑文本与情绪提示、一键重配。重配输出保存在 `revisions/` 目录下，文件名沿用原始命名并自动追加序号（`-2/-3`）。
- **模型缓存复用**：WebUI 与 CLI 共用执行器缓存。首次合成加载模型后驻留内存，后续逐句重配或再次运行自动配音均直接复用，显著缩短响应时间。前端提供“释放模型缓存”按钮，可在需要时手动清理缓存并回收 GPU/CPU 资源。
- **编辑日志追踪**：每次逐句重配都会记录旧版与新版文本、情绪提示、生成文件与情绪模式，统一追加到 `revisions/edits_log.json`。前端展示最近 5 条修改，可下载完整日志以供 AI 总结或团队复盘。
- **Dry-run 结果可视化**：CLI 的 dry-run 输出现经过 WebUI 展示为摘要卡片与片段表格，包括段落数、涉及的主持人、未匹配的 speaker、计划输出目录等信息，方便在正式合成前校验脚本。

### 6.9 错误处理与恢复
- 如果输出文件已存在且未指定 `--force`，跳过并在 manifest 标记为 `skipped`.
- 若 TTS 失败，记录错误并继续后续 Segment；最终汇总失败列表。
- 提供 `--resume` 参数读取 manifest，只处理状态为 `pending`/`failed` 的 Segment。

## 7. 双语与多版本支持
- CLI 支持 `--language zh|en` 或自动从脚本文件名解析语言。
- Speaker Profile 中可为同一人物定义多语言条目（`leo` vs `leo_en`）。
- Manifest 中记录 `language` 与 `pair_id`，便于生成双语对照音频。
- 输出结构可选：
  - `DUB/zh/ch01/...`、`DUB/en/ch01/...`
  - 或单目录下通过文件名区分（`ch01-01-leo.zh.wav`）。

## 8. 开发计划
| 阶段 | 内容 | 里程碑 |
| --- | --- | --- |
| P0 | Markdown 解析 + CLI 骨架 + dry-run | 输出 Segment manifest |
| P1 | 集成 IndexTTS2 推理，生成分段 WAV | 可按示例脚本跑通 |
| P2 | 后处理（静音/响度/章节拼接） | 生成完整章节与母带 |
| P3 | 双语脚本支持 & Manifest 完善 | manifest、日志齐备 |
| P4 | 配置模板、文档、测试脚本 | `docs/`、`tests/auto_voiceover_test.py` |
| P5 (可选) | 背景音乐自动混合、GUI 接入 | 视资源安排 |

## 9. 风险与缓解
- **Markdown 结构复杂**：可能出现非标准格式 → 提供脚本校验、dry-run 检查、在文档中描述编写规范。
- **TTS 时延 / 显存压力**：长文本或大批量合成耗时高 → 按章节拆分、限制 `max_text_tokens_per_segment`、提供进度条和并发策略。
- **情感控制不一致**：脚本指令与默认配置冲突 → 定义覆盖优先级，统一日志提示。
- **背景音乐版权/长度问题**：先提供占位逻辑，提醒用户自行准备版权可用 BGM。
- **多语言音色差异**：需要单独准备参考音频；在配置中注明要求并在文档中提示。

## 10. 测试与验证
- **单元测试**：解析模块（章节编号、speaker 匹配、directives 提取）、配置加载、文件命名。
- **集成测试**：使用短脚本跑通全流程，验证输出目录结构、manifest 内容、音频可播放。
- **回归测试**：创建样例脚本（如上述中文/英文示例），比对生成的 manifest 与输出数量，必要时进行波形快照对比。
- **人工审核**：随机抽取若干 Segment，听感验证情感正确性与音量平衡。

## 11. 文档与交付
- 在 `docs/auto_voiceover/` 增补：
  - 使用指南（脚本规范、配置说明、常见问题）。
  - 样例脚本（中文/英文）。
  - 输出目录说明与后期编辑建议。
- CLI 帮助：`uv run tools/auto_voiceover.py --help` 提供参数说明。
- PR 清单：列出执行过的 `uv run` 命令、测试结果、示例 manifest/音频。

## 12. 附录
- **输出结构示例**：
```
DUB/
  ch00/
    ch00-01-larei.wav
    ch00-02-leo.wav
  ch01/
    ch01-01-leo.wav
    ...
  ch02/
    ...
  episode_master.wav
  # 注意：manifest文件实际存储在 outputs/auto_voiceover/ 目录下
```
- **示例脚本**：参考需求方提供的中英文 Markdown，作为测试与文档样例。

## 13. 输入目录与 CLI 示例

- **标准目录结构**（示例）：
```
project_root/
  DUB/
    Claude_Life_Sciences_Podcast_CN/
      ch00/
      ch01/
    Claude_Life_Sciences_Podcast_EN/
      ch00/
      ch01/
  scripts/
    Claude_Life_Sciences_Podcast_CN.md
    Claude_Life_Sciences_Podcast_EN.md
  voice-reference/
    larei/larei-voice.mp3
    leo/leo-voice.wav
    ...
  speakers.yaml
```
- **配置说明**：`speakers.yaml` 可仅保留情感/静音等自定义参数，通过 `voice_root` 自动匹配对应音色目录，缺省项由 `auto_speaker_defaults` 填充。
- **中文脚本命令示例**：
```
uv run python tools/auto_voiceover.py \
  --script tools/test_input/scripts/Claude_Life_Sciences_Podcast_CN.md \
  --config tools/test_input/speakers.yaml \
  --out-root tools/test_input/DUB/Claude_Life_Sciences_Podcast_CN \
  --voice-root tools/test_input/voice-reference \
  --language zh --dry-run
```
- **英文脚本命令示例**（输出到另一子目录，可使用同一配置与音色库）：
```
uv run python tools/auto_voiceover.py \
  --script tools/test_input/scripts/Claude_Life_Sciences_Podcast_EN.md \
  --config tools/test_input/speakers.yaml \
  --out-root tools/test_input/DUB/Claude_Life_Sciences_Podcast_EN \
  --voice-root tools/test_input/voice-reference \
  --language en --dry-run
```
- **前端入口**：`uv run python webui_auto_voiceover.py` 启动 Flask 页面后，只需填入基础目录即可列出脚本并执行 Dry-run / 正式合成。  
  - `Dry-run` 按钮会以当前脚本、情绪提示、主持人筛选等参数创建执行计划，但不会真正调用 TTS。页面会刷新并展示解析出的段落列表、情绪标记、预期输出路径以及缺失的主持人信息，便于正式生成前做脚本与配置的校验。
