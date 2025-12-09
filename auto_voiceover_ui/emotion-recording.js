const scriptInput = document.getElementById("scriptPath");
const configInput = document.getElementById("configPath");
const outRootInput = document.getElementById("outRoot");
const modelDirInput = document.getElementById("modelDir");
const languageSelect = document.getElementById("language");

const loadChaptersBtn = document.getElementById("loadChaptersBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");

const recordingPanel = document.getElementById("recordingPanel");
const unrecordedCount = document.getElementById("unrecordedCount");
const recordedCount = document.getElementById("recordedCount");

const currentSegmentTitle = document.getElementById("currentSegmentTitle");
const currentSegmentText = document.getElementById("currentSegmentText");
const currentSegmentEmotion = document.getElementById("currentSegmentEmotion");

const recordingMode = document.getElementById("recordingMode");
const startRecordingBtn = document.getElementById("startRecordingBtn");
const stopRecordingBtn = document.getElementById("stopRecordingBtn");
const recordingIndicator = document.getElementById("recordingIndicator");
const recordedAudio = document.getElementById("recordedAudio");
const uploadAudioBtn = document.getElementById("uploadAudioBtn");
const reRecordBtn = document.getElementById("reRecordBtn");
const audioPlayback = document.getElementById("audioPlayback");

const chaptersPanel = document.getElementById("chaptersPanel");
const chaptersContainer = document.getElementById("chaptersContainer");
const chapterIndicator = document.getElementById("chapterIndicator");
const chapterNav = document.getElementById("chapterNav");
const chapterNavList = document.getElementById("chapterNavList");

const prevSegmentBtn = document.getElementById("prevSegmentBtn");
const nextSegmentBtn = document.getElementById("nextSegmentBtn");
const segmentPosition = document.getElementById("segmentPosition");

const batchRecordingPanel = document.getElementById("batchRecordingPanel");
const batchProgressBar = document.getElementById("batchProgressBar");
const batchCurrent = document.getElementById("batchCurrent");
const batchTotal = document.getElementById("batchTotal");
const batchSegmentTitle = document.getElementById("batchSegmentTitle");
const batchSegmentText = document.getElementById("batchSegmentText");
const batchSegmentEmotion = document.getElementById("batchSegmentEmotion");
const batchStartBtn = document.getElementById("batchStartBtn");
const batchNextBtn = document.getElementById("batchNextBtn");
const batchSkipBtn = document.getElementById("batchSkipBtn");
const exitBatchModeBtn = document.getElementById("exitBatchModeBtn");

const exportPanel = document.getElementById("exportPanel");
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
  try {
    const data = await fetchJSON("/api/defaults");
    scriptInput.value = data.script || "";
    configInput.value = data.config || "";
    outRootInput.value = data.out_root || "";
    modelDirInput.value = data.model_dir || "";
    languageSelect.value = data.language || "auto";
    workspaceRoot = data.workspace_root || workspaceRoot;
  } catch (err) {
    console.error("加载默认配置失败:", err);
  }
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
  try {
    const body = {
      path,
      include_dirs: true,
      include_files: browserState.target.type === "file",
      extensions: browserState.target.extensions || [],
    };
    const data = await fetchJSON("/api/browse", {
      method: "POST",
      body: JSON.stringify(body),
    });

    browserPath.textContent = data.path;
    browserList.innerHTML = "";
    browserList.className = "";
    browserList.classList.add("browser-list");

    if (data.parent) {
      const parentItem = document.createElement("li");
      parentItem.className = "browser-item directory";
      parentItem.textContent = "..";
      parentItem.onclick = () => loadDirectory(data.parent);
      browserList.appendChild(parentItem);
    }

    for (const dir of data.directories || []) {
      const item = document.createElement("li");
      item.className = "browser-item directory";
      item.textContent = dir;
      item.onclick = () => selectBrowserItem(item, dir, true);
      browserList.appendChild(item);
    }

    for (const file of data.files || []) {
      const item = document.createElement("li");
      item.className = "browser-item file";
      item.textContent = file;
      item.onclick = () => selectBrowserItem(item, file, false);
      browserList.appendChild(item);
    }
  } catch (err) {
    console.error("加载目录失败:", err);
    alert("加载目录失败: " + err.message);
  }
}

function selectBrowserItem(item, name, isDir) {
  document.querySelectorAll(".browser-item").forEach((el) => {
    el.classList.remove("selected");
  });
  item.classList.add("selected");
  browserState.selectedPath = name;
  browserState.selectedIsDir = isDir;
  browserSelect.disabled = false;
}

function closeBrowser() {
  modal.classList.add("hidden");
}

async function selectBrowserPath() {
  if (!browserState.selectedPath) return;

  const fullPath = browserState.currentPath
    ? browserState.currentPath.replace(/\/$/, "") + "/" + browserState.selectedPath
    : browserState.selectedPath;

  if (browserState.selectedIsDir) {
    browserState.currentPath = fullPath;
    loadDirectory(browserState.currentPath);
  } else {
    browserState.target.input.value = fullPath;
    closeBrowser();
  }
}

async function browseUp() {
  if (!browserState.currentPath) return;
  const parent = browserState.currentPath.substring(0, browserState.currentPath.lastIndexOf("/"));
  browserState.currentPath = parent || "/";
  loadDirectory(browserState.currentPath);
}

async function loadChapters() {
  try {
    const scriptPath = scriptInput.value;
    const configPath = configInput.value;
    const outRoot = outRootInput.value;

    if (!scriptPath || !configPath || !outRoot) {
      alert("请先选择脚本、配置文件和输出目录");
      return;
    }

    const body = {
      script: scriptPath,
      config: configPath,
      out_root: outRoot,
      language: languageSelect.value,
    };

    const data = await fetchJSON("/api/review-data", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!data.chapters || !Array.isArray(data.chapters)) {
      alert("无法加载章节数据，请检查脚本文件");
      return;
    }

    chaptersData = data.chapters;
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

    renderChapters();
    renderChapterNav();
    selectChapter(0);

    chaptersPanel.style.display = "block";
    recordingPanel.style.display = "block";
    chapterNav.style.display = "block";
    exportPanel.style.display = "block";

    alert("章节加载成功！");
  } catch (err) {
    console.error("加载章节失败:", err);
    alert("加载章节失败: " + err.message);
  }
}

function renderChapters() {
  chaptersContainer.innerHTML = "";

  for (let i = 0; i < chaptersData.length; i++) {
    const chapter = chaptersData[i];
    const chapterDiv = document.createElement("div");
    chapterDiv.className = "chapter";
    chapterDiv.id = `chapter-${chapter.chapter_id}`;

    const header = document.createElement("div");
    header.className = "chapter-header";
    header.innerHTML = `
      <h3>${chapter.chapter_title}</h3>
      <span class="chapter-meta">${chapter.segments.length} 个片段</span>
    `;

    const segmentsDiv = document.createElement("div");
    segmentsDiv.className = "chapter-segments";

    for (const segment of chapter.segments) {
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

      segmentsDiv.appendChild(segmentDiv);
    }

    chapterDiv.appendChild(header);
    chapterDiv.appendChild(segmentsDiv);
    chaptersContainer.appendChild(chapterDiv);
  }

  updateRecordingStats();
}

function renderChapterNav() {
  chapterNavList.innerHTML = "";

  for (let i = 0; i < chaptersData.length; i++) {
    const chapter = chaptersData[i];
    const navItem = document.createElement("div");
    navItem.className = "chapter-nav-item";
    navItem.innerHTML = `
      <div class="chapter-nav-title">${chapter.chapter_title}</div>
      <div class="chapter-nav-meta">${chapter.segments.length} 片段</div>
    `;
    navItem.onclick = () => selectChapter(i);
    chapterNavList.appendChild(navItem);
  }
}

function selectChapter(index) {
  currentChapterIndex = index;
  const chapter = chaptersData[index];

  document.querySelectorAll(".chapter").forEach((el) => {
    el.classList.remove("active");
  });
  document.querySelectorAll(".chapter-nav-item").forEach((el) => {
    el.classList.remove("active");
  });

  const chapterElement = document.getElementById(`chapter-${chapter.chapter_id}`);
  if (chapterElement) {
    chapterElement.classList.add("active");
  }

  const navItems = chapterNavList.querySelectorAll(".chapter-nav-item");
  if (navItems[index]) {
    navItems[index].classList.add("active");
  }

  chapterIndicator.textContent = `当前章节: ${chapter.chapter_title}`;
  chapterElement?.scrollIntoView({ behavior: "smooth", block: "start" });
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

function navigateToSegment(index) {
  if (index < 0 || index >= allSegments.length) return;

  currentSegmentIndex = index;
  const segment = allSegments[index];

  currentSegmentTitle.textContent = `${segment.segment_id} · ${segment.speaker}`;
  currentSegmentText.textContent = segment.text;
  currentSegmentEmotion.textContent = segment.emotion || "无";
  startRecordingBtn.disabled = false;

  segmentPosition.textContent = `${index + 1} / ${allSegments.length}`;

  prevSegmentBtn.disabled = index === 0;
  nextSegmentBtn.disabled = index === allSegments.length - 1;

  recordingPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function attachEventListeners() {
  document.querySelectorAll("[data-browse]").forEach((btn) => {
    btn.onclick = () => openBrowser(btn.getAttribute("data-browse"));
  });

  loadChaptersBtn.onclick = loadChapters;
  clearCacheBtn.onclick = async () => {
    try {
      await fetchJSON("/api/cache/clear", { method: "POST" });
      alert("模型缓存已清理");
    } catch (err) {
      console.error("清理缓存失败:", err);
      alert("清理缓存失败: " + err.message);
    }
  };

  browserClose.onclick = closeBrowser;
  browserCancel.onclick = closeBrowser;
  browserSelect.onclick = selectBrowserPath;
  browserUp.onclick = browseUp;

  prevSegmentBtn.onclick = () => navigateToSegment(currentSegmentIndex - 1);
  nextSegmentBtn.onclick = () => navigateToSegment(currentSegmentIndex + 1);

  startRecordingBtn.onclick = () => {
    if (currentSegmentIndex < 0 || currentSegmentIndex >= allSegments.length) {
      alert("请先选择片段");
      return;
    }
    startRecording();
  };

  stopRecordingBtn.onclick = stopRecording;
  uploadAudioBtn.onclick = uploadAudio;
  reRecordBtn.onclick = () => {
    audioPlayback.style.display = "none";
    startRecordingBtn.style.display = "inline-block";
    stopRecordingBtn.style.display = "none";
  };

  batchStartBtn.onclick = startBatchRecording;
  exitBatchModeBtn.onclick = exitBatchMode;
  batchNextBtn.onclick = nextBatchSegment;
  batchSkipBtn.onclick = nextBatchSegment;

  exportProgressBtn.onclick = exportProgressReport;
}

let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartTime = null;

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
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
    recordingIndicator.classList.remove("hidden");

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
  recordingIndicator.classList.add("hidden");
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

    const response = await fetch("/api/audio/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    alert("情感参考音频上传成功！");
    audioPlayback.style.display = "none";
    renderChapters();
  } catch (err) {
    console.error("上传失败:", err);
    alert("上传失败: " + err.message);
  }
}

let batchModeSegments = [];
let batchCurrentIndex = 0;

function enterBatchMode() {
  batchRecordingPanel.style.display = "block";
  batchModeSegments = [...allSegments];
  batchCurrentIndex = 0;
  updateBatchProgress();
}

function exitBatchMode() {
  batchRecordingPanel.style.display = "none";
  batchModeSegments = [];
  batchCurrentIndex = 0;
}

function updateBatchProgress() {
  batchCurrent.textContent = batchCurrentIndex + 1;
  batchTotal.textContent = batchModeSegments.length;

  const progress = ((batchCurrentIndex + 1) / batchModeSegments.length) * 100;
  batchProgressBar.style.width = progress + "%";

  if (batchCurrentIndex < batchModeSegments.length) {
    const segment = batchModeSegments[batchCurrentIndex];
    batchSegmentTitle.textContent = `${segment.segment_id} · ${segment.speaker}`;
    batchSegmentText.textContent = segment.text;
    batchSegmentEmotion.textContent = segment.emotion || "无";
  }
}

function startBatchRecording() {
  batchStartBtn.style.display = "none";
  batchNextBtn.style.display = "inline-block";
  batchSkipBtn.style.display = "inline-block";
  navigateToSegment(batchCurrentIndex);
  startRecording();
}

function nextBatchSegment() {
  stopRecording();
  batchCurrentIndex++;
  if (batchCurrentIndex >= batchModeSegments.length) {
    alert("批量录制完成！");
    exitBatchMode();
    renderChapters();
    return;
  }
  updateBatchProgress();
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
  attachEventListeners();
  await loadDefaults();
});
