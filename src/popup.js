'use strict';

const DEFAULTS = {
  enabled: true,
  showDate: true,
  showViews: true,
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

const CACHE_KEY = 'igpd_cache';
const $ = (id) => document.getElementById(id);

function readControl(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range') return Number(el.value);
  return el.value;
}

function writeControl(el, value) {
  if (el.type === 'checkbox') el.checked = Boolean(value);
  else el.value = String(value);
}

async function refreshCacheCount() {
  const got = await chrome.storage.local.get(CACHE_KEY);
  const n = got[CACHE_KEY] ? Object.keys(got[CACHE_KEY]).length : 0;
  $('cacheCount').textContent = n.toLocaleString('ko-KR');
}

async function init() {
  const settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };

  for (const key of Object.keys(DEFAULTS)) {
    const el = $(key);
    if (!el) continue;
    writeControl(el, settings[key]);
    el.addEventListener('input', () => {
      const value = readControl(el);
      chrome.storage.sync.set({ [key]: value });
      if (key === 'fontSize') $('fontSizeOut').textContent = String(value);
    });
  }
  $('fontSizeOut').textContent = String(settings.fontSize);

  $('clearCache').addEventListener('click', async () => {
    await chrome.storage.local.remove(CACHE_KEY);
    await refreshCacheCount();
  });

  await refreshCacheCount();
}

init().catch((err) => console.error('[IGPD] popup init failed', err));
