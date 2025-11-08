#!/usr/bin/env python3
import re

# 读取原始文件
with open('webui.py', 'r') as f:
    content = f.read()

# 替换指定部分
old_pattern = r'            os\.makedirs\("prompts",exist_ok=True\)\n            prompt_list = os\.listdir\("prompts"\)\n            default = \'\'\n            if prompt_list:\n                default = prompt_list\[0\]'
new_pattern = r'''            os.makedirs("prompts",exist_ok=True)
            os.makedirs("examples",exist_ok=True)
            prompt_list = os.listdir("prompts")
            examples_list = os.listdir("examples")
            
            # 合并 prompts 和 examples 目录中的音频文件
            all_audio_files = []
            
            # 添加 prompts 目录中的音频文件
            for file in prompt_list:
                if file.endswith(('.wav', '.mp3', '.flac', '.m4a')):
                    all_audio_files.append(os.path.join("prompts", file))
            
            # 添加 examples 目录中的音频文件
            for file in examples_list:
                if file.endswith(('.wav', '.mp3', '.flac', '.m4a')):
                    all_audio_files.append(os.path.join("examples", file))
            
            default = ''
            if all_audio_files:
                default = all_audio_files[0]'''

# 执行替换
new_content = re.sub(old_pattern, new_pattern, content)

# 写入新文件
with open('webui.py', 'w') as f:
    f.write(new_content)

print("webui.py 已修改完成")