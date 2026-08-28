/*
 * interceptor.js — 페이지(MAIN) 월드에서 실행.
 *
 * 인스타그램 웹앱이 스스로 호출하는 fetch / XMLHttpRequest 응답을 가로채,
 * 그 안에 들어 있는 게시물 메타데이터(업로드 시각, 조회수, 댓글수, 좋아요수)를
 * 뽑아서 콘텐츠 스크립트로 넘긴다. 네트워크를 새로 발생시키지 않고,
 * 이미 로그인한 사용자가 어차피 받아보는 데이터만 읽는다.
 */
(() => {
  'use strict';

  const CHANNEL = 'IGPD::media';
  const MAX_BODY = 4 * 1024 * 1024; // 너무 큰 응답은 파싱하지 않는다
  const MAX_NODES = 20000;          // 응답 하나당 순회 노드 상한
  const MAX_DEPTH = 14;
  const CODE_RE = /^[A-Za-z0-9_-]{5,30}$/;

  // 진단용 카운터. 어디까지 진행됐는지 팝업에서 확인할 수 있게 콘텐츠 스크립트로 넘긴다.
  const stats = { targets: 0, parsed: 0, media: 0 };
  let statTimer = null;

  function reportStats() {
    if (statTimer) return;
    statTimer = setTimeout(() => {
      statTimer = null;
      try {
        window.postMessage({ channel: 'IGPD::stat', stats: { ...stats } }, window.location.origin);
      } catch (_) { /* 무시 */ }
    }, 500);
  }

  /* ---------- 값 추출 ---------- */

  const num = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d{1,15}$/.test(v)) return Number(v);
    return null;
  };

  const countOf = (v) => (v && typeof v === 'object' ? num(v.count) : num(v));

  function takenAt(node) {
    // 초 단위 epoch 를 쓰는 필드들
    const s = num(node.taken_at) ?? num(node.taken_at_timestamp) ?? num(node.publish_date);
    if (s !== null && s > 1000000000 && s < 4102444800) return s;
    // 밀리초 단위
    const ms = num(node.taken_at_ms) ?? num(node.creation_time_ms);
    if (ms !== null && ms > 1e12 && ms < 4.1e12) return Math.floor(ms / 1000);
    return null;
  }

  /** 캐러셀(여러 장 게시물)의 자식 미디어 목록 */
  function childrenOf(node) {
    if (Array.isArray(node.carousel_media)) return node.carousel_media;
    const edges = node.edge_sidecar_to_children && node.edge_sidecar_to_children.edges;
    if (Array.isArray(edges)) return edges.map((e) => e && e.node).filter(Boolean);
    return [];
  }

  /**
   * insights / play_count_info 처럼 한 겹 감싸인 곳의 조회수.
   * 노출수(impression)·도달수(reach)는 조회수와 다른 지표라 쓰지 않는다.
   */
  function wrappedViews(node) {
    for (const key of ['insights', 'media_insights', 'play_count_info', 'video_view_count_info']) {
      const o = node[key];
      if (!o || typeof o !== 'object') continue;
      const v = num(o.play_count) ?? num(o.video_views) ?? num(o.view_count) ?? num(o.count);
      if (v !== null) return v;
    }
    return null;
  }

  function viewsOf(node) {
    const own =
      num(node.play_count) ??
      num(node.video_view_count) ??
      num(node.view_count) ??
      num(node.ig_play_count) ??
      num(node.reel_play_count) ??
      num(node.video_play_count) ??
      countOf(node.video_play_count) ??
      wrappedViews(node);
    if (own !== null) return own;

    // 캐러셀은 부모에 조회수가 없고 동영상 자식에만 붙어 오는 경우가 있다
    let best = null;
    for (const child of childrenOf(node)) {
      if (!child || typeof child !== 'object') continue;
      const v =
        num(child.play_count) ??
        num(child.video_view_count) ??
        num(child.view_count) ??
        num(child.ig_play_count) ??
        wrappedViews(child);
      if (v !== null) best = best === null ? v : Math.max(best, v);
    }
    return best;
  }

  function commentsOf(node) {
    return (
      num(node.comment_count) ??
      countOf(node.edge_media_to_comment) ??
      countOf(node.edge_media_to_parent_comment) ??
      countOf(node.edge_media_preview_comment) ??
      null
    );
  }

  function likesOf(node) {
    const n =
      num(node.like_count) ??
      countOf(node.edge_liked_by) ??
      countOf(node.edge_media_preview_like) ??
      null;
    return n !== null && n >= 0 ? n : null;
  }

  function typeOf(node) {
    if (node.product_type === 'clips' || node.is_reel === true) return 'reel';
    const t = node.__typename || node.media_type;
    if (t === 'GraphVideo' || t === 'XDTGraphVideo' || t === 2) return 'video';
    if (t === 'GraphSidecar' || t === 'XDTGraphSidecar' || t === 8) return 'sidecar';
    return 'image';
  }

  /** 게시물처럼 생긴 객체면 정규화해서 돌려주고, 아니면 null. */
  function pickMedia(node) {
    const code = node.code || node.shortcode;
    if (typeof code !== 'string' || !CODE_RE.test(code)) return null;

    const ts = takenAt(node);
    const comments = commentsOf(node);
    const views = viewsOf(node);
    const likes = likesOf(node);
    if (ts === null && comments === null && views === null && likes === null) return null;

    const owner = node.owner || node.user || null;
    return {
      code,
      ts,
      views,
      comments,
      likes,
      type: typeOf(node),
      username: (owner && typeof owner.username === 'string') ? owner.username : null,
      seen: Date.now()
    };
  }

  /** 응답 JSON 을 훑으며 게시물 객체를 모은다. */
  function harvest(root) {
    const out = [];
    const stack = [[root, 0]];
    let visited = 0;

    while (stack.length) {
      const [node, depth] = stack.pop();
      if (!node || typeof node !== 'object' || depth > MAX_DEPTH) continue;
      if (++visited > MAX_NODES) break;

      if (!Array.isArray(node)) {
        const media = pickMedia(node);
        if (media) out.push(media);
      }

      if (Array.isArray(node)) {
        for (let i = 0; i < node.length && i < 200; i++) stack.push([node[i], depth + 1]);
      } else {
        for (const key in node) {
          const v = node[key];
          if (v && typeof v === 'object') stack.push([v, depth + 1]);
        }
      }
    }
    return out;
  }

  function publish(items) {
    stats.media += items.length;
    reportStats();
    if (!items.length) return;
    // 같은 응답에 중복 등장하는 코드는 마지막 값만 남긴다
    const byCode = new Map();
    for (const it of items) byCode.set(it.code, it);
    try {
      window.postMessage({ channel: CHANNEL, items: [...byCode.values()] }, window.location.origin);
    } catch (_) { /* 무시 */ }
  }

  function consume(text) {
    stats.targets++;
    reportStats();
    if (!text || text.length > MAX_BODY) return;
    // 인스타 API 응답만 대상으로 하기 위한 가벼운 사전 필터
    if (text.indexOf('"code"') === -1 && text.indexOf('"shortcode"') === -1) return;
    let data;
    try {
      data = JSON.parse(text.startsWith('for (;;);') ? text.slice(9) : text);
    } catch (_) {
      return;
    }
    stats.parsed++;
    try {
      publish(harvest(data));
    } catch (_) { /* 무시 */ }
  }

  function isTarget(url) {
    if (typeof url !== 'string') return false;
    return /(\/graphql|\/api\/v1\/|\/api\/graphql|\/__a=1)/.test(url);
  }

  /* ---------- fetch 후킹 ---------- */

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (...args) {
      const p = nativeFetch.apply(this, args);
      try {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isTarget(url)) {
          p.then((res) => {
            try {
              res.clone().text().then(consume, () => {});
            } catch (_) { /* 무시 */ }
          }, () => {});
        }
      } catch (_) { /* 무시 */ }
      return p;
    };
  }

  /* ---------- XHR 후킹 ---------- */

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;

    XHR.prototype.open = function (method, url, ...rest) {
      try { this.__igpdUrl = String(url); } catch (_) { /* 무시 */ }
      return open.call(this, method, url, ...rest);
    };

    XHR.prototype.send = function (...args) {
      try {
        if (isTarget(this.__igpdUrl)) {
          this.addEventListener('load', () => {
            try {
              if (this.responseType === '' || this.responseType === 'text') {
                consume(this.responseText);
              } else if (this.responseType === 'json' && this.response) {
                publish(harvest(this.response));
              }
            } catch (_) { /* 무시 */ }
          });
        }
      } catch (_) { /* 무시 */ }
      return send.apply(this, args);
    };
  }

  /* ---------- 초기 HTML 에 심어진 데이터 ---------- */

  // 인스타는 첫 로딩 시 <script type="application/json"> 안에 프로필/게시물 데이터를 함께 내려준다.
  function scanInlineJson() {
    const nodes = document.querySelectorAll(
      'script[type="application/json"], script[type="text/javascript"][data-content-len]'
    );
    for (const s of nodes) {
      const t = s.textContent;
      if (t && t.length < MAX_BODY) consume(t);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanInlineJson, { once: true });
  } else {
    scanInlineJson();
  }
  window.addEventListener('load', scanInlineJson, { once: true });
})();
