(() => {
  'use strict';

  if (window.__biliVideoDownloaderLoaded) return;
  window.__biliVideoDownloaderLoaded = true;

  const ROOT_ID = 'bili-video-downloader-root';
  const QUALITY_FALLBACK = '清晰度由 B 站账号权限决定';

  const state = {
    ref: null,
    data: null,
    qualities: [],
    warning: '',
    page: 1,
    qn: null,
    codec: 'auto',
    merge: true,
    loading: false,
    busy: false,
    panelOpen: false,
    error: null,
    success: null,
  };

  let host = null;
  let shadow = null;
  let bodyEl = null;
  let panelEl = null;
  let fabEl = null;
  let lastPageKey = '';
  let loadToken = 0;
  let pollTimer = null;

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));

  function parseVideoPage() {
    let url;
    try {
      url = new URL(window.location.href);
    } catch {
      return null;
    }
    if (!/(^|\.)bilibili\.com$/i.test(url.hostname)) return null;

    const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av(\d+))\/?/i);
    if (!match) return null;

    const bvid = match[1].startsWith('BV') ? match[1] : '';
    const aid = match[2] ? Number(match[2]) : undefined;
    if (!bvid && !aid) return null;

    return { bvid, aid, p: Math.max(1, Number(url.searchParams.get('p')) || 1) };
  }

  function pageKey(ref) {
    return ref ? `${ref.bvid || `av${ref.aid}`}:${ref.p}` : '';
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = Math.floor(total % 60);
    if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function formatQuality(quality) {
    if (!quality) return '';
    const dimensions = quality.width && quality.height ? `${quality.width}×${quality.height}` : '';
    const fps = quality.fps > 30 ? `${Math.round(quality.fps)}fps` : '';
    return [quality.label, dimensions, fps].filter(Boolean).join(' · ');
  }

  function getDomTitle() {
    const node = document.querySelector('h1.video-title, .video-title, h1[title]');
    const meta = document.querySelector('meta[property="og:title"]');
    const title = node?.textContent || meta?.getAttribute('content') || document.title;
    return title.replace(/\s*[-_]\s*哔哩哔哩.*$/i, '').trim();
  }

  function getDomOwner() {
    const node = document.querySelector('.up-name, .up-info--name, a.up-name');
    return node?.textContent?.trim() || '';
  }

  function storageGet(defaults) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(defaults, (value) => resolve({ ...defaults, ...value }));
      } catch {
        resolve(defaults);
      }
    });
  }

  function storageSet(value) {
    try {
      chrome.storage.local.set(value);
    } catch {
      // The extension may have been reloaded; settings persistence is best-effort.
    }
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function mount() {
    if (host) return;
    host = document.createElement('div');
    host.id = ROOT_ID;
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${styles()}</style>
      <button class="bdw-fab" id="bdwFab" type="button" title="下载此视频" aria-label="下载此视频">
        <span class="bdw-fab-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path>
          </svg>
        </span>
        <span class="bdw-fab-text">下载</span>
      </button>
      <section class="bdw-panel" id="bdwPanel" aria-label="B 站视频下载" hidden>
        <header class="bdw-head">
          <div class="bdw-brand">
            <span class="bdw-logo" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="24" height="24" fill="none">
                <rect x="2" y="6" width="28" height="20" rx="6" fill="currentColor"/>
                <path d="m12 12 8 4-8 4v-8Z" fill="white"/>
                <path d="m9 3 3 3M23 3l-3 3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
              </svg>
            </span>
            <span class="bdw-brand-copy">
              <strong>B站视频下载</strong>
              <small>保存到本地 · 自动合并</small>
            </span>
          </div>
          <button class="bdw-close" id="bdwClose" type="button" aria-label="关闭">×</button>
        </header>
        <div class="bdw-body" id="bdwBody"></div>
        <footer class="bdw-foot">仅用于个人学习与备份 · 请尊重 UP 主版权</footer>
      </section>
    `;

    bodyEl = shadow.getElementById('bdwBody');
    panelEl = shadow.getElementById('bdwPanel');
    fabEl = shadow.getElementById('bdwFab');

    fabEl.addEventListener('click', () => togglePanel());
    shadow.getElementById('bdwClose').addEventListener('click', () => closePanel());

    document.documentElement.appendChild(host);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.panelOpen) closePanel();
    });

    renderIdle();
  }

  function styles() {
    return `
      :host {
        all: initial;
        position: fixed;
        right: 24px;
        bottom: 104px;
        z-index: 2147483647;
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: #18191c;
      }
      *, *::before, *::after { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, select, input { font: inherit; }
      button { cursor: pointer; }

      .bdw-fab {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 10px 15px 10px 12px;
        border: 0;
        border-radius: 999px;
        color: #fff;
        background: linear-gradient(135deg, #fb7299 0%, #ff8fb1 100%);
        box-shadow: 0 8px 24px rgba(251, 114, 153, .34), 0 2px 6px rgba(0, 0, 0, .12);
        transition: transform .18s ease, box-shadow .18s ease;
        user-select: none;
      }
      .bdw-fab:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(251, 114, 153, .4), 0 3px 8px rgba(0, 0, 0, .14); }
      .bdw-fab:active { transform: translateY(0); }
      .bdw-fab-icon { display: flex; }
      .bdw-fab-text { font-size: 14px; font-weight: 700; letter-spacing: .5px; }

      .bdw-panel {
        position: absolute;
        right: 0;
        bottom: 54px;
        width: 388px;
        max-width: calc(100vw - 28px);
        max-height: min(720px, calc(100vh - 130px));
        overflow: auto;
        border: 1px solid rgba(24, 25, 28, .08);
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 24px 70px rgba(15, 23, 42, .2), 0 6px 20px rgba(15, 23, 42, .1);
        animation: bdw-in .2s ease-out;
        overscroll-behavior: contain;
      }
      @keyframes bdw-in { from { opacity: 0; transform: translateY(8px) scale(.985); } to { opacity: 1; transform: none; } }
      .bdw-panel::-webkit-scrollbar { width: 8px; }
      .bdw-panel::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 8px; border: 2px solid #fff; }

      .bdw-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 18px 12px;
        background: linear-gradient(180deg, #fff5f8 0%, #fff 100%);
        border-bottom: 1px solid #f4f5f7;
      }
      .bdw-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .bdw-logo { display: flex; color: #fb7299; flex: none; }
      .bdw-brand-copy { display: flex; flex-direction: column; min-width: 0; }
      .bdw-brand-copy strong { font-size: 16px; line-height: 1.3; letter-spacing: .2px; }
      .bdw-brand-copy small { color: #9499a0; font-size: 11px; line-height: 1.4; margin-top: 2px; }
      .bdw-close {
        width: 30px; height: 30px; flex: none;
        border: 0; border-radius: 50%;
        background: rgba(24, 25, 28, .04);
        color: #61666d; font-size: 22px; line-height: 1;
        display: grid; place-items: center;
        transition: background .15s;
      }
      .bdw-close:hover { background: rgba(24, 25, 28, .09); }

      .bdw-body { padding: 16px 18px 6px; }
      .bdw-foot { padding: 10px 18px 14px; color: #a2a7ae; font-size: 10.5px; text-align: center; }

      .bdw-video { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
      .bdw-cover {
        width: 118px; height: 70px; flex: none;
        border-radius: 10px; object-fit: cover;
        background: #f1f2f3;
        border: 1px solid #f1f2f3;
      }
      .bdw-meta { min-width: 0; padding-top: 1px; }
      .bdw-title {
        font-size: 14px; font-weight: 650; line-height: 1.45;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; word-break: break-word;
      }
      .bdw-sub { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; color: #9499a0; font-size: 11px; }
      .bdw-dot { color: #d0d3d8; }

      .bdw-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
      .bdw-field > span { color: #61666d; font-size: 12px; font-weight: 600; }
      .bdw-select {
        width: 100%; height: 38px; padding: 0 34px 0 11px;
        border: 1px solid #e3e5e7; border-radius: 9px;
        background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%239499a0' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 12px center;
        color: #18191c; font-size: 13px; appearance: none; outline: none;
      }
      .bdw-select:focus { border-color: #fb7299; box-shadow: 0 0 0 3px rgba(251, 114, 153, .12); }
      .bdw-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

      .bdw-toggle {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 11px 12px; margin-bottom: 12px;
        border: 1px solid #f1f2f3; border-radius: 10px; background: #fafbfc;
        cursor: pointer;
      }
      .bdw-toggle input { position: absolute; opacity: 0; pointer-events: none; }
      .bdw-switch {
        position: relative; width: 36px; height: 20px; flex: none; margin-top: 1px;
        border-radius: 99px; background: #d0d3d8; transition: background .18s;
      }
      .bdw-switch::after {
        content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px;
        border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: transform .18s;
      }
      .bdw-toggle input:checked + .bdw-switch { background: #fb7299; }
      .bdw-toggle input:checked + .bdw-switch::after { transform: translateX(16px); }
      .bdw-toggle-copy { min-width: 0; }
      .bdw-toggle-copy strong { display: block; font-size: 12.5px; font-weight: 650; }
      .bdw-toggle-copy small { display: block; margin-top: 2px; color: #9499a0; font-size: 11px; line-height: 1.45; }

      .bdw-note {
        padding: 9px 11px; margin-bottom: 12px;
        border-radius: 8px; background: #fff8e6; color: #8a6116;
        font-size: 11px; line-height: 1.55; border: 1px solid #ffedc2;
      }
      .bdw-note.info { background: #f3f7ff; border-color: #e1ebff; color: #4d6b9e; }
      .bdw-note.error { background: #fff2f4; border-color: #ffd9e0; color: #b4233c; }

      .bdw-actions { display: flex; flex-direction: column; gap: 8px; }
      .bdw-primary {
        width: 100%; min-height: 42px; padding: 10px 12px;
        border: 0; border-radius: 10px; color: #fff;
        background: linear-gradient(135deg, #fb7299 0%, #ff88aa 100%);
        font-size: 13.5px; font-weight: 700; letter-spacing: .3px;
        box-shadow: 0 5px 14px rgba(251, 114, 153, .25);
        transition: opacity .15s, transform .15s;
      }
      .bdw-primary:hover:not(:disabled) { transform: translateY(-1px); }
      .bdw-primary:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
      .bdw-secondary {
        width: 100%; height: 36px; border: 1px solid #e3e5e7; border-radius: 9px;
        background: #fff; color: #61666d; font-size: 12.5px; font-weight: 600;
      }
      .bdw-secondary:hover:not(:disabled) { border-color: #fb7299; color: #fb7299; }
      .bdw-secondary:disabled { opacity: .55; cursor: not-allowed; }
      .bdw-link {
        align-self: center; border: 0; background: transparent; color: #9499a0;
        font-size: 11.5px; padding: 5px 8px; text-decoration: underline; text-underline-offset: 3px;
      }
      .bdw-link:hover:not(:disabled) { color: #fb7299; }
      .bdw-link:disabled { opacity: .45; cursor: not-allowed; }

      .bdw-spinner {
        width: 15px; height: 15px; display: inline-block; vertical-align: -2px;
        border: 2px solid rgba(255,255,255,.45); border-top-color: #fff; border-radius: 50%;
        animation: bdw-spin .8s linear infinite; margin-right: 7px;
      }
      @keyframes bdw-spin { to { transform: rotate(360deg); } }

      .bdw-skeleton { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 12px; }
      .bdw-sk-line { height: 14px; border-radius: 6px; background: linear-gradient(90deg, #f1f2f3 25%, #f8f9fa 50%, #f1f2f3 75%); background-size: 400% 100%; animation: bdw-shimmer 1.4s ease infinite; }
      .bdw-sk-cover { height: 86px; border-radius: 10px; background: linear-gradient(90deg, #f1f2f3 25%, #f8f9fa 50%, #f1f2f3 75%); background-size: 400% 100%; animation: bdw-shimmer 1.4s ease infinite; }
      @keyframes bdw-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }

      .bdw-empty { padding: 22px 8px 16px; text-align: center; color: #61666d; }
      .bdw-empty-icon { width: 48px; height: 48px; margin: 0 auto 10px; display: grid; place-items: center; border-radius: 50%; background: #fff0f4; color: #fb7299; font-size: 23px; }
      .bdw-empty strong { display: block; font-size: 14px; color: #18191c; margin-bottom: 5px; }
      .bdw-empty p { margin: 0 0 14px; color: #9499a0; font-size: 12px; line-height: 1.6; }

      .bdw-success { padding: 14px; border-radius: 10px; background: #f2fbf6; border: 1px solid #d7f2e3; margin-bottom: 12px; }
      .bdw-success strong { display: flex; align-items: center; gap: 7px; color: #137a4b; font-size: 13px; }
      .bdw-success p { margin: 5px 0 0; color: #4c7c65; font-size: 11.5px; line-height: 1.5; word-break: break-all; }
      .bdw-success .bdw-check { display: inline-grid; place-items: center; width: 19px; height: 19px; border-radius: 50%; background: #20a464; color: #fff; font-size: 12px; }

      .bdw-loading-inline { color: #9499a0; font-size: 11px; text-align: center; padding: 4px 0 2px; }

      @media (max-width: 520px) {
        :host { right: 14px; bottom: 82px; }
        .bdw-fab { padding: 10px 13px; }
        .bdw-panel { position: fixed; right: 14px; bottom: 138px; width: calc(100vw - 28px); max-height: calc(100vh - 170px); }
      }
    `;
  }

  function renderIdle() {
    if (!bodyEl) return;
    bodyEl.innerHTML = `
      <div class="bdw-empty">
        <div class="bdw-empty-icon">↓</div>
        <strong>准备下载这个视频</strong>
        <p>点击下方按钮解析清晰度。<br>支持多 P、音视频自动合并。</p>
        <button class="bdw-primary" id="bdwStart" type="button">解析视频</button>
      </div>
    `;
    bodyEl.querySelector('#bdwStart')?.addEventListener('click', () => loadVideo());
  }

  function renderLoading() {
    bodyEl.innerHTML = `
      <div class="bdw-skeleton" aria-label="正在解析">
        <div class="bdw-sk-cover"></div>
        <div class="bdw-sk-line" style="width: 88%"></div>
        <div class="bdw-sk-line" style="width: 55%"></div>
        <div class="bdw-sk-line" style="height: 38px; margin-top: 4px"></div>
        <div class="bdw-sk-line" style="height: 38px"></div>
      </div>
      <div class="bdw-loading-inline">正在向 B 站获取视频信息…</div>
    `;
  }

  function renderError(error) {
    state.error = error;
    bodyEl.innerHTML = `
      <div class="bdw-empty">
        <div class="bdw-empty-icon">!</div>
        <strong>暂时无法解析</strong>
        <p>${escapeHtml(error?.message || '请稍后重试。')}</p>
        ${error?.detail ? `<div class="bdw-note error">${escapeHtml(error.detail)}</div>` : ''}
        <button class="bdw-primary" id="bdwRetry" type="button">重新解析</button>
        <button class="bdw-link" id="bdwOpenBili" type="button">在新标签页打开视频</button>
      </div>
    `;
    bodyEl.querySelector('#bdwRetry')?.addEventListener('click', () => loadVideo());
    bodyEl.querySelector('#bdwOpenBili')?.addEventListener('click', () => {
      window.open(window.location.href, '_blank', 'noopener');
    });
  }

  function currentQuality() {
    return state.qualities.find((quality) => Number(quality.qn) === Number(state.qn)) || null;
  }

  function codecOptionsFor(quality) {
    const families = quality?.codecs || [];
    const options = [{ value: 'auto', label: '自动（优先兼容）' }];
    const labels = [
      ['avc', 'H.264 / AVC'],
      ['hevc', 'H.265 / HEVC'],
      ['av1', 'AV1'],
    ];
    for (const [value, label] of labels) {
      if (families.includes(value)) options.push({ value, label });
    }
    return options;
  }

  function updateCodecSelect() {
    const select = bodyEl.querySelector('#bdwCodec');
    if (!select) return;
    const options = codecOptionsFor(currentQuality());
    select.innerHTML = options
      .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
      .join('');
    if (!options.some((option) => option.value === state.codec)) state.codec = 'auto';
    select.value = state.codec;
  }

  function updateActionCopy() {
    const button = bodyEl.querySelector('#bdwDownload');
    const hint = bodyEl.querySelector('#bdwMergeHint');
    if (button) {
      if (state.busy) {
        button.innerHTML = '<span class="bdw-spinner"></span>正在准备…';
      } else {
        button.textContent = state.merge ? '下载并合并 MP4' : '分别下载视频 / 音频';
      }
      button.disabled = state.busy || !state.qualities.length;
    }
    const audioButton = bodyEl.querySelector('#bdwAudio');
    if (audioButton) audioButton.disabled = state.busy || !state.qualities.length;
    if (hint) {
      hint.textContent = state.merge
        ? '首次合并会加载本地引擎，长视频需要更多内存。'
        : '关闭后视频轨和音频轨会保存为两个文件，可用剪辑软件自行合并。';
    }
  }

  function renderVideo(data) {
    const page = data.page;
    const quality = currentQuality();
    const pages = data.pages || [];
    const qualityOptions = state.qualities
      .map((item) => `<option value="${item.qn}">${escapeHtml(formatQuality(item))}</option>`)
      .join('');
    const pageOptions = pages
      .map((item) => `<option value="${item.page}">P${item.page} ${escapeHtml(item.part)}</option>`)
      .join('');
    const warnings = [state.warning].filter(Boolean);
    const codecOptions = codecOptionsFor(quality);

    bodyEl.innerHTML = `
      <div class="bdw-video">
        ${data.cover ? `<img class="bdw-cover" id="bdwCover" src="${escapeHtml(data.cover)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : '<div class="bdw-cover"></div>'}
        <div class="bdw-meta">
          <div class="bdw-title">${escapeHtml(data.title)}</div>
          <div class="bdw-sub">
            ${data.owner ? `<span>${escapeHtml(data.owner)}</span><span class="bdw-dot">·</span>` : ''}
            <span>${escapeHtml(formatDuration(page.duration || data.duration))}</span>
            <span class="bdw-dot">·</span>
            <span>${escapeHtml(data.bvid)}</span>
          </div>
        </div>
      </div>

      ${pages.length > 1 ? `
        <label class="bdw-field">
          <span>选择分 P</span>
          <select class="bdw-select" id="bdwPage">${pageOptions}</select>
        </label>
      ` : ''}

      <div class="bdw-row">
        <label class="bdw-field">
          <span>清晰度</span>
          <select class="bdw-select" id="bdwQuality" ${qualityOptions ? '' : 'disabled'}>
            ${qualityOptions || '<option>暂无可用清晰度</option>'}
          </select>
        </label>
        <label class="bdw-field">
          <span>视频编码</span>
          <select class="bdw-select" id="bdwCodec">
            ${codecOptions.map((option) => `<option value="${option.value}">${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
      </div>

      <label class="bdw-toggle">
        <input type="checkbox" id="bdwMerge" ${state.merge ? 'checked' : ''}>
        <span class="bdw-switch" aria-hidden="true"></span>
        <span class="bdw-toggle-copy">
          <strong>合并为完整 MP4</strong>
          <small id="bdwMergeHint"></small>
        </span>
      </label>

      ${warnings.map((warning) => `<div class="bdw-note">${escapeHtml(warning)}</div>`).join('')}
      ${quality ? `<div class="bdw-note info">当前选择：${escapeHtml(formatQuality(quality))}。${escapeHtml(QUALITY_FALLBACK)}。</div>` : ''}

      <div class="bdw-actions">
        <button class="bdw-primary" id="bdwDownload" type="button">${state.merge ? '下载并合并 MP4' : '分别下载视频 / 音频'}</button>
        <button class="bdw-secondary" id="bdwAudio" type="button">仅下载音频（M4A）</button>
        <button class="bdw-link" id="bdwRefresh" type="button">刷新解析</button>
      </div>
      <div id="bdwInlineStatus"></div>
    `;

    const cover = bodyEl.querySelector('#bdwCover');
    cover?.addEventListener('error', () => { cover.style.display = 'none'; });

    const pageSelect = bodyEl.querySelector('#bdwPage');
    if (pageSelect) {
      pageSelect.value = String(page.page);
      pageSelect.addEventListener('change', () => {
        state.page = Number(pageSelect.value) || 1;
        if (state.ref) state.ref.p = state.page;
        loadVideo();
      });
    }

    const qualitySelect = bodyEl.querySelector('#bdwQuality');
    qualitySelect.value = String(state.qn);
    qualitySelect.addEventListener('change', () => {
      state.qn = Number(qualitySelect.value);
      updateCodecSelect();
      updateActionCopy();
      const note = bodyEl.querySelector('.bdw-note.info');
      if (note) note.textContent = `当前选择：${formatQuality(currentQuality())}。${QUALITY_FALLBACK}。`;
    });

    const codecSelect = bodyEl.querySelector('#bdwCodec');
    codecSelect.value = state.codec;
    codecSelect.addEventListener('change', () => {
      state.codec = codecSelect.value;
      storageSet({ preferredCodec: state.codec });
    });

    const merge = bodyEl.querySelector('#bdwMerge');
    merge.checked = state.merge;
    merge.addEventListener('change', () => {
      state.merge = merge.checked;
      storageSet({ mergeMedia: state.merge });
      updateActionCopy();
    });

    bodyEl.querySelector('#bdwDownload').addEventListener('click', () => {
      startDownload(state.merge ? 'merge' : 'separate');
    });
    bodyEl.querySelector('#bdwAudio').addEventListener('click', () => startDownload('audio'));
    bodyEl.querySelector('#bdwRefresh').addEventListener('click', () => loadVideo());
    updateActionCopy();
  }

  function showInlineError(message, detail = '') {
    const box = bodyEl.querySelector('#bdwInlineStatus');
    if (!box) return;
    box.innerHTML = `<div class="bdw-note error" style="margin-top:12px">${escapeHtml(message)}${detail ? `<br><span style="opacity:.75">${escapeHtml(detail)}</span>` : ''}</div>`;
  }

  function showInlineSuccess(title, message) {
    const box = bodyEl.querySelector('#bdwInlineStatus');
    if (!box) return;
    box.innerHTML = `<div class="bdw-success" style="margin-top:12px"><strong><span class="bdw-check">✓</span>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  }

  async function loadVideo() {
    if (!state.ref) return;
    const token = ++loadToken;
    state.loading = true;
    state.busy = false;
    state.error = null;
    state.success = null;
    renderLoading();

    try {
      const response = await sendMessage({
        type: 'BILI_GET_VIDEO',
        bvid: state.ref.bvid,
        aid: state.ref.aid,
        p: state.page,
      });
      if (token !== loadToken) return;
      if (!response?.ok) {
        state.loading = false;
        renderError(response?.error || { message: '请刷新页面后重试。' });
        return;
      }

      state.data = response.video;
      state.qualities = response.qualities || [];
      state.warning = response.warning || '';
      state.page = response.video.page?.page || state.page;
      if (!state.qualities.some((quality) => Number(quality.qn) === Number(state.qn))) {
        state.qn = state.qualities[0]?.qn ?? null;
      }
      const selectedQuality = currentQuality();
      if (!codecOptionsFor(selectedQuality).some((option) => option.value === state.codec)) {
        state.codec = 'auto';
      }
      state.loading = false;
      renderVideo(response.video);
    } catch (error) {
      if (token !== loadToken) return;
      state.loading = false;
      renderError({
        message: error?.message || '扩展通信失败，请刷新页面后重试。',
        detail: '如果刚刚更新过扩展，请刷新 B 站页面。',
      });
    }
  }

  async function startDownload(mode) {
    if (state.busy || !state.qualities.length) return;
    state.busy = true;
    state.error = null;
    updateActionCopy();
    const status = bodyEl.querySelector('#bdwInlineStatus');
    if (status) status.innerHTML = '';

    try {
      const response = await sendMessage({
        type: 'BILI_PREPARE_DOWNLOAD',
        bvid: state.data?.bvid || state.ref.bvid,
        aid: state.data?.aid || state.ref.aid,
        p: state.page,
        qn: state.qn,
        codec: state.codec,
        mode,
      });

      if (!response?.ok) {
        showInlineError(response?.error?.message || '下载准备失败，请稍后重试。', response?.error?.detail || '');
        return;
      }

      if (response.taskId) {
        showInlineSuccess(
          '已打开下载页',
          '请在新标签页查看进度；保存完成后会出现在浏览器下载记录中。',
        );
      } else {
        showInlineSuccess(
          '已开始下载',
          response.filename || (response.filenames || []).join('、') || '请在浏览器下载记录中查看。',
        );
      }
    } catch (error) {
      showInlineError(error?.message || '扩展通信失败，请刷新页面后重试。');
    } finally {
      state.busy = false;
      if (bodyEl.querySelector('#bdwDownload')) updateActionCopy();
    }
  }

  async function togglePanel() {
    if (state.panelOpen) {
      closePanel();
      return;
    }
    await openPanel();
  }

  async function openPanel() {
    if (!state.ref) return;
    state.panelOpen = true;
    panelEl.hidden = false;
    fabEl.hidden = true;
    if (!state.data || state.error) {
      state.page = state.ref.p;
      await loadVideo();
    }
  }

  function closePanel() {
    state.panelOpen = false;
    if (panelEl) panelEl.hidden = true;
    if (fabEl) fabEl.hidden = false;
  }

  function updateVisibility() {
    const ref = parseVideoPage();
    const key = pageKey(ref);
    if (!ref) {
      host.style.display = 'none';
      closePanel();
      return;
    }
    host.style.display = '';
    if (key !== lastPageKey) {
      lastPageKey = key;
      state.ref = ref;
      state.page = ref.p;
      state.data = null;
      state.qualities = [];
      state.warning = '';
      state.qn = null;
      if (state.panelOpen) {
        loadVideo();
      } else {
        renderIdle();
      }
    }
  }

  async function init() {
    mount();
    const settings = await storageGet({ mergeMedia: true, preferredCodec: 'auto' });
    state.merge = Boolean(settings.mergeMedia);
    state.codec = ['auto', 'avc', 'hevc', 'av1'].includes(settings.preferredCodec)
      ? settings.preferredCodec
      : 'auto';

    updateVisibility();
    pollTimer = window.setInterval(updateVisibility, 700);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === 'BILI_PING') {
        sendResponse({ ok: Boolean(state.ref) });
        return false;
      }
      if (message?.type === 'BILI_SHOW_PANEL') {
        if (!state.panelOpen) openPanel();
      }
      return false;
    });
  }

  init().catch((error) => {
    console.warn('[B站下载器] 初始化失败', error);
  });
})();
