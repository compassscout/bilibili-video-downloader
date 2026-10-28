const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusHint = document.getElementById('statusHint');
const openPanel = document.getElementById('openPanel');

let activeTabId = null;

function setStatus(kind, text, hint, enabled) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
  statusHint.textContent = hint;
  openPanel.disabled = !enabled;
}

function sendToTab(message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(activeTabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0] || null;
  activeTabId = tab?.id ?? null;

  if (activeTabId == null) {
    setStatus('', '无法读取当前页面', '请切换到 B 站视频页后重试。', false);
    return;
  }

  try {
    const response = await sendToTab({ type: 'BILI_PING' });
    if (!response?.ok) throw new Error('no content script');
    setStatus('ready', '已识别 B 站视频页', '点击按钮打开页面右下角的下载面板。', true);
  } catch {
    setStatus('warn', '当前不是可用的 B 站视频页', '如果已在视频页，请刷新页面后再试。', false);
  }
}

openPanel.addEventListener('click', async () => {
  if (activeTabId == null) return;
  openPanel.disabled = true;
  openPanel.textContent = '正在打开…';

  try {
    await sendToTab({ type: 'BILI_SHOW_PANEL' });
    window.close();
  } catch {
    setStatus('warn', '面板尚未加载', '请刷新 B 站视频页，等页面加载完成后再试。', true);
    openPanel.textContent = '重新打开下载面板';
  }
});

init().catch(() => {
  setStatus('warn', '初始化失败', '请刷新扩展后重试。', false);
});
