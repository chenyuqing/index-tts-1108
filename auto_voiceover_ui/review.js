const scriptInput = document.getElementById("scriptPath");
const configInput = document.getElementById("configPath");
const outRootInput = document.getElementById("outRoot");
const modelDirInput = document.getElementById("modelDir");
const languageSelect = document.getElementById("language");
const loadChaptersBtn = document.getElementById("loadChaptersBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");
const chaptersContainer = document.getElementById("chaptersContainer");
const chapterNavList = document.getElementById("chapterNavList");
const chapterIndicator = document.getElementById("chapterIndicator");

const modal = document.getElementById("browserModal");
const browserTitle = document.getElementById("browserTitle");
const browserPath = document.getElementById("browserPath");
const browserList = document.getElementById("browserList");
const browserSelectBtn = document.getElementById("browserSelect");
const browserCancelBtn = document.getElementById("browserCancel");
const browserCloseBtn = document.getElementById("browserClose");
const browserUpBtn = document.getElementById("browserUp");

let manifestPath = "";
let workspaceRoot = window.__workspaceRoot || "";
let chaptersData = [];
let activeChapterId = null;

const browseConfig = {
  script: { label: "选择脚本", input: scriptInput, type: "file", extensions: [".md"] },
  config: { label: "选择配置", input: configInput, type: "file", extensions: [".yaml", ".yml"] },
  outroot: { label: "选择输出目录", input: outRootInput, type: "dir" },
  model: { label: "选择模型目录", input: modelDirInput, type: "dir" },
};

let browserState = {
  currentPath: null,
  selectedPath: null,
  selectedIsDir: false,
  target: null,
};

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!resp.ok) {
    const message = await resp.text();
    throw new Error(message || resp.statusText);
  }
  return resp.json();
}

async function loadDefaults() {
  const data = await fetchJSON("/api/defaults");
  scriptInput.value = data.script || "";
  configInput.value = data.config || "";
  outRootInput.value = data.out_root || "";
  modelDirInput.value = data.model_dir || "";
  languageSelect.value = data.language || "auto";
  workspaceRoot = data.workspace_root || workspaceRoot;
}

function openBrowser(targetKey) {
  const cfg = browseConfig[targetKey];
  if (!cfg) return;
  browserState = {
    currentPath: cfg.input.value || workspaceRoot,
    selectedPath: null,
    selectedIsDir: false,
    target: cfg,
  };
  browserTitle.textContent = cfg.label;
  browserSelectBtn.disabled = true;
  modal.classList.remove("hidden");
  loadDirectory(browserState.currentPath);
}

async function loadDirectory(path) {
  const body = {
    path,
    include_dirs: true,
    include_files: browserState.target.type === "file",
    extensions: browserState.target.extensions || [],
  };
  try {
    const res = await fetchJSON("/api/listdir", { method: "POST", body: JSON.stringify(body) });
    browserState.currentPath = res.current_path;
    browserPath.textContent = res.current_path;
    renderBrowserList(res.entries);
  } catch (err) {
    browserPath.textContent = err.message;
    browserList.innerHTML = "";
  }
}

function renderBrowserList(entries) {
  browserList.innerHTML = "";
  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.dataset.path = entry.path;
    li.dataset.isDir = entry.is_dir;
    li.textContent = entry.name + (entry.is_dir ? " /" : "");
    browserList.appendChild(li);
  });
}

browserList.addEventListener("click", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  const isDir = li.dataset.isDir === "true";
  if (isDir && browserState.target.type === "file") {
    loadDirectory(li.dataset.path);
    return;
  }
  browserState.selectedPath = li.dataset.path;
  browserState.selectedIsDir = isDir;
  Array.from(browserList.children).forEach((node) => node.classList.remove("active"));
  li.classList.add("active");
  const expectDir = browserState.target.type === "dir";
  browserSelectBtn.disabled = expectDir ? !isDir : isDir;
});

browserList.addEventListener("dblclick", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  if (li.dataset.isDir === "true") {
    loadDirectory(li.dataset.path);
  }
});

browserSelectBtn.addEventListener("click", () => {
  if (!browserState.selectedPath) return;
  if (browserState.target.type === "dir" && !browserState.selectedIsDir) return;
  if (browserState.target.type === "file" && browserState.selectedIsDir) return;
  browserState.target.input.value = browserState.selectedPath;
  closeBrowser();
});

browserCancelBtn.addEventListener("click", closeBrowser);
 browserCloseBtn.addEventListener("click", closeBrowser);
browserUpBtn.addEventListener("click", () => {
  if (!browserState.currentPath) return;
  const parent = parentPath(browserState.currentPath);
  loadDirectory(parent);
});

document.querySelectorAll("button[data-browse]").forEach((btn) => {
  btn.addEventListener("click", () => openBrowser(btn.dataset.browse));
});

function closeBrowser() {
  modal.classList.add("hidden");
}

function parentPath(pathStr) {
  if (!pathStr) return "/";
  let trimmed = pathStr;
  if (trimmed.endsWith("/") || trimmed.endsWith("\\")) {
    trimmed = trimmed.slice(0, -1);
  }
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return "/";
  return trimmed.slice(0, idx) || "/";
}

async function loadChapters() {
  chaptersContainer.innerHTML = "加载中...";
  try {
    const payload = basePayload();
    const res = await fetchJSON("/api/review-data", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    manifestPath = res.manifest_path;
    chaptersData = res.chapters || [];
    activeChapterId = chaptersData.length ? chaptersData[0].chapter_id : null;
    renderChapterNav();
    renderActiveChapter();

    // 设置字幕编辑器的manifest路径
    if (window.subtitleEditor) {
      window.subtitleEditor.setManifestPath(manifestPath);
    }
  } catch (err) {
    chaptersContainer.textContent = `加载失败: ${err.message}`;
    chapterNavList.innerHTML = "";
  }
}

function basePayload() {
  return {
    script_path: scriptInput.value,
    config_path: configInput.value,
    out_root: outRootInput.value,
    language: languageSelect.value,
  };
}

function renderChapterNav() {
  chapterNavList.innerHTML = "";
  if (!chaptersData.length) {
    chapterIndicator.textContent = "";
    return;
  }
  chaptersData.forEach((chapter) => {
    const navBtn = document.createElement("button");
    navBtn.textContent = chapter.chapter_id;
    if (chapter.chapter_id === activeChapterId) {
      navBtn.classList.add("active");
    }
    navBtn.addEventListener("click", () => {
      activeChapterId = chapter.chapter_id;
      renderChapterNav();
      renderActiveChapter();
    });
    chapterNavList.appendChild(navBtn);
  });
}

function renderActiveChapter() {
  if (!chaptersData.length) {
    chaptersContainer.textContent = "暂无章节";
    return;
  }
  const chapter = chaptersData.find((c) => c.chapter_id === activeChapterId) || chaptersData[0];
  activeChapterId = chapter.chapter_id;
  chapterIndicator.textContent = `当前：${chapter.chapter_id}`;
  chaptersContainer.innerHTML = "";

  const card = document.createElement("div");
  card.className = "chapter-card";

  const header = document.createElement("div");
  header.className = "chapter-header";
  header.innerHTML = `<h3>${chapter.chapter_id} · ${chapter.chapter_title || ""}</h3>`;
  card.appendChild(header);

  const list = document.createElement("div");
  list.className = "segment-list";

    (chapter.segments || []).forEach((segment) => {
      const row = document.createElement("div");
      row.className = "segment-row";
      row.dataset.segmentId = segment.segment_id;

      const headerEl = document.createElement("header");
      const title = document.createElement("h4");
      title.textContent = `${segment.segment_id} · ${segment.speaker || ""}`;
      const emotionLabel = document.createElement("span");
      emotionLabel.textContent = segment.emotion || "";
      headerEl.appendChild(title);
      headerEl.appendChild(emotionLabel);
      row.appendChild(headerEl);

      const textArea = document.createElement("textarea");
      textArea.className = "segment-text";
      textArea.value = segment.text || "";
      textArea.rows = Math.min(8, Math.max(3, Math.ceil((textArea.value.length || 1) / 60)));
      row.appendChild(textArea);

      const controls = document.createElement("div");
      controls.className = "segment-controls";
      const emotionInput = document.createElement("textarea");
      emotionInput.className = "segment-emotion";
      emotionInput.placeholder = "自定义情绪，比如：温暖、激情";
      emotionInput.value = segment.emotion || "";
      emotionInput.rows = 2;
      const regenBtn = document.createElement("button");
      regenBtn.textContent = segment.audio_url ? "重新生成" : "生成";
      regenBtn.className = "primary";
      regenBtn.dataset.defaultLabel = regenBtn.textContent;
      regenBtn.addEventListener("click", () =>
        handleRegenerate(segment.segment_id, emotionInput.value, textArea.value, row, regenBtn)
      );
      controls.appendChild(emotionInput);
      controls.appendChild(regenBtn);
      row.appendChild(controls);

      const audioWrapper = document.createElement("div");
      audioWrapper.className = "segment-audio";
      if (segment.audio_url) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = segment.audio_url;
        audioWrapper.appendChild(audio);
      } else {
        audioWrapper.textContent = "尚未生成音频";
        audioWrapper.classList.add("no-audio");
      }
      row.appendChild(audioWrapper);

      list.appendChild(row);
    });

  card.appendChild(list);
  chaptersContainer.appendChild(card);
}

async function handleRegenerate(segmentId, emotionText, textValue, rowEl, buttonEl) {
  rowEl.classList.add("pending");
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "合成中…";
  }
  try {
    const payload = {
      ...basePayload(),
      model_dir: modelDirInput.value,
      segment_id: segmentId,
      manifest_path: manifestPath,
      overrides: buildOverrides(emotionText, textValue),
    };
    const res = await fetchJSON("/api/segment/regenerate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.audio_url) {
      const audio = rowEl.querySelector("audio");
      if (audio) {
        audio.src = `${res.audio_url}&_=${Date.now()}`;
        audio.load();
      }
      if (buttonEl) {
        buttonEl.dataset.defaultLabel = "重新生成";
      }
    }
  } catch (err) {
    alert(`重新生成失败: ${err.message}`);
  } finally {
    rowEl.classList.remove("pending");
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = buttonEl.dataset.defaultLabel || "重新生成";
    }
  }
}

function buildOverrides(emotionText, textValue) {
  const overrides = {};
  if (textValue && textValue.trim()) {
    overrides.text = textValue.trim();
  }
  if (emotionText && emotionText.trim()) {
    overrides.emotion = emotionText.trim();
  }
  return overrides;
}

loadChaptersBtn.addEventListener("click", loadChapters);
clearCacheBtn.addEventListener("click", handleClearCache);
loadDefaults();

// 字幕编辑功能
class SubtitleEditor {
  constructor() {
    this.subtitles = [];
    this.originalSubtitles = [];
    this.manifestPath = "";
    this.isModified = false;
    this.isGenerated = false;

    // DOM元素
    this.elements = {
      generateBtn: document.getElementById('generatePreviewBtn'),
      exportBtn: document.getElementById('exportSrtBtn'),
      finalExportBtn: document.getElementById('exportFinalBtn'),
      includeSpeaker: document.getElementById('includeSpeaker'),
      table: document.getElementById('subtitleTable'),
      tbody: document.getElementById('subtitleTbody'),
      placeholder: document.getElementById('subtitlePlaceholder'),
      stats: document.getElementById('subtitleStats'),
      totalDuration: document.getElementById('totalDuration'),
      subtitleCount: document.getElementById('subtitleCount'),
      timingAccuracy: document.getElementById('timingAccuracyBadge'),
      timelineViz: document.getElementById('timelineVisualization'),
      timelineBar: document.getElementById('timelineBar'),
      timelinePosition: document.getElementById('timelinePosition'),
      batchTools: document.getElementById('batchEditTools'),
      exportOptions: document.querySelector('.export-options')
    };

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.elements.generateBtn.addEventListener('click', () => this.generatePreview());
    this.elements.exportBtn.addEventListener('click', () => this.exportSRT());
    this.elements.finalExportBtn.addEventListener('click', () => this.finalExport());
    this.elements.includeSpeaker.addEventListener('change', () => this.handleIncludeSpeakerChange());
  }

  setManifestPath(path) {
    this.manifestPath = path;
    this.resetEditor();
  }

  resetEditor() {
    this.subtitles = [];
    this.originalSubtitles = [];
    this.isModified = false;
    this.isGenerated = false;
    this.hideAllElements();
    this.elements.generateBtn.disabled = false;
    this.elements.exportBtn.disabled = true;
    this.elements.finalExportBtn.disabled = true;
  }

  hideAllElements() {
    this.elements.table.style.display = 'none';
    this.elements.placeholder.style.display = 'block';
    this.elements.stats.style.display = 'none';
    this.elements.timelineViz.style.display = 'none';
    this.elements.batchTools.style.display = 'none';
    this.elements.exportOptions.style.display = 'none';
  }

  showEditorElements() {
    this.elements.table.style.display = 'table';
    this.elements.placeholder.style.display = 'none';
    this.elements.stats.style.display = 'flex';
    this.elements.timelineViz.style.display = 'block';
    this.elements.batchTools.style.display = 'block';
    this.elements.exportOptions.style.display = 'block';
    this.elements.exportBtn.disabled = false;
    this.elements.finalExportBtn.disabled = false;
  }

  async generatePreview() {
    if (!this.manifestPath) {
      alert('请先加载章节信息');
      return;
    }

    this.elements.generateBtn.disabled = true;
    this.elements.generateBtn.textContent = '生成中...';

    try {
      const response = await fetchJSON('/api/subtitles/preview', {
        method: 'POST',
        body: JSON.stringify({
          manifest_path: this.manifestPath,
          include_speaker: this.elements.includeSpeaker.checked
        })
      });

      if (response.error) {
        throw new Error(response.error);
      }

      this.subtitles = response.subtitles;
      this.originalSubtitles = JSON.parse(JSON.stringify(response.subtitles));
      this.isGenerated = true;
      this.isModified = false;

      this.renderSubtitleTable();
      this.updateStats(response);
      this.renderTimeline();
      this.showEditorElements();

    } catch (error) {
      console.error('生成字幕预览失败:', error);
      alert(`生成字幕预览失败: ${error.message}`);
    } finally {
      this.elements.generateBtn.disabled = false;
      this.elements.generateBtn.textContent = '📝 生成字幕预览';
    }
  }

  renderSubtitleTable() {
    const tbody = this.elements.tbody;
    tbody.innerHTML = '';

    this.subtitles.forEach((subtitle, index) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${index + 1}</td>
        <td><input type="text" class="time-input" value="${subtitle.start_srt}"
                   onchange="subtitleEditor.updateTiming(${index}, 'start', this.value)"></td>
        <td><input type="text" class="time-input" value="${subtitle.end_srt}"
                   onchange="subtitleEditor.updateTiming(${index}, 'end', this.value)"></td>
        <td><textarea class="subtitle-text" rows="2"
                   onchange="subtitleEditor.updateText(${index}, this.value)">${subtitle.text}</textarea></td>
        <td>
          <button class="btn btn-xs btn-danger" onclick="subtitleEditor.deleteSubtitle(${index})">删除</button>
          <button class="btn btn-xs btn-primary" onclick="subtitleEditor.splitSubtitle(${index})">分割</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  updateStats(response) {
    this.elements.totalDuration.textContent = response.total_duration ? response.total_duration.toFixed(3) : '0';
    this.elements.subtitleCount.textContent = this.subtitles.length;

    const timingBadge = this.elements.timingAccuracy;
    if (response.verified) {
      timingBadge.textContent = '⏱️ 时间准确性: 已验证';
      timingBadge.style.color = '#28a745';
    } else {
      timingBadge.textContent = '⏱️ 时间准确性: 估算中';
      timingBadge.style.color = '#ffc107';
    }
  }

  renderTimeline() {
    const timelineBar = this.elements.timelineBar;
    timelineBar.innerHTML = '';

    if (this.subtitles.length === 0) return;

    const totalDuration = parseFloat(this.elements.totalDuration.textContent) || 1;

    this.subtitles.forEach((subtitle, index) => {
      const startPercent = (subtitle.start_sec / totalDuration) * 100;
      const widthPercent = ((subtitle.end_sec - subtitle.start_sec) / totalDuration) * 100;

      const segment = document.createElement('div');
      segment.className = 'timeline-segment';
      segment.style.left = `${startPercent}%`;
      segment.style.width = `${widthPercent}%`;
      segment.style.background = `hsl(${(index * 137.5) % 360}, 70%, 60%)`;
      segment.title = `${subtitle.text.substring(0, 50)}${subtitle.text.length > 50 ? '...' : ''}`;
      segment.onclick = () => this.scrollToSubtitle(index);

      timelineBar.appendChild(segment);
    });
  }

  scrollToSubtitle(index) {
    const rows = this.elements.tbody.querySelectorAll('tr');
    if (rows[index]) {
      rows[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
      rows[index].style.background = 'rgba(0, 123, 255, 0.1)';
      setTimeout(() => {
        rows[index].style.background = '';
      }, 2000);
    }
  }

  updateTiming(index, type, value) {
    this.subtitles[index][type + '_srt'] = value;
    this.subtitles[index][type + '_sec'] = this.srtToSeconds(value);
    this.isModified = true;
    this.updateTimelineAfterEdit();
  }

  updateText(index, value) {
    this.subtitles[index].text = value;
    this.isModified = true;
  }

  deleteSubtitle(index) {
    if (confirm('确定要删除这条字幕吗？')) {
      this.subtitles.splice(index, 1);
      // 重新索引
      this.subtitles.forEach((sub, i) => sub.index = i + 1);
      this.renderSubtitleTable();
      this.renderTimeline();
      this.isModified = true;
    }
  }

  splitSubtitle(index) {
    const subtitle = this.subtitles[index];
    const text = subtitle.text;
    const duration = subtitle.end_sec - subtitle.start_sec;

    if (duration < 2) {
      alert('字幕时长太短，无法分割');
      return;
    }

    if (text.length < 20) {
      alert('字幕文本太短，无法分割');
      return;
    }

    // 简单分割：按标点符号或空格分割
    const splitPoint = Math.floor(text.length / 2);
    const firstText = text.substring(0, splitPoint).trim();
    const secondText = text.substring(splitPoint).trim();

    if (firstText.length < 5 || secondText.length < 5) {
      alert('无法在合适位置分割字幕');
      return;
    }

    const midTime = subtitle.start_sec + duration / 2;

    // 创建新的字幕条目
    const newSubtitle = {
      ...subtitle,
      index: this.subtitles.length + 1,
      start_sec: midTime,
      start_srt: this.secondsToSrt(midTime),
      text: secondText
    };

    // 更新原字幕
    subtitle.end_sec = midTime;
    subtitle.end_srt = this.secondsToSrt(midTime);
    subtitle.text = firstText;

    // 插入新字幕
    this.subtitles.splice(index + 1, 0, newSubtitle);

    // 重新索引
    this.subtitles.forEach((sub, i) => sub.index = i + 1);

    this.renderSubtitleTable();
    this.renderTimeline();
    this.isModified = true;
  }

  updateTimelineAfterEdit() {
    this.renderTimeline();
  }

  handleIncludeSpeakerChange() {
    if (this.isGenerated) {
      this.generatePreview();
    }
  }

  srtToSeconds(srtTime) {
    const [time, ms] = srtTime.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return (hours * 3600) + (minutes * 60) + seconds + (Number(ms) / 1000);
  }

  secondsToSrt(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  }

  generateSRTContent() {
    // 生成SRT格式内容
    let srtContent = '';

    this.subtitles.forEach((subtitle, index) => {
      srtContent += `${index + 1}\n`;
      srtContent += `${subtitle.start_srt} --> ${subtitle.end_srt}\n`;

      // 处理长文本自动换行 - 优化显示效果
      let text = subtitle.text;

      // 字幕显示最佳实践：每行不超过35个字符，最多2-3行
      const MAX_CHARS_PER_LINE = 35;
      const MAX_LINES = 3;

      if (text.length > MAX_CHARS_PER_LINE) {
        // 优先按句子/标点分割
        const sentences = text.split(/[。！？.!?]/).filter(s => s.trim());

        if (sentences.length > 1 && sentences.every(s => s.length < MAX_CHARS_PER_LINE * 1.5)) {
          // 如果每个句子都不太长，按句子分行
          text = sentences.map(s => s.trim()).join('\n');
        } else {
          // 否则按语义位置分割（逗号、连接词等）
          const semanticBreaks = text.split(/[,，、]\s*/);
          if (semanticBreaks.length > 1 && semanticBreaks.every(s => s.length < MAX_CHARS_PER_LINE * 1.2)) {
            text = semanticBreaks.map(s => s.trim()).join('\n');
          } else {
            // 最后按长度智能分割
            const words = text.split(' ');
            const lines = [];
            let currentLine = '';

            for (const word of words) {
              const potentialLine = currentLine ? currentLine + ' ' + word : word;

              if (potentialLine.length <= MAX_CHARS_PER_LINE) {
                currentLine = potentialLine;
              } else {
                if (currentLine) {
                  lines.push(currentLine);
                  // 检查是否超过最大行数
                  if (lines.length >= MAX_LINES) {
                    // 将超过的内容合并到最后一行
                    const remainingWords = [word, ...words.slice(words.indexOf(word) + 1)].join(' ');
                    lines[lines.length - 1] += ' ' + remainingWords;
                    break;
                  }
                }
                currentLine = word;
              }
            }

            if (currentLine && lines.length < MAX_LINES) {
              lines.push(currentLine);
            }

            text = lines.join('\n');
          }
        }
      }

      srtContent += text + '\n\n';
    });

    return srtContent.trim();
  }

  exportSRT() {
    if (!this.isGenerated || this.subtitles.length === 0) {
      alert('请先生成字幕预览');
      return;
    }

    this.elements.exportBtn.disabled = true;
    this.elements.exportBtn.textContent = '生成中...';

    try {
      // 检查是否有修改过的内容
      const hasModifiedContent = this.subtitles.some((subtitle, index) => {
        const original = this.originalSubtitles[index];
        return original && subtitle.text !== original.text;
      });

      if (hasModifiedContent) {
        const confirmed = confirm(
          '检测到字幕内容已修改。\n' +
          '⚠️ 注意：修改后的文本可能与实际配音内容不一致。\n' +
          '建议先重新生成修改片段的配音，再导出字幕。\n\n' +
          '是否仍要继续导出当前字幕？'
        );
        if (!confirmed) {
          this.elements.exportBtn.disabled = false;
          this.elements.exportBtn.textContent = '📥 导出SRT文件';
          return;
        }
      }

      // 生成SRT内容
      const srtContent = this.generateSRTContent();

      // 创建Blob并下载
      const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = this.getEpisodeName() + '.srt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 清理URL对象
      setTimeout(() => URL.revokeObjectURL(url), 100);

      alert('✅ SRT字幕文件已生成并下载！');

      // 显示统计信息
      const stats = `
字幕统计：
- 总条数：${this.subtitles.length}
- 总时长：${this.elements.totalDuration.textContent}秒
- 时间准确性：${this.elements.timingAccuracy.textContent.includes('已验证') ? '已验证' : '估算中'}
- 说话人标签：${this.elements.includeSpeaker.checked ? '包含' : '不包含'}
      `.trim();

      console.log(stats);

    } catch (error) {
      console.error('导出SRT失败:', error);
      alert(`导出SRT失败: ${error.message}`);
    } finally {
      this.elements.exportBtn.disabled = false;
      this.elements.exportBtn.textContent = '📥 导出SRT文件';
    }
  }

  getEpisodeName() {
    // 从manifest路径提取剧集名称
    if (!this.manifestPath) return 'subtitles';
    const pathParts = this.manifestPath.split('/');
    const filename = pathParts[pathParts.length - 1];
    return filename.replace('_manifest.json', '').replace('.md', '');
  }

  generateVTTContent() {
    // 生成WebVTT格式内容
    let vttContent = 'WEBVTT\n\n';

    this.subtitles.forEach((subtitle, index) => {
      // WebVTT时间格式使用点而不是逗号
      const startVtt = subtitle.start_srt.replace(',', '.');
      const endVtt = subtitle.end_srt.replace(',', '.');

      vttContent += `${startVtt} --> ${endVtt}\n`;
      vttContent += `${subtitle.text}\n\n`;
    });

    return vttContent.trim();
  }

  generatePlainTextContent() {
    // 生成纯文本格式内容
    let plainContent = '';

    this.subtitles.forEach((subtitle, index) => {
      plainContent += `${index + 1}. ${subtitle.text}\n`;
    });

    return plainContent.trim();
  }

  async finalExport() {
    const format = document.querySelector('input[name="exportFormat"]:checked').value;

    if (!this.isGenerated || this.subtitles.length === 0) {
      alert('请先生成字幕预览');
      return;
    }

    this.elements.finalExportBtn.disabled = true;
    this.elements.finalExportBtn.textContent = '导出中...';

    try {
      // 检查是否有修改过的内容
      const hasModifiedContent = this.subtitles.some((subtitle, index) => {
        const original = this.originalSubtitles[index];
        return original && subtitle.text !== original.text;
      });

      if (hasModifiedContent) {
        const confirmed = confirm(
          '检测到字幕内容已修改。\n' +
          '⚠️ 注意：修改后的文本可能与实际配音内容不一致。\n' +
          '建议先重新生成修改片段的配音，再导出字幕。\n\n' +
          '是否仍要继续导出当前字幕？'
        );
        if (!confirmed) {
          this.elements.finalExportBtn.disabled = false;
          this.elements.finalExportBtn.textContent = '📄 导出最终字幕';
          return;
        }
      }

      let content, extension, mimeType;

      switch (format) {
        case 'srt':
          content = this.generateSRTContent();
          extension = 'srt';
          mimeType = 'text/plain;charset=utf-8';
          break;
        case 'vtt':
          content = this.generateVTTContent();
          extension = 'vtt';
          mimeType = 'text/vtt;charset=utf-8';
          break;
        case 'txt':
          content = this.generatePlainTextContent();
          extension = 'txt';
          mimeType = 'text/plain;charset=utf-8';
          break;
        default:
          throw new Error(`不支持的格式: ${format}`);
      }

      // 创建Blob并下载
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.getEpisodeName()}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 清理URL对象
      setTimeout(() => URL.revokeObjectURL(url), 100);

      alert(`✅ ${format.toUpperCase()}字幕文件已生成并下载！`);

      // 显示统计信息
      const stats = `
字幕统计：
- 总条数：${this.subtitles.length}
- 总时长：${this.elements.totalDuration.textContent}秒
- 时间准确性：${this.elements.timingAccuracy.textContent.includes('已验证') ? '已验证' : '估算中'}
- 说话人标签：${this.elements.includeSpeaker.checked ? '包含' : '不包含'}
- 导出格式：${format.toUpperCase()}
      `.trim();

      console.log(stats);

    } catch (error) {
      console.error('导出失败:', error);
      alert(`导出失败: ${error.message}`);
    } finally {
      this.elements.finalExportBtn.disabled = false;
      this.elements.finalExportBtn.textContent = '📄 导出最终字幕';
    }
  }
}

// 全局函数（供HTML调用）
window.adjustAllTimings = function(ms) {
  if (!window.subtitleEditor || !window.subtitleEditor.subtitles.length) return;

  window.subtitleEditor.subtitles.forEach(subtitle => {
    subtitle.start_sec += ms / 1000;
    subtitle.end_sec += ms / 1000;
    subtitle.start_srt = window.subtitleEditor.secondsToSrt(subtitle.start_sec);
    subtitle.end_srt = window.subtitleEditor.secondsToSrt(subtitle.end_sec);
  });

  window.subtitleEditor.renderSubtitleTable();
  window.subtitleEditor.renderTimeline();
  window.subtitleEditor.isModified = true;
};

window.autoAdjustTiming = function() {
  if (!window.subtitleEditor || !window.subtitleEditor.subtitles.length) return;

  // 简单的自动调整：确保相邻字幕间有适当的间隔
  const subtitles = window.subtitleEditor.subtitles;
  const minGap = 0.1; // 最小间隔100ms

  for (let i = 0; i < subtitles.length - 1; i++) {
    const current = subtitles[i];
    const next = subtitles[i + 1];

    const actualGap = next.start_sec - current.end_sec;
    if (actualGap < minGap) {
      // 调整下一个字幕的开始时间
      const adjustment = minGap - actualGap;
      next.start_sec += adjustment;
      next.end_sec += adjustment;
      next.start_srt = window.subtitleEditor.secondsToSrt(next.start_sec);
      next.end_srt = window.subtitleEditor.secondsToSrt(next.end_sec);
    }
  }

  window.subtitleEditor.renderSubtitleTable();
  window.subtitleEditor.renderTimeline();
  window.subtitleEditor.isModified = true;

  alert('✅ 时间间隔已自动调整');
};

window.resetToOriginal = function() {
  if (!window.subtitleEditor || !window.subtitleEditor.originalSubtitles.length) return;

  if (confirm('确定要重置为原始字幕吗？所有修改将丢失。')) {
    window.subtitleEditor.subtitles = JSON.parse(JSON.stringify(window.subtitleEditor.originalSubtitles));
    window.subtitleEditor.renderSubtitleTable();
    window.subtitleEditor.renderTimeline();
    window.subtitleEditor.isModified = false;
  }
};

// 初始化字幕编辑器
window.subtitleEditor = new SubtitleEditor();

async function handleClearCache() {
  clearCacheBtn.disabled = true;
  clearCacheBtn.textContent = "清理中...";
  try {
    const res = await fetchJSON("/api/model/clear", { method: "POST" });
    alert(res.status === "cleared" ? "模型缓存已清理" : "暂无已加载的模型缓存");
  } catch (err) {
    alert(`清理失败: ${err.message}`);
  } finally {
    clearCacheBtn.disabled = false;
    clearCacheBtn.textContent = "清理模型缓存";
  }
}
