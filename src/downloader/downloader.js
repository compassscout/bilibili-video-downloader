'use strict';

const ui = {
  card: document.getElementById('mainCard'),
  eyebrow: document.getElementById('eyebrow'),
  title: document.getElementById('title'),
  meta: document.getElementById('meta'),
  steps: [...document.querySelectorAll('.step')],
  stageLabel: document.getElementById('stageLabel'),
  percent: document.getElementById('percent'),
  progress: document.getElementById('progress'),
  bar: document.getElementById('bar'),
  detail: document.getElementById('detail'),
  errorBox: document.getElementById('errorBox'),
  errorTitle: document.getElementById('errorTitle'),
  errorText: document.getElementById('errorText'),
  errorDetailWrap: document.getElementById('errorDetailWrap'),
  errorDetail: document.getElementById('errorDetail'),
  cancelButton: document.getElementById('cancelButton'),
  retryButton: document.getElementById('retryButton'),
  separateButton: document.getElementById('separateButton'),
  showFolderButton: document.getElementById('showFolderButton'),
  closeButton: document.getElementById('closeButton'),
  logBox: document.getElementById('logBox'),
  log: document.getElementById('log'),
};

const state = {
  task: null,
  ffmpeg: null,
  controller: new AbortController(),
  aborted: false,
  finished: false,
  lastDownloadIds: [],
  savedFilenames: [],
  lastProgress: 0,
  logLines: [],
};

const CODEC_LABELS = {
  avc: 'H.264 / AVC',
  hevc: 'H.265 / HEVC',
  av1: 'AV1',
};

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function appendLog(line) {
  const text = String(line || '').trim();
  if (!text) return;
  state.logLines.push(text);
  if (state.logLines.length > 120) state.logLines.shift();
  ui.log.textContent = state.logLines.join('\n');
}

function setStage(text) {
  ui.stageLabel.textContent = text;
}

function setProgress(value, detail = '') {
  const clamped = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  state.lastProgress = Math.max(state.lastProgress, clamped);
  ui.bar.classList.remove('indeterminate');
  ui.bar.style.width = `${state.lastProgress}%`;
  ui.percent.textContent = `${state.lastProgress}%`;
  ui.progress.setAttribute('aria-valuenow', String(state.lastProgress));
  if (detail) ui.detail.textContent = detail;
}

function setIndeterminate(label, detail = '') {
  ui.bar.classList.add('indeterminate');
  ui.percent.textContent = '处理中';
  ui.progress.removeAttribute('aria-valuenow');
  if (label) setStage(label);
  if (detail) ui.detail.textContent = detail;
}

function markStep(number, status) {
  const step = ui.steps.find((item) => Number(item.dataset.step) === number);
  if (!step) return;
  step.classList.toggle('active', status === 'active');
  step.classList.toggle('done', status === 'done' || status === 'skipped');
  const dot = step.querySelector('.step-dot');
  if (dot) dot.textContent = status === 'active' ? String(number) : status === 'skipped' ? '—' : '✓';
}

function activateStep(number) {
  for (const step of ui.steps) {
    const stepNumber = Number(step.dataset.step);
    step.classList.toggle('done', stepNumber < number);
    step.classList.toggle('active', stepNumber === number);
    const dot = step.querySelector('.step-dot');
    if (dot) dot.textContent = stepNumber < number ? '✓' : String(stepNumber);
  }
}

function completeStep(number) {
  const step = ui.steps.find((item) => Number(item.dataset.step) === number);
  if (!step) return;
  step.classList.remove('active');
  step.classList.add('done');
  const dot = step.querySelector('.step-dot');
  if (dot) dot.textContent = '✓';
}

function completeAllSteps() {
  for (const step of ui.steps) {
    step.classList.remove('active');
    step.classList.add('done');
    const dot = step.querySelector('.step-dot');
    if (dot) dot.textContent = '✓';
  }
}

function showError(error) {
  state.finished = true;
  state.aborted = true;
  ui.card.classList.add('failed');
  ui.eyebrow.textContent = '下载未完成';
  setStage('未完成');
  ui.bar.classList.remove('indeterminate');
  ui.errorBox.hidden = false;
  ui.errorTitle.textContent = '下载或合并失败';
  ui.errorText.textContent = error?.message || '发生未知错误，请重试。';

  const detail = [error?.detail, error?.stack].filter(Boolean).join('\n');
  if (detail) {
    ui.errorDetailWrap.hidden = false;
    ui.errorDetail.textContent = detail;
  } else {
    ui.errorDetailWrap.hidden = true;
  }

  ui.cancelButton.hidden = true;
  ui.retryButton.hidden = false;
  ui.separateButton.hidden = state.task?.mode !== 'merge'
    || state.task?.codec !== 'avc'
    || !state.task?.video?.url;
  ui.closeButton.hidden = false;
  ui.showFolderButton.hidden = true;
  if (state.ffmpeg) {
    try { state.ffmpeg.terminate(); } catch { /* noop */ }
    state.ffmpeg = null;
  }
}

function showCancelled() {
  state.finished = true;
  state.aborted = true;
  ui.card.classList.add('failed');
  ui.eyebrow.textContent = '已取消';
  setStage('已取消');
  ui.bar.classList.remove('indeterminate');
  ui.detail.textContent = '下载已取消，没有保存文件。';
  ui.cancelButton.hidden = true;
  ui.retryButton.hidden = false;
  ui.separateButton.hidden = true;
  ui.closeButton.hidden = false;
}

function showSuccess(downloadState = 'complete') {
  state.finished = true;
  const filenames = state.savedFilenames.length
    ? state.savedFilenames
    : [state.task?.filename].filter(Boolean);
  ui.card.classList.add('success');
  ui.eyebrow.textContent = '保存完成';
  setStage(downloadState === 'complete' ? '已保存到下载目录' : '已开始保存');
  setProgress(100, downloadState === 'complete'
    ? `文件已保存：${filenames.join('、')}`
    : '文件较大，浏览器正在后台写入磁盘，请留意下载记录。');
  completeAllSteps();
  ui.errorBox.hidden = true;
  ui.cancelButton.hidden = true;
  ui.retryButton.hidden = true;
  ui.separateButton.hidden = true;
  ui.showFolderButton.hidden = downloadState !== 'complete' || !state.lastDownloadIds.length;
  ui.closeButton.hidden = false;
  document.title = `下载完成 · ${state.task.title}`;
}

async function getTask(id) {
  const key = `biliTask:${id}`;
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (value) => {
      resolve(value?.[key] || null);
    });
  });
}

function renderTask(task) {
  ui.title.textContent = task.title;
  ui.eyebrow.textContent = '正在准备';

  const total = (task.video?.estimatedSize || 0) + (task.audio?.estimatedSize || 0);
  const chips = [
    task.qualityLabel,
    task.page > 1 ? `P${task.page}` : '',
    task.video ? CODEC_LABELS[task.codec] || '' : '',
    formatDuration(task.duration),
    total ? `约 ${formatBytes(total)}` : '',
  ].filter(Boolean);

  ui.meta.innerHTML = '';
  for (const chip of chips) {
    const span = document.createElement('span');
    span.textContent = chip;
    ui.meta.appendChild(span);
  }

  const step1 = ui.steps.find((step) => Number(step.dataset.step) === 1);
  const step2 = ui.steps.find((step) => Number(step.dataset.step) === 2);
  const step3 = ui.steps.find((step) => Number(step.dataset.step) === 3);
  const step4 = ui.steps.find((step) => Number(step.dataset.step) === 4);

  if (task.mode === 'audio') {
    if (step1) step1.querySelector('.step-name').textContent = '下载音频';
    if (step2) {
      step2.querySelector('.step-name').textContent = '无需视频';
      const dot = step2.querySelector('.step-dot');
      if (dot) dot.textContent = '—';
    }
    if (step3) step3.querySelector('.step-name').textContent = '准备保存';
    if (step4) step4.querySelector('.step-name').textContent = '保存音频';
  } else if (task.mode === 'separate') {
    if (step3) step3.querySelector('.step-name').textContent = '准备保存';
    if (!task.audio && step2) {
      step2.querySelector('.step-name').textContent = '无独立音频';
      const dot = step2.querySelector('.step-dot');
      if (dot) dot.textContent = '—';
    }
  } else if (!task.audio && step2) {
    step2.querySelector('.step-name').textContent = '无独立音频';
    const dot = step2.querySelector('.step-dot');
    if (dot) dot.textContent = '—';
  }
}

async function fetchMedia(stream, label, onProgress) {
  const urls = [stream.url, ...(stream.backups || [])].filter(Boolean);
  let lastError = null;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    try {
      if (index > 0) {
        appendLog(`[${label}] 主地址失败，尝试备用地址 ${index}`);
        setStage(`正在重试${label}…`);
      } else {
        setStage(`正在下载${label}…`);
      }

      const response = await fetch(url, {
        signal: state.controller.signal,
        credentials: 'omit',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const total = Number(response.headers.get('content-length')) || stream.estimatedSize || 0;
      if (!response.body) {
        const buffer = new Uint8Array(await response.arrayBuffer());
        onProgress(buffer.byteLength, buffer.byteLength);
        return buffer;
      }

      const reader = response.body.getReader();
      let received = 0;
      let lastTick = 0;
      let buffer = total > 0 ? new Uint8Array(total) : null;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        if (buffer && received + value.length <= buffer.length) {
          buffer.set(value, received);
        } else {
          if (buffer) {
            chunks.push(buffer.subarray(0, received));
            buffer = null;
          }
          chunks.push(value);
        }

        received += value.length;
        const now = performance.now();
        if (now - lastTick > 100) {
          lastTick = now;
          onProgress(received, total);
        }
      }

      onProgress(received, total || received);

      if (buffer && received === buffer.length) {
        return buffer;
      }
      if (buffer) {
        return buffer.slice(0, received);
      }

      const output = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      return output;
    } catch (error) {
      if (state.aborted || error?.name === 'AbortError') throw error;
      lastError = error;
      appendLog(`[${label}] ${error?.message || error}`);
    }
  }

  const suffix = /HTTP 403/.test(String(lastError?.message || ''))
    ? '。该编码的 CDN 拒绝了请求，请回到视频页切换为 H.264 或 AV1 后重试。'
    : '';
  throw new Error(`${label}下载失败${lastError?.message ? `：${lastError.message}` : ''}${suffix}`);
}

async function ensureFFmpeg() {
  if (state.ffmpeg?.loaded) return state.ffmpeg;
  if (!window.FFmpegWASM?.FFmpeg) {
    throw new Error('合并引擎没有加载成功，请重新打开此页面或直接分别下载视频/音频。');
  }

  setIndeterminate('正在加载合并引擎…', '首次使用需要初始化约 32 MB 的本地引擎，不会上传文件。');
  const ffmpeg = new window.FFmpegWASM.FFmpeg();
  state.ffmpeg = ffmpeg;
  ffmpeg.on('log', ({ message }) => appendLog(message));
  ffmpeg.on('progress', ({ progress }) => {
    if (state.finished) return;
    const value = Number(progress);
    if (!Number.isFinite(value)) return;
    const mapped = 76 + Math.max(0, Math.min(1, value)) * 16;
    setProgress(mapped, '正在合并音视频轨道…');
  });

  await ffmpeg.load({
    coreURL: chrome.runtime.getURL('src/vendor/ffmpeg/ffmpeg-core.js'),
    wasmURL: chrome.runtime.getURL('src/vendor/ffmpeg/ffmpeg-core.wasm'),
  });
  return ffmpeg;
}

function buildMuxArgs(task) {
  const args = ['-hide_banner', '-y', '-i', 'video.m4s'];
  if (task.audio) args.push('-i', 'audio.m4s');
  args.push('-map', '0:v:0');
  if (task.audio) args.push('-map', '1:a:0');
  args.push('-c', 'copy');
  if (task.codec === 'hevc') args.push('-tag:v', 'hvc1');
  args.push('-movflags', '+faststart', '-metadata', `title=${task.title}`, 'output.mp4');
  return args;
}

function hasMoovAtom(data) {
  const scan = (start, end) => {
    for (let i = start; i + 3 < end; i += 1) {
      if (data[i] === 0x6d && data[i + 1] === 0x6f && data[i + 2] === 0x6f && data[i + 3] === 0x76) {
        return true;
      }
    }
    return false;
  };
  const windowSize = 2 * 1024 * 1024;
  return scan(0, Math.min(data.byteLength, windowSize))
    || scan(Math.max(0, data.byteLength - windowSize), data.byteLength);
}

async function saveBlob(data, filename, mime = 'video/mp4') {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    state.lastDownloadIds.push(id);
    if (!state.savedFilenames.includes(filename)) state.savedFilenames.push(filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
    return id;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`保存文件失败：${error?.message || '浏览器拒绝下载'}`);
  }
}

function waitForDownload(id, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let settled = false;
    let interval = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (interval) window.clearInterval(interval);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const check = () => {
      chrome.downloads.search({ id }, (items) => {
        const item = items?.[0];
        if (!item) return;
        if (item.state === 'complete') finish('complete');
        if (item.state === 'interrupted') finish('interrupted');
      });
    };
    const onChanged = (delta) => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish('complete');
      if (delta.state?.current === 'interrupted') finish('interrupted');
    };
    chrome.downloads.onChanged.addListener(onChanged);
    interval = window.setInterval(check, 700);
    window.setTimeout(() => finish('timeout'), timeoutMs);
    check();
  });
}

async function run() {
  if (!state.task) return;
  if (state.task.mode === 'audio') return runAudio();
  if (state.task.mode === 'separate') return runSeparate();
  return runMerge();
}

async function runAudio() {
  const task = state.task;
  const ensureActive = () => {
    if (state.aborted) throw new DOMException('已取消', 'AbortError');
  };

  activateStep(1);
  setStage('正在下载音频…');
  setProgress(1, '正在连接 B 站 CDN…');
  const audioData = await fetchMedia(task.audio, '音频轨', (received, total) => {
    const ratio = total ? received / total : 0;
    const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
    setProgress(2 + ratio * 76, `音频轨：${size}`);
  });
  ensureActive();
  completeStep(1);
  markStep(2, 'skipped');

  activateStep(3);
  setProgress(82, '正在准备保存音频…');
  completeStep(3);
  activateStep(4);
  setStage('正在保存文件…');
  setProgress(88, `${formatBytes(audioData.byteLength)}，正在交给浏览器下载…`);
  const downloadId = await saveBlob(audioData, task.filename, 'audio/mp4');
  ensureActive();

  setProgress(96, '正在写入浏览器下载目录…');
  const result = await waitForDownload(downloadId);
  if (state.aborted) return;
  if (result === 'interrupted') throw new Error('浏览器下载被中断，可能是磁盘空间不足或下载被阻止。');
  if (result === 'complete') completeStep(4);
  showSuccess(result === 'complete' ? 'complete' : 'timeout');
}

async function runSeparate() {
  const task = state.task;
  const ensureActive = () => {
    if (state.aborted) throw new DOMException('已取消', 'AbortError');
  };

  activateStep(1);
  setStage('正在下载视频轨…');
  setProgress(1, '正在连接 B 站 CDN…');
  const videoData = await fetchMedia(task.video, '视频轨', (received, total) => {
    const ratio = total ? received / total : 0;
    const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
    setProgress(2 + ratio * 46, `视频轨：${size}`);
  });
  ensureActive();
  completeStep(1);

  let audioData = null;
  if (task.audio) {
    activateStep(2);
    audioData = await fetchMedia(task.audio, '音频轨', (received, total) => {
      const ratio = total ? received / total : 0;
      const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
      setProgress(49 + ratio * 34, `音频轨：${size}`);
    });
    ensureActive();
    completeStep(2);
  } else {
    markStep(2, 'skipped');
  }

  activateStep(3);
  setProgress(85, '正在准备保存文件…');
  const videoFilename = task.filenames?.[0] || `${task.filename.replace(/\.mp4$/i, '')}_视频.mp4`;
  const audioFilename = task.filenames?.[1] || `${task.filename.replace(/\.mp4$/i, '')}_音频.m4a`;
  await saveBlob(videoData, videoFilename, 'video/mp4');
  ensureActive();
  setProgress(90, '视频轨已交给浏览器，正在保存音频轨…');
  if (audioData) {
    await saveBlob(audioData, audioFilename, 'audio/mp4');
    ensureActive();
  }
  completeStep(3);

  activateStep(4);
  setStage('正在保存文件…');
  setProgress(96, '正在写入浏览器下载目录…');
  const results = await Promise.all(state.lastDownloadIds.map((id) => waitForDownload(id)));
  if (state.aborted) return;
  if (results.includes('interrupted')) {
    throw new Error('有文件在保存时被中断，可能是磁盘空间不足或下载被阻止。');
  }
  if (results.every((result) => result === 'complete')) completeStep(4);
  showSuccess(results.every((result) => result === 'complete') ? 'complete' : 'timeout');
}

async function runMerge() {
  if (!state.task) return;
  const task = state.task;
  const hasAudio = Boolean(task.audio);
  const ensureActive = () => {
    if (state.aborted) throw new DOMException('已取消', 'AbortError');
  };

  activateStep(1);
  setStage('开始下载');
  setProgress(1, '正在连接 B 站 CDN…');

  let videoData = await fetchMedia(task.video, '视频轨', (received, total) => {
    const ratio = total ? received / total : 0;
    const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
    setProgress(2 + ratio * 54, `视频轨：${size}`);
  });
  ensureActive();
  completeStep(1);

  let audioData = null;
  if (hasAudio) {
    activateStep(2);
    audioData = await fetchMedia(task.audio, '音频轨', (received, total) => {
      const ratio = total ? received / total : 0;
      const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
      setProgress(57 + ratio * 13, `音频轨：${size}`);
    });
    ensureActive();
    completeStep(2);
  } else {
    markStep(2, 'skipped');
  }

  activateStep(3);
  const ffmpeg = await ensureFFmpeg();
  ensureActive();
  setProgress(72, '正在准备临时文件…');

  await ffmpeg.writeFile('video.m4s', videoData);
  videoData = null;
  if (audioData) {
    await ffmpeg.writeFile('audio.m4s', audioData);
    audioData = null;
  }
  ensureActive();

  setStage('正在合并音视频…');
  setProgress(75, '正在封装 MP4，不会重新编码，请稍候…');
  const args = buildMuxArgs(task);
  appendLog(`ffmpeg ${args.join(' ')}`);
  await ffmpeg.exec(args);
  ensureActive();

  setProgress(93, '正在读取合并结果…');
  const output = await ffmpeg.readFile('output.mp4');
  ensureActive();
  if (!output || output.byteLength < 1024 || !hasMoovAtom(output)) {
    throw new Error('合并没有完整结束，输出文件缺少 MP4 索引。请重试，或改用分别下载。');
  }

  activateStep(4);
  setStage('正在保存文件…');
  setProgress(96, `${formatBytes(output.byteLength)}，正在交给浏览器下载…`);
  const downloadId = await saveBlob(output, task.filename, 'video/mp4');

  try {
    ffmpeg.terminate();
  } catch { /* noop */ }
  state.ffmpeg = null;
  ensureActive();

  setProgress(99, '正在写入浏览器下载目录…');
  const result = await waitForDownload(downloadId);
  if (state.aborted) return;
  if (result === 'interrupted') {
    throw new Error('浏览器下载被中断，可能是磁盘空间不足或下载被阻止。');
  }
  if (result === 'complete') {
    completeStep(4);
    showSuccess('complete');
  } else {
    showSuccess('timeout');
  }
}

async function downloadSeparate() {
  if (!state.task?.video?.url) return;
  ui.separateButton.disabled = true;
  ui.separateButton.textContent = '正在开始…';
  try {
    const base = state.task.filename.replace(/\.mp4$/i, '');
    const ids = [];
    ids.push(await chrome.downloads.download({
      url: state.task.video.url,
      filename: `${base}_视频.mp4`,
      conflictAction: 'uniquify',
      saveAs: false,
    }));
    if (state.task.audio?.url) {
      ids.push(await chrome.downloads.download({
        url: state.task.audio.url,
        filename: `${base}_音频.m4a`,
        conflictAction: 'uniquify',
        saveAs: false,
      }));
    }
    state.lastDownloadIds = ids;
    ui.errorBox.hidden = false;
    ui.errorTitle.textContent = '已改为分别下载';
    ui.errorText.textContent = '视频轨和音频轨会保存为两个文件。可用剪辑软件或本地 ffmpeg 合并：\nffmpeg -i 视频.mp4 -i 音频.m4a -c copy 输出.mp4';
    ui.separateButton.hidden = true;
    ui.showFolderButton.hidden = false;
  } catch (error) {
    ui.errorText.textContent = `分别下载也失败了：${error?.message || '未知错误'}`;
    ui.separateButton.disabled = false;
    ui.separateButton.textContent = '分别下载视频 / 音频';
  }
}

async function cancel() {
  if (state.finished) return;
  state.aborted = true;
  state.controller.abort();
  if (state.ffmpeg) {
    try { state.ffmpeg.terminate(); } catch { /* noop */ }
    state.ffmpeg = null;
  }
  showCancelled();
}

async function closePage() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) chrome.tabs.remove(tab.id);
}

async function init() {
  ui.cancelButton.addEventListener('click', cancel);
  ui.retryButton.addEventListener('click', () => window.location.reload());
  ui.separateButton.addEventListener('click', downloadSeparate);
  ui.showFolderButton.addEventListener('click', () => {
    if (state.lastDownloadIds.length) chrome.downloads.show(state.lastDownloadIds[0]);
  });
  ui.closeButton.addEventListener('click', closePage);

  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) {
    showError({ message: '下载任务不存在，请回到 B 站视频页重新点击下载。' });
    return;
  }

  const task = await getTask(id);
  if (!task) {
    showError({ message: '下载任务已过期或不存在，请回到 B 站视频页重新发起下载。' });
    return;
  }

  if (Date.now() - task.createdAt > 2 * 60 * 60 * 1000) {
    showError({ message: '这个下载任务已经过期，请回到 B 站视频页重新发起下载。' });
    return;
  }

  state.task = task;
  renderTask(task);

  run().catch((error) => {
    if (state.aborted) {
      if (!state.finished) showCancelled();
      return;
    }
    console.error(error);
    appendLog(`[错误] ${error?.message || error}`);
    showError(error);
  });
}

window.addEventListener('beforeunload', () => {
  if (!state.finished) {
    state.aborted = true;
    state.controller.abort();
    if (state.ffmpeg) {
      try { state.ffmpeg.terminate(); } catch { /* noop */ }
    }
  }
});

init();
