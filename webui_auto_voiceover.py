#!/usr/bin/env python3
"""Lightweight WebUI for the Auto Voiceover dry-run workflow."""

from __future__ import annotations

import argparse
from pathlib import Path
from functools import lru_cache
from typing import Any, List, Tuple, Optional

try:  # Delay hard dependency for environments without gradio during testing
    import gradio as gr  # type: ignore
except ImportError:  # pragma: no cover - handled when building UI
    gr = None

from tools.auto_voiceover import (
    prepare_manifest,
    save_manifest,
    synthesize_segments,
    load_manifest,
    merge_manifests,
)

OUTPUT_MANIFEST_DIR = Path("outputs/auto_voiceover")
PROGRESS_DEFAULT = gr.Progress(track_tqdm=True) if gr else None


def list_scripts() -> List[str]:
    candidates: List[str] = []
    for folder in (Path("scripts"), Path("test_input/scripts")):
        if folder.exists():
            for path in sorted(folder.glob("*.md")):
                candidates.append(str(path))
    return candidates


def list_configs() -> List[str]:
    candidates: List[str] = []
    for folder in (Path("assets"), Path("test_input"), Path(".")):
        if folder.exists():
            for path in sorted(folder.glob("*.yaml")):
                candidates.append(str(path))
    return candidates


def _prepare_context(script_path: str, config_path: str, out_root: str, language: str):
    script = Path(script_path).expanduser()
    if not script.exists():
        raise FileNotFoundError(f"Script not found: {script}")

    config = Path(config_path).expanduser()
    if not config.exists():
        raise FileNotFoundError(f"Config not found: {config}")

    episode_name = script.stem
    out_root_value = out_root.strip()
    out_root_path = (
        Path(out_root_value).expanduser() if out_root_value else (Path("DUB") / episode_name)
    ).resolve()

    manifest, config_data, parse_result = prepare_manifest(
        script,
        config,
        out_root_path,
        None if language == "auto" else language,
    )
    return manifest, config_data, out_root_path, parse_result


def run_dry_run(script_path: str, config_path: str, out_root: str, language: str) -> Tuple[str, str, List[List[str]], dict]:
    try:
        manifest, _, _, _ = _prepare_context(script_path, config_path, out_root, language)
    except FileNotFoundError as exc:
        return (str(exc), "", [], {})

    summary_lines = [
        f"Episode: {manifest['episode']}",
        f"Script title: {manifest.get('script_title') or '-'}",
        f"Output root: {manifest['output_root']}",
        f"Segments: {len(manifest['segments'])}",
        f"Missing speakers: {', '.join(manifest['missing_speakers']) if manifest['missing_speakers'] else 'None'}",
    ]
    summary = "\n".join(summary_lines)

    warnings = manifest.get("warnings", [])
    warnings_text = "\n".join(warnings) if warnings else "None"

    preview_rows: List[List[str]] = []
    for entry in manifest["segments"][:50]:
        preview_rows.append(
            [
                entry["segment_id"],
                entry["chapter"],
                entry["speaker"],
                entry.get("emotion") or "",
                entry["text"][:80],
                entry["output_path"],
            ]
        )

    manifest_preview = dict(manifest)
    manifest_preview["segments"] = manifest_preview["segments"][:20]

    return summary, warnings_text, preview_rows, manifest_preview


@lru_cache(maxsize=2)
def _get_tts(model_dir: str, use_fp16: bool):
    from indextts.infer_v2 import IndexTTS2

    model_dir_path = Path(model_dir).expanduser().resolve()
    cfg_path = model_dir_path / "config.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"config.yaml not found under {model_dir_path}")

    return IndexTTS2(
        cfg_path=str(cfg_path),
        model_dir=str(model_dir_path),
        use_fp16=use_fp16,
    )


def run_generation(
    script_path: str,
    config_path: str,
    out_root: str,
    language: str,
    model_dir: str,
    use_fp16: bool,
    pending_only: bool,
    progress=PROGRESS_DEFAULT,
):
    try:
        manifest, config_data, _, _ = _prepare_context(script_path, config_path, out_root, language)
    except FileNotFoundError as exc:
        return (str(exc), str(exc), [], {}, None)

    manifest_path = OUTPUT_MANIFEST_DIR / f"{manifest['episode']}_manifest.json"
    existing = load_manifest(manifest_path)
    if existing:
        manifest = merge_manifests(existing, manifest)

    if manifest["missing_speakers"]:
        message = "缺少主持人配置: " + ", ".join(manifest["missing_speakers"])
        tip = "请在 speakers.yaml 中补齐后再运行自动配音。"
        preview = dict(manifest)
        preview["segments"] = preview["segments"][:20]
        return (message, tip, [], preview, None)

    progress_fn = progress if progress is not None else (lambda *_, **__: None)

    progress_fn(0.02, "加载模型…")
    try:
        tts = _get_tts(model_dir, use_fp16)
    except Exception as exc:  # pragma: no cover - runtime dependent
        return (f"加载模型失败: {exc}", str(exc), [], {}, None)

    def progress_cb(ratio: float, desc: str) -> None:
        progress_fn(0.1 + 0.85 * ratio, desc)

    manifest, logs = synthesize_segments(
        manifest,
        config_data,
        tts,
        progress_cb=progress_cb,
        only_pending=pending_only,
    )

    OUTPUT_MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    save_manifest(manifest, manifest_path)

    stats = manifest.get("stats", {})
    counts = stats.get("status_counts", {})
    summary_lines = [
        f"Episode: {manifest['episode']}",
        f"完成/总计: {counts.get('done', 0)}/{stats.get('total_segments', len(manifest['segments']))}",
        f"失败: {counts.get('failed', 0)} | 跳过: {counts.get('skipped', 0)}",
        f"耗时 (秒): {manifest.get('elapsed_sec', '-')}",
        f"Manifest: {manifest_path}",
    ]
    summary = "\n".join(summary_lines)

    log_tail = "\n".join(logs[-200:]) if logs else "No logs captured."

    preview = dict(manifest)
    preview["segments"] = preview["segments"][:20]

    table_rows: List[List[str]] = []
    for entry in manifest["segments"][:100]:
        table_rows.append(
            [
                entry["segment_id"],
                entry["speaker"],
                entry.get("status", ""),
                entry.get("emotion") or "",
                entry.get("output_path", ""),
                entry.get("duration_sec") or "",
            ]
        )

    return summary, log_tail, table_rows, preview, str(manifest_path)


def _extract_path(selection: Any) -> Optional[str]:
    if selection is None:
        return None
    if isinstance(selection, str):
        return selection
    if isinstance(selection, dict):
        return selection.get("path") or selection.get("name")
    if isinstance(selection, list):
        for item in selection:
            path = _extract_path(item)
            if path:
                return path
    return None


def build_interface() -> gr.Blocks:
    if gr is None:
        raise ImportError("gradio is required to launch the Auto Voiceover WebUI. Install via `uv sync --extra webui`.")
    script_choices = list_scripts()
    config_choices = list_configs()
    default_script = script_choices[0] if script_choices else ""
    default_config = config_choices[0] if config_choices else ""
    default_out_root = ""

    with gr.Blocks(title="Auto Voiceover Dry-Run") as demo:
        gr.Markdown("## Auto Voiceover Dry-Run UI")
        gr.Markdown(
            "Upload或直接引用现有脚本 + 配置，点击按钮即可解析并生成 dry-run manifest。"
        )

        with gr.Row():
            script_picker = gr.Dropdown(
                choices=script_choices,
                value=default_script,
                label="示例脚本选择",
            )
            config_picker = gr.Dropdown(
                choices=config_choices,
                value=default_config,
                label="配置文件选择",
            )

        with gr.Row():
            script_path_input = gr.Textbox(
                value=default_script,
                label="脚本路径 (.md)",
                lines=1,
                placeholder="test_input/scripts/example.md",
                interactive=False,
            )
            config_path_input = gr.Textbox(
                value=default_config,
                label="配置路径 (.yaml)",
                lines=1,
                placeholder="test_input/speakers.yaml",
                interactive=False,
            )

        with gr.Row():
            script_browser = gr.FileExplorer(
                label="浏览脚本 (.md)",
                root_dir=str(Path.cwd()),
                file_count="single",
                glob="**/*.md",
            )
            config_browser = gr.FileExplorer(
                label="浏览配置 (.yaml)",
                root_dir=str(Path.cwd()),
                file_count="single",
                glob="**/*.yaml",
            )

        script_picker.change(fn=lambda val: val, inputs=script_picker, outputs=script_path_input)
        config_picker.change(fn=lambda val: val, inputs=config_picker, outputs=config_path_input)

        def _on_script_browse(selection):
            path = _extract_path(selection)
            return path or gr.update()

        def _on_config_browse(selection):
            path = _extract_path(selection)
            return path or gr.update()

        script_browser.change(fn=_on_script_browse, inputs=script_browser, outputs=script_path_input)
        config_browser.change(fn=_on_config_browse, inputs=config_browser, outputs=config_path_input)

        out_root_input = gr.Textbox(
            value=default_out_root,
            label="输出根目录 (可留空，默认 DUB/<episode>)",
            interactive=False,
        )

        out_root_browser = gr.FileExplorer(
            label="浏览输出目录",
            root_dir=str(Path.cwd()),
            file_count="single",
            glob="**/",
        )

        def _on_out_root_browse(selection):
            path = _extract_path(selection)
            return path or gr.update()

        out_root_browser.change(fn=_on_out_root_browse, inputs=out_root_browser, outputs=out_root_input)
        language_radio = gr.Radio(
            choices=["auto", "zh", "en"],
            value="auto",
            label="脚本语言",
        )

        run_button = gr.Button("运行 Dry-Run", variant="primary")

        summary_box = gr.Textbox(label="执行摘要", lines=5)
        warnings_box = gr.Textbox(label="Warnings", lines=5)
        segments_table = gr.Dataframe(
            headers=["segment_id", "chapter", "speaker", "emotion", "text", "output_path"],
            wrap=True,
        )
        manifest_json = gr.JSON(label="Manifest 预览 (前 20 条)")

        run_button.click(
            fn=run_dry_run,
            inputs=[script_path_input, config_path_input, out_root_input, language_radio],
            outputs=[summary_box, warnings_box, segments_table, manifest_json],
        )

        gr.Markdown("---")
        gr.Markdown("### 自动配音生成 (需要已下载的 IndexTTS2 checkpoints)")
        with gr.Row():
            model_dir_input = gr.Textbox(
                value="checkpoints",
                label="模型目录",
                placeholder="checkpoints",
            )
            fp16_checkbox = gr.Checkbox(value=True, label="启用 FP16（若设备支持）")
            pending_checkbox = gr.Checkbox(value=False, label="仅处理未完成段落 (--resume)")

        generate_button = gr.Button("开始自动配音", variant="primary")

        generation_summary = gr.Textbox(label="生成摘要", lines=6)
        generation_logs = gr.Textbox(label="生成日志 (最近记录)", lines=8)
        generation_table = gr.Dataframe(
            headers=["segment_id", "speaker", "status", "emotion", "output_path", "duration(s)"],
            wrap=True,
        )
        generation_manifest_json = gr.JSON(label="生成 Manifest 预览 (前 20 条)")
        manifest_file = gr.File(label="下载 Manifest", interactive=False)

        generate_button.click(
            fn=run_generation,
            inputs=[
                script_path_input,
                config_path_input,
                out_root_input,
                language_radio,
                model_dir_input,
                fp16_checkbox,
                pending_checkbox,
            ],
            outputs=[
                generation_summary,
                generation_logs,
                generation_table,
                generation_manifest_json,
                manifest_file,
            ],
        )

    return demo


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto Voiceover Dry-Run WebUI")
    parser.add_argument("--host", default="0.0.0.0", help="Host for gradio server")
    parser.add_argument("--port", type=int, default=7865, help="Port for gradio server")
    parser.add_argument("--share", action="store_true", help="Enable gradio share")
    parser.add_argument("--inbrowser", action="store_true", help="Open UI in default browser")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    demo = build_interface()
    demo.queue().launch(
        server_name=args.host,
        server_port=args.port,
        share=args.share,
        inbrowser=args.inbrowser,
    )


if __name__ == "__main__":
    main()
