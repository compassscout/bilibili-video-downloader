import { md5 } from '../shared/md5.js';

const API_BASE = 'https://api.bilibili.com';
const VIDEO_PAGE_REFERER = 'https://www.bilibili.com/';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const QUALITY_LABELS = {
  127: '8K 超高清',
  126: '杜比视界',
  125: 'HDR 真彩',
  120: '4K 超清',
  116: '1080P 60帧',
  112: '1080P 高码率',
  80: '1080P 高清',
  74: '720P 60帧',
  64: '720P 准高清',
  32: '480P 标清',
  16: '360P 流畅',
  6: '240P 极速',
};

const API_ERROR_MESSAGES = {
  '-101': '请先登录 B 站账号后再试。',
  '-102': '账号状态异常，请重新登录 B 站。',
  '-352': 'B 站风控校验未通过，请刷新视频页并确认已登录后重试。',
  '-400': '请求参数有误，请刷新页面后重试。',
  '-403': '没有权限访问该视频。',
  '-404': '视频不存在、已删除，或当前账号无权观看。',
  '-412': '请求被 B 站拦截，请稍后再试。',
  '-509': '请求过于频繁，请稍后再试。',
  '-10403': '当前账号无权观看该视频，可能需要大会员或 UP 主授权。',
};

export class BiliError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'BiliError';
    this.code = code;
    this.detail = detail;
  }
}

function apiErrorFromResponse(json, fallbackMessage) {
  const code = String(json?.code ?? 'UNKNOWN');
  const message = API_ERROR_MESSAGES[code] || fallbackMessage || 'B 站接口返回错误，请稍后重试。';
  return new BiliError(code, message, json?.message || '');
}

function cleanUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url.replace(/^http:\/\//, 'https://');
}

async function getJson(path, params = {}) {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    throw new BiliError(
      'NETWORK',
      '无法连接 B 站服务器，请检查网络后重试。',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    throw new BiliError('HTTP', `B 站服务器返回 HTTP ${response.status}，请稍后重试。`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new BiliError('BAD_RESPONSE', 'B 站返回的数据无法解析，请稍后重试。');
  }
}

let wbiCache = null;

function getMixinKey(imgKey, subKey) {
  const raw = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((index) => raw[index] || '').join('').slice(0, 32);
}

async function getWbiMixinKey() {
  const now = Date.now();
  if (wbiCache && wbiCache.expiresAt > now) return wbiCache.key;

  const json = await getJson('/x/web-interface/nav');
  const imgUrl = json?.data?.wbi_img?.img_url;
  const subUrl = json?.data?.wbi_img?.sub_url;
  if (!imgUrl || !subUrl) {
    throw new BiliError('WBI', '无法获取 B 站请求签名，请刷新页面后重试。', json?.message || '');
  }

  const imgKey = String(imgUrl).split('/').pop().split('.')[0];
  const subKey = String(subUrl).split('/').pop().split('.')[0];
  const key = getMixinKey(imgKey, subKey);
  if (key.length !== 32) {
    throw new BiliError('WBI', 'B 站请求签名生成失败，请刷新页面后重试。');
  }

  wbiCache = { key, expiresAt: now + 30 * 60 * 1000 };
  return key;
}

function signedQuery(params, mixinKey) {
  const allParams = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = Object.keys(allParams)
    .filter((key) => allParams[key] !== undefined && allParams[key] !== null)
    .sort()
    .map((key) => {
      const value = String(allParams[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');

  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

async function getWbiPlayInfo({ bvid, aid, cid, qn, fnval = 4048, fourk = 1 }) {
  const mixinKey = await getWbiMixinKey();
  const params = {
    cid,
    fnval,
    fnver: 0,
    fourk,
    qn,
    ...(bvid ? { bvid } : { avid: aid }),
  };
  const query = signedQuery(params, mixinKey);
  const url = `${API_BASE}/x/player/wbi/playurl?${query}`;

  let response;
  try {
    response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Referer: VIDEO_PAGE_REFERER,
      },
    });
  } catch (error) {
    throw new BiliError(
      'NETWORK',
      '无法连接 B 站播放接口，请检查网络后重试。',
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!response.ok) {
    throw new BiliError('HTTP', `B 站播放接口返回 HTTP ${response.status}，请稍后重试。`);
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new BiliError('BAD_RESPONSE', 'B 站播放接口返回的数据无法解析。');
  }

  if (json?.code !== 0) {
    throw apiErrorFromResponse(json, '无法获取视频播放地址。');
  }
  return json.data || {};
}

export async function fetchVideoInfo({ bvid, aid }) {
  if (!bvid && !aid) {
    throw new BiliError('INVALID_URL', '没有识别到 BV 号或 av 号。');
  }

  const json = await getJson('/x/web-interface/view', bvid ? { bvid } : { aid });
  if (json?.code !== 0) {
    throw apiErrorFromResponse(json, '无法获取视频信息。');
  }

  const data = json.data;
  if (!data?.pages?.length) {
    throw new BiliError('NO_PAGES', '这个视频没有可下载的分 P 信息。');
  }

  return {
    bvid: data.bvid,
    aid: data.aid,
    title: data.title || '未命名视频',
    cover: cleanUrl(data.pic),
    owner: data.owner?.name || '',
    duration: Number(data.duration) || 0,
    pages: data.pages.map((page) => ({
      page: Number(page.page) || 1,
      cid: page.cid,
      part: page.part || `P${page.page}`,
      duration: Number(page.duration) || Number(data.duration) || 0,
      width: Number(page.dimension?.width) || 0,
      height: Number(page.dimension?.height) || 0,
    })),
  };
}

export async function fetchPlayInfo({ bvid, aid, cid, qn = 127 }) {
  if (!cid) throw new BiliError('INVALID_CID', '缺少视频 CID，请刷新页面后重试。');
  const data = await getWbiPlayInfo({ bvid, aid, cid, qn });

  if (!data?.dash?.video?.length && !data?.durl?.length) {
    throw new BiliError(
      'NO_STREAM',
      '没有获取到可下载的视频流。该视频可能需要登录、大会员，或受版权/付费限制。',
      '扩展只使用普通网页播放接口，不绕过会员、付费或 DRM 限制。',
    );
  }
  return data;
}

function qualityLabel(qn, height) {
  return QUALITY_LABELS[qn] || (height ? `${height}P` : `画质 ${qn}`);
}

export function describeQualities(playInfo) {
  const videos = playInfo?.dash?.video || [];
  const byQuality = new Map();

  for (const video of videos) {
    const qn = Number(video.id);
    const height = Number(video.height) || 0;
    const width = Number(video.width) || 0;
    const fps = Number.parseFloat(video.frameRate || video.frame_rate || 0) || 0;
    const current = byQuality.get(qn);
    const next = {
      qn,
      label: qualityLabel(qn, height),
      width,
      height,
      fps,
      codecs: new Set(current?.codecs || []),
      bandwidth: Math.max(current?.bandwidth || 0, Number(video.bandwidth) || 0),
    };
    next.codecs.add(codecFamily(video.codecs));
    byQuality.set(qn, next);
  }

  if (!byQuality.size && playInfo?.accept_quality?.length) {
    const heights = playInfo.accept_quality;
    for (const rawQn of heights) {
      const qn = Number(rawQn);
      byQuality.set(qn, {
        qn,
        label: qualityLabel(qn, 0),
        width: 0,
        height: 0,
        fps: 0,
        codecs: new Set(['combined']),
        bandwidth: 0,
      });
    }
  }

  return [...byQuality.values()]
    .map((quality) => ({ ...quality, codecs: [...quality.codecs].filter(Boolean) }))
    .sort((a, b) => b.qn - a.qn);
}

export function codecFamily(codecs = '') {
  const value = String(codecs).toLowerCase();
  if (value.startsWith('avc') || value.includes('avc1')) return 'avc';
  if (value.startsWith('hev') || value.startsWith('hvc') || value.includes('hev1') || value.includes('hvc1')) {
    return 'hevc';
  }
  if (value.startsWith('av01') || value.includes('av01')) return 'av1';
  return 'other';
}

export function codecLabel(codec) {
  return { avc: 'H.264 / AVC', hevc: 'H.265 / HEVC', av1: 'AV1', other: '未知编码' }[codec] || codec;
}

function streamFromDash(track) {
  if (!track) return null;
  const url = cleanUrl(track.baseUrl || track.base_url);
  if (!url) return null;
  const backups = [...(track.backupUrl || track.backup_url || [])]
    .map(cleanUrl)
    .filter((item) => item && item !== url);
  return {
    url,
    backups: [...new Set(backups)],
    bandwidth: Number(track.bandwidth) || 0,
    mime: track.mimeType || track.mime_type || '',
    codecs: track.codecs || '',
    width: Number(track.width) || 0,
    height: Number(track.height) || 0,
    frameRate: Number.parseFloat(track.frameRate || track.frame_rate || 0) || 0,
  };
}

export function pickVideoStream(playInfo, requestedQn, codecPreference = 'auto') {
  const videos = playInfo?.dash?.video || [];
  if (!videos.length) return null;

  const qualities = [...new Set(videos.map((video) => Number(video.id)))].sort((a, b) => b - a);
  const exact = qualities.includes(Number(requestedQn));
  const targetQn = exact
    ? Number(requestedQn)
    : qualities.filter((qn) => qn <= Number(requestedQn)).sort((a, b) => b - a)[0] || qualities[0];

  const candidates = videos.filter((video) => Number(video.id) === targetQn);
  const preference = codecPreference === 'auto'
    ? ['avc', 'hevc', 'av1', 'other']
    : [codecPreference, 'avc', 'hevc', 'av1', 'other'];

  const rank = (track) => {
    const family = codecFamily(track.codecs);
    const codecRank = preference.indexOf(family);
    return [codecRank === -1 ? 99 : codecRank, -(Number(track.bandwidth) || 0)];
  };

  candidates.sort((a, b) => {
    const [aRank, aBandwidth] = rank(a);
    const [bRank, bBandwidth] = rank(b);
    return aRank - bRank || aBandwidth - bBandwidth;
  });

  return streamFromDash(candidates[0]);
}

export function pickAudioStream(playInfo) {
  const audios = playInfo?.dash?.audio || [];
  if (!audios.length) return null;
  const sorted = [...audios].sort((a, b) => (Number(b.bandwidth) || 0) - (Number(a.bandwidth) || 0));
  return streamFromDash(sorted[0]);
}

export function pickPage(videoInfo, pageNumber) {
  const requested = Number(pageNumber) || 1;
  return videoInfo.pages.find((page) => page.page === requested) || videoInfo.pages[0];
}

export function streamSize(stream, durationSeconds) {
  if (!stream?.bandwidth || !durationSeconds) return 0;
  return Math.round((stream.bandwidth * durationSeconds) / 8);
}
