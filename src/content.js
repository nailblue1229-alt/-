/*
 * content.js — 격리(ISOLATED) 월드에서 실행.
 *
 * interceptor.js 가 보내준 게시물 메타데이터를 모아두었다가,
 * 화면에 보이는 썸네일 위에 "업로드 날짜 / 조회수 / 댓글수" 배지를 그려준다.
 */
(() => {
  'use strict';

  const CHANNEL = 'IGPD::media';
  const CACHE_KEY = 'igpd_cache';
  const NARROW_PX = 220; // 이보다 좁은 썸네일에서는 날짜를 짧게 줄인다
  const CACHE_MAX = 3000;
  const CACHE_TTL = 1000 * 60 * 60 * 24 * 14; // 14일

  const DEFAULTS = {
    enabled: true,
    showDate: true,
    showViews: true,
    showUnknownViews: true,   // 동영상인데 조회수를 못 받았으면 '–' 로 표시
    showComments: true,
    showLikes: false,
    dateFormat: 'both',      // 'absolute' | 'relative' | 'both'
    showTime: true,
    position: 'bottom-right', // 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
    fontSize: 11,
    numberStyle: 'compact',  // 'compact' | 'full'
    inlineDate: true,        // 게시물 상세 페이지의 "3일 전" 옆에 정확한 날짜 붙이기
    autoFetch: true          // 가로챈 데이터가 없으면 공개 embed 페이지로 보충
  };

  let settings = { ...DEFAULTS };

  /** code -> { code, ts, views, comments, likes, type, username, seen } */
  const store = new Map();
  /** 보충 조회 결과가 없었던 코드 (재시도 억제) */
  const missed = new Map();

  /* =====================================================================
   * 포맷터 (src/format.js 의 순수 함수를 설정과 함께 감싼다)
   * ===================================================================== */

  const F = globalThis.IGPDFormat;

  const formatAbsolute = (ts) => F.absolute(ts, settings.showTime);
  const formatFull = (ts) => F.full(ts);
  const formatDate = (ts, compact) => F.date(ts, compact ? { ...settings, compact: true } : settings);
  const formatNumber = (n) => F.count(n, settings.numberStyle);

  /* =====================================================================
   * 저장소
   * ===================================================================== */

  function merge(item) {
    if (!item || !item.code) return false;
    const prev = store.get(item.code);
    if (!prev) {
      store.set(item.code, item);
      return true;
    }
    let changed = false;
    for (const k of ['ts', 'views', 'comments', 'likes', 'username']) {
      if (item[k] !== null && item[k] !== undefined && item[k] !== prev[k]) {
        prev[k] = item[k];
        changed = true;
      }
    }
    if (item.type && item.type !== 'image' && prev.type !== item.type) {
      prev.type = item.type;
      changed = true;
    }
    prev.seen = Date.now();
    return changed;
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const now = Date.now();
      let entries = [...store.values()].filter((e) => now - e.seen < CACHE_TTL);
      if (entries.length > CACHE_MAX) {
        entries.sort((a, b) => b.seen - a.seen);
        entries = entries.slice(0, CACHE_MAX);
      }
      const obj = {};
      for (const e of entries) obj[e.code] = e;
      try {
        chrome.storage.local.set({ [CACHE_KEY]: obj });
      } catch (_) { /* 확장 컨텍스트 소멸 */ }
    }, 3000);
  }

  async function loadCache() {
    try {
      const got = await chrome.storage.local.get(CACHE_KEY);
      const obj = got[CACHE_KEY];
      if (!obj) return;
      const now = Date.now();
      for (const code in obj) {
        const e = obj[code];
        if (e && e.code && now - (e.seen || 0) < CACHE_TTL) store.set(code, e);
      }
    } catch (_) { /* 무시 */ }
  }

  async function loadSettings() {
    try {
      const got = await chrome.storage.sync.get(DEFAULTS);
      settings = { ...DEFAULTS, ...got };
    } catch (_) {
      settings = { ...DEFAULTS };
    }
  }

  /* =====================================================================
   * 보충 조회 (공개 embed 페이지)
   * ===================================================================== */

  const queue = [];
  const queued = new Set();
  let active = 0;
  const MAX_ACTIVE = 2;
  const MISS_TTL = 1000 * 60 * 30;

  function enqueue(code) {
    if (!settings.autoFetch || store.has(code) || queued.has(code)) return;
    const miss = missed.get(code);
    if (miss && Date.now() - miss < MISS_TTL) return;
    queued.add(code);
    queue.push(code);
    pump();
  }

  function pump() {
    while (active < MAX_ACTIVE && queue.length) {
      const code = queue.shift();
      active++;
      fetchEmbed(code)
        .then((item) => {
          if (item && merge(item)) {
            scheduleSave();
            requestRender();
          } else if (!item) {
            missed.set(code, Date.now());
          }
        })
        .catch(() => missed.set(code, Date.now()))
        .finally(() => {
          queued.delete(code);
          active--;
          setTimeout(pump, 350); // 과도한 요청 방지
        });
    }
  }

  async function fetchEmbed(code) {
    const res = await fetch(`https://www.instagram.com/p/${encodeURIComponent(code)}/embed/captioned/`, {
      credentials: 'omit',
      cache: 'force-cache'
    });
    if (!res.ok) return null;
    const html = await res.text();

    let ts = null;
    const m1 = html.match(/"taken_at_timestamp"\s*:\s*(\d{9,11})/);
    if (m1) ts = Number(m1[1]);
    if (ts === null) {
      const m2 = html.match(/datetime="([^"]+)"/);
      if (m2) {
        const t = Date.parse(m2[1]);
        if (!Number.isNaN(t)) ts = Math.floor(t / 1000);
      }
    }

    const mc = html.match(/"edge_media_to_(?:parent_)?comment"\s*:\s*\{\s*"count"\s*:\s*(\d+)/)
      || html.match(/"comment_count"\s*:\s*(\d+)/);
    const mv = html.match(/"play_count"\s*:\s*(\d+)/)
      || html.match(/"video_view_count"\s*:\s*(\d+)/)
      || html.match(/"ig_play_count"\s*:\s*(\d+)/)
      || html.match(/"view_count"\s*:\s*(\d+)/);
    const ml = html.match(/"edge_media_preview_like"\s*:\s*\{\s*"count"\s*:\s*(\d+)/)
      || html.match(/"like_count"\s*:\s*(\d+)/);

    if (ts === null && !mc && !mv) return null;
    return {
      code,
      ts,
      views: mv ? Number(mv[1]) : null,
      comments: mc ? Number(mc[1]) : null,
      likes: ml ? Number(ml[1]) : null,
      type: (mv || /"is_video"\s*:\s*true/.test(html) || html.includes('<video')) ? 'video' : 'image',
      username: null,
      seen: Date.now()
    };
  }

  /* =====================================================================
   * 렌더링
   * ===================================================================== */

  const CODE_FROM_HREF = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,30})\//;

  function codeOf(anchor) {
    let path;
    try {
      path = new URL(anchor.href, location.origin).pathname;
    } catch (_) {
      return null;
    }
    const m = CODE_FROM_HREF.exec(path);
    return m ? m[1] : null;
  }

  const isVideo = (data) => data.type === 'video' || data.type === 'reel';

  function badgeHtmlParts(data, compact) {
    const parts = [];
    if (settings.showDate && data.ts) {
      parts.push({ cls: 'igpd-date', icon: '📅', text: formatDate(data.ts, compact), title: formatFull(data.ts) });
    }
    if (settings.showViews && typeof data.views === 'number') {
      parts.push({ cls: 'igpd-views', icon: '▶', text: formatNumber(data.views), title: `조회수 ${data.views.toLocaleString('ko-KR')}회` });
    } else if (settings.showViews && settings.showUnknownViews && isVideo(data)) {
      // 동영상·릴스인데 아직 숫자를 못 받은 경우. 사진 게시물은 조회수 지표
      // 자체가 없으므로 아무것도 띄우지 않는다.
      parts.push({ cls: 'igpd-views igpd-unknown', icon: '▶', text: '–', title: '조회수 정보를 아직 받지 못했습니다' });
    }
    if (settings.showComments && typeof data.comments === 'number') {
      parts.push({ cls: 'igpd-comments', icon: '💬', text: formatNumber(data.comments), title: `댓글 ${data.comments.toLocaleString('ko-KR')}개` });
    }
    if (settings.showLikes && typeof data.likes === 'number') {
      parts.push({ cls: 'igpd-likes', icon: '♥', text: formatNumber(data.likes), title: `좋아요 ${data.likes.toLocaleString('ko-KR')}개` });
    }
    return parts;
  }

  function buildBadge(data, compact) {
    const parts = badgeHtmlParts(data, compact);
    if (!parts.length) return null;

    const box = document.createElement('div');
    box.className = `igpd-badge igpd-${settings.position}`;
    box.style.fontSize = `${settings.fontSize}px`;
    box.setAttribute('aria-hidden', 'true');

    for (const p of parts) {
      const row = document.createElement('span');
      row.className = `igpd-row ${p.cls}`;
      row.title = p.title;

      const icon = document.createElement('span');
      icon.className = 'igpd-icon';
      icon.textContent = p.icon;

      const text = document.createElement('span');
      text.className = 'igpd-text';
      text.textContent = p.text;

      row.append(icon, text);
      box.appendChild(row);
    }
    return box;
  }

  function signatureOf(data, compact) {
    return [
      compact ? 'c' : 'w',
      settings.position, settings.fontSize, settings.dateFormat, settings.showTime,
      settings.numberStyle, settings.showDate, settings.showViews,
      settings.showUnknownViews, settings.showComments, settings.showLikes,
      data.ts, data.views, data.comments, data.likes, data.type
    ].join('|');
  }

  /**
   * 배지를 붙일 만한 "썸네일 링크" 인지 판단한다.
   * 피드 게시물의 시각 표시(<a href="/p/..."><time>...</time></a>)나
   * 캡션 속 링크처럼 작은 텍스트 링크에는 붙이지 않는다.
   */
  function isThumbnail(anchor, rect) {
    if (rect.width < 80 || rect.height < 80) return false;
    if (anchor.querySelector('time')) return false;
    return anchor.querySelector('img, video, canvas') !== null;
  }

  function decorate(anchor, rect) {
    const code = codeOf(anchor);
    if (!code) return;
    if (!isThumbnail(anchor, rect)) return;

    const data = store.get(code);
    if (!data) {
      enqueue(code);
      return;
    }

    const compact = rect.width < NARROW_PX;
    const sig = signatureOf(data, compact);
    if (anchor.dataset.igpdSig === sig) return;

    const old = anchor.querySelector(':scope > .igpd-badge');
    if (old) old.remove();

    const badge = buildBadge(data, compact);
    if (!badge) {
      delete anchor.dataset.igpdSig;
      anchor.classList.remove('igpd-host', 'igpd-relative');
      return;
    }

    anchor.classList.add('igpd-host');
    // 배지를 앵커 기준으로 띄우려면 앵커가 positioned 여야 한다.
    // 인스타가 이미 absolute/relative 를 쓰고 있으면 건드리지 않는다.
    if (getComputedStyle(anchor).position === 'static') anchor.classList.add('igpd-relative');
    anchor.appendChild(badge);
    anchor.dataset.igpdSig = sig;
  }

  function clearAll() {
    for (const el of document.querySelectorAll('.igpd-badge, .igpd-inline')) el.remove();
    for (const el of document.querySelectorAll('.igpd-host')) {
      el.classList.remove('igpd-host', 'igpd-relative');
      delete el.dataset.igpdSig;
    }
    for (const el of document.querySelectorAll('time[data-igpd-sig]')) {
      delete el.dataset.igpdSig;
    }
  }

  /* ---------- 상세 페이지: "3일 전" 옆에 정확한 날짜 ---------- */

  function currentPostCode() {
    const m = CODE_FROM_HREF.exec(location.pathname);
    return m ? m[1] : null;
  }

  function enhanceTimes() {
    if (!settings.inlineDate) return;
    for (const t of document.querySelectorAll('time[datetime]')) {
      const iso = t.getAttribute('datetime');
      const parsed = Date.parse(iso);
      if (Number.isNaN(parsed)) continue;
      const ts = Math.floor(parsed / 1000);

      const sig = `${ts}|${settings.dateFormat}|${settings.showTime}`;
      if (t.dataset.igpdSig === sig) continue;
      t.dataset.igpdSig = sig;

      t.title = formatFull(ts);

      let tail = t.nextElementSibling;
      if (!tail || !tail.classList.contains('igpd-inline')) {
        tail = document.createElement('span');
        tail.className = 'igpd-inline';
        if (t.parentNode) t.parentNode.insertBefore(tail, t.nextSibling);
      }
      tail.textContent = ` · ${formatAbsolute(ts)}`;
      tail.title = formatFull(ts);
    }
  }

  /* ---------- 스캔 루프 ---------- */

  let renderPending = false;
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  function render() {
    if (!settings.enabled) return;
    const anchors = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
    for (const a of anchors) {
      // 화면 밖으로 한참 벗어난 항목은 건너뛴다
      const r = a.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom < -800 || r.top > window.innerHeight + 800) continue;
      decorate(a, r);
    }
    enhanceTimes();
  }

  /* =====================================================================
   * 시작
   * ===================================================================== */

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.channel !== CHANNEL || !Array.isArray(d.items)) return;
    let changed = false;
    for (const item of d.items) changed = merge(item) || changed;
    if (changed) {
      scheduleSave();
      requestRender();
    }
  });

  const mo = new MutationObserver(() => requestRender());

  function startObserving() {
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('scroll', requestRender, { passive: true });
    window.addEventListener('resize', requestRender, { passive: true });
    setInterval(requestRender, 2000);
    requestRender();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let touched = false;
    for (const key in changes) {
      if (key in DEFAULTS) {
        settings[key] = changes[key].newValue;
        touched = true;
      }
    }
    if (!touched) return;
    clearAll();
    if (settings.enabled) requestRender();
  });

  (async () => {
    await Promise.all([loadSettings(), loadCache()]);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving, { once: true });
    } else {
      startObserving();
    }
    // 현재 보고 있는 게시물은 우선적으로 채운다
    const code = currentPostCode();
    if (code) enqueue(code);
  })();
})();
