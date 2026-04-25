let videoInfo = null;
let currentBvid = null;

const $ = id => document.getElementById(id);

function showSection(id) {
  ['not-video', 'loading', 'error', 'video-info'].forEach(s => {
    $(s).classList.toggle('hidden', s !== id);
  });
}

function formatCount(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
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

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) {
    showSection('not-video');
    return;
  }

  const match = tab.url.match(/bilibili\.com\/video\/(BV[A-Za-z0-9_-]+)/);
  if (!match) {
    showSection('not-video');
    return;
  }

  currentBvid = match[1];
  showSection('loading');

  try {
    const data = await sendMessage({ action: 'popupGetData', pageIndex: 0 });
    videoInfo = data.info;
    renderVideoInfo(videoInfo, data.qualities);
    showSection('video-info');
  } catch (err) {
    $('error-text').textContent = '获取失败: ' + err.message;
    showSection('error');
  }
}

function renderVideoInfo(info, qualities) {
  $('cover').src = info.pic?.replace('http:', 'https:') || '';
  $('cover').alt = info.title || '视频封面';
  $('title').textContent = info.title;
  $('owner').textContent = `UP主: ${info.owner?.name || '未知'}`;
  $('stat').textContent = [
    `播放 ${formatCount(info.stat?.view || 0)}`,
    `弹幕 ${formatCount(info.stat?.danmaku || 0)}`,
    `时长 ${formatDuration(info.duration || 0)}`
  ].join(' · ');

  const pages = info.pages || [];
  if (pages.length > 1) {
    $('pages-section').classList.remove('hidden');
    $('page-select').innerHTML = pages.map((p, i) =>
      `<option value="${i}">P${i + 1}: ${p.part}</option>`
    ).join('');
  } else {
    $('pages-section').classList.add('hidden');
  }

  if (qualities?.length) {
    $('quality-select').innerHTML = qualities.map(q =>
      `<option value="${q.qn}">${q.desc}</option>`
    ).join('');
  }
}

// 分P切换
$('page-select')?.addEventListener('change', async () => {
  if (!videoInfo || !currentBvid) return;
  const idx = parseInt($('page-select').value);
  $('status').textContent = '切换分P...';
  try {
    const data = await sendMessage({ action: 'popupGetData', pageIndex: idx });
    videoInfo = data.info;
    if (data.qualities?.length) {
      $('quality-select').innerHTML = data.qualities.map(q =>
        `<option value="${q.qn}">${q.desc}</option>`
      ).join('');
    }
    $('status').textContent = '';
  } catch (e) {
    $('status').textContent = '切换失败: ' + e.message;
  }
});

async function startDownload() {
  if (!videoInfo || !currentBvid) return;

  const pageIdx = $('page-select') ? parseInt($('page-select').value) : 0;
  const qn = parseInt($('quality-select').value);
  const pages = videoInfo.pages || [];
  const page = pages[pageIdx] || pages[0];
  const cid = page?.cid || videoInfo.cid;

  $('download-btn').disabled = true;
  $('status').textContent = '获取下载地址...';
  $('status').style.color = '#888';

  try {
    const streamData = await sendMessage({ action: 'popupFetchStreamUrl', bvid: currentBvid, cid, qn });

    const qualityName = $('quality-select').options[$('quality-select').selectedIndex].textContent;
    const partName = pages.length > 1 ? `_P${pageIdx + 1}` : '';
    const filename = `${videoInfo.title}${partName}_${qualityName}.mp4`;

    $('status').textContent = '下载中...';

    await sendMessage({ action: 'download', streamData, filename });

    $('status').textContent = '已开始下载!';
    $('status').style.color = '#52c41a';
  } catch (err) {
    $('status').textContent = '失败: ' + err.message;
    $('status').style.color = '#ff4d4f';
  } finally {
    $('download-btn').disabled = false;
  }
}

$('download-btn')?.addEventListener('click', startDownload);
$('retry-btn')?.addEventListener('click', init);

init();
