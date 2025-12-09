const scriptInput = document.getElementById("scriptPath");
const configInput = document.getElementById("configPath");
const outRootInput = document.getElementById("outRoot");
const modelDirInput = document.getElementById("modelDir");
const languageSelect = document.getElementById("language");

const loadChaptersBtn = document.getElementById("loadChaptersBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");

const chaptersPanel = document.getElementById("chaptersPanel");
const chaptersContainer = document.getElementById("chaptersContainer");
const chapterIndicator = document.getElementById("chapterIndicator");

const emotionRecordingPanel = document.getElementById("emotionRecordingPanel");
const prevChapterBtn = document.getElementById("prevChapterBtn");
const prevSegmentBtn = document.getElementById("prevSegmentBtn");
const nextSegmentBtn = document.getElementById("nextSegmentBtn");
const nextChapterBtn = document.getElementById("nextChapterBtn");
const segmentPosition = document.getElementById("segmentPosition");

const currentSegmentTitle = document.getElementById("currentSegmentTitle");
const currentSegmentText = document.getElementById("currentSegmentText");
const currentSegmentEmotion = document.getElementById("currentSegmentEmotion");

const startRecordingBtn = document.getElementById("startRecordingBtn");
const stopRecordingBtn = document.getElementById("stopRecordingBtn");
const recordingIndicator = document.getElementById("recordingIndicator");
const recordedAudio = document.getElementById("recordedAudio");
const uploadAudioBtn = document.getElementById("uploadAudioBtn");
const reRecordBtn = document.getElementById("reRecordBtn");
const audioPlayback = document.getElementById("audioPlayback");

const unrecordedCount = document.getElementById("unrecordedCount");
const recordedCount = document.getElementById("recordedCount");
const batchRecordBtn = document.getElementById("batchRecordBtn");
const exportProgressBtn = document.getElementById("exportProgressBtn");

const modal = document.getElementById("browserModal");
const browserTitle = document.getElementById("browserTitle");
const browserClose = document.getElementById("browserClose");
const browserPath = document.getElementById("browserPath");
const browserUp = document.getElementById("browserUp");
const browserList = document.getElementById("browserList");
const browserSelect = document.getElementById("browserSelect");
const browserCancel = document.getElementById("browserCancel");

let chaptersData = [];
let allSegments = [];
let currentChapterIndex = 0;
let currentSegmentIndex = 0;
let workspaceRoot = window.__workspaceRoot || "";

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
  browserSelect.disabled = true;
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
  browserSelect.disabled = expectDir ? !isDir : isDir;
});

browserList.addEventListener("dblclick", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  if (li.dataset.isDir === "true") {
    loadDirectory(li.dataset.path);
  }
});

browserSelect.addEventListener("click", () => {
  if (!browserState.selectedPath) return;
  if (browserState.target.type === "dir" && !browserState.selectedIsDir) return;
  if (browserState.target.type === "file" && browserState.selectedIsDir) return;
  browserState.target.input.value = browserState.selectedPath;
  closeBrowser();
});

browserCancel.addEventListener("click", closeBrowser);
browserClose.addEventListener("click", closeBrowser);
browserUp.addEventListener("click", () => {
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

function parentPath(path) {
  if (!path) return "/";
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

async function loadChapters() {
  chaptersContainer.innerHTML = "加载中...";
  try {
    const payload = basePayload();
    const res = await fetchJSON("/api/review-data", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    chaptersData = res.chapters || [];
    currentChapterIndex = 0;

    allSegments = [];
    for (const chapter of chaptersData) {
      for (const segment of chapter.segments) {
        allSegments.push({
          ...segment,
          chapter_id: chapter.chapter_id,
          chapter_title: chapter.chapter_title,
        });
      }
    }

    renderActiveChapter();

    chaptersPanel.style.display = "block";
    emotionRecordingPanel.style.display = "block";

  } catch (err) {
    chaptersContainer.textContent = `加载失败: ${err.message}`;
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

function renderActiveChapter() {
  if (!chaptersData.length) {
    chaptersContainer.innerHTML = "";
    chapterIndicator.textContent = "";
    return;
  }

  const activeChapter = chaptersData[currentChapterIndex];
  chapterIndicator.textContent = `${activeChapter.chapter_title} (${currentChapterIndex + 1}/${chaptersData.length}) - 总片段数: ${allSegments.length}`;
  chaptersContainer.innerHTML = "";

  // 创建当前章节的片段列表
  const chapterSegmentsDiv = document.createElement("div");
  chapterSegmentsDiv.className = "chapter-segments";

  const currentChapterSegments = activeChapter.segments;
  for (const segment of currentChapterSegments) {
    const hasEmotionAudio = segment.emotion_reference_audio && segment.emotion_reference_audio.path;
    const segmentDiv = document.createElement("div");
    segmentDiv.className = `segment-item ${hasEmotionAudio ? "recorded" : "unrecorded"}`;
    segmentDiv.innerHTML = `
      <div class="segment-info">
        <h4>${segment.segment_id} · ${segment.speaker}</h4>
        <p class="segment-text">${segment.text}</p>
        <p class="segment-emotion">${hasEmotionAudio ? "✅ 已录制" : "🎤 未录制"} · ${segment.emotion || "无"}</p>
      </div>
    `;
    segmentDiv.onclick = () => selectSegment(segment);
    chapterSegmentsDiv.appendChild(segmentDiv);
  }

  chaptersContainer.appendChild(chapterSegmentsDiv);

  updateRecordingStats();
  // 导航到当前章节的第一个片段
  navigateToChapterSegment(0);
}

function updateRecordingStats() {
  let unrecorded = 0;
  let recorded = 0;

  for (const segment of allSegments) {
    const hasEmotionAudio = segment.emotion_reference_audio && segment.emotion_reference_audio.path;
    if (hasEmotionAudio) {
      recorded++;
    } else {
      unrecorded++;
    }
  }

  unrecordedCount.textContent = unrecorded;
  recordedCount.textContent = recorded;
}

function selectSegment(segment) {
  const activeChapter = chaptersData[currentChapterIndex];
  const index = activeChapter.segments.findIndex((s) => s.segment_id === segment.segment_id);
  if (index !== -1) {
    navigateToChapterSegment(index);
  }
}

function navigateToChapterSegment(index) {
  const activeChapter = chaptersData[currentChapterIndex];
  if (index < 0 || index >= activeChapter.segments.length) return;

  currentSegmentIndex = index;
  const segment = activeChapter.segments[index];

  currentSegmentTitle.textContent = `${segment.segment_id} · ${segment.speaker}`;
  currentSegmentText.textContent = segment.text;
  currentSegmentEmotion.textContent = segment.emotion || "无";
  startRecordingBtn.disabled = false;

  segmentPosition.textContent = `${index + 1} / ${activeChapter.segments.length}`;

  // 更新章节导航按钮状态
  prevChapterBtn.disabled = currentChapterIndex === 0;
  nextChapterBtn.disabled = currentChapterIndex === chaptersData.length - 1;
  // 更新片段导航按钮状态
  prevSegmentBtn.disabled = index === 0;
  nextSegmentBtn.disabled = index === activeChapter.segments.length - 1;
}

clearCacheBtn.addEventListener("click", async () => {
  try {
    await fetchJSON("/api/cache/clear", { method: "POST" });
    alert("模型缓存已清理");
  } catch (err) {
    alert("清理缓存失败: " + err.message);
  }
});

loadChaptersBtn.addEventListener("click", loadChapters);

prevChapterBtn.addEventListener("click", () => {
  if (currentChapterIndex > 0) {
    currentChapterIndex--;
    renderActiveChapter();
  }
});

nextChapterBtn.addEventListener("click", () => {
  if (currentChapterIndex < chaptersData.length - 1) {
    currentChapterIndex++;
    renderActiveChapter();
  }
});

prevSegmentBtn.addEventListener("click", () => {
  navigateToChapterSegment(currentSegmentIndex - 1);
});

nextSegmentBtn.addEventListener("click", () => {
  navigateToChapterSegment(currentSegmentIndex + 1);
});

startRecordingBtn.addEventListener("click", startRecording);
stopRecordingBtn.addEventListener("click", stopRecording);
uploadAudioBtn.addEventListener("click", uploadAudio);
reRecordBtn.addEventListener("click", () => {
  audioPlayback.style.display = "none";
  startRecordingBtn.style.display = "inline-block";
  stopRecordingBtn.style.display = "none";
});

batchRecordBtn.addEventListener("click", () => {
  alert("批量录制功能开发中...");
});

exportProgressBtn.addEventListener("click", exportProgressReport);

let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartTime = null;

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    // 检查浏览器支持的音频格式
    let mimeType = "audio/webm;codecs=opus";
    if (MediaRecorder.isTypeSupported) {
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
        mimeType = "audio/ogg;codecs=opus";
      }
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: mimeType });
      const audioUrl = URL.createObjectURL(audioBlob);
      recordedAudio.src = audioUrl;
      audioPlayback.style.display = "block";
      startRecordingBtn.style.display = "none";
      stopRecordingBtn.style.display = "none";
    };

    mediaRecorder.start();
    recordingStartTime = Date.now();

    startRecordingBtn.style.display = "none";
    stopRecordingBtn.style.display = "inline-block";
    recordingIndicator.style.display = "block";

    recordingTimer = setInterval(updateRecordingTime, 100);
  } catch (err) {
    console.error("开始录制失败:", err);
    alert("无法访问麦克风，请检查权限设置");
  }
}

function updateRecordingTime() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  recordingIndicator.querySelector(".recording-time").textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  if (elapsed >= 90) {
    stopRecording();
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }

  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  stopRecordingBtn.style.display = "none";
  recordingIndicator.style.display = "none";
}

async function uploadAudio() {
  if (currentSegmentIndex < 0 || currentSegmentIndex >= allSegments.length || audioChunks.length === 0) {
    alert("没有可上传的音频");
    return;
  }

  try {
    const segment = allSegments[currentSegmentIndex];
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    const formData = new FormData();
    formData.append("audio", audioBlob, `${segment.segment_id}-${segment.speaker}.wav`);
    formData.append("script_path", scriptInput.value);
    formData.append("segment_id", segment.segment_id);
    formData.append("chapter_id", segment.chapter_id);
    formData.append("speaker", segment.speaker);

    const response = await fetch("/api/audio/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    alert("情感参考音频上传成功！");
    audioPlayback.style.display = "none";
    renderActiveChapter();
  } catch (err) {
    console.error("上传失败:", err);
    alert("上传失败: " + err.message);
  }
}

function exportProgressReport() {
  const report = {
    script: scriptInput.value,
    config: configInput.value,
    timestamp: new Date().toISOString(),
    segments: allSegments.map((s, idx) => ({
      id: s.segment_id,
      speaker: s.speaker,
      emotion: s.emotion,
      has_reference_audio: !!(s.emotion_reference_audio && s.emotion_reference_audio.path),
      text: s.text.substring(0, 50) + (s.text.length > 50 ? "..." : ""),
      order: idx + 1,
    })),
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "emotion_recording_report.json";
  a.click();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadDefaults();
});
