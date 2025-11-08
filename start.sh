#!/bin/bash

# IndexTTS2 一键启动脚本
# 适用于 M4 芯片的 Mac

echo "=========================================="
echo "IndexTTS2 WebUI 启动脚本"
echo "=========================================="

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 uv 是否安装
if ! command -v uv &> /dev/null; then
    echo -e "${RED}错误: uv 未安装！${NC}"
    echo "请先安装 uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# 检查模型文件是否存在
if [ ! -f "checkpoints/gpt.pth" ]; then
    echo -e "${RED}错误: 模型文件不存在！${NC}"
    echo "请确保已下载模型文件到 checkpoints 目录"
    exit 1
fi

echo -e "${GREEN}环境检查通过！${NC}"

# 设置环境变量
export PATH="$HOME/.local/bin:$PATH"
export PYTHONPATH="$PYTHONPATH:."

# 对于 M4 芯片，使用 MPS 加速
export PYTORCH_ENABLE_MPS_FALLBACK=1

# 检查并杀死占用端口 7860 的进程
PORT=7860
PID=$(lsof -ti:$PORT)
if [ -n "$PID" ]; then
    echo -e "${YELLOW}端口 $PORT 被进程 $PID 占用，正在终止...${NC}"
    kill -9 $PID
    sleep 2
fi

echo -e "${YELLOW}正在启动 IndexTTS2 WebUI...${NC}"
echo "WebUI 将在 http://127.0.0.1:7860 启动"
echo "按 Ctrl+C 停止服务"
echo ""
echo -e "${YELLOW}注意：首次启动时会自动下载额外的模型文件（约 200MB）${NC}"
echo "这些文件包括语义编码器和情感识别模型，是 IndexTTS2 正常工作所必需的"
echo "下载的文件将保存在 checkpoints/hf_cache 目录中"
echo "这些模型只需要下载一次，后续启动会直接使用缓存"
echo "=========================================="

# 启动 WebUI，使用适合 M4 芯片的参数
# 设置环境变量以解决 Gradio 网络问题
export GRADIO_SERVER_NAME=127.0.0.1
export GRADIO_SERVER_PORT=7860
export GRADIO_SHARE=False
export GRADIO_SHOW_ERROR=True
export GRADIO_SHOW_TIPS=False

# 尝试使用不同的端口
PORT=7860

# 检查端口是否被占用
PID=$(lsof -ti:$PORT)
if [ -n "$PID" ]; then
    echo -e "${YELLOW}端口 $PORT 被进程 $PID 占用，正在终止...${NC}"
    kill -9 $PID
    sleep 2
fi

echo -e "${YELLOW}正在启动 IndexTTS2 WebUI...${NC}"
echo "WebUI 将在 http://127.0.0.1:$PORT 启动"
echo "按 Ctrl+C 停止服务"
echo ""
echo -e "${YELLOW}注意：首次启动时会自动下载额外的模型文件（约 200MB）${NC}"
echo "这些文件包括语义编码器和情感识别模型，是 IndexTTS2 正常工作所必需的"
echo "下载的文件将保存在 checkpoints/hf_cache 目录中"
echo "这些模型只需要下载一次，后续启动会直接使用缓存"
echo ""
echo -e "${YELLOW}如果启动失败，请尝试以下解决方案：${NC}"
echo "1. 检查系统防火墙设置，确保允许本地端口访问"
echo "2. 尝试使用不同的端口，如 7861、7862 等"
echo "3. 检查是否有其他网络代理或 VPN 软件干扰"
echo "=========================================="

# 创建一个临时的 webui 启动脚本
cat > temp_webui.py << 'EOF'
import os
import sys
import argparse

# 添加当前目录到 Python 路径
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)
sys.path.append(os.path.join(current_dir, "indextts"))

# 导入原始 webui 模块
import webui

# 修改启动参数
port = 7860
webui.cmd_args.host = "127.0.0.1"
webui.cmd_args.port = port

# 启动 demo，使用最基本的参数
if __name__ == "__main__":
    webui.demo.queue(20)
    webui.demo.launch(
        server_name="127.0.0.1",
        server_port=port,
        share=False
    )
EOF

# 启动 WebUI
uv run temp_webui.py

# 清理临时文件
rm -f temp_webui.py

echo -e "${GREEN}IndexTTS2 WebUI 已停止${NC}"