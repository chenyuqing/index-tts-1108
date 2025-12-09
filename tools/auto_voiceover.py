#!/usr/bin/env python3
"""Auto Voiceover CLI utilities.

This initial implementation focuses on parsing Markdown podcast scripts,
combining them with speaker configuration, and emitting a dry-run manifest
that follows the requirements described in PRD_Auto_Voiceover.md.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import wave
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

try:  # Prefer OmegaConf when available (already listed in project deps)
    from omegaconf import OmegaConf  # type: ignore
except ImportError:  # pragma: no cover - handled at runtime
    OmegaConf = None

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


EMOTION_KEYWORDS = ("情绪", "语气", "tone", "emotion")
MANIFEST_VERSION = "0.1"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
SEGMENT_TIMEOUT = float(os.getenv("AUTO_VOICEOVER_SEGMENT_TIMEOUT", "300"))

ProgressCallback = Callable[[float, str], None]
LogCallback = Callable[[str], None]


def normalize_segment_text(text: str) -> str:
    replacements = {
        "\u2014": " ",
        "\u2013": " ",
        "\u2012": " ",
        "\u2010": " ",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    text = text.replace("**", "")
    text = text.replace("__", "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^\*+\s*", "", text)
    text = re.sub(r"\s*\*+$", "", text)
    return text

def detect_language(text: str) -> str:
    if not text.strip():
        return "auto"
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    latin_chars = len(re.findall(r"[A-Za-z]", text))
    if chinese_chars == 0 and latin_chars == 0:
        return "auto"
    if chinese_chars >= latin_chars:
        return "zh"
    return "en"


def write_placeholder_wav(path: Path, duration_sec: float = 0.2, sample_rate: int = 16000) -> None:
    # Add suffix for easier identification
    target_path = path
    if path.suffix:
        target_path = path.with_name(f"{path.stem}_null{path.suffix}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    frames = max(1, int(duration_sec * sample_rate))
    silence = b"\x00\x00" * frames
    with wave.open(str(target_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(silence)



@dataclass
class Directive:
    kind: str
    content: str
    raw: str


@dataclass
class Segment:
    chapter_id: str
    chapter_title: str
    sequence_id: str
    speaker_id: str
    text: str
    emotion: Optional[str]
    directives: List[Directive] = field(default_factory=list)
    metadata: Dict[str, str] = field(default_factory=dict)


@dataclass
class ParseResult:
    segments: List[Segment]
    warnings: List[str]
    script_title: Optional[str]
    language: str


class MarkdownScriptParser:
    """Parses Markdown scripts that follow the PRD conventions."""

    SPEAKER_PATTERN = re.compile(
        r"^\s*(?:\*\*)?(?P<name>[\w\u4e00-\u9fff]+)(?:\*\*)?\s*[：:]\s*(?P<rest>.*)$"
    )

    HEADER_PATTERN = re.compile(r"^(?P<level>#{1,6})\s+(?P<title>.+?)\s*$")

    DIRECTIVE_PATTERN = re.compile(r"^[（(](?P<content>.+)[）)]$")

    def __init__(self, language: Optional[str] = None, valid_speakers: Optional[set[str]] = None):
        self.language = language
        self._text_samples: List[str] = []
        self._detected_language: Optional[str] = None
        self.valid_speakers: set[str] = valid_speakers or set()

    def parse(self, script_path: Path) -> ParseResult:
        if not script_path.exists():
            raise FileNotFoundError(f"Script file not found: {script_path}")

        segments: List[Segment] = []
        warnings: List[str] = []

        chapter_index = -1
        chapter_id: Optional[str] = None
        chapter_title: Optional[str] = None
        chapter_seq: int = 0
        script_title: Optional[str] = None
        pending_directives: List[Directive] = []
        active_segment: Optional[Dict[str, object]] = None

        def ensure_chapter(new_title: Optional[str]) -> None:
            nonlocal chapter_index, chapter_id, chapter_title, chapter_seq
            chapter_index += 1
            chapter_id = f"ch{chapter_index:02d}"
            chapter_title = new_title or chapter_title or f"Chapter {chapter_index:02d}"
            chapter_seq = 0

        def flush_active_segment() -> None:
            nonlocal active_segment, pending_directives, chapter_seq
            if not active_segment:
                return
            text_lines: List[str] = active_segment["lines"]  # type: ignore[index]
            raw_text = "\n".join(text_lines).strip()
            text, emotion_hint = self._extract_emotion_markers(raw_text)
            text = normalize_segment_text(text)
            self._text_samples.append(text)
            emotion_text = active_segment.get("emotion")  # type: ignore[attr-defined]
            merged_emotion = _merge_emotions(
                [emotion_text, emotion_hint]) if emotion_hint or emotion_text else emotion_text
            chapter_seq += 1
            seq_id = f"{active_segment['chapter_id']}-{chapter_seq:02d}"
            segment = Segment(
                chapter_id=active_segment["chapter_id"],
                chapter_title=active_segment["chapter_title"],
                sequence_id=seq_id,
                speaker_id=active_segment["speaker_id"],
                text=text,
                emotion=merged_emotion,
                directives=pending_directives.copy(),
                metadata={"language": self.language or "auto"},
            )
            segments.append(segment)
            pending_directives.clear()
            active_segment = None

        lines = script_path.read_text(encoding="utf-8").splitlines()
        for lineno, line in enumerate(lines, start=1):
            stripped = line.strip()

            header_match = self.HEADER_PATTERN.match(stripped)
            if header_match:
                level = len(header_match.group("level"))
                title_text = header_match.group("title").strip()
                if level == 1 and not script_title:
                    script_title = title_text
                    continue
                if level == 2:
                    flush_active_segment()
                    ensure_chapter(title_text)
                    continue

            if stripped == "---":
                continue

            directive_match = self.DIRECTIVE_PATTERN.match(stripped)
            if directive_match:
                pending_directives.append(
                    self._build_directive(directive_match.group("content"), lineno)
                )
                continue

            speaker_match = self.SPEAKER_PATTERN.match(stripped)
            if speaker_match:
                speaker_name = speaker_match.group("name").strip()
                if self.is_valid_speaker_name(speaker_name) and self._looks_like_speaker_header(speaker_match.group("rest")):
                    flush_active_segment()
                    if chapter_id is None:
                        ensure_chapter("ch00")
                    raw_rest = speaker_match.group("rest").strip()
                    rest_text, emotion_from_line = self._extract_emotion_markers(raw_rest)
                    active_segment = {
                        "chapter_id": chapter_id,
                        "chapter_title": chapter_title or "",
                        "speaker_id": speaker_name.lower(),
                        "emotion": emotion_from_line,
                        "lines": [rest_text] if rest_text else [],
                    }
                    if pending_directives:
                        # `pending_directives` will get attached when the segment is flushed
                        pass
                    continue

            if not stripped:
                if active_segment and active_segment["lines"] and active_segment["lines"][-1] != "":
                    active_segment["lines"].append("")
                continue

            if active_segment:
                active_segment["lines"].append(line.rstrip())
            else:
                warnings.append(
                    f"Line {lineno}: Unassigned text outside of a speaker block -> {stripped[:40]}"
                )

        flush_active_segment()
        if pending_directives:
            warnings.append(
                f"Dangling directives without a following segment: {[d.raw for d in pending_directives]}"
            )
        effective_language = self._resolve_language()
        for segment in segments:
            if effective_language == "zh":
                segment.text = self._localize_names(segment.text)
            segment.metadata["language"] = effective_language
        return ParseResult(segments=segments, warnings=warnings, script_title=script_title, language=effective_language)

    def _resolve_language(self) -> str:
        if self.language and self.language != "auto":
            return self.language
        if self._detected_language:
            return self._detected_language
        sample_text = " ".join(self._text_samples[:50])
        detected = detect_language(sample_text)
        if detected == "auto":
            detected = "en"
        self._detected_language = detected
        return detected

    @staticmethod
    def _localize_names(text: str) -> str:
        if not text:
            return text

        def _replace(match: re.Match[str]) -> str:
            return "翠花" if match.group(0) == "Larei" else "里奥"

        return re.sub(r"\b(Larei|Leo)\b", _replace, text)

    def _build_directive(self, content: str, lineno: int) -> Directive:
        text = content.strip()
        lowered = text.lower()
        if "music" in lowered or "音乐" in text:
            kind = "music"
        elif "pause" in lowered or "停顿" in text:
            kind = "pause"
        elif "gain" in lowered or "音量" in text:
            kind = "gain"
        else:
            kind = "note"
        return Directive(kind=kind, content=text, raw=f"Line {lineno}: {content}")

    def _extract_emotion_markers(self, text: str) -> tuple[str, Optional[str]]:
        if not text:
            return "", None

        emotion_chunks: List[str] = []
        updated_text = text

        pattern = re.compile(
            r"[【\[](?:\s*(?:" + "|".join(EMOTION_KEYWORDS) + r")\s*[:=：]\s*)?(?P<emo>[^】\]]+)[】\]]",
            flags=re.IGNORECASE,
        )

        while True:
            match = pattern.search(updated_text)
            if not match:
                break
            emotion_chunks.append(match.group("emo").strip())
            updated_text = updated_text[: match.start()] + updated_text[match.end():]

        normalized = re.sub(r"\s+", " ", updated_text).strip()
        emotion_text = "; ".join(chunk for chunk in emotion_chunks if chunk)
        return normalized, (emotion_text or None)

    @staticmethod
    def _looks_like_speaker_header(rest: str) -> bool:
        """改进的speaker头部验证函数"""
        import re

        candidate = rest.strip()
        if not candidate:
            return True

        # 检查是否以情绪标记开头（优先检查）
        emotion_patterns = [
            r'^【[^】]*】',      # 【情绪=xxx】
            r'^\[[^\]]*\]',    # [情绪=xxx]
            r'^\([^)]*\)',     # (情绪=xxx)
        ]

        for pattern in emotion_patterns:
            if re.match(pattern, candidate):
                return True

        # 如果rest部分包含多个**（Markdown粗体格式），说明这是内容而不是speaker header
        if candidate.count('**') >= 2:
            return False

        # 检查是否是格式化的内容（如**xxx**）
        # 如果开头是**但不是情绪标记，可能是Markdown格式
        if candidate.startswith('**'):
            # 检查后面是否紧跟中文或英文内容，而不是特殊符号
            content_after_stars = candidate[2:].strip()
            if content_after_stars and content_after_stars[0] in '。！？；：':
                return False
            # 如果是**xxx**格式且xxx很短，可能是合法的
            if re.match(r'^\*\*[^*]{1,30}\*\*', candidate):
                return True

        # 检查是否是直接的说话内容（短句，没有复杂标点）
        # 如果rest很短（小于60字符）且不包含句子结束符，可能是直接说话
        if len(candidate) < 60 and not any(char in candidate[:40] for char in '。！？；'):
            return True

        return False

    def is_valid_speaker_name(self, name: str) -> bool:
        """验证speaker名称是否合理 - 基于配置文件中定义的speaker列表"""
        if not name:
            return False
        
        # 如果配置了valid_speakers，只检查是否在列表中（不区分大小写）
        if self.valid_speakers:
            name_lower = name.lower()
            # 检查精确匹配（不区分大小写）
            if name_lower in {s.lower() for s in self.valid_speakers}:
                return True
            # 如果不在列表中，直接返回False
            return False
        
        # 如果没有配置valid_speakers（向后兼容），使用原有的启发式检查
        # 长度检查：speaker名称通常很短（1-8个字符）
        if len(name) > 8:
            return False

        # 模式检查：应该是人名，不是句子
        if not re.match(r'^[\w\u4e00-\u9fff]{1,8}$', name):
            return False

        # 内容检查：不应该包含常见句子标志
        sentence_indicators = ['问题', '这是', '我们', '你们', '他们', '如果', '但是', '所以', '因此', '回到', '根本']
        if any(indicator in name for indicator in sentence_indicators):
            return False

        # 排除数字词、常见单词等（这些通常是列表项或普通词汇）
        invalid_speakers = {
            # 英文数字词
            'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
            'first', 'second', 'third', 'fourth', 'fifth',
            # 英文常见词汇
            'step', 'point', 'note', 'tip', 'hint',
            'example', 'case', 'fact', 'truth',
            'yes', 'no', 'ok', 'okay', 'sure', 'thanks',
            'introduction', 'conclusion', 'summary', 'chapter',
            'music', 'sound', 'sfx', 'transition', 'fade',
            # 中文总结和常用词汇
            '总结', '总结一下', '总结完毕', '总之', '总的来说',
            '首先', '其次', '最后', '接下来', '然后', '另外', '还有', '接着',
            '第一', '第二', '第三', '第四', '第五', '第六', '第七', '第八', '第九', '第十',
            '一方面', '另一方面', '换句话说', '简单来说', '实际上', '事实上',
            '简单说', '句话说', '换言之', '具体来说', '详细来说',
            '开场白', '开场', '结束', '结束语', '结语',
            '过门', '过渡', '转场', '片头', '片尾', '开场音乐', '背景音乐',
            '提问', '回答', '解答', '解析', '说明', '解释', '阐述', '论述',
            '举例', '例如', '比如', '以此类推', '总而言之', '概括来说',
            '重点', '要点', '关键', '核心', '精髓', '精华', '本质', '核心内容',
            '开场hook', 'hook', 'call', 'callin', 'callout'
        }
        if name.lower() in invalid_speakers:
            return False

        # 检查是否包含数字（除了可能是人名的特殊情况）
        if re.search(r'\d', name) and len(name) <= 4:
            # 允许4个字符以内的纯数字（但这种情况很少见）
            return False

        return True


def _merge_emotions(parts: Iterable[Optional[str]]) -> Optional[str]:
    cleaned = [p.strip() for p in parts if p and p.strip()]
    if not cleaned:
        return None
    seen: List[str] = []
    for chunk in cleaned:
        if chunk not in seen:
            seen.append(chunk)
    return "; ".join(seen)


def load_speaker_config(path: Path) -> Dict[str, Dict[str, object]]:
    if not path.exists():
        raise FileNotFoundError(f"Speaker config not found: {path}")

    data: Dict[str, object]
    if OmegaConf is not None:
        cfg = OmegaConf.load(path)
        data = OmegaConf.to_container(cfg, resolve=True)  # type: ignore[arg-type]
    elif yaml is not None:  # pragma: no cover - depends on runtime env
        with path.open("r", encoding="utf-8") as fp:
            data = yaml.safe_load(fp)
    else:
        data = _basic_yaml_parse(path.read_text(encoding="utf-8"))

    if not isinstance(data, dict):
        raise ValueError("Speaker config must be a mapping")

    speakers = data.get("speakers") or {}
    if not isinstance(speakers, dict):
        raise ValueError("`speakers` field must be a mapping")

    defaults = data.get("auto_speaker_defaults") or {}
    default_tts = data.get("default_tts") or {}
    
    # 确保默认值中的数值参数是正确的类型（YAML可能解析为字符串）
    if "emo_alpha" in defaults:
        try:
            defaults["emo_alpha"] = float(defaults["emo_alpha"])
        except (ValueError, TypeError):
            defaults["emo_alpha"] = 1.0
    if "interval_silence" in defaults:
        try:
            defaults["interval_silence"] = float(defaults["interval_silence"])
        except (ValueError, TypeError):
            defaults["interval_silence"] = 0.2
    
    # 确保 default_tts 中的数值参数是正确的类型
    for key in ["temperature", "top_p", "top_k", "emo_alpha"]:
        if key in default_tts:
            try:
                if key == "top_k":
                    default_tts[key] = int(float(default_tts[key]))
                else:
                    default_tts[key] = float(default_tts[key])
            except (ValueError, TypeError):
                if key == "emo_alpha":
                    default_tts[key] = 1.0
                elif key == "temperature":
                    default_tts[key] = 0.8
                elif key == "top_p":
                    default_tts[key] = 0.8
                elif key == "top_k":
                    default_tts[key] = 30

    base_dir = path.parent
    voice_root_raw = data.get("voice_root")
    voice_root_path = _resolve_base_path(voice_root_raw, base_dir)

    result: Dict[str, Dict[str, object]] = {}
    for key, value in speakers.items():
        if not isinstance(value, dict):
            continue
        merged = {**defaults, **value}
        merged["voice_prompt"] = _resolve_media_path(
            merged.get("voice_prompt"), base_dir, voice_root_path
        )
        if merged.get("emo_audio_prompt"):
            merged["emo_audio_prompt"] = _resolve_media_path(
                merged.get("emo_audio_prompt"), base_dir, voice_root_path
            )
        merged.setdefault("voice_prompt", None)
        # 确保数值参数是正确的类型（YAML可能解析为字符串）
        if "emo_alpha" in merged:
            try:
                merged["emo_alpha"] = float(merged["emo_alpha"])
            except (ValueError, TypeError):
                merged["emo_alpha"] = 1.0
        if "interval_silence" in merged:
            try:
                merged["interval_silence"] = float(merged["interval_silence"])
            except (ValueError, TypeError):
                merged["interval_silence"] = 0.2
        result[key.lower()] = merged

    return {
        "speakers": result,
        "voice_root": str(voice_root_path) if voice_root_path else None,
        "defaults": defaults,
        "default_tts": default_tts,
        "raw": data,
        "config_dir": str(base_dir),
    }


def _basic_yaml_parse(text: str) -> Dict[str, object]:
    """Very small YAML parser for the limited config structure used in tests."""

    root: Dict[str, object] = {}
    stack: List[tuple[int, Dict[str, object]]] = [(-1, root)]

    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        indent = len(raw_line) - len(raw_line.lstrip(" "))
        line = raw_line.strip()
        if line.startswith("- "):
            raise ValueError("Lists are not supported in the fallback YAML parser")

        if ":" not in line:
            raise ValueError(f"Invalid line in YAML: {raw_line}")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()

        while stack and indent <= stack[-1][0]:
            stack.pop()
        parent = stack[-1][1]

        if value == "":
            new_map: Dict[str, object] = {}
            parent[key] = new_map
            stack.append((indent, new_map))
        else:
            parent[key] = _parse_scalar(value)

    return root


def _parse_scalar(value: str) -> object:
    if value.startswith(("'", '"')) and value.endswith(("'", '"')):
        return value[1:-1]
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return value


def _resolve_base_path(value: Optional[str], base_dir: Path) -> Optional[Path]:
    if not value:
        return None
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate

    search_roots = [base_dir, PROJECT_ROOT, Path.cwd()]
    for root in search_roots:
        resolved = (root / candidate).resolve()
        if resolved.exists():
            return resolved
    return (base_dir / candidate).resolve()


def _resolve_media_path(value: Optional[str], base_dir: Path, voice_root: Optional[Path]) -> Optional[str]:
    if not value:
        return None
    candidate = Path(value)
    if candidate.is_absolute():
        return str(candidate)

    search_roots: List[Path] = []
    if voice_root:
        search_roots.append(voice_root)
    search_roots.extend([base_dir, PROJECT_ROOT, Path.cwd()])

    for root in search_roots:
        resolved = (root / candidate).resolve()
        if resolved.exists():
            return str(resolved)

    anchor = search_roots[0] if search_roots else base_dir
    return str((anchor / candidate).resolve())


def build_manifest(
    parse_result: ParseResult,
    config: Dict[str, Dict[str, object]],
    out_root: Path,
    episode_name: str,
) -> Dict[str, object]:
    speakers = config["speakers"]
    manifest_items = []
    missing_speakers = set()

    for segment in parse_result.segments:
        speaker_profile = speakers.get(segment.speaker_id)
        if not speaker_profile:
            missing_speakers.add(segment.speaker_id)
        chapter_folder = out_root / segment.chapter_id
        file_name = f"{segment.sequence_id}-{segment.speaker_id}.wav"
        manifest_items.append(
            {
                "segment_id": segment.sequence_id,
                "chapter": segment.chapter_id,
                "chapter_title": segment.chapter_title,
                "speaker": segment.speaker_id,
                "text": segment.text,
                "emotion": segment.emotion,
                "directives": [directive.__dict__ for directive in segment.directives],
                "output_path": str(chapter_folder / file_name),
                "voice_prompt": speaker_profile.get("voice_prompt") if speaker_profile else None,
                "status": "pending",
                "duration_sec": None,
                "error": None,
                "started_at": None,
                "completed_at": None,
                # 情感参考音频相关字段
                "emotion_reference_audio": None,
                "emotion_reference_status": "missing",
                "emotion_mode": "text",  # "text" 或 "audio"
                "actual_duration_sec": None,
                "timing_accuracy": None,
            }
        )

    now = datetime.utcnow().isoformat()

    return {
        "episode": episode_name,
        "script_title": parse_result.script_title,
        "language": parse_result.language,
        "output_root": str(out_root),
        "segments": manifest_items,
        "warnings": parse_result.warnings,
        "missing_speakers": sorted(missing_speakers),
        "stats": {"total_segments": len(manifest_items), "status_counts": {}},
        "created_at": now,
        "updated_at": now,
        "manifest_version": MANIFEST_VERSION,
    }


def save_manifest(manifest: Dict[str, object], manifest_path: Path) -> Path:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def load_manifest(manifest_path: Path) -> Optional[Dict[str, object]]:
    if not manifest_path.exists():
        return None
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else None


def merge_manifests(old: Dict[str, object], new: Dict[str, object]) -> Dict[str, object]:
    old_segments = {seg.get("segment_id"): seg for seg in old.get("segments", []) if seg.get("segment_id")}
    for seg in new.get("segments", []):
        seg_id = seg.get("segment_id")
        if not seg_id:
            continue
        prev = old_segments.get(seg_id)
        if not prev:
            continue
        for key in [
            "status",
            "duration_sec",
            "error",
            "started_at",
            "completed_at",
            "actual_duration_sec",
            "timing_accuracy",
            # 情感参考音频相关字段
            "emotion_reference_audio",
            "emotion_reference_status",
            "emotion_mode",
        ]:
            if prev.get(key) is not None:
                seg[key] = prev.get(key)

    new["stats"] = old.get("stats", new.get("stats"))
    new["updated_at"] = old.get("updated_at", new.get("updated_at"))
    return new


def refresh_segment_status_by_files(manifest: Dict[str, object]) -> None:
    """刷新段落状态：检查文件是否存在，如果存在则更新状态和音频时长"""
    for entry in manifest.get("segments", []):
        if entry.get("status") == "done":
            # 即使状态是done，也检查并更新音频时长（如果缺失）
            output_path = entry.get("output_path")
            if output_path and Path(output_path).exists():
                if not entry.get("actual_duration_sec"):
                    try:
                        import librosa
                        actual_duration = librosa.get_duration(path=output_path)
                        entry["actual_duration_sec"] = round(actual_duration, 3)
                        entry["timing_accuracy"] = "verified"
                    except Exception:
                        pass
            continue
        
        output_path = entry.get("output_path")
        if not output_path:
            continue
        if Path(output_path).exists():
            entry["status"] = "done"
            entry["completed_at"] = entry.get("completed_at") or datetime.utcnow().isoformat()
            entry["error"] = None
            # 测量实际音频时长
            try:
                import librosa
                actual_duration = librosa.get_duration(path=output_path)
                entry["actual_duration_sec"] = round(actual_duration, 3)
                entry["timing_accuracy"] = "verified"
            except Exception:
                # 如果测量失败，至少标记为done
                entry["timing_accuracy"] = "estimated"


def prepare_manifest(
    script_path: Path,
    config_path: Path,
    out_root: Path,
    language: Optional[str] = None,
) -> Tuple[Dict[str, object], Dict[str, Dict[str, object]], ParseResult]:
    # 先加载配置，提取所有可用的speaker名称（包括别名）
    config = load_speaker_config(config_path)
    speakers = config.get("speakers", {})
    
    # 构建有效的speaker名称集合（包括原始名称和别名）
    valid_speaker_names: set[str] = set()
    for speaker_key, speaker_config in speakers.items():
        if not isinstance(speaker_config, dict):
            continue
        # 添加原始名称（不区分大小写）
        valid_speaker_names.add(speaker_key)
        # 添加别名
        aliases = speaker_config.get("aliases", [])
        if isinstance(aliases, list):
            for alias in aliases:
                if isinstance(alias, str):
                    valid_speaker_names.add(alias)
    
    # 使用有效的speaker列表初始化parser
    parser = MarkdownScriptParser(language=language, valid_speakers=valid_speaker_names)
    parse_result = parser.parse(script_path)
    episode = script_path.stem
    final_out_root = normalize_out_root(out_root, episode)
    manifest = build_manifest(parse_result, config, final_out_root, episode)
    return manifest, config, parse_result


def normalize_out_root(out_root: Path, episode: str) -> Path:
    out_root = out_root.resolve()
    if out_root.name != episode:
        out_root = (out_root / episode).resolve()
    return out_root


def build_review_output_path(out_root: Path, segment: Dict[str, object]) -> Path:
    base = out_root
    speaker = segment.get("speaker") or "spk"
    chapter = segment.get("chapter") or "ch00"
    filename = f"{segment.get('segment_id')}-{speaker}.wav"
    return base / "review" / chapter / filename


def synthesize_segments(
    manifest: Dict[str, object],
    config: Dict[str, Dict[str, object]],
    tts: Any,
    progress_cb: Optional[ProgressCallback] = None,
    log_cb: Optional[LogCallback] = None,
    segment_filter: Optional[Sequence[str]] = None,
    only_pending: bool = False,
    control_fn: Optional[Callable[[], Optional[str]]] = None,
    overrides: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Tuple[Dict[str, object], List[str]]:
    start_time = time.time()
    logs: List[str] = []

    def emit(message: str) -> None:
        logs.append(message)
        if log_cb:
            log_cb(message)

    refresh_segment_status_by_files(manifest)

    speakers = config.get("speakers", {})
    speaker_defaults = config.get("defaults", {})
    generation_defaults = config.get("default_tts", {})

    segments = manifest.get("segments", [])
    selected_segments = []
    filter_set = set(segment_filter) if segment_filter else None
    for entry in segments:
        if filter_set and entry.get("segment_id") not in filter_set:
            continue
        # only_pending: 跳过已完成(done)的，但处理失败(failed)和待处理(pending)的
        if only_pending and entry.get("status") == "done":
            continue
        selected_segments.append(entry)

    total = len(selected_segments)
    if total == 0:
        emit("No segments selected for synthesis.")
        manifest["updated_at"] = datetime.utcnow().isoformat()
        manifest.setdefault("stats", {})
        counts = Counter(entry.get("status", "pending") for entry in segments)
        manifest["stats"].update({
            "total_segments": len(segments),
            "status_counts": dict(counts),
        })
        return manifest, logs

    def _parse_chapter(value: Optional[str]) -> int:
        if not value:
            return 0
        value = value.lower()
        if value.startswith("ch"):
            value = value[2:]
        try:
            return int(value)
        except ValueError:
            return 0

    def _parse_sequence(value: Optional[str]) -> int:
        if not value:
            return 0
        parts = value.split("-")
        if len(parts) >= 2:
            try:
                return int(parts[-1])
            except ValueError:
                return 0
        try:
            return int(value)
        except ValueError:
            return 0

    def _segment_order(entry: Dict[str, object]) -> tuple:
        seg_id = entry.get("segment_id") or entry.get("sequence_id") or ""
        chapter = entry.get("chapter") or ""
        chapter_num = _parse_chapter(chapter if isinstance(chapter, str) else str(chapter))
        seq_num = _parse_sequence(seg_id if isinstance(seg_id, str) else str(seg_id))
        return (chapter_num, seq_num, seg_id)

    selected_segments.sort(key=_segment_order)

    overrides = overrides or {}
    paused = False
    timeout_enabled = SEGMENT_TIMEOUT > 0

    for idx, entry in enumerate(selected_segments, start=1):
        if control_fn:
            while True:
                action = control_fn()
                if action == "pause":
                    if not paused:
                        emit("Job paused")
                        paused = True
                    time.sleep(0.5)
                    continue
                if action == "stop":
                    emit("Job stopped by user")
                    manifest["updated_at"] = datetime.utcnow().isoformat()
                    return manifest, logs
                if action == "resume" and paused:
                    emit("Job resumed")
                    paused = False
                if not paused:
                    break
                time.sleep(0.2)

        segment_id = entry["segment_id"]
        progress_ratio = idx / total
        # 计算预计剩余时间
        if idx > 1:
            elapsed = time.time() - start_time
            avg_time_per_segment = elapsed / (idx - 1)
            remaining_segments = total - idx
            estimated_remaining = avg_time_per_segment * remaining_segments
            progress_msg = f"合成 {segment_id} ({idx}/{total}) - 预计剩余: {int(estimated_remaining)}s"
        else:
            progress_msg = f"合成 {segment_id} ({idx}/{total})"
        
        if progress_cb:
            progress_cb(progress_ratio, progress_msg)

        speaker_id = entry["speaker"]
        speaker_profile = speakers.get(speaker_id)
        if not speaker_profile:
            entry["status"] = "skipped"
            entry["error"] = f"Speaker profile missing: {speaker_id}"
            emit(f"[{segment_id}] Skipped - speaker profile missing")
            continue

        voice_prompt = speaker_profile.get("voice_prompt")
        if not voice_prompt:
            entry["status"] = "skipped"
            entry["error"] = f"voice_prompt not configured for {speaker_id}"
            emit(f"[{segment_id}] Skipped - voice prompt missing")
            continue

        voice_prompt_path = Path(str(voice_prompt))
        if not voice_prompt_path.exists():
            entry["status"] = "skipped"
            entry["error"] = f"voice_prompt not found: {voice_prompt_path}"
            emit(f"[{segment_id}] Skipped - voice prompt path not found")
            continue

        output_path = Path(entry["output_path"])
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # 获取覆盖配置
        override_cfg = overrides.get(segment_id, {})
        override_text = override_cfg.get("text")
        override_emotion = override_cfg.get("emotion")

        # 输入验证：检查文本长度
        text_to_synthesize = override_text or entry.get("text", "")
        if not text_to_synthesize or not text_to_synthesize.strip():
            entry["status"] = "skipped"
            entry["error"] = f"Empty text for segment {segment_id}"
            emit(f"[{segment_id}] Skipped - empty text")
            continue

        # 检查文本长度是否过长（可能导致内存问题）
        max_text_length = 5000  # 可配置
        if len(text_to_synthesize) > max_text_length:
            emit(f"[{segment_id}] Warning: Text length ({len(text_to_synthesize)}) exceeds recommended limit ({max_text_length})")

        interval = speaker_profile.get("interval_silence") or speaker_defaults.get("interval_silence") or 0
        interval_ms = int(float(interval) * 1000)

        emo_mode = (speaker_profile.get("emo_mode") or speaker_defaults.get("emo_mode") or "text").lower()
        emotion_text = override_emotion or entry.get("emotion") or speaker_profile.get("emo_text") or speaker_defaults.get("emo_text")
        emo_audio_prompt = speaker_profile.get("emo_audio_prompt")
        emo_vector = speaker_profile.get("emo_vector")

        # 检查是否有情感参考音频录制
        entry_emotion_mode = entry.get("emotion_mode", "text")
        entry_emotion_audio = entry.get("emotion_reference_audio")

        # 如果片段指定了使用音频模式且有参考音频，优先使用
        if entry_emotion_mode == "audio" and entry_emotion_audio and Path(entry_emotion_audio).exists():
            emo_mode = "audio"
            emo_audio_prompt = entry_emotion_audio
        elif entry_emotion_mode == "text" and emotion_text:
            emo_mode = "text"

        # 确保 emo_alpha 是 float 类型，避免类型错误
        emo_alpha_raw = speaker_profile.get("emo_alpha") or speaker_defaults.get("emo_alpha") or generation_defaults.get("emo_alpha") or 1.0
        emo_alpha = float(emo_alpha_raw) if emo_alpha_raw is not None else 1.0

        tts_kwargs = dict(generation_defaults)
        # 确保所有数值参数都是正确的类型
        for key in ["emo_alpha", "temperature", "top_p", "top_k"]:
            if key in tts_kwargs and tts_kwargs[key] is not None:
                try:
                    tts_kwargs[key] = float(tts_kwargs[key])
                except (ValueError, TypeError):
                    # 如果转换失败，使用默认值或移除该参数
                    if key == "emo_alpha":
                        tts_kwargs[key] = 1.0
                    else:
                        tts_kwargs.pop(key, None)
        
        tts_kwargs.update(
            spk_audio_prompt=str(voice_prompt_path),
            text=override_text or entry["text"],
            output_path=str(output_path),
            interval_silence=interval_ms,
            emo_alpha=emo_alpha,
            verbose=False,
        )

        if emo_mode == "text" and emotion_text:
            tts_kwargs["use_emo_text"] = True
            tts_kwargs["emo_text"] = emotion_text
        elif emo_mode == "audio" and emo_audio_prompt:
            tts_kwargs["emo_audio_prompt"] = emo_audio_prompt
            # 确保不传递文本情感参数
            tts_kwargs.pop("use_emo_text", None)
            tts_kwargs.pop("emo_text", None)
        elif emo_mode == "vector" and emo_vector:
            tts_kwargs["emo_vector"] = emo_vector

        entry["status"] = "running"
        entry["started_at"] = datetime.utcnow().isoformat()
        emit(f"[{segment_id}] Start synthesis (speaker={speaker_id}, text_length={len(entry.get('text', ''))})")
        try:
            seg_start = time.time()
            # 添加超时处理
            if timeout_enabled:
                import signal
                def timeout_handler(signum, frame):
                    raise TimeoutError(f"Segment {segment_id} synthesis timeout after {SEGMENT_TIMEOUT}s")
                
                # 注意：signal.alarm只在Unix系统上可用，Windows需要使用threading.Timer
                if hasattr(signal, 'SIGALRM'):
                    signal.signal(signal.SIGALRM, timeout_handler)
                    signal.alarm(int(SEGMENT_TIMEOUT))
            
            tts.infer(**tts_kwargs)
            
            if timeout_enabled and hasattr(signal, 'SIGALRM'):
                signal.alarm(0)  # 取消超时

            entry["status"] = "done"
            entry["completed_at"] = datetime.utcnow().isoformat()
            entry["duration_sec"] = round(time.time() - seg_start, 3)
            entry["error"] = None

            # 测量实际音频时长（关键修复）
            try:
                # 尝试使用librosa测量实际音频时长
                import librosa
                actual_duration = librosa.get_duration(path=output_path)
                entry["actual_duration_sec"] = round(actual_duration, 3)
                entry["timing_accuracy"] = "verified"
            except Exception as audio_err:
                # 如果测量失败，回退到推理时间
                entry["actual_duration_sec"] = entry["duration_sec"]
                entry["timing_accuracy"] = "estimated"
                print(f"警告: 无法测量音频实际时长 {segment_id}: {audio_err}")

            # 记录最终使用的文本（用于字幕一致性）
            entry["final_text"] = entry.get("text", "")
            if override_text:
                entry["text"] = override_text
            if override_emotion:
                entry["emotion"] = override_emotion
            emit(f"[{segment_id}] Completed in {entry['duration_sec']}s (audio: {entry.get('actual_duration_sec', 'N/A')}s)")
        except TimeoutError as exc:
            entry["status"] = "failed"
            entry["error"] = str(exc)
            emit(f"[{segment_id}] FAILED: {exc}")
            emit(f"[{segment_id}] This segment exceeded the timeout limit ({SEGMENT_TIMEOUT}s)")
        except Exception as exc:  # pragma: no cover - depends on runtime env
            import traceback
            error_trace = traceback.format_exc()
            entry["status"] = "failed"
            entry["error"] = str(exc)
            entry["error_traceback"] = error_trace  # 保存完整堆栈到manifest
            emit(f"[{segment_id}] FAILED: {exc}")
            # 对于所有失败，记录关键错误信息（完整堆栈保存到manifest中）
            emit(f"[{segment_id}] Error type: {type(exc).__name__}")
            # 只打印堆栈的关键部分，避免日志过长
            trace_lines = error_trace.split('\n')
            for line in trace_lines[:10]:  # 只显示前10行
                if line.strip():
                    emit(f"[{segment_id}] {line}")
            if len(trace_lines) > 10:
                emit(f"[{segment_id}] ... (full traceback saved in manifest)")

    counts = Counter(entry.get("status", "pending") for entry in segments)
    manifest.setdefault("stats", {})
    manifest["stats"].update(
        {
            "total_segments": len(segments),
            "status_counts": dict(counts),
            "completed_segments": counts.get("done", 0),
            "failed_segments": counts.get("failed", 0),
        }
    )
    manifest["updated_at"] = datetime.utcnow().isoformat()
    manifest["elapsed_sec"] = round(time.time() - start_time, 3)
    emit(
        f"Synthesis finished: {counts.get('done', 0)}/{len(selected_segments)} segments succeeded"
    )
    if counts.get("failed"):
        emit(f"Failed segments: {counts['failed']}")

    return manifest, logs


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Auto Voiceover CLI")
    parser.add_argument("--script", required=True, help="Path to the Markdown script")
    parser.add_argument("--config", required=True, help="Path to speakers.yaml")
    parser.add_argument(
        "--out-root",
        help="Directory for DUB outputs (defaults to DUB/<script_basename>)",
    )
    parser.add_argument("--language", default=None, help="Script language hint (zh/en)")
    parser.add_argument("--manifest", help="Optional path to write manifest JSON")
    parser.add_argument("--print", action="store_true", help="Print manifest summary to stdout")
    parser.add_argument("--generate", action="store_true", help="Run the full synthesis pipeline")
    parser.add_argument("--pending-only", action="store_true", help="When generating, skip segments already marked as done")
    parser.add_argument("--model-dir", default="checkpoints", help="IndexTTS2 checkpoints directory")
    parser.add_argument("--fp16", action="store_true", help="Use FP16 when loading the model (if supported)")
    args = parser.parse_args(argv)

    script_path = Path(args.script)
    config_path = Path(args.config)
    episode_name = script_path.stem

    out_root = Path(args.out_root) if args.out_root else Path("DUB") / episode_name
    out_root = out_root.resolve()

    manifest_path = Path(args.manifest) if args.manifest else None
    if args.generate and manifest_path is None:
        manifest_path = Path("outputs/auto_voiceover") / f"{episode_name}_manifest.json"

    existing_manifest = load_manifest(manifest_path) if (manifest_path and manifest_path.exists()) else None

    manifest, config, _ = prepare_manifest(script_path, config_path, out_root, args.language)
    if existing_manifest:
        manifest = merge_manifests(existing_manifest, manifest)

    if manifest["missing_speakers"]:
        print(
            "WARNING: Missing speaker profiles for -> "
            + ", ".join(manifest["missing_speakers"]),
            file=sys.stderr,
        )
        return 2

    logs: List[str] = []

    if args.generate:
        from indextts.infer_v2 import IndexTTS2

        model_dir = Path(args.model_dir)
        cfg_path = model_dir / "config.yaml"
        if not cfg_path.exists():
            raise FileNotFoundError(f"Config file not found in model dir: {cfg_path}")
        tts = IndexTTS2(
            cfg_path=str(cfg_path),
            model_dir=str(model_dir),
            use_fp16=args.fp16,
        )
        manifest, logs = synthesize_segments(
            manifest,
            config,
            tts,
            log_cb=print,
            only_pending=args.pending_only,
        )

    if manifest_path:
        save_manifest(manifest, manifest_path)
        print(f"Manifest written to {manifest_path}")

    if args.print or (not args.manifest and not args.generate):
        _print_summary(manifest)

    if args.generate and logs and args.print:
        print("Generation log tail:")
        for line in logs[-10:]:
            print(f"  {line}")

    return 0


def _print_summary(manifest: Dict[str, object]) -> None:
    print(f"Episode: {manifest['episode']}")
    print(f"Output root: {manifest['output_root']}")
    print(f"Segments: {len(manifest['segments'])}")
    stats = manifest.get("stats")
    if stats and stats.get("status_counts"):
        print("Status counts:")
        for status, count in stats["status_counts"].items():
            print(f"  - {status}: {count}")
    if manifest.get("warnings"):
        print("Warnings:")
        for warning in manifest["warnings"]:
            print(f"  - {warning}")
    print("Sample entries:")
    for entry in manifest["segments"][:3]:
        print(
            f"  • {entry['segment_id']} | speaker={entry['speaker']} | emotion={entry.get('emotion') or '-'}"
        )


if __name__ == "__main__":
    sys.exit(main())
