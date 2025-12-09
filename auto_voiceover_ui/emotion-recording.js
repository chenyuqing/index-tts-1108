// 调试版本的情感录制
console.log('=== 情感录制调试版本 ===');

// 检查所有元素是否都存在
const elementIds = [
  'scriptPath', 'configPath', 'outRoot', 'modelDir',
  'loadSegmentsBtn', 'clearCacheBtn',
  'recordingPanel', 'unrecordedCount', 'recordedCount',
  'currentSegmentTitle', 'currentSegmentText', 'currentSegmentEmotion',
  'recordingMode', 'startRecordingBtn', 'stopRecordingBtn',
  'recordingIndicator', 'recordedAudio', 'uploadAudioBtn', 'reRecordBtn',
  'audioPlayback', 'segmentsPanel', 'segmentsList',
  'batchRecordBtn', 'exportProgressBtn',
  'batchRecordingPanel', 'batchProgressBar', 'batchCurrent', 'batchTotal',
  'batchSegmentTitle', 'batchSegmentText', 'batchSegmentEmotion',
  'batchStartBtn', 'batchNextBtn', 'batchSkipBtn', 'exitBatchModeBtn',
  'browserModal', 'browserTitle', 'browserClose', 'browserPath',
  'browserUp', 'browserList', 'browserSelect', 'browserCancel'
];

const missingElements = [];
elementIds.forEach(id => {
  const el = document.getElementById(id);
  if (!el) {
    missingElements.push(id);
  } else {
    console.log(`✓ 找到元素: ${id}`);
  }
});

if (missingElements.length > 0) {
  console.error('❌ 缺失的元素:', missingElements);
  alert(`页面加载错误！缺失元素: ${missingElements.join(', ')}`);
} else {
  console.log('✓ 所有元素都存在');
}

// 简化版本的基本功能
const elements = {};
elementIds.forEach(id => {
  elements[id] = document.getElementById(id);
});

// 基础功能
let manifest = null;
let segments = [];
let currentSegment = null;

// 加载默认配置
function loadDefaults() {
  console.log('加载默认配置...');
  try {
    const params = new URLSearchParams(window.location.search);
    elements.scriptPath.value = params.get('script') || '';
    elements.configPath.value = params.get('config') || '';
    elements.outRoot.value = params.get('out') || '';
    elements.modelDir.value = params.get('model') || '';

    console.log('当前配置:', {
      script: elements.scriptPath.value,
      config: elements.configPath.value,
      outRoot: elements.outRoot.value,
      modelDir: elements.modelDir.value
    });

    // 显示配置面板
    elements.recordingPanel.style.display = 'block';
    elements.segmentsPanel.style.display = 'block';

    // 创建测试数据
    createTestData();
  } catch (error) {
    console.error('加载默认配置错误:', error);
  }
}

// 创建测试数据
function createTestData() {
  console.log('创建测试数据...');

  // 创建模拟清单数据
  manifest = {
    episode: 'test-episode',
    segments: [
      {
        segment_id: 'ch00-01',
        chapter: 'ch00',
        speaker: 'larei',
        text: '这是测试文本1',
        emotion: '平静',
        emotion_reference_audio: null,
        emotion_reference_status: 'missing'
      },
      {
        segment_id: 'ch00-02',
        chapter: 'ch00',
        speaker: 'leo',
        text: '这是测试文本2',
        emotion: '好奇',
        emotion_reference_audio: null,
        emotion_reference_status: 'missing'
      }
    ]
  };

  segments = manifest.segments;
  updateRecordingStatus();
  renderSegmentsList();
}

// 更新录制状态
function updateRecordingStatus() {
  if (!segments.length) return;

  const recorded = segments.filter(s => s.emotion_reference_audio).length;
  const unrecorded = segments.length - recorded;

  elements.unrecordedCount.textContent = unrecorded;
  elements.recordedCount.textContent = recorded;
}

// 渲染片段列表
function renderSegmentsList() {
  console.log('渲染片段列表...');

  const html = segments.map(segment => {
    const isRecorded = !!segment.emotion_reference_audio;
    const statusClass = isRecorded ? 'recorded' : 'unrecorded';
    const statusIcon = isRecorded ? '✅' : '🎤';

    return `
      <div class="segment-item ${statusClass}" data-segment-id="${segment.segment_id}"
           onclick="selectSegment('${segment.segment_id}')" style="cursor: pointer; padding: 10px; margin: 5px; border: 1px solid #ccc;">
        <div>${segment.segment_id} · ${segment.speaker}</div>
        <div>${segment.text}</div>
        <div>${statusIcon} ${isRecorded ? '已录制' : '未录制'}</div>
      </div>
    `;
  }).join('');

  elements.segmentsList.innerHTML = html;
  console.log('片段列表渲染完成');
}

// 选择片段
function selectSegment(segmentId) {
  console.log('选择片段:', segmentId);
  currentSegment = segments.find(s => s.segment_id === segmentId);

  if (!currentSegment) return;

  elements.currentSegmentTitle.textContent = `${currentSegment.segment_id} · ${currentSegment.speaker}`;
  elements.currentSegmentText.textContent = currentSegment.text;
  elements.currentSegmentEmotion.textContent = currentSegment.emotion || '无情感标注';

  elements.startRecordingBtn.disabled = false;
}

// 开始录制
function startRecording() {
  console.log('开始录制...');
  if (!currentSegment) {
    alert('请先选择一个片段');
    return;
  }

  alert('录制功能需要麦克风权限。在实际环境中，这里会调用MediaRecorder API进行录制。');
}

// 设置事件监听器
function setupEventListeners() {
  console.log('设置事件监听器...');

  elements.loadSegmentsBtn.addEventListener('click', () => {
    console.log('加载片段按钮被点击');
    loadSegments();
  });

  elements.startRecordingBtn.addEventListener('click', startRecording);

  console.log('事件监听器设置完成');
}

// 加载片段（模拟）
function loadSegments() {
  console.log('加载片段按钮被点击');
  alert('在实际环境中，这里会加载真实的片段数据。现在使用测试数据。');
  createTestData();
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('=== DOMContentLoaded 事件触发 ===');
  try {
    setupEventListeners();
    loadDefaults();
    console.log('=== 初始化完成 ===');
  } catch (error) {
    console.error('初始化失败:', error);
    document.getElementById('status').textContent = '初始化失败: ' + error.message;
  }
});