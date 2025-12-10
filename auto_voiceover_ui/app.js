const scriptInput = document.getElementById("scriptPath");
const configInput = document.getElementById("configPath");
const outRootInput = document.getElementById("outRoot");
const modelDirInput = document.getElementById("modelDir");
const languageSelect = document.getElementById("language");

// 检查关键DOM元素是否存在
console.log("检查DOM元素:", {
  scriptInput: !!scriptInput,
  configInput: !!configInput,
  outRootInput: !!outRootInput,
  modelDirInput: !!modelDirInput,
  languageSelect: !!languageSelect
});

if (!scriptInput || !configInput || !outRootInput || !modelDirInput || !languageSelect) {
  console.error("DOM元素获取失败，页面可能未正确加载");
  alert("页面加载错误，请刷新重试");
}
const useFp16Input = document.getElementById("useFp16");
const pendingOnlyInput = document.getElementById("pendingOnly");
const useEmotionRefInput = document.getElementById("useEmotionRef");
const dryRunBtn = document.getElementById("dryRunBtn");
const generateBtn = document.getElementById("generateBtn");
const dryRunSummary = document.getElementById("dryRunSummary");
const dryRunTable = document.getElementById("dryRunTable");
const generateSummary = document.getElementById("generateSummary");
const generateLogs = document.getElementById("generateLogs");
const generateTable = null;
const themeToggle = document.getElementById("themeToggle");
const navLinks = document.querySelectorAll(".nav-link");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const stopBtn = document.getElementById("stopBtn");

const modal = document.getElementById("browserModal");
const browserTitle = document.getElementById("browserTitle");
const browserPath = document.getElementById("browserPath");
const browserList = document.getElementById("browserList");
const browserSelectBtn = document.getElementById("browserSelect");
const browserCancelBtn = document.getElementById("browserCancel");
const browserCloseBtn = document.getElementById("browserClose");
const browserUpBtn = document.getElementById("browserUp");

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

function setDefaults(data) {
  console.log("设置默认值到表单...");
  console.log("原始数据:", data);

  // 确保数据存在
  data = data || {};

  scriptInput.value = data.script || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/test_input/scripts/cursor-composor-EN.md";
  configInput.value = data.config || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/test_input/speakers.yaml";
  outRootInput.value = data.out_root || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/test_input/DUB";
  modelDirInput.value = data.model_dir || "/Users/tim/Documents/vibe-coding/MVP/index-tts-1108/checkpoints";
  languageSelect.value = data.language || "auto";

  if (data.workspace_root) {
    window.__workspaceRoot = data.workspace_root;
  } else if (!window.__workspaceRoot) {
    window.__workspaceRoot = "/";
  }

  console.log("表单字段已更新:", {
    script: scriptInput.value,
    config: configInput.value,
    outRoot: outRootInput.value,
    modelDir: modelDirInput.value,
    language: languageSelect.value
  });

  // 验证字段是否正确设置
  if (!scriptInput.value || !configInput.value || !outRootInput.value) {
    console.warn("部分字段为空，使用了默认路径");
  }
}

async function loadDefaults() {
  try {
    console.log("加载默认值...");
    const data = await fetchJSON("/api/defaults");
    console.log("获取到的默认值:", data);
    setDefaults(data);
    console.log("默认值已设置");
  } catch (err) {
    console.error("加载默认值失败:", err);
  }
}

function openBrowser(targetKey) {
  const cfg = browseConfig[targetKey];
  if (!cfg) return;
  browserState = {
    currentPath: cfg.input.value || window.__workspaceRoot || null,
    selectedPath: null,
    selectedIsDir: false,
    target: cfg,
  };
  browserTitle.textContent = cfg.label;
  browserSelectBtn.disabled = true;
  modal.classList.remove("hidden");
  loadDirectory(browserState.currentPath || undefined);
}

async function loadDirectory(path) {
  try {
    const body = {
      path,
      include_dirs: true,
      include_files: browserState.target.type === "file",
      extensions: browserState.target.extensions || [],
    };
    const res = await fetchJSON("/api/listdir", {
      method: "POST",
      body: JSON.stringify(body),
    });
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
  const path = li.dataset.path;
  if (isDir && browserState.target.type === "file") {
    loadDirectory(path);
    return;
  }
  browserState.selectedPath = path;
  browserState.selectedIsDir = isDir;
  Array.from(browserList.children).forEach((node) => node.classList.remove("active"));
  li.classList.add("active");
  const expectingDir = browserState.target.type === "dir";
  browserSelectBtn.disabled = expectingDir ? !isDir : isDir;
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
  if (idx <= 0) {
    return "/";
  }
  return trimmed.slice(0, idx) || "/";
}

async function handleDryRun() {
  dryRunSummary.textContent = "运行中...";
  dryRunTable.innerHTML = "";
  try {
    const payload = collectBasePayload();
    const res = await fetchJSON("/api/dry-run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const warningText = res.warnings && res.warnings.length ? `Warnings: ${res.warnings.join("; ")}` : "";
    dryRunSummary.textContent = `节目: ${res.episode}\n输出: ${res.output_root}\n段落: ${res.stats.total_segments}\n缺失主持人: ${res.missing_speakers.join(", ") || "无"}\n${warningText}`;
    dryRunTable.innerHTML = res.preview
      .map(
        (row) =>
          `<tr><td>${row.segment_id}</td><td>${row.chapter || ""}</td><td>${row.speaker || ""}</td><td>${row.emotion || ""}</td><td>${row.output_path || ""}</td></tr>`
      )
      .join("");
  } catch (err) {
    dryRunSummary.textContent = `Dry-run 失败: ${err.message}`;
  }
}

function collectBasePayload() {
  return {
    script_path: scriptInput.value,
    config_path: configInput.value,
    out_root: outRootInput.value,
    language: languageSelect.value,
  };
}

async function handleGenerate() {
  generateSummary.textContent = "正在合成...";
  generateLogs.textContent = "";
  try {
    const payload = {
      ...collectBasePayload(),
      model_dir: modelDirInput.value,
      use_fp16: useFp16Input.checked,
      pending_only: pendingOnlyInput.checked,
      use_emotion_reference: useEmotionRefInput.checked,
    };
    const res = await fetchJSON("/api/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    refreshState();
    const summary = res.summary;
    generateSummary.textContent = `节目: ${summary.episode}\n完成: ${summary.completed}/${summary.total}\n失败: ${summary.failed} | 跳过: ${summary.skipped}\nManifest: ${summary.manifest_path}`;
    generateLogs.textContent = (res.logs || []).join("\n");
  } catch (err) {
    generateSummary.textContent = `生成失败: ${err.message}`;
    refreshState();
  }
}

async function sendControl(action) {
  try {
    await fetchJSON("/api/control", {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  } catch (err) {
    console.error(err);
  } finally {
    refreshState();
  }
}

pauseBtn.addEventListener("click", () => sendControl("pause"));
resumeBtn.addEventListener("click", () => sendControl("resume"));
stopBtn.addEventListener("click", () => sendControl("stop"));

async function refreshState() {
  try {
    const state = await fetchJSON("/api/state");
    updateControlUI(state);
    if (state.logs) {
      generateLogs.textContent = state.logs.join("\n");
    }
  } catch (err) {
    console.error(err);
  }
}

function updateControlUI(state) {
  const running = state.status === "running";
  pauseBtn.disabled = !running;
  stopBtn.disabled = !running;
  resumeBtn.disabled = !(running && state.requested === "pause");
  if (!running) {
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    resumeBtn.disabled = true;
  }
  generateBtn.disabled = running;
}

browserList.addEventListener("dblclick", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  const isDir = li.dataset.isDir === "true";
  if (isDir) {
    loadDirectory(li.dataset.path);
  }
});

dryRunBtn.addEventListener("click", handleDryRun);

generateBtn.addEventListener("click", handleGenerate);

themeToggle.addEventListener("click", () => {
  const root = document.documentElement;
  const current = root.getAttribute("data-theme");
  root.setAttribute("data-theme", current === "light" ? "dark" : "light");
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const targetUrl = link.dataset.link;
    if (targetUrl) {
      window.location.href = targetUrl;
      return;
    }
    const targetId = link.dataset.anchor;
    const target = document.getElementById(targetId);
    if (!target) return;
    navLinks.forEach((btn) => btn.classList.remove("active"));
    link.classList.add("active");
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

// 确保DOM加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM已加载完成，开始初始化...");
  loadDefaults();
  refreshState();
  setInterval(refreshState, 5000);
});
