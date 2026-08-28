'use strict';

const DEFAULTS = {
  enabled: true,
  showDate: true,
  showViews: true,
  showUnknownViews: true,
  showComments: true,
  showLikes: false,
  dateFormat: 'both',
  showTime: true,
  position: 'bottom-right',
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
  const entries = got[CACHE_KEY] ? Object.values(got[CACHE_KEY]) : [];
  const withViews = entries.filter((e) => typeof e.views === 'number').length;
  $('cacheCount').textContent = entries.length.toLocaleString('ko-KR');
  $('viewsCount').textContent = withViews.toLocaleString('ko-KR');
}

const IG_URL = /^https:\/\/(www\.)?instagram\.com\//;

/** 어디까지 동작하고 있는지 인스타그램 탭에 물어본다 */
async function refreshDiag() {
  const el = $('diag');
  el.textContent = '확인 중…';

  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) { /* 무시 */ }

  if (!tab || !IG_URL.test(tab.url || '')) {
    el.textContent = '✗ 지금 보고 있는 탭이 인스타그램이 아닙니다.\n'
      + '   instagram.com 을 연 뒤 [다시 확인] 을 눌러 주세요.';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'IGPD_DIAG' }, (r) => {
    if (chrome.runtime.lastError || !r) {
      el.textContent = '✗ 이 탭에서 확장이 실행되지 않았습니다.\n'
        + '   인스타그램 탭을 새로고침(F5) 한 뒤 다시 확인해 주세요.\n'
        + '   그래도 같으면 chrome://extensions 에서 확장을 껐다 켜 보세요.';
      return;
    }

    const lines = [
      r.enabled ? '✓ 확장 실행 중' : '⚠ 실행 중이지만 [표시 켜기] 가 꺼져 있음',
      r.formatLoaded ? '✓ 표시 모듈 정상' : '✗ 표시 모듈 로드 실패',
      '',
      `가로챈 응답  ${r.net.targets}건 → 해석 ${r.net.parsed}건`,
      `받은 게시물  ${r.net.media}개 (메시지 ${r.messages}회)`,
      `저장된 정보  ${r.stored}개 · 날짜 ${r.withDate} · 조회수 ${r.withViews}`,
      '',
      `화면의 링크  ${r.anchors}개 → 썸네일 판정 ${r.thumbs}개`,
      `배지 그림    ${r.drawn}개 · 정보 없어 건너뜀 ${r.noData}개`,
      `보충 조회    성공 ${r.embedOk} · 실패 ${r.embedFail}${r.autoFetch ? '' : ' (꺼짐)'}`,
      '',
      `마지막 오류  ${r.lastError || '없음'}`
    ];
    el.textContent = lines.join('\n');
  });
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

  $('refreshDiag').addEventListener('click', refreshDiag);

  $('clearCache').addEventListener('click', async () => {
    await chrome.storage.local.remove(CACHE_KEY);
    await refreshCacheCount();
  });

  await refreshCacheCount();
  await refreshDiag();
}

init().catch((err) => console.error('[IGPD] popup init failed', err));
