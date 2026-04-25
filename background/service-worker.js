function _extractPageData(pageIndex) {
  const state = window.__INITIAL_STATE__;
  const playinfo = window.__playinfo__;
  if (!state?.videoData) throw new Error('未找到视频数据，请刷新页面');

  const vd = state.videoData;
  const info = {
    bvid: vd.bvid, aid: vd.aid, title: vd.title, pic: vd.pic,
    duration: vd.duration,
    owner: vd.owner || { name: vd.author || '未知' },
    stat: vd.stat || {},
    pages: (vd.pages || []).map(p => ({
      cid: p.cid, part: p.part || `P${p.page}`, page: p.page
    })),
    cid: vd.cid
  };

  let qualities = [];
  if (playinfo?.data) {
    const d = playinfo.data;
    if (d.accept_quality && d.accept_description) {
      qualities = d.accept_quality.map((qn, i) => ({
        qn, desc: d.accept_description[i] || String(qn)
      }));
    }
  }

  return { info, qualities };
}

function _fetchStreamUrl(bvid, cid, qn) {
  return fetch(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=${qn}&fnval=1&fourk=1`,
    { credentials: 'include' }
  ).then(r => r.json()).then(data => {
    if (data.code !== 0) throw new Error(data.message || '获取播放地址失败');
    return data.data;
  });
}

async function runInPageWorld(tabId, fn, args) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: fn,
    args: args || []
  });
  return results?.[0]?.result;
}

// blob → base64 data URL (chunk-based to avoid stack overflow)
async function blobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return `data:${blob.type || 'video/mp4'};base64,${btoa(binary)}`;
}

// Fetch with Referer, return blob
async function fetchBlob(url) {
  const resp = await fetch(url, {
    headers: { 'Referer': 'https://www.bilibili.com' }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new Error('CDN返回了HTML，可能需要登录');
  return resp.blob();
}

// Send progress to the tab that initiated the download
function notifyTab(tabId, text) {
  if (tabId) chrome.tabs.sendMessage(tabId, { type: 'dlProgress', text }).catch(() => {});
}

// Download: handle both durl (legacy) and dash (video+audio merge)
async function downloadVideo(streamData, filename, tabId) {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, '_').substring(0, 200);

  let blob;

  if (streamData.durl?.length) {
    // Legacy format: single file
    notifyTab(tabId, '正在下载视频...');
    blob = await fetchBlob(streamData.durl[0].url);
  } else if (streamData.dash) {
    // DASH format: download video + audio, concatenate
    const videoStream = streamData.dash.video?.[0];
    const audioStream = streamData.dash.audio?.[0];

    if (!videoStream) throw new Error('未找到视频流');

    const videoUrl = videoStream.baseUrl || videoStream.base_url;
    const audioUrl = audioStream ? (audioStream.baseUrl || audioStream.base_url) : null;

    notifyTab(tabId, '正在下载视频流...');
    const videoBlob = await fetchBlob(videoUrl);

    if (audioUrl) {
      notifyTab(tabId, '正在下载音频流...');
      const audioBlob = await fetchBlob(audioUrl);
      blob = new Blob([videoBlob, audioBlob], { type: videoBlob.type || 'video/mp4' });
    } else {
      blob = videoBlob;
    }
  } else {
    throw new Error('未找到下载地址');
  }

  const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
  notifyTab(tabId, `正在处理 ${sizeMB}MB...`);

  const dataUrl = await blobToDataUrl(blob);
  notifyTab(tabId, '正在保存...');

  return chrome.downloads.download({ url: dataUrl, filename: safeName });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'pageGetData') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: 'no tab' }); return; }
    runInPageWorld(tabId, _extractPageData, [msg.pageIndex || 0])
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === 'pageFetchStreamUrl') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: 'no tab' }); return; }
    runInPageWorld(tabId, _fetchStreamUrl, [msg.bvid, msg.cid, msg.qn])
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === 'popupGetData') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ success: false, error: 'no tab' }); return; }
      runInPageWorld(tabs[0].id, _extractPageData, [msg.pageIndex || 0])
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (msg.action === 'popupFetchStreamUrl') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ success: false, error: 'no tab' }); return; }
      runInPageWorld(tabs[0].id, _fetchStreamUrl, [msg.bvid, msg.cid, msg.qn])
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }

  if (msg.action === 'download') {
    // Capture sender tab ID for progress notifications
    const tabId = sender.tab?.id;
    downloadVideo(msg.streamData, msg.filename, tabId)
      .then(id => sendResponse({ success: true, id }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Fallback for unknown actions
  sendResponse({ success: false, error: 'unknown action: ' + msg.action });
});
