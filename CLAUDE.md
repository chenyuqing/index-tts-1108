# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

IndexTTS2 是一个情感表现丰富且支持时长控制的自回归零样本文本转语音系统。此代码库包含：

1. **核心 TTS 引擎** (`indextts/`) - 主要的 IndexTTS2 推理引擎，包含基于 GPT 的模型、BigVGAN 声码器和支持工具
2. **自动配音工作流** (`tools/auto_voiceover.py`) - 将 Markdown 播客脚本转换为多说话人音频作品的综合系统
3. **Flask Web UI** (`auto_voiceover_server.py`) - 自动配音工作流的网页界面
4. **Gradio WebUI** (`webui.py`) - 单次生成任务的传统 TTS 网页界面
5. **有声书处理** - 将 EPUB 转换为音频作品的工具

## 架构设计

### 核心 TTS 组件
- `indextts/infer_v2.py` - 主要的 IndexTTS2 推理类，支持情感控制和时长管理
- `indextts/gpt/` - 用于 TTS 生成的基于 GPT 的语言模型组件
- `indextts/s2mel/` - 语音到梅尔频谱转换模块，包括流匹配和扩散变换器
- `indextts/BigVGAN/` - 用于高质量音频生成的神经声码器
- `indextts/utils/` - 文本处理、检查点管理和常用操作的工具

### 自动配音流水线
自动配音系统遵循以下架构：
1. **Markdown 解析器** - 将播客脚本解析为带有说话人识别和指令的片段
2. **清单生成器** - 创建执行计划并跟踪处理状态
3. **TTS 编排器** - 协调多个说话人和片段的 IndexTTS2 合成
4. **音频后处理器** - 处理静音插入、标准化和章节合并
5. **审查系统** - 用于审查和重新生成片段的基于网页的界面

## 常用开发命令

### 环境设置
```bash
# 安装所有额外依赖
uv sync --all-extras

# 从 HuggingFace 下载模型
uv tool install "huggingface-hub[cli,hf_xet]"
hf download IndexTeam/IndexTTS-2 --local-dir=checkpoints
```

### 运行应用程序
```bash
# 启动主 TTS WebUI
uv run webui.py

# 启动自动配音 Flask 服务器
uv run python auto_voiceover_server.py

# 快速有声书工作流启动器
./start_audiobook.sh

# 自动配音 CLI 干运行测试
uv run python tools/auto_voiceover.py --script test_input/scripts/example.md --config test_input/speakers.yaml --dry-run
```

### 测试和验证
```bash
# 检查 GPU 环境
uv run tools/gpu_check.py

# 运行回归测试
uv run python tests/regression_test.py

# 测试音频填充
uv run python tests/padding_test.py
```

## 关键配置文件

- `checkpoints/config.yaml` - IndexTTS2 模型配置
- `test_input/speakers.yaml` - 自动配音的说话人配置文件
- `pyproject.toml` - 项目依赖和配置
- `.gitignore` - Git 忽略模式（注意：大模型文件通过 Git LFS 跟踪）

## 目录结构

```
├── indextts/               # 核心 TTS 引擎
│   ├── infer_v2.py        # 主要 IndexTTS2 推理类
│   ├── gpt/               # GPT 语言模型
│   ├── s2mel/             # 语音到梅尔频谱转换
│   ├── BigVGAN/           # 神经声码器
│   └── utils/             # 工具和助手
├── tools/                 # 处理工具和脚本
│   ├── auto_voiceover.py  # 主要自动配音 CLI
│   └── epub_ingest.py     # EPUB 到 Markdown 转换
├── auto_voiceover_ui/     # Flask 网页界面文件
├── test_input/            # 测试脚本和配置
├── test_ebooks/           # 有声书测试目录
├── checkpoints/           # 模型权重和配置
└── outputs/               # 生成的音频和清单
```

## 开发注意事项

### 模型管理
- 模型文件很大，通过 Git LFS 管理
- 主要模型文件：`gpt.pth`、`s2mel.pth`、`bpe.model`
- 配置文件位于 `checkpoints/config.yaml`
- 使用 `hf download IndexTeam/IndexTTS-2 --local-dir=checkpoints` 获取模型

### 配音脚本格式
- Markdown 格式，使用 `**说话人：**` 表示对话
- 支持章节分隔符（`---`）和括号中的指令
- 通过内联标签控制情感：`【情绪=...】` 或 `[Tone=...]`
- 自动检测中文和英文内容

### 音频输出结构
```
DUB/
├── ch00/                  # 章节目录
│   ├── ch00-01-说话人.wav
│   └── ch00-02-说话人.wav
├── ch01/
└── episode_master.wav     # 合并的章节音频
```

### Manifest 文件管理
- **存储位置**: `outputs/auto_voiceover/` 和 `outputs/audiobook/`
- **命名规则**: `{脚本文件名}_manifest.json`（包含完整脚本名以避免中英文版本冲突）
- **示例**:
  - `22-the-gods-of-modern-ai-CN.md_manifest.json`
  - `22-the-gods-of-modern-ai-EN.md_manifest.json`
- **功能**: 记录每个片段的处理状态、文本内容、情感设置、输出路径和元数据
- **用途**: 支持断点续传、状态跟踪和逐句微调功能

### 性能考虑
- 使用 FP16 推理减少显存使用：`--fp16`
- 可用 DeepSpeed 加速：`--deepspeed`
- 在网页应用中模型缓存以避免重新加载
- 通过缓存清理端点管理 GPU 内存

## 集成点

系统支持多个界面：
- **CLI 工具** - 批处理和自动化
- **Flask API** - 编程访问和网页界面
- **Gradio UI** - 交互式 TTS 生成
- **有声书工作流** - 专门的 EPUB 到音频流水线

所有界面共享相同的 IndexTTS2 推理引擎，可以在工作流中一起使用。