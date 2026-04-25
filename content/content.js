let videoInfo = null;
let panelVisible = false;
let lastUrl = '';
let closePanelHandler = null;
let observerTimer = null;

function getBvid() {
  const match = location.pathname.match(/\/video\/(BV[A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

function getPageIndex() {
  const match = location.hash.match(/p=(\d+)/);
  return match ? parseInt(match[1]) - 1 : 0;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!resp?.success) {
        reject(new Error(resp?.error || '请求失败'));
      } else {
        resolve(resp.data);
      }
    });
  });
}

function injectDownloadBtn() {
  if (document.getElementById('bili-dl-btn')) return;

  const btn = document.createElement('div');
  btn.id = 'bili-dl-btn';
  btn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
    </svg>
    <span>下载</span>
  `;
  btn.title = '下载视频';
  btn.addEventListener('click', onDownloadClick);
  document.body.appendChild(btn);
}

function removePanel() {
  const panel = document.getElementById('bili-dl-panel');
  if (panel) panel.remove();
  panelVisible = false;
  if (closePanelHandler) {
    document.removeEventListener('click', closePanelHandler);
    closePanelHandler = null;
  }
}

async function onDownloadClick(e) {
  e.stopPropagation();

  const bvid = getBvid();
  if (!bvid) return alert('未检测到视频');

  if (panelVisible) { removePanel(); return; }

  try {
    const pageIndex = getPageIndex();
    const data = await sendMessage({ action: 'pageGetData', pageIndex });
    videoInfo = data.info;
    showPanel(bvid, videoInfo, data.qualities, pageIndex);
  } catch (err) {
    alert('获取视频信息失败: ' + err.message);
  }
}

function showPanel(bvid, info, qualities, pageIndex) {
  removePanel();

  const panel = document.createElement('div');
  panel.id = 'bili-dl-panel';

  const pages = info.pages || [];

  let qualityOptions = '';
  if (qualities?.length) {
    qualityOptions = qualities.map(q =>
      `<option value="${q.qn}">${q.desc}</option>`
    ).join('');
  } else {
    qualityOptions = `
      <option value="80">1080P</option>
      <option value="64">720P</option>
      <option value="32">480P</option>
      <option value="16">360P</option>
    `;
  }

  panel.innerHTML = `
    <div class="bili-dl-header">
      <span class="bili-dl-title">${escapeHtml(info.title)}</span>
      <span class="bili-dl-close" id="bili-dl-close">&times;</span>
    </div>
    <div class="bili-dl-info">UP主: ${escapeHtml(info.owner?.name || '未知')}</div>
    ${pages.length > 1 ? `
      <div class="bili-dl-pages">
        <label>分P: </label>
        <select id="bili-dl-page-select">
          ${pages.map((p, i) => `<option value="${i}" ${i === pageIndex ? 'selected' : ''}>P${i + 1}: ${escapeHtml(p.part)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
    <div class="bili-dl-quality-section">
      <label>画质: </label>
      <select id="bili-dl-quality-select">
        ${qualityOptions}
      </select>
    </div>
    <button id="bili-dl-download" class="bili-dl-btn-download">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
      </svg>
      开始下载
    </button>
    <div id="bili-dl-status" class="bili-dl-status"></div>
  `;

  document.body.appendChild(panel);
  panelVisible = true;

  document.getElementById('bili-dl-close').addEventListener('click', removePanel);
  document.getElementById('bili-dl-download').addEventListener('click', startDownload);

  // 分P切换
  const pageSelect = document.getElementById('bili-dl-page-select');
  if (pageSelect) {
    pageSelect.addEventListener('change', async () => {
      const newIdx = parseInt(pageSelect.value);
      try {
        const data = await sendMessage({ action: 'pageGetData', pageIndex: newIdx });
        videoInfo = data.info;
        const qSelect = document.getElementById('bili-dl-quality-select');
        if (qSelect && data.qualities?.length) {
          qSelect.innerHTML = data.qualities.map(q =>
            `<option value="${q.qn}">${q.desc}</option>`
          ).join('');
        }
      } catch (err) {
        document.getElementById('bili-dl-status').textContent = '切换分P失败: ' + err.message;
      }
    });
  }

  // 只在面板打开时监听外部点击
  closePanelHandler = (e) => {
    if (!e.target.closest('#bili-dl-panel') && !e.target.closest('#bili-dl-btn')) {
      removePanel();
    }
  };
  setTimeout(() => document.addEventListener('click', closePanelHandler), 100);
}

async function startDownload() {
  const bvid = getBvid();
  if (!bvid || !videoInfo) return;

  const pageSelect = document.getElementById('bili-dl-page-select');
  const qualitySelect = document.getElementById('bili-dl-quality-select');
  const statusEl = document.getElementById('bili-dl-status');

  const pageIndex = pageSelect ? parseInt(pageSelect.value) : getPageIndex();
  const qn = parseInt(qualitySelect.value);
  const pages = videoInfo.pages || [];
  const page = pages[pageIndex] || pages[0];
  const cid = page?.cid || videoInfo.cid;

  statusEl.textContent = '获取下载地址...';
  statusEl.style.color = '#888';

  try {
    const streamData = await sendMessage({ action: 'pageFetchStreamUrl', bvid, cid, qn });

    const qualityName = qualitySelect.options[qualitySelect.selectedIndex].textContent;
    const partName = pages.length > 1 ? `_P${pageIndex + 1}` : '';
    const filename = `${videoInfo.title}${partName}_${qualityName}.mp4`;

    statusEl.textContent = '下载中...';

    // Pass full streamData to service worker for DASH audio merge
    await sendMessage({ action: 'download', streamData, filename });

    statusEl.textContent = '已开始下载!';
    statusEl.style.color = '#52c41a';
    setTimeout(removePanel, 2000);
  } catch (err) {
    statusEl.textContent = '下载失败: ' + err.message;
    statusEl.style.color = '#ff4d4f';
  }
}

// 下载进度监听
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'dlProgress') {
    const statusEl = document.getElementById('bili-dl-status');
    if (statusEl) {
      statusEl.textContent = msg.text;
      statusEl.style.color = '#00a1d6';
    }
  }
});

// SPA 导航检测：URL 变化时重置状态
function checkNavigation() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    videoInfo = null;
    removePanel();
    injectDownloadBtn();
  }
}

// 监听 title 变化（B站 SPA 导航会改 title）
const titleEl = document.querySelector('title');
if (titleEl) {
  new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(checkNavigation, 200);
  }).observe(titleEl, { childList: true });
}

// 监听 body 子元素变化（debounced）
const bodyObserver = new MutationObserver(() => {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    if (!document.getElementById('bili-dl-btn')) injectDownloadBtn();
  }, 300);
});
bodyObserver.observe(document.body, { childList: true });

// popstate 用于处理浏览器前进后退
window.addEventListener('popstate', () => setTimeout(checkNavigation, 100));

// 初始化
lastUrl = location.href;
injectDownloadBtn();
