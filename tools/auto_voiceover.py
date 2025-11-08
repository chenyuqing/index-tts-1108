#!/usr/bin/env python3
"""Auto Voiceover CLI utilities.

This initial implementation focuses on parsing Markdown podcast scripts,
combining them with speaker configuration, and emitting a dry-run manifest
that follows the requirements described in PRD_Auto_Voiceover.md.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
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

ProgressCallback = Callable[[float, str], None]
LogCallback = Callable[[str], None]


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


class MarkdownScriptParser:
    """Parses Markdown scripts that follow the PRD conventions."""

    SPEAKER_PATTERN = re.compile(
        r"^\s*(?:\*\*)?(?P<name>[\w\u4e00-\u9fff]+)(?:\*\*)?\s*[：:]\s*(?P<rest>.*)$"
    )

    HEADER_PATTERN = re.compile(r"^(?P<level>#{1,6})\s+(?P<title>.+?)\s*$")

    DIRECTIVE_PATTERN = re.compile(r"^[（(](?P<content>.+)[）)]$")

    def __init__(self, language: Optional[str] = None):
        self.language = language

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
                if level == 1 and not script_title:
                    script_title = header_match.group("title").strip()
                else:
                    flush_active_segment()
                    ensure_chapter(header_match.group("title").strip())
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
            if speaker_match and self._looks_like_speaker_header(speaker_match.group("rest")):
                flush_active_segment()
                if chapter_id is None:
                    ensure_chapter("ch00")
                raw_rest = speaker_match.group("rest").strip()
                rest_text, emotion_from_line = self._extract_emotion_markers(raw_rest)
                active_segment = {
                    "chapter_id": chapter_id,
                    "chapter_title": chapter_title or "",
                    "speaker_id": speaker_match.group("name").strip().lower(),
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
        return ParseResult(segments=segments, warnings=warnings, script_title=script_title)

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
        candidate = rest.strip()
        if not candidate:
            return True
        return candidate[0] in {"【", "[", "(", "*"}


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
            }
        )

    now = datetime.utcnow().isoformat()

    return {
        "episode": episode_name,
        "script_title": parse_result.script_title,
        "language": parse_result.segments[0].metadata.get("language") if parse_result.segments else None,
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
        ]:
            if prev.get(key) is not None:
                seg[key] = prev.get(key)

    new["stats"] = old.get("stats", new.get("stats"))
    new["updated_at"] = old.get("updated_at", new.get("updated_at"))
    return new


def refresh_segment_status_by_files(manifest: Dict[str, object]) -> None:
    for entry in manifest.get("segments", []):
        if entry.get("status") == "done":
            continue
        output_path = entry.get("output_path")
        if not output_path:
            continue
        if Path(output_path).exists():
            entry["status"] = "done"
            entry["completed_at"] = entry.get("completed_at") or datetime.utcnow().isoformat()
            entry["error"] = None


def prepare_manifest(
    script_path: Path,
    config_path: Path,
    out_root: Path,
    language: Optional[str] = None,
) -> Tuple[Dict[str, object], Dict[str, Dict[str, object]], ParseResult]:
    parser = MarkdownScriptParser(language=language)
    parse_result = parser.parse(script_path)
    config = load_speaker_config(config_path)
    episode = script_path.stem
    final_out_root = normalize_out_root(out_root, episode)
    manifest = build_manifest(parse_result, config, final_out_root, episode)
    return manifest, config, parse_result


def normalize_out_root(out_root: Path, episode: str) -> Path:
    out_root = out_root.resolve()
    if out_root.name != episode:
        out_root = (out_root / episode).resolve()
    return out_root


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
        if progress_cb:
            progress_cb(progress_ratio, f"合成 {segment_id}")

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

        interval = speaker_profile.get("interval_silence") or speaker_defaults.get("interval_silence") or 0
        interval_ms = int(float(interval) * 1000)

        override_cfg = overrides.get(segment_id, {})
        override_text = override_cfg.get("text")
        override_emotion = override_cfg.get("emotion")

        emo_mode = (speaker_profile.get("emo_mode") or speaker_defaults.get("emo_mode") or "text").lower()
        emotion_text = override_emotion or entry.get("emotion") or speaker_profile.get("emo_text") or speaker_defaults.get("emo_text")
        emo_audio_prompt = speaker_profile.get("emo_audio_prompt")
        emo_vector = speaker_profile.get("emo_vector")
        emo_alpha = float(speaker_profile.get("emo_alpha") or speaker_defaults.get("emo_alpha") or 1.0)

        tts_kwargs = dict(generation_defaults)
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
        elif emo_mode == "vector" and emo_vector:
            tts_kwargs["emo_vector"] = emo_vector

        entry["status"] = "running"
        entry["started_at"] = datetime.utcnow().isoformat()
        emit(f"[{segment_id}] Start synthesis (speaker={speaker_id})")
        try:
            seg_start = time.time()
            tts.infer(**tts_kwargs)
            entry["status"] = "done"
            entry["completed_at"] = datetime.utcnow().isoformat()
            entry["duration_sec"] = round(time.time() - seg_start, 3)
            entry["error"] = None
            if override_text:
                entry["text"] = override_text
            if override_emotion:
                entry["emotion"] = override_emotion
            emit(f"[{segment_id}] Completed in {entry['duration_sec']}s")
        except Exception as exc:  # pragma: no cover - depends on runtime env
            entry["status"] = "failed"
            entry["error"] = str(exc)
            emit(f"[{segment_id}] FAILED: {exc}")

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
