/* 설치 시 기본 설정을 채워 넣는다. (그 외 백그라운드 작업 없음) */
const DEFAULTS = {
  enabled: true,
  showDate: true,
  showViews: true,
  showUnknownViews: true,
  showComments: true,
  showLikes: false,
  dateFormat: 'both',
  showTime: true,
  position: 'bottom-left',
  fontSize: 11,
  numberStyle: 'compact',
  inlineDate: true,
  autoFetch: true
};

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const current = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    const patch = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (current[k] === undefined) patch[k] = v;
    }
    if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  } catch (_) { /* 무시 */ }
});
