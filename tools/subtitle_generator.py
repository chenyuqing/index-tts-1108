#!/usr/bin/env python3
"""
字幕生成模块 - 为IndexTTS2自动配音系统生成准确的字幕文件
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

try:
    import librosa
    LIBROSA_AVAILABLE = True
except ImportError:
    LIBROSA_AVAILABLE = False
    print("警告: librosa未安装，将使用替代方案测量音频时长")

try:
    import soundfile as sf
    SOUNDFILE_AVAILABLE = True
except ImportError:
    SOUNDFILE_AVAILABLE = False


class SubtitleGenerator:
    """字幕生成器 - 生成准确的SRT/VTT字幕文件"""

    def __init__(self):
        self.subtitle_entries = []
        self.timeline_accuracy = "unverified"
        self.total_duration_ms = 0

    def measure_actual_audio_duration(self, audio_path: str) -> Optional[float]:
        """测量音频文件实际时长"""
        try:
            audio_file = Path(audio_path)
            if not audio_file.exists():
                print(f"警告: 音频文件不存在 {audio_path}")
                return None

            # 优先使用librosa（如果可用）
            if LIBROSA_AVAILABLE:
                duration = librosa.get_duration(path=str(audio_path))
                return round(duration, 3)

            # 备选方案：使用soundfile
            elif SOUNDFILE_AVAILABLE:
                info = sf.info(str(audio_path))
                return round(info.duration, 3)

            else:
                # 最后备选：尝试读取WAV文件头
                import wave
                with wave.open(str(audio_path), 'rb') as wav_file:
                    frames = wav_file.getnframes()
                    rate = wav_file.getframerate()
                    duration = frames / float(rate)
                    return round(duration, 3)

        except Exception as e:
            print(f"测量音频时长失败 {audio_path}: {e}")
            return None

    def verify_and_update_timeline(self, manifest: Dict) -> Tuple[bool, List[str]]:
        """验证并更新manifest中的时间线信息"""
        warnings = []
        all_verified = True
        cumulative_time = 0.0

        for i, segment in enumerate(manifest.get("segments", [])):
            if segment.get("status") != "done":
                continue

            segment_id = segment.get("segment_id", f"seg-{i}")

            # 检查音频文件路径
            output_path = segment.get("output_path")
            if not output_path or not Path(output_path).exists():
                warnings.append(f"片段 {segment_id}: 音频文件不存在")
                all_verified = False
                continue

            # 测量实际音频时长
            actual_duration = self.measure_actual_audio_duration(output_path)
            if actual_duration is None:
                warnings.append(f"片段 {segment_id}: 无法测量音频时长")
                all_verified = False
                continue

            # 更新片段信息
            segment["actual_duration_sec"] = actual_duration
            segment["start_time_sec"] = round(cumulative_time, 3)
            segment["end_time_sec"] = round(cumulative_time + actual_duration, 3)

            # 计算累积时间（包含间隔静音）
            cumulative_time += actual_duration
            interval_ms = segment.get("interval_silence", 0)
            if interval_ms > 0:
                cumulative_time += interval_ms / 1000.0

            segment["cumulative_end_sec"] = round(cumulative_time, 3)
            segment["timing_verified"] = True

        manifest["total_duration_sec"] = round(cumulative_time, 3)
        manifest["timeline_verified"] = all_verified
        manifest["timeline_updated_at"] = datetime.now().isoformat()

        return all_verified, warnings

    def generate_subtitle_entries(self, manifest: Dict, include_speaker: bool = True,
                                use_final_text: bool = True) -> List[Dict]:
        """生成字幕条目"""
        entries = []

        for i, segment in enumerate(manifest.get("segments", [])):
            if segment.get("status") != "done":
                continue

            # 确定使用的文本（考虑逐句微调）
            if use_final_text and "final_text" in segment:
                text = segment["final_text"]
            else:
                text = segment.get("text", "")

            # 添加说话人标签
            if include_speaker and segment.get("speaker"):
                speaker = segment["speaker"]
                text = f"[{speaker}] {text}"

            # 时间转换（秒到SRT格式）
            start_sec = segment.get("start_time_sec", 0)
            end_sec = segment.get("end_time_sec", start_sec + segment.get("actual_duration_sec", 0))

            entry = {
                "index": len(entries) + 1,
                "start_sec": start_sec,
                "end_sec": end_sec,
                "start_srt": self.format_srt_timestamp(start_sec),
                "end_srt": self.format_srt_timestamp(end_sec),
                "text": text.strip(),
                "segment_id": segment.get("segment_id", f"seg-{i}"),
                "speaker": segment.get("speaker", ""),
                "chapter": segment.get("chapter", ""),
                "timing_verified": segment.get("timing_verified", False)
            }

            entries.append(entry)

        self.subtitle_entries = entries
        return entries

    def format_srt_timestamp(self, seconds: float) -> str:
        """将秒数转换为SRT时间戳格式"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds % 1) * 1000)

        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    def generate_srt_content(self, entries: List[Dict]) -> str:
        """生成SRT格式内容"""
        srt_lines = []

        for entry in entries:
            srt_lines.append(str(entry["index"]))
            srt_lines.append(f"{entry['start_srt']} --> {entry['end_srt']}")

            # 处理多行文本（按句子分割）
            text = entry["text"]
            if len(text) > 50:  # 长文本自动分行
                sentences = re.split(r'[。！？.!?]', text)
                if len(sentences) > 1:
                    # 按句子分行，保持完整性
                    formatted_text = '\n'.join([s.strip() for s in sentences if s.strip()])
                    srt_lines.append(formatted_text)
                else:
                    # 按字数分行（每行约25字符）
                    words = text.split()
                    lines = []
                    current_line = ""
                    for word in words:
                        if len(current_line + word) <= 25:
                            current_line += (" " + word if current_line else word)
                        else:
                            if current_line:
                                lines.append(current_line)
                            current_line = word
                    if current_line:
                        lines.append(current_line)
                    srt_lines.append('\n'.join(lines))
            else:
                srt_lines.append(text)

            srt_lines.append("")  # 空行分隔

        return "\n".join(srt_lines).strip() + "\n"

    def generate_webvtt_content(self, entries: List[Dict]) -> str:
        """生成WebVTT格式内容"""
        vtt_lines = ["WEBVTT", ""]

        for entry in entries:
            # WebVTT时间格式与SRT略有不同
            start_vtt = entry["start_srt"].replace(",", ".")
            end_vtt = entry["end_srt"].replace(",", ".")

            vtt_lines.append(f"{entry['index']}")
            vtt_lines.append(f"{start_vtt} --> {end_vtt}")
            vtt_lines.append(entry["text"])
            vtt_lines.append("")

        return "\n".join(vtt_lines).strip() + "\n"

    def save_subtitle_file(self, content: str, output_path: str,
                          encoding: str = "utf-8") -> bool:
        """保存字幕文件"""
        try:
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, 'w', encoding=encoding) as f:
                f.write(content)

            print(f"字幕文件已保存: {output_path}")
            return True

        except Exception as e:
            print(f"保存字幕文件失败 {output_path}: {e}")
            return False

    def process_manifest_for_subtitles(self, manifest_path: str, output_dir: str,
                                     include_speaker: bool = True,
                                     formats: List[str] = None) -> Dict:
        """处理manifest文件并生成字幕"""

        if formats is None:
            formats = ["srt"]

        try:
            # 读取manifest
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)

            # 验证和更新时间线
            verified, warnings = self.verify_and_update_timeline(manifest)

            if not verified:
                print("警告: 时间线验证存在错误")
                for warning in warnings:
                    print(f"  - {warning}")
                return {"success": False, "warnings": warnings}

            # 生成字幕条目
            entries = self.generate_subtitle_entries(manifest, include_speaker)

            if not entries:
                return {"success": False, "error": "没有可用的字幕条目"}

            # 确保输出目录存在
            output_path = Path(output_dir)
            output_path.mkdir(parents=True, exist_ok=True)

            results = {
                "success": True,
                "entries": entries,
                "total_duration": manifest.get("total_duration_sec", 0),
                "files_generated": [],
                "warnings": warnings
            }

            # 生成不同格式的字幕文件
            episode_name = Path(manifest_path).stem.replace("_manifest", "")

            for fmt in formats:
                if fmt.lower() == "srt":
                    content = self.generate_srt_content(entries)
                    filename = f"{episode_name}.srt"
                elif fmt.lower() == "vtt":
                    content = self.generate_webvtt_content(entries)
                    filename = f"{episode_name}.vtt"
                else:
                    continue

                output_file = output_path / filename
                if self.save_subtitle_file(content, str(output_file)):
                    results["files_generated"].append(str(output_file))

            # 保存字幕数据JSON（用于前端编辑）
            json_data = {
                "entries": entries,
                "total_duration": manifest.get("total_duration_sec", 0),
                "episode_name": episode_name,
                "generated_at": datetime.now().isoformat()
            }

            json_file = output_path / f"{episode_name}_subtitles.json"
            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump(json_data, f, ensure_ascii=False, indent=2)

            results["json_file"] = str(json_file)
            return results

        except Exception as e:
            print(f"处理字幕生成失败: {e}")
            return {"success": False, "error": str(e)}


def main():
    """命令行接口"""
    import argparse

    parser = argparse.ArgumentParser(description="IndexTTS2 字幕生成工具")
    parser.add_argument("--manifest", required=True, help="Manifest文件路径")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--include-speaker", action="store_true",
                       help="在字幕中包含说话人标签")
    parser.add_argument("--format", choices=["srt", "vtt", "both"],
                       default="srt", help="输出格式")
    parser.add_argument("--verify-only", action="store_true",
                       help="仅验证时间线，不生成字幕")

    args = parser.parse_args()

    generator = SubtitleGenerator()

    if args.verify_only:
        # 仅验证模式
        try:
            with open(args.manifest, 'r', encoding='utf-8') as f:
                manifest = json.load(f)

            verified, warnings = generator.verify_and_update_timeline(manifest)

            print(f"时间线验证结果: {'通过' if verified else '失败'}")
            if warnings:
                print("警告信息:")
                for warning in warnings:
                    print(f"  - {warning}")

            # 保存更新后的manifest
            output_manifest = Path(args.output) / f"{Path(args.manifest).stem}_verified.json"
            with open(output_manifest, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)

            print(f"验证结果已保存: {output_manifest}")

        except Exception as e:
            print(f"验证失败: {e}")
            return 1

    else:
        # 完整字幕生成模式
        formats = ["srt"]
        if args.format == "both":
            formats = ["srt", "vtt"]
        elif args.format == "vtt":
            formats = ["vtt"]

        results = generator.process_manifest_for_subtitles(
            args.manifest,
            args.output,
            include_speaker=args.include_speaker,
            formats=formats
        )

        if results["success"]:
            print("✅ 字幕生成成功！")
            print(f"总时长: {results['total_duration']:.3f} 秒")
            print(f"生成文件: {results['files_generated']}")
            if results.get("json_file"):
                print(f"字幕数据: {results['json_file']}")
            if results["warnings"]:
                print("⚠️  警告信息:")
                for warning in results["warnings"]:
                    print(f"  - {warning}")
        else:
            print("❌ 字幕生成失败")
            if results.get("error"):
                print(f"错误: {results['error']}")
            return 1

    return 0


if __name__ == "__main__":
    exit(main())