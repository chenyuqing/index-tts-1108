// 情感参考音频录制功能

// 全局变量
let manifest = null;
let segments = [];
let currentSegment = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingStartTime = 0;
let isRecording = false;
let batchMode = false;
let batchSegments = [];
let batchCurrentIndex = 0;

// DOM元素
const elements = {
  // 基础配置
  scriptPath: document.getElementById('scriptPath'),
  configPath: document.getElementById('configPath'),
  outRoot: document.getElementById('outRoot'),
  modelDir: document.getElementById('modelDir'),
  loadSegmentsBtn: document.getElementById('loadSegmentsBtn'),
  clearCacheBtn: document.getElementById('clearCacheBtn'),

  // 录制面板
  recordingPanel: document.getElementById('recordingPanel'),
  unrecordedCount: document.getElementById('unrecordedCount'),
  recordedCount: document.getElementById('recordedCount'),

  // 当前录制
  currentSegmentTitle: document.getElementById('currentSegmentTitle'),
  currentSegmentText: document.getElementById('currentSegmentText'),
  currentSegmentEmotion: document.getElementById('currentSegmentEmotion'),
  recordingMode: document.getElementById('recordingMode'),
  startRecordingBtn: document.getElementById('startRecordingBtn'),
  stopRecordingBtn: document.getElementById('stopRecordingBtn'),
  recordingIndicator: document.getElementById('recordingIndicator'),
  recordedAudio: document.getElementById('recordedAudio'),
  uploadAudioBtn: document.getElementById('uploadAudioBtn'),
  reRecordBtn: document.getElementById('reRecordBtn'),
  audioPlayback: document.getElementById('audioPlayback'),

  // 片段列表
  segmentsPanel: document.getElementById('segmentsPanel'),
  segmentsList: document.getElementById('segmentsList'),
  batchRecordBtn: document.getElementById('batchRecordBtn'),
  exportProgressBtn: document.getElementById('exportProgressBtn'),

  // 批量录制
  batchRecordingPanel: document.getElementById('batchRecordingPanel'),
  batchProgressBar: document.getElementById('batchProgressBar'),
  batchCurrent: document.getElementById('batchCurrent'),
  batchTotal: document.getElementById('batchTotal'),
  batchSegmentTitle: document.getElementById('batchSegmentTitle'),
  batchSegmentText: document.getElementById('batchSegmentText'),
  batchSegmentEmotion: document.getElementById('batchSegmentEmotion'),
  batchStartBtn: document.getElementById('batchStartBtn'),
  batchNextBtn: document.getElementById('batchNextBtn'),
  batchSkipBtn: document.getElementById('batchSkipBtn'),
  exitBatchModeBtn: document.getElementById('exitBatchModeBtn'),

  // 文件浏览器
  browserModal: document.getElementById('browserModal'),
  browserTitle: document.getElementById('browserTitle'),
  browserPath: document.getElementById('browserPath'),
  browserUp: document.getElementById('browserUp'),
  browserList: document.getElementById('browserList'),
  browserSelect: document.getElementById('browserSelect'),
  browserCancel: document.getElementById('browserCancel'),
  browserClose: document.getElementById('browserClose')
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadDefaults();
  setupEventListeners();
  setupFileBrowsing();
});

// 设置事件监听器
function setupEventListeners() {
  // 基础配置
  elements.loadSegmentsBtn.addEventListener('click', loadSegments);
  elements.clearCacheBtn.addEventListener('click', handleClearCache);

  // 录制控制
  elements.startRecordingBtn.addEventListener('click', startRecording);
  elements.stopRecordingBtn.addEventListener('click', stopRecording);
  elements.uploadAudioBtn.addEventListener('click', uploadCurrentRecording);
  elements.reRecordBtn.addEventListener('click', reRecord);

  // 批量录制
  elements.batchRecordBtn.addEventListener('click', enterBatchMode);
  elements.batchStartBtn.addEventListener('click', startBatchRecording);
  elements.batchNextBtn.addEventListener('click', nextBatchSegment);
  elements.batchSkipBtn.addEventListener('click', skipBatchSegment);
  elements.exitBatchModeBtn.addEventListener('click', exitBatchMode);

  // 导出
  elements.exportProgressBtn.addEventListener('click', exportRecordingProgress);
}

// 加载默认配置
function loadDefaults() {
  const params = new URLSearchParams(window.location.search);

  elements.scriptPath.value = params.get('script') || localStorage.getItem('emotionRecording_script') || '';
  elements.configPath.value = params.get('config') || localStorage.getItem('emotionRecording_config') || '';
  elements.outRoot.value = params.get('out') || localStorage.getItem('emotionRecording_out') || '';
  elements.modelDir.value = params.get('model') || localStorage.getItem('emotionRecording_model') || '';

  // 如果已有配置，自动加载
  if (elements.scriptPath.value && elements.configPath.value) {
    loadSegments();
  }
}

// 保存配置
function saveDefaults() {
  localStorage.setItem('emotionRecording_script', elements.scriptPath.value);
  localStorage.setItem('emotionRecording_config', elements.configPath.value);
  localStorage.setItem('emotionRecording_out', elements.outRoot.value);
  localStorage.setItem('emotionRecording_model', elements.modelDir.value);
}

// 加载片段列表
async function loadSegments() {
  if (!elements.scriptPath.value || !elements.configPath.value) {
    alert('请先选择脚本和配置文件');
    return;
  }

  elements.loadSegmentsBtn.disabled = true;
  elements.loadSegmentsBtn.textContent = '加载中...';

  try {
    const response = await fetch('/api/review-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script_path: elements.scriptPath.value,
        config_path: elements.configPath.value,
        out_root: elements.outRoot.value,
        model_dir: elements.modelDir.value,
        manifest_path: ''
      })
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error);
    }

    manifest = data.manifest;
    segments = manifest.segments || [];

    // 更新录制状态
    updateRecordingStatus();

    // 显示面板
    elements.recordingPanel.style.display = 'block';
    elements.segmentsPanel.style.display = 'block';

    // 渲染片段列表
    renderSegmentsList();

    // 保存默认配置
    saveDefaults();

  } catch (error) {
    console.error('加载失败:', error);
    alert(`加载失败: ${error.message}`);
  } finally {
    elements.loadSegmentsBtn.disabled = false;
    elements.loadSegmentsBtn.textContent = '加载片段列表';
  }
}

// 更新录制状态统计
function updateRecordingStatus() {
  if (!segments.length) return;

  const recorded = segments.filter(s => s.emotion_reference_audio).length;
  const unrecorded = segments.length - recorded;

  elements.unrecordedCount.textContent = unrecorded;
  elements.recordedCount.textContent = recorded;
}

// 渲染片段列表
function renderSegmentsList() {
  if (!segments.length) {
    elements.segmentsList.innerHTML = '<p class="no-segments">暂无片段</p>';
    return;
  }

  const html = segments.map(segment => {
    const isRecorded = !!segment.emotion_reference_audio;
    const statusClass = isRecorded ? 'recorded' : 'unrecorded';
    const statusIcon = isRecorded ? '✅' : '🎤';

    return `
      <div class="segment-item ${statusClass}" data-segment-id="${segment.segment_id}"
           onclick="selectSegment('${segment.segment_id}')">
        <div class="segment-header">
          <span class="segment-id">${segment.segment_id}</span>
          <span class="segment-speaker">${segment.speaker}</span>
        </div>
        <div class="segment-text">${segment.text}</div>
        <div class="segment-footer">
          <span class="segment-emotion">${segment.emotion || '无情感标注'}</span>
          <span class="segment-status">
            <span class="status-icon">${statusIcon}</span>
            <span>${isRecorded ? '已录制' : '未录制'}</span>
          </span>
        </div>
      </div>
    `;
  }).join('');

  elements.segmentsList.innerHTML = html;
}

// 选择片段
function selectSegment(segmentId) {
  currentSegment = segments.find(s => s.segment_id === segmentId);

  if (!currentSegment) return;

  // 更新UI
  elements.currentSegmentTitle.textContent =
    `${currentSegment.segment_id} · ${currentSegment.speaker}`;
  elements.currentSegmentText.textContent = currentSegment.text;
  elements.currentSegmentEmotion.textContent =
    currentSegment.emotion || '无情感标注';

  // 更新选中状态
  document.querySelectorAll('.segment-item').forEach(item => {
    item.classList.remove('selected');
  });
  document.querySelector(`[data-segment-id="${segmentId}"]`)
    ?.classList.add('selected');

  // 启用录制按钮
  elements.startRecordingBtn.disabled = false;

  // 重置录制界面
  resetRecordingInterface();
}

// 重置录制界面
function resetRecordingInterface() {
  elements.audioPlayback.style.display = 'none';
  elements.recordedAudio.src = '';
  elements.recordingMode.value = 'replace';

  // 如果有已录制的音频，显示预览
  if (currentSegment?.emotion_reference_audio) {
    elements.recordedAudio.src = currentSegment.emotion_reference_audio;
    elements.audioPlayback.style.display = 'block';
  }
}

// 开始录制
async function startRecording() {
  if (!currentSegment) {
    alert('请先选择一个片段');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
        channelCount: 1
      }
    });

    // 创建 MediaRecorder
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(audioBlob);
      elements.recordedAudio.src = audioUrl;
      elements.audioPlayback.style.display = 'block';

      // 清理流
      stream.getTracks().forEach(track => track.stop());
    };

    // 开始录制
    mediaRecorder.start();
    isRecording = true;
    recordingStartTime = Date.now();

    // 更新UI
    elements.startRecordingBtn.style.display = 'none';
    elements.stopRecordingBtn.style.display = 'block';
    elements.recordingIndicator.classList.remove('hidden');

    // 开始计时器
    startRecordingTimer();

  } catch (error) {
    console.error('录制失败:', error);
    alert('无法访问麦克风，请检查权限设置');
  }
}

// 开始录制计时器
function startRecordingTimer() {
  recordingTimer = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const displaySeconds = seconds % 60;

    elements.recordingIndicator.querySelector('.recording-time').textContent =
      `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`;

    // 90秒自动停止
    if (seconds >= 90) {
      stopRecording();
    }
  }, 100);
}

// 停止录制
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  mediaRecorder.stop();
  isRecording = false;

  // 清除计时器
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  // 更新UI
  elements.startRecordingBtn.style.display = 'block';
  elements.stopRecordingBtn.style.display = 'none';
  elements.recordingIndicator.classList.add('hidden');
}

// 上传当前录制
async function uploadCurrentRecording() {
  if (!currentSegment || !elements.recordedAudio.src) {
    alert('没有可上传的录音');
    return;
  }

  try {
    // 从audio元素获取blob
    const response = await fetch(elements.recordedAudio.src);
    const audioBlob = await response.blob();

    // 创建表单数据
    const formData = new FormData();
    formData.append('audio', audioBlob, `${currentSegment.segment_id}.webm`);
    formData.append('segment_id', currentSegment.segment_id);
    formData.append('project_name', manifest.episode || 'unknown');
    formData.append('chapter', currentSegment.chapter || 'ch00');
    formData.append('speaker', currentSegment.speaker || 'unknown');

    // 显示上传状态
    elements.uploadAudioBtn.disabled = true;
    elements.uploadAudioBtn.textContent = '上传中...';

    const uploadResponse = await fetch('/api/audio/upload', {
      method: 'POST',
      body: formData
    });

    const result = await uploadResponse.json();

    if (result.success) {
      // 更新片段数据
      currentSegment.emotion_reference_audio = result.path;
      currentSegment.emotion_reference_status = 'recorded';
      currentSegment.emotion_mode = 'audio';

      alert('情感音频上传成功！');

      // 更新UI
      renderSegmentsList();
      updateRecordingStatus();

      // 重置录制界面
      resetRecordingInterface();
    } else {
      alert(`上传失败: ${result.error}`);
    }

  } catch (error) {
    console.error('上传失败:', error);
    alert('上传失败，请重试');
  } finally {
    elements.uploadAudioBtn.disabled = false;
    elements.uploadAudioBtn.textContent = '上传并保存';
  }
}

// 重新录制
function reRecord() {
  if (confirm('确定要重新录制吗？当前录音将被丢弃。')) {
    elements.audioPlayback.style.display = 'none';
    elements.recordedAudio.src = '';
  }
}

// 进入批量录制模式
function enterBatchMode() {
  // 筛选未录制的片段
  batchSegments = segments.filter(s => !s.emotion_reference_audio);

  if (batchSegments.length === 0) {
    alert('所有片段都已录制完成！');
    return;
  }

  batchMode = true;
  batchCurrentIndex = 0;

  // 更新UI
  elements.segmentsPanel.style.display = 'none';
  elements.recordingPanel.style.display = 'none';
  elements.batchRecordingPanel.style.display = 'block';

  // 更新进度
  elements.batchTotal.textContent = batchSegments.length;
  elements.batchCurrent.textContent = batchCurrentIndex;
  elements.batchProgressBar.style.width = '0%';

  // 加载第一个片段
  loadBatchSegment();
}

// 加载批量录制片段
function loadBatchSegment() {
  if (batchCurrentIndex >= batchSegments.length) {
    // 批量录制完成
    completeBatchRecording();
    return;
  }

  const segment = batchSegments[batchCurrentIndex];

  // 更新UI
  elements.batchSegmentTitle.textContent =
    `${segment.segment_id} · ${segment.speaker}`;
  elements.batchSegmentText.textContent = segment.text;
  elements.batchSegmentEmotion.textContent =
    segment.emotion || '无情感标注';

  // 更新进度
  elements.batchCurrent.textContent = batchCurrentIndex + 1;
  const progress = ((batchCurrentIndex + 1) / batchSegments.length) * 100;
  elements.batchProgressBar.style.width = `${progress}%`;

  // 显示录制控制
  elements.batchStartBtn.style.display = 'none';
  elements.batchNextBtn.style.display = 'none';
  elements.batchSkipBtn.style.display = 'none';

  // 播放文本提示音（可选）
  // playTextPrompt(segment.text);
}

// 开始批量录制
function startBatchRecording() {
  // 这里可以实现自动播放文本提示
  // 目前简化为直接开始录制
  selectSegment(batchSegments[batchCurrentIndex].segment_id);
  startRecording();

  // 显示控制按钮
  elements.batchNextBtn.style.display = 'inline-block';
  elements.batchSkipBtn.style.display = 'inline-block';
}

// 下一个批量片段
function nextBatchSegment() {
  if (!currentSegment || !elements.recordedAudio.src) {
    alert('请先完成当前片段的录制');
    return;
  }

  // 上传当前录制
  uploadCurrentRecording().then(() => {
    batchCurrentIndex++;
    loadBatchSegment();
  });
}

// 跳过当前批量片段
function skipBatchSegment() {
  batchCurrentIndex++;
  loadBatchSegment();
}

// 退出批量录制模式
function exitBatchMode() {
  if (!confirm('确定要退出批量录制模式吗？未完成的录制将不会保存。')) {
    return;
  }

  batchMode = false;
  batchSegments = [];
  batchCurrentIndex = 0;

  // 重置UI
  elements.segmentsPanel.style.display = 'block';
  elements.recordingPanel.style.display = 'block';
  elements.batchRecordingPanel.style.display = 'none';

  // 重新加载片段列表
  renderSegmentsList();
}

// 完成批量录制
function completeBatchRecording() {
  alert(`批量录制完成！共录制了 ${batchSegments.length} 个片段。`);
  exitBatchMode();
}

// 导出录制进度
function exportRecordingProgress() {
  if (!segments.length) {
    alert('暂无片段数据');
    return;
  }

  const recorded = segments.filter(s => s.emotion_reference_audio);
  const unrecorded = segments.filter(s => !s.emotion_reference_audio);

  const report = {
    project: manifest.episode,
    total_segments: segments.length,
    recorded_count: recorded.length,
    unrecorded_count: unrecorded.length,
    recording_rate: Math.round((recorded.length / segments.length) * 100),
    recorded_segments: recorded.map(s => ({
      segment_id: s.segment_id,
      speaker: s.speaker,
      emotion_reference_audio: s.emotion_reference_audio
    })),
    unrecorded_segments: unrecorded.map(s => ({
      segment_id: s.segment_id,
      speaker: s.speaker,
      text: s.text.substring(0, 100) + '...'
    })),
    export_time: new Date().toISOString()
  };

  // 下载报告
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${manifest.episode}_recording_report.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// 清理模型缓存
async function handleClearCache() {
  try {
    const response = await fetch('/api/model/clear', { method: 'POST' });
    const result = await response.json();
    alert(result.status === 'cleared' ? '模型缓存已清理' : '缓存为空');
  } catch (error) {
    alert('清理失败: ' + error.message);
  }
}

// 文件浏览功能
function setupFileBrowsing() {
  let currentBrowseTarget = null;
  let currentPath = '';

  // 浏览按钮事件
  document.querySelectorAll('[data-browse]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentBrowseTarget = btn.dataset.browse;
      openBrowser();
    });
  });

  // 浏览器事件
  elements.browserClose.addEventListener('click', closeBrowser);
  elements.browserCancel.addEventListener('click', closeBrowser);
  elements.browserUp.addEventListener('click', navigateUp);
  elements.browserSelect.addEventListener('click', selectBrowserItem);

  // ESC键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.browserModal.classList.contains('hidden')) {
      closeBrowser();
    }
  });
}

// 打开文件浏览器
async function openBrowser(path = '') {
  currentPath = path;
  elements.browserModal.classList.remove('hidden');

  // 设置标题
  const titles = {
    script: '选择脚本文件',
    config: '选择配置文件',
    outroot: '选择输出目录',
    model: '选择模型目录'
  };
  elements.browserTitle.textContent = titles[currentBrowseTarget] || '选择文件';

  await loadBrowserList();
}

// 关闭文件浏览器
function closeBrowser() {
  elements.browserModal.classList.add('hidden');
}

// 加载浏览器列表
async function loadBrowserList() {
  try {
    const response = await fetch('/api/listdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath })
    });

    const data = await response.json();

    elements.browserPath.textContent = data.path || '/';
    elements.browserUp.disabled = !data.parent;

    // 渲染列表
    let html = '';

    // 添加目录项
    data.dirs.forEach(dir => {
      html += `
        <li class="browser-item browser-dir" data-path="${dir.path}">
          <span class="browser-icon">📁</span>
          <span class="browser-name">${dir.name}</span>
        </li>
      `;
    });

    // 添加文件项
    if (currentBrowseTarget !== 'outroot' && currentBrowseTarget !== 'model') {
      data.files.forEach(file => {
        html += `
          <li class="browser-item browser-file" data-path="${file.path}">
            <span class="browser-icon">📄</span>
            <span class="browser-name">${file.name}</span>
          </li>
        `;
      });
    }

    elements.browserList.innerHTML = html || '<li class="browser-empty">空目录</li>';

    // 添加点击事件
    elements.browserList.querySelectorAll('.browser-item').forEach(item => {
      item.addEventListener('click', () => selectBrowserItem(item));
    });

  } catch (error) {
    console.error('加载目录失败:', error);
    elements.browserList.innerHTML = '<li class="browser-error">加载失败</li>';
  }
}

// 导航到上级目录
function navigateUp() {
  const pathParts = currentPath.split('/').filter(p => p);
  pathParts.pop();
  openBrowser(pathParts.join('/'));
}

// 选择浏览器项
function selectBrowserItem(item) {
  // 清除之前的选中状态
  elements.browserList.querySelectorAll('.browser-item').forEach(i => {
    i.classList.remove('selected');
  });

  if (item && item.dataset) {
    item.classList.add('selected');
  }
}

// 选择浏览器项目
async function selectBrowserItem() {
  const selected = elements.browserList.querySelector('.browser-item.selected');
  if (!selected) return;

  const path = selected.dataset.path;
  const isDir = selected.classList.contains('browser-dir');

  if (isDir) {
    // 进入目录
    openBrowser(path);
  } else {
    // 选择文件
    const targetMap = {
      script: elements.scriptPath,
      config: elements.configPath,
      outroot: elements.outRoot,
      model: elements.modelDir
    };

    targetMap[currentBrowseTarget].value = path;
    closeBrowser();
  }
}