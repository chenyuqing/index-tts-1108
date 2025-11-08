const scriptInput = document.getElementById("scriptPath");
const configInput = document.getElementById("configPath");
const outRootInput = document.getElementById("outRoot");
const modelDirInput = document.getElementById("modelDir");
const languageSelect = document.getElementById("language");
const loadChaptersBtn = document.getElementById("loadChaptersBtn");
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
      row.innerHTML = `
        <header>
          <h4>${segment.segment_id} · ${segment.speaker || ""}</h4>
          <span>${segment.emotion || ""}</span>
        </header>
        <p>${segment.text || ""}</p>
      `;

      const controls = document.createElement("div");
      controls.className = "segment-controls";
      const emotionInput = document.createElement("input");
      emotionInput.placeholder = "自定义情绪，比如：温暖、激情";
      emotionInput.value = segment.emotion || "";
      const regenBtn = document.createElement("button");
      regenBtn.textContent = segment.audio_url ? "重新生成" : "生成";
      regenBtn.className = "primary";
      regenBtn.addEventListener("click", () => handleRegenerate(segment.segment_id, emotionInput.value, row));
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

async function handleRegenerate(segmentId, emotionText, rowEl) {
  rowEl.classList.add("pending");
  try {
    const payload = {
      ...basePayload(),
      model_dir: modelDirInput.value,
      segment_id: segmentId,
      manifest_path: manifestPath,
      overrides: emotionText ? { emotion: emotionText } : {},
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
    }
  } catch (err) {
    alert(`重新生成失败: ${err.message}`);
  } finally {
    rowEl.classList.remove("pending");
  }
}

loadChaptersBtn.addEventListener("click", loadChapters);
loadDefaults();
