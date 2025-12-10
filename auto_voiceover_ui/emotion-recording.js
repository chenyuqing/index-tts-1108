const scriptInput = document.getElementById("scriptPath");
const configInput = document.getElementById("configPath");
const outRootInput = document.getElementById("outRoot");
const modelDirInput = document.getElementById("modelDir");
const languageSelect = document.getElementById("language");

const loadChaptersBtn = document.getElementById("loadChaptersBtn");
const clearCacheBtn = document.getElementById("clearCacheBtn");

const emotionRecordingPanel = document.getElementById("emotionRecordingPanel");
const prevChapterBtn = document.getElementById("prevChapterBtn");
const prevSegmentBtn = document.getElementById("prevSegmentBtn");
const nextSegmentBtn = document.getElementById("nextSegmentBtn");
const nextChapterBtn = document.getElementById("nextChapterBtn");
const lastChapterBtn = document.getElementById("lastChapterBtn");
const segmentPosition = document.getElementById("segmentPosition");

const currentSegmentTitle = document.getElementById("currentSegmentTitle");
const currentSegmentText = document.getElementById("currentSegmentText");
const currentSegmentEmotion = document.getElementById("currentSegmentEmotion");
const chapterInfo = document.getElementById("chapterInfo");

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
let currentSegment = null; // 当前显示的segment对象，包含chapter_id
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
    console.log("情感录制页面：加载默认值...");
    const data = await fetchJSON("/api/defaults");
    console.log("情感录制页面：获取到的默认值:", data);

    // 使用默认值
    const defaults = data || {};
    const scriptValue = defaults.script || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/test_input/scripts/cursor-composor-EN.md";
    const configValue = defaults.config || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/test_input/speakers.yaml";
    const outRootValue = defaults.out_root || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/test_input/DUB";
    const modelDirValue = defaults.model_dir || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/checkpoints";
    const languageValue = defaults.language || "auto";

    scriptInput.value = scriptValue;
    configInput.value = configValue;
    outRootInput.value = outRootValue;
    modelDirInput.value = modelDirValue;
    languageSelect.value = languageValue;

    if (defaults.workspace_root) {
      workspaceRoot = defaults.workspace_root;
    } else if (!workspaceRoot) {
      workspaceRoot = "/";
    }

    console.log("情感录制页面：表单字段已更新:", {
      script: scriptInput.value,
      config: configInput.value,
      outRoot: outRootInput.value,
      modelDir: modelDirInput.value,
      language: languageSelect.value
    });
  } catch (err) {
    console.error("情感录制页面：加载默认值失败:", err);
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
  console.log("开始加载章节...");
  try {
    const payload = basePayload();
    console.log("请求参数:", payload);

    const res = await fetchJSON("/api/review-data", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    console.log("API响应:", res);

    chaptersData = res.chapters || [];
    currentChapterIndex = 0;

    allSegments = [];
    for (const chapter of chaptersData) {
      for (const segment of chapter.segments) {
        allSegments.push({
          ...segment,
          chapter_id: segment.chapter_id,  // 从API返回的数据中获取
          chapter_title: chapter.chapter_title,
        });
      }
    }

    console.log(`加载完成: ${chaptersData.length} 个章节, ${allSegments.length} 个片段`);

    renderActiveChapter();

    emotionRecordingPanel.style.display = "block";

  } catch (err) {
    console.error("加载失败:", err.message);
    alert("加载失败: " + err.message);
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
    return;
  }

  // 导航到当前章节的第一个片段
  navigateToChapterSegment(0);
  // 更新统计显示
  updateRecordingStats();
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

function navigateToChapterSegment(index) {
  const activeChapter = chaptersData[currentChapterIndex];
  if (index < 0 || index >= activeChapter.segments.length) return;

  currentSegmentIndex = index;
  const segment = activeChapter.segments[index];

  // 保存当前segment对象，包含完整的chapter信息
  currentSegment = {
    ...segment,
    chapter_id: segment.chapter_id,  // 从segment数据中获取
    chapter_title: activeChapter.chapter_title,
  };

  // 显示章节信息
  chapterInfo.textContent = `${activeChapter.chapter_title} (${currentChapterIndex + 1}/${chaptersData.length})`;
  currentSegmentTitle.textContent = `${segment.segment_id} · ${segment.speaker}`;
  currentSegmentText.textContent = segment.text;
  currentSegmentEmotion.textContent = segment.emotion || "无";

  segmentPosition.textContent = `${index + 1} / ${activeChapter.segments.length} / ${currentChapterIndex + 1}`;

  // 检查是否有已录制的情感参考音频
  const hasExistingAudio = segment.emotion_reference_audio && segment.emotion_reference_audio.path;
  if (hasExistingAudio) {
    // 有参考音频，显示播放器
    const audioUrl = `/api/audio?path=${encodeURIComponent(segment.emotion_reference_audio.path)}`;
    recordedAudio.src = audioUrl;
    audioPlayback.style.display = "block";
    startRecordingBtn.style.display = "none";
    stopRecordingBtn.style.display = "none";
  } else {
    // 无参考音频，显示录制按钮
    startRecordingBtn.disabled = false;
    startRecordingBtn.style.display = "inline-block";
    stopRecordingBtn.style.display = "none";
    audioPlayback.style.display = "none";
  }

  // 更新章节导航按钮状态
  prevChapterBtn.disabled = currentChapterIndex === 0;
  nextChapterBtn.disabled = currentChapterIndex === chaptersData.length - 1;
  lastChapterBtn.disabled = currentChapterIndex === chaptersData.length - 1;
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

lastChapterBtn.addEventListener("click", () => {
  if (chaptersData.length > 0) {
    currentChapterIndex = chaptersData.length - 1;
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
  if (!currentSegment || audioChunks.length === 0) {
    alert("没有可上传的音频");
    return;
  }

  try {
    const segment = currentSegment;
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
    audioChunks = [];  // 清空音频缓存

    // 上传成功后，手动更新当前片段的emotion_reference_audio信息
    const activeChapter = chaptersData[currentChapterIndex];
    const currentActiveSegment = activeChapter.segments[currentSegmentIndex];

    // 从响应中获取文件路径
    const result = await response.json();
    if (result.path) {
      currentActiveSegment.emotion_reference_audio = {
        path: result.path,
        duration: result.duration,
        content_type: result.content_type,
        uploaded_at: new Date().toISOString()
      };

      // 更新allSegments中对应的数据
      const globalIndex = allSegments.findIndex(s =>
        s.segment_id === currentActiveSegment.segment_id &&
        s.chapter_id === currentActiveSegment.chapter_id
      );
      if (globalIndex >= 0) {
        allSegments[globalIndex].emotion_reference_audio = currentActiveSegment.emotion_reference_audio;
      }

      // 更新统计显示
      updateRecordingStats();

      // 刷新当前片段显示（会显示音频播放器）
      navigateToChapterSegment(currentSegmentIndex);
    }
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
