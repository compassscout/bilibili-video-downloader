import {
  BiliError,
  codecFamily,
  describeQualities,
  fetchPlayInfo,
  fetchVideoInfo,
  pickAudioStream,
  pickPage,
  pickVideoStream,
  streamSize,
} from './bilibili.js';

const DOWNLOADER_PAGE = 'src/downloader/downloader.html';
const TASK_PREFIX = 'biliTask:';
const TASK_TTL_MS = 2 * 60 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  if (sender.id !== chrome.runtime.id) return false;

  const handlers = {
    BILI_GET_VIDEO: handleGetVideo,
    BILI_PREPARE_DOWNLOAD: handlePrepareDownload,
  };

  const handler = handlers[message.type];
  if (!handler) return false;

  handler(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error('[B站下载器]', error);
      sendResponse({ ok: false, error: serializeError(error) });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  cleanupOldTasks().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  cleanupOldTasks().catch(() => {});
});

cleanupOldTasks().catch(() => {});

function serializeError(error) {
  if (error instanceof BiliError) {
    return { code: error.code, message: error.message, detail: error.detail || '' };
  }
  return {
    code: 'UNKNOWN',
    message: error?.message || '操作失败，请稍后重试。',
    detail: '',
  };
}

function cleanText(value, fallback = '') {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

function truncateUtf8(value, maxBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;
  let output = '';
  for (const char of value) {
    if (encoder.encode(output + char).length > maxBytes) break;
    output += char;
  }
  return output;
}

function sanitizeFilename(value, fallback = 'bilibili-video') {
  const cleaned = cleanText(value, fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120)
    .trim();
  return truncateUtf8(cleaned, 180).trim() || fallback;
}

function buildBaseName(info, page) {
  const part = info.pages.length > 1 ? ` P${page.page}` : '';
  return sanitizeFilename(`${info.title}${part} [${info.bvid}]`);
}

function normalizeCodecPreference(value) {
  return ['auto', 'avc', 'hevc', 'av1'].includes(value) ? value : 'auto';
}

async function handleGetVideo(message) {
  const info = await fetchVideoInfo({ bvid: message.bvid, aid: message.aid });
  const page = pickPage(info, message.p);

  let qualities = [];
  let warning = '';
  try {
    const playInfo = await fetchPlayInfo({
      bvid: info.bvid,
      aid: info.aid,
      cid: page.cid,
      qn: 127,
    });
    qualities = describeQualities(playInfo);
  } catch (error) {
    if (error instanceof BiliError) {
      warning = error.message;
      if (error.detail) warning += ` ${error.detail}`;
    } else {
      warning = '暂时无法解析清晰度，请稍后重试。';
    }
  }

  return {
    video: {
      bvid: info.bvid,
      aid: info.aid,
      title: info.title,
      cover: info.cover,
      owner: info.owner,
      duration: info.duration,
      pages: info.pages,
      page,
    },
    qualities,
    warning,
  };
}

async function resolveStreams({ bvid, aid, p, qn, codec }) {
  const info = await fetchVideoInfo({ bvid, aid });
  const page = pickPage(info, p);
  const playInfo = await fetchPlayInfo({
    bvid: info.bvid,
    aid: info.aid,
    cid: page.cid,
    qn,
  });

  const video = pickVideoStream(playInfo, qn, normalizeCodecPreference(codec));
  const audio = pickAudioStream(playInfo);
  const quality = describeQualities(playInfo).find((item) => item.qn === Number(video?.id)) || null;

  return { info, page, playInfo, video, audio, quality };
}

async function handlePrepareDownload(message) {
  const mode = ['merge', 'separate', 'audio'].includes(message.mode) ? message.mode : 'merge';
  const { info, page, video, audio, quality } = await resolveStreams({
    bvid: message.bvid,
    aid: message.aid,
    p: message.p,
    qn: Number(message.qn) || 127,
    codec: message.codec,
  });

  if (mode === 'audio' && !audio) {
    throw new BiliError('NO_AUDIO', '这个视频没有独立音频流，无法只下载音频。');
  }
  if (mode !== 'audio' && !video) {
    throw new BiliError('NO_VIDEO', '没有找到可下载的视频流，请尝试切换清晰度或登录后重试。');
  }

  const qualityHeight = video?.height || quality?.height || 0;
  const qualityLabel = quality?.label || (qualityHeight ? `${qualityHeight}P` : '');
  const base = buildBaseName(info, page);
  const duration = page.duration || info.duration;

  const baseTask = {
    createdAt: Date.now(),
    title: info.title,
    bvid: info.bvid,
    page: page.page,
    duration,
    qualityLabel,
    codec: codecFamily(video?.codecs),
  };

  if (mode === 'audio') {
    const filename = `${base} 音频.m4a`;
    const task = {
      ...baseTask,
      id: crypto.randomUUID(),
      mode: 'audio',
      filename,
      video: null,
      audio: {
        ...audio,
        estimatedSize: streamSize(audio, duration),
      },
    };
    await createTaskAndOpen(task);
    return { mode, taskId: task.id, filename };
  }

  if (mode === 'separate') {
    const videoFilename = `${base}${qualityHeight ? ` ${qualityHeight}P` : ''}_视频.mp4`;
    const audioFilename = `${base}_音频.m4a`;
    const filenames = audio ? [videoFilename, audioFilename] : [videoFilename];
    const task = {
      ...baseTask,
      id: crypto.randomUUID(),
      mode: 'separate',
      filename: videoFilename,
      filenames,
      video: {
        ...video,
        estimatedSize: streamSize(video, duration),
      },
      audio: audio
        ? {
            ...audio,
            estimatedSize: streamSize(audio, duration),
          }
        : null,
    };
    await createTaskAndOpen(task);
    return { mode, taskId: task.id, filenames };
  }

  const filename = `${base}${qualityHeight ? ` ${qualityHeight}P` : ''}.mp4`;
  const task = {
    ...baseTask,
    id: crypto.randomUUID(),
    mode: 'merge',
    filename,
    video: {
      ...video,
      estimatedSize: streamSize(video, duration),
    },
    audio: audio
      ? {
          ...audio,
          estimatedSize: streamSize(audio, duration),
        }
      : null,
  };

  await createTaskAndOpen(task);
  return { mode: 'merge', taskId: task.id, filename };
}

async function createTaskAndOpen(task) {
  await chrome.storage.session.set({ [`${TASK_PREFIX}${task.id}`]: task });
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`${DOWNLOADER_PAGE}?id=${encodeURIComponent(task.id)}`),
      active: true,
    });
  } catch {
    await chrome.storage.session.remove(`${TASK_PREFIX}${task.id}`);
    throw new BiliError('TAB', '无法打开下载页，请检查浏览器是否阻止了新标签页。');
  }
}

async function cleanupOldTasks() {
  const all = await chrome.storage.session.get(null);
  const expiredKeys = Object.entries(all)
    .filter(([key, value]) => key.startsWith(TASK_PREFIX) && value?.createdAt && Date.now() - value.createdAt > TASK_TTL_MS)
    .map(([key]) => key);
  if (expiredKeys.length) await chrome.storage.session.remove(expiredKeys);
}
