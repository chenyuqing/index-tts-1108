#!/usr/bin/env python3
"""Flask-based UI backend for the Auto Voiceover workflow."""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory
from urllib.parse import quote, unquote

from tools.auto_voiceover import (
    prepare_manifest,
    save_manifest,
    synthesize_segments,
    load_manifest,
    merge_manifests,
    build_review_output_path,
)


WORKSPACE_ROOT = Path(__file__).resolve().parent
DEFAULT_SCRIPT = str(WORKSPACE_ROOT / "test_input/scripts/what is understanding-hinton-CN.md")
DEFAULT_CONFIG = str(WORKSPACE_ROOT / "test_input/speakers.yaml")
DEFAULT_OUT_ROOT = str(WORKSPACE_ROOT / "test_input/DUB")
DEFAULT_MODEL_DIR = str(WORKSPACE_ROOT / "checkpoints")
MANIFEST_DIR = WORKSPACE_ROOT / "outputs/auto_voiceover"
STATIC_DIR = WORKSPACE_ROOT / "auto_voiceover_ui"
DEFAULT_BROWSER_ROOT = WORKSPACE_ROOT / "test_input"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/ui")


class _QuietFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return "/api/state" not in msg


logging.getLogger("werkzeug").addFilter(_QuietFilter())

_original_signal_handler = signal.signal


def _thread_safe_signal(signum, handler):
    if threading.current_thread() is not threading.main_thread():
        # Skip re-registering signals from worker threads to avoid ValueError.
        return handler
    return _original_signal_handler(signum, handler)


signal.signal = _thread_safe_signal


def _find_fallback_script() -> Optional[Path]:
    candidate = Path(DEFAULT_SCRIPT)
    if candidate.exists():
        return candidate
    scripts_dir = WORKSPACE_ROOT / "test_input/scripts"
    if scripts_dir.exists():
        items = sorted(scripts_dir.glob("*.md"))
        if items:
            return items[0]
    return None


def _resolve_script_input(value: Optional[str]) -> Path:
    if value:
        candidate = _resolve_path(value)
        if candidate.exists():
            return candidate
    fallback = _find_fallback_script()
    if fallback:
        return fallback
    raise FileNotFoundError("No Markdown script available. Please upload or specify a script.")


def _normalize_out_root(path: Path, episode: str) -> Path:
    path = path.resolve()
    if path.name != episode:
        path = (path / episode).resolve()
    return path


def _get_tts_instance(model_dir: Path, use_fp16: bool):
    cfg_path = model_dir / "config.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"Config file not found in model dir: {cfg_path}")

    with tts_lock:
        if (
            tts_cache["instance"] is not None
            and tts_cache["model_dir"] == str(model_dir)
            and tts_cache["use_fp16"] == use_fp16
        ):
            return tts_cache["instance"]

        from indextts.infer_v2 import IndexTTS2

        instance = IndexTTS2(
            cfg_path=str(cfg_path),
            model_dir=str(model_dir),
            use_fp16=use_fp16,
        )
        tts_cache["instance"] = instance
        tts_cache["model_dir"] = str(model_dir)
        tts_cache["use_fp16"] = use_fp16
        return instance


def _get_review_tts_instance(model_dir: Path, use_fp16: bool):
    cfg_path = model_dir / "config.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"Config file not found in model dir: {cfg_path}")

    with review_tts_lock:
        if (
            review_tts_cache["instance"] is not None
            and review_tts_cache["model_dir"] == str(model_dir)
            and review_tts_cache["use_fp16"] == use_fp16
        ):
            return review_tts_cache["instance"]

        from indextts.infer_v2 import IndexTTS2

        instance = IndexTTS2(
            cfg_path=str(cfg_path),
            model_dir=str(model_dir),
            use_fp16=use_fp16,
        )
        review_tts_cache["instance"] = instance
        review_tts_cache["model_dir"] = str(model_dir)
        review_tts_cache["use_fp16"] = use_fp16
        return instance


def _clear_tts_cache() -> bool:
    cleared = False
    with tts_lock:
        if tts_cache["instance"] is not None:
            tts_cache["instance"] = None
            tts_cache["model_dir"] = None
            tts_cache["use_fp16"] = None
            cleared = True
    with review_tts_lock:
        if review_tts_cache["instance"] is not None:
            review_tts_cache["instance"] = None
            review_tts_cache["model_dir"] = None
            review_tts_cache["use_fp16"] = None
            cleared = True
    if cleared:
        try:
            import torch

            if hasattr(torch, "cuda"):
                torch.cuda.empty_cache()
        except Exception:
            pass
    return cleared
job_lock = Lock()
job_control = {
    "status": "idle",
    "requested": None,
    "logs": [],
}
LAST_MANIFEST_PATH: Optional[Path] = None
tts_lock = Lock()
tts_infer_lock = Lock()
tts_cache: Dict[str, Optional[Any]] = {
    "instance": None,
    "model_dir": None,
    "use_fp16": None,
}
review_tts_lock = Lock()
review_tts_infer_lock = Lock()
review_tts_cache: Dict[str, Optional[Any]] = {
    "instance": None,
    "model_dir": None,
    "use_fp16": None,
}


def request_job_action(action: str) -> None:
    if action not in {"pause", "resume", "stop"}:
        return
    job_control["requested"] = action


def consume_job_action() -> Optional[str]:
    action = job_control.get("requested")
    job_control["requested"] = None
    return action


def _resolve_path(path_str: Optional[str]) -> Path:
    if not path_str:
        return WORKSPACE_ROOT
    candidate = Path(path_str)
    if not candidate.is_absolute():
        candidate = (WORKSPACE_ROOT / candidate).resolve()
    return candidate


def _serialize_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "segment_id": entry.get("segment_id"),
        "speaker": entry.get("speaker"),
        "status": entry.get("status"),
        "emotion": entry.get("emotion"),
        "output_path": entry.get("output_path"),
        "duration_sec": entry.get("duration_sec"),
    }


@app.route("/")
def index() -> Any:
    return send_from_directory(app.static_folder, "index.html")


@app.route("/review")
def review() -> Any:
    return send_from_directory(app.static_folder, "review.html")


@app.route("/api/defaults")
def api_defaults() -> Any:
    script_path = _find_fallback_script() or Path(DEFAULT_SCRIPT)
    return jsonify(
        {
            "script": str(script_path),
            "config": DEFAULT_CONFIG,
            "out_root": DEFAULT_OUT_ROOT,
            "model_dir": DEFAULT_MODEL_DIR,
            "language": "auto",
            "workspace_root": str(DEFAULT_BROWSER_ROOT if DEFAULT_BROWSER_ROOT.exists() else WORKSPACE_ROOT),
        }
    )


def _resolve_manifest_path(manifest_path: Optional[str], script_path: Path) -> Path:
    global LAST_MANIFEST_PATH
    if manifest_path:
        return _resolve_path(manifest_path)
    if LAST_MANIFEST_PATH and LAST_MANIFEST_PATH.exists():
        return LAST_MANIFEST_PATH
    return MANIFEST_DIR / f"{script_path.stem}_manifest.json"


@app.post("/api/listdir")
def api_listdir() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    path = _resolve_path(data.get("path"))
    if not path.exists():
        return jsonify({"error": f"Path not found: {path}"}), 404
    if path.is_file():
        path = path.parent

    allowed_exts = data.get("extensions") or []
    allowed_exts = [ext.lower() for ext in allowed_exts]
    want_dirs = data.get("include_dirs", True)
    want_files = data.get("include_files", True)

    entries: List[Dict[str, Any]] = []
    try:
        for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            if child.name.startswith("."):
                continue
            if child.is_dir():
                if want_dirs:
                    entries.append({
                        "name": child.name,
                        "path": str(child),
                        "is_dir": True,
                    })
            else:
                if not want_files:
                    continue
                if allowed_exts and child.suffix.lower() not in allowed_exts:
                    continue
                entries.append({
                    "name": child.name,
                    "path": str(child),
                    "is_dir": False,
                })
    except PermissionError:
        return jsonify({"error": f"Permission denied: {path}"}), 403

    return jsonify({"current_path": str(path), "entries": entries})


def _build_manifest_summary(manifest: Dict[str, Any]) -> Dict[str, Any]:
    stats = manifest.get("stats", {})
    counts = stats.get("status_counts", {})
    preview = [
        {
            "segment_id": entry["segment_id"],
            "chapter": entry.get("chapter"),
            "speaker": entry.get("speaker"),
            "emotion": entry.get("emotion"),
            "text": entry.get("text", "")[:120],
            "output_path": entry.get("output_path"),
        }
        for entry in manifest.get("segments", [])[:30]
    ]
    return {
        "episode": manifest.get("episode"),
        "script_title": manifest.get("script_title"),
        "output_root": manifest.get("output_root"),
        "warnings": manifest.get("warnings", []),
        "missing_speakers": manifest.get("missing_speakers", []),
        "stats": {
            "total_segments": stats.get("total_segments", len(manifest.get("segments", []))),
            "status_counts": counts,
        },
        "preview": preview,
    }


@app.post("/api/model/clear")
def api_model_clear() -> Any:
    cleared = _clear_tts_cache()
    return jsonify({"status": "cleared" if cleared else "empty"})


@app.get("/api/model/state")
def api_model_state() -> Any:
    with tts_lock, review_tts_lock:
        return jsonify(
            {
                "main": {
                    "loaded": tts_cache["instance"] is not None,
                    "model_dir": tts_cache["model_dir"],
                    "use_fp16": tts_cache["use_fp16"],
                },
                "review": {
                    "loaded": review_tts_cache["instance"] is not None,
                    "model_dir": review_tts_cache["model_dir"],
                    "use_fp16": review_tts_cache["use_fp16"],
                },
            }
        )


@app.get("/api/state")
def api_state() -> Any:
    return jsonify(job_control)


@app.post("/api/control")
def api_control() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    action = data.get("action")
    if action not in {"pause", "resume", "stop"}:
        return jsonify({"error": "invalid_action"}), 400
    if job_control["status"] != "running" and action != "stop":
        return jsonify({"error": "no_running_job"}), 400
    job_control["requested"] = action
    return jsonify({"status": "ok", "requested": action})


@app.post("/api/dry-run")
def api_dry_run() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    script_path = _resolve_script_input(data.get("script_path"))
    config_path = _resolve_path(data.get("config_path") or DEFAULT_CONFIG)
    out_root = _normalize_out_root(_resolve_path(data.get("out_root") or DEFAULT_OUT_ROOT), script_path.stem)
    language = data.get("language")

    manifest, _, _ = prepare_manifest(
        script_path,
        _resolve_path(config_path),
        out_root,
        language if language and language != "auto" else None,
    )

    return jsonify(_build_manifest_summary(manifest))


@app.post("/api/review-data")
def api_review_data() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    script_path = _resolve_script_input(data.get("script_path"))
    config_path = _resolve_path(data.get("config_path") or DEFAULT_CONFIG)
    out_root = _normalize_out_root(_resolve_path(data.get("out_root") or DEFAULT_OUT_ROOT), script_path.stem)
    language = data.get("language")
    manifest_path = _resolve_manifest_path(data.get("manifest_path"), script_path)

    manifest_data = load_manifest(manifest_path)
    if manifest_data is None:
        manifest_data, _, _ = prepare_manifest(
            script_path,
            config_path,
            out_root,
            language if language and language != "auto" else None,
        )

    chapters: Dict[str, Dict[str, Any]] = {}
    for entry in manifest_data.get("segments", []):
        chapter_id = entry.get("chapter") or "chXX"
        chapter = chapters.setdefault(
            chapter_id,
            {
                "chapter_id": chapter_id,
                "chapter_title": entry.get("chapter_title") or chapter_id,
                "segments": [],
            },
        )
        output_path = entry.get("output_path")
        audio_path = Path(output_path) if output_path else None
        if not audio_path or not audio_path.exists():
            filename = f"{entry.get('segment_id')}" + (f"-{entry.get('speaker')}" if entry.get('speaker') else "") + ".wav"
            audio_path = out_root / chapter_id / filename
        audio_exists = audio_path.exists()
        audio_url = f"/api/audio?path={quote(str(audio_path))}" if audio_exists else None
        chapter["segments"].append(
            {
                "segment_id": entry.get("segment_id"),
                "speaker": entry.get("speaker"),
                "emotion": entry.get("emotion"),
                "text": entry.get("text"),
                "audio_url": audio_url,
                "output_path": output_path,
            }
        )

    ordered = sorted(chapters.values(), key=lambda c: c["chapter_id"])
    return jsonify({
        "manifest_path": str(manifest_path),
        "chapters": ordered,
    })


@app.get("/api/audio")
def api_audio() -> Any:
    raw_path = request.args.get("path")
    if not raw_path:
        return jsonify({"error": "missing_path"}), 400
    path = unquote(raw_path)
    if not path:
        return jsonify({"error": "missing_path"}), 400
    target = _resolve_path(path)
    if not target.exists() or not target.is_file():
        return jsonify({"error": "not_found"}), 404
    return send_from_directory(target.parent, target.name)


@app.post("/api/generate")
def api_generate() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    script_path = _resolve_script_input(data.get("script_path"))
    config_path = _resolve_path(data.get("config_path") or DEFAULT_CONFIG)
    out_root = _normalize_out_root(_resolve_path(data.get("out_root") or DEFAULT_OUT_ROOT), script_path.stem)
    language = data.get("language")
    model_dir = _resolve_path(data.get("model_dir") or DEFAULT_MODEL_DIR)
    use_fp16 = bool(data.get("use_fp16", False))
    pending_only = bool(data.get("pending_only", False))

    manifest_path = _resolve_manifest_path(data.get("manifest_path"), script_path)
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)

    existing_manifest = load_manifest(manifest_path)
    manifest, config_data, _ = prepare_manifest(
        script_path,
        config_path,
        out_root,
        language if language and language != "auto" else None,
    )
    if existing_manifest:
        manifest = merge_manifests(existing_manifest, manifest)

    if manifest["missing_speakers"]:
        summary = _build_manifest_summary(manifest)
        return jsonify({"error": "missing_speakers", "summary": summary}), 400

    with job_lock:
        if job_control["status"] == "running":
            return jsonify({"error": "job_running"}), 409

        job_control["requested"] = None
        job_control["status"] = "running"

    def control_fn():
        action = job_control.get("requested")
        if action in {"pause", "resume", "stop"}:
            return action
        return None

    try:
        tts = _get_tts_instance(model_dir, use_fp16)

        job_control["logs"] = []

        def log_cb(message: str) -> None:
            job_control["logs"].append(message)
            if len(job_control["logs"]) > 200:
                job_control["logs"] = job_control["logs"][-200:]
            print(message)

        with tts_infer_lock:
            manifest, logs = synthesize_segments(
                manifest,
                config_data,
                tts,
                only_pending=pending_only,
                control_fn=control_fn,
                log_cb=log_cb,
            )
    except Exception as exc:
        job_control["status"] = "idle"
        job_control["requested"] = None
        raise
    else:
        save_manifest(manifest, manifest_path)
        global LAST_MANIFEST_PATH
        LAST_MANIFEST_PATH = manifest_path
        job_control["status"] = "idle"
        job_control["requested"] = None

    stats = manifest.get("stats", {})
    counts = stats.get("status_counts", {})
    table_rows = [_serialize_entry(entry) for entry in manifest.get("segments", [])[:200]]
    return jsonify(
        {
            "summary": {
                "episode": manifest.get("episode"),
                "completed": counts.get("done", 0),
                "total": stats.get("total_segments"),
                "failed": counts.get("failed", 0),
                "skipped": counts.get("skipped", 0),
                "manifest_path": str(manifest_path),
            },
            "logs": logs,
            "segments": table_rows,
        }
    )


@app.post("/api/segment/regenerate")
def api_segment_regenerate() -> Any:
    data = request.get_json(force=True, silent=True) or {}
    script_path = _resolve_script_input(data.get("script_path"))
    config_path = _resolve_path(data.get("config_path") or DEFAULT_CONFIG)
    out_root = _normalize_out_root(_resolve_path(data.get("out_root") or DEFAULT_OUT_ROOT), script_path.stem)
    language = data.get("language")
    model_dir = _resolve_path(data.get("model_dir") or DEFAULT_MODEL_DIR)
    use_fp16 = bool(data.get("use_fp16", False))
    segment_id = data.get("segment_id")
    overrides = data.get("overrides") or {}

    if not segment_id:
        return jsonify({"error": "missing_segment"}), 400

    manifest_path = _resolve_manifest_path(data.get("manifest_path"), script_path)
    manifest, config_data, _ = prepare_manifest(
        script_path,
        config_path,
        out_root,
        language if language and language != "auto" else None,
    )

    entry = next((seg for seg in manifest.get("segments", []) if seg.get("segment_id") == segment_id), None)
    if entry is None:
        return jsonify({"error": "segment_not_found"}), 404

    review_path = build_review_output_path(out_root, entry)
    entry_copy = dict(entry)
    entry_copy["output_path"] = str(review_path)

    review_manifest = {
        **manifest,
        "segments": [entry_copy],
    }

    tts = _get_review_tts_instance(model_dir, use_fp16)

    with review_tts_infer_lock:
        review_manifest, logs = synthesize_segments(
            review_manifest,
            config_data,
            tts,
            segment_filter=[segment_id],
            overrides={segment_id: overrides},
        )

    audio_url = None
    if Path(review_path).exists():
        audio_url = f"/api/audio?path={quote(str(review_path))}"

    return jsonify({"logs": logs, "audio_url": audio_url})


def create_app() -> Flask:
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto Voiceover Flask UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7865)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
