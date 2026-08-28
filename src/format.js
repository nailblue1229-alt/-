/*
 * format.js — 날짜/숫자 표시 형식을 만드는 순수 함수 모음.
 * 콘텐츠 스크립트와 테스트에서 함께 쓴다.
 */
(function (root) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /** 2026.08.28 15:24 (showTime=false 면 날짜까지만) */
  function absolute(ts, showTime = true) {
    const d = new Date(ts * 1000);
    const base = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    return showTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
  }

  /** 2026년 8월 28일 (금) 오후 3:24 — 툴팁용 전체 표기 */
  function full(ts) {
    const d = new Date(ts * 1000);
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]}) `
      + `${h < 12 ? '오전' : '오후'} ${h12}:${pad(d.getMinutes())}`;
  }

  /** 3개월 전 */
  function relative(ts, now = Date.now()) {
    const diff = Math.floor(now / 1000) - ts;
    if (diff < 0) return '방금';
    if (diff < 60) return `${diff}초 전`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    const day = Math.floor(h / 24);
    if (day < 7) return `${day}일 전`;
    if (day < 31) return `${Math.floor(day / 7)}주 전`;
    const mon = Math.floor(day / 30.44);
    if (mon < 12) return `${Math.max(1, mon)}개월 전`;
    const y = Math.floor(day / 365.25);
    const restMon = Math.floor((day - y * 365.25) / 30.44);
    return restMon > 0 ? `${y}년 ${restMon}개월 전` : `${y}년 전`;
  }

/**
   * 작은 썸네일용 짧은 날짜.
   * 올해 것은 08.28, 지난 해 것은 25.08.28 처럼 연도를 붙인다.
   */
  function short(ts, now = Date.now()) {
    const d = new Date(ts * 1000);
    const md = `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
    const thisYear = new Date(now).getFullYear();
    return d.getFullYear() === thisYear ? md : `${String(d.getFullYear()).slice(2)}.${md}`;
  }

  /**
   * 설정(dateFormat, showTime)에 맞춘 날짜 문자열.
   * opts.compact 이면 좁은 썸네일에 맞춰 짧은 형태로 줄인다.
   */
  function date(ts, opts = {}, now = Date.now()) {
    const showTime = opts.showTime !== false;
    if (opts.compact) {
      // 상대 표기를 고른 사람에게는 좁은 자리에서도 상대 표기를 유지한다
      return opts.dateFormat === 'relative' ? relative(ts, now) : short(ts, now);
    }
    if (opts.dateFormat === 'relative') return relative(ts, now);
    if (opts.dateFormat === 'absolute') return absolute(ts, showTime);
    return `${absolute(ts, showTime)} · ${relative(ts, now)}`;
  }

  /** 12345 -> "1.2만" (compact) 또는 "12,345" (full) */
  function count(n, style = 'compact') {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    if (style === 'full' || Math.abs(n) < 10000) return n.toLocaleString('ko-KR');
    const trim = (v) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''));
    if (Math.abs(n) < 100000000) return `${trim(n / 10000)}만`;
    return `${trim(n / 100000000)}억`;
  }

  const api = { absolute, full, relative, short, date, count };

  root.IGPDFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
