#!/usr/bin/env python3
"""
简单的 IndexTTS2 测试脚本
"""
import os
import sys

# 添加当前目录到 Python 路径
sys.path.insert(0, '.')

from indextts.infer_v2 import IndexTTS2

def main():
    print("正在初始化 IndexTTS2...")
    
    # 初始化 IndexTTS2，使用 MPS 加速（适用于 M4 芯片）
    tts = IndexTTS2(
        cfg_path="checkpoints/config.yaml", 
        model_dir="checkpoints", 
        use_fp16=True,  # 使用半精度以节省内存
        use_cuda_kernel=False,  # 在 Mac 上不使用 CUDA 内核
        use_deepspeed=False  # 不使用 DeepSpeed
    )
    
    print("IndexTTS2 初始化成功！")
    
    # 测试文本
    text = "你好，这是一个测试语音合成的例子。"
    
    # 使用示例音频作为音色提示
    spk_audio_prompt = "examples/voice_01.wav"
    
    print(f"正在合成语音...")
    print(f"文本: {text}")
    print(f"音色提示: {spk_audio_prompt}")
    
    # 生成语音
    output_path = "test_output.wav"
    tts.infer(
        spk_audio_prompt=spk_audio_prompt, 
        text=text, 
        output_path=output_path, 
        verbose=True
    )
    
    print(f"语音合成完成！输出文件: {output_path}")
    
    # 检查输出文件是否存在
    if os.path.exists(output_path):
        file_size = os.path.getsize(output_path)
        print(f"输出文件大小: {file_size} 字节")
        print("测试成功！")
    else:
        print("错误：输出文件未生成！")

if __name__ == "__main__":
    main()