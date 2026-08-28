/* 날짜/숫자 포맷터 테스트 — TZ=Asia/Seoul 기준 */
const assert = require('node:assert/strict');
const test = require('node:test');
const F = require('../src/format.js');

// 2026-08-28 15:24:00 KST
const TS = Math.floor(Date.parse('2026-08-28T06:24:00Z') / 1000);

test('absolute', () => {
  assert.equal(F.absolute(TS), '2026.08.28 15:24');
  assert.equal(F.absolute(TS, false), '2026.08.28');
});

test('full', () => {
  assert.equal(F.full(TS), '2026년 8월 28일 (금) 오후 3:24');
  const morning = Math.floor(Date.parse('2026-08-27T15:05:00Z') / 1000); // 00:05 KST
  assert.equal(F.full(morning), '2026년 8월 28일 (금) 오전 12:05');
});

test('relative', () => {
  const now = Date.parse('2026-08-28T06:24:00Z');
  assert.equal(F.relative(TS, now), '0초 전');
  assert.equal(F.relative(TS - 45, now), '45초 전');
  assert.equal(F.relative(TS - 60 * 5, now), '5분 전');
  assert.equal(F.relative(TS - 3600 * 3, now), '3시간 전');
  assert.equal(F.relative(TS - 86400 * 3, now), '3일 전');
  assert.equal(F.relative(TS - 86400 * 14, now), '2주 전');
  assert.equal(F.relative(TS - 86400 * 95, now), '3개월 전');
  assert.equal(F.relative(TS - 86400 * 400, now), '1년 1개월 전');
  assert.equal(F.relative(TS - 86400 * 366, now), '1년 전');
  assert.equal(F.relative(TS + 60, now), '방금');
});

test('date honours settings', () => {
  const now = Date.parse('2026-08-28T06:24:00Z') + 86400 * 3 * 1000;
  assert.equal(F.date(TS, { dateFormat: 'absolute' }, now), '2026.08.28 15:24');
  assert.equal(F.date(TS, { dateFormat: 'relative' }, now), '3일 전');
  assert.equal(F.date(TS, { dateFormat: 'both' }, now), '2026.08.28 15:24 · 3일 전');
  assert.equal(F.date(TS, { dateFormat: 'both', showTime: false }, now), '2026.08.28 · 3일 전');
});

test('count', () => {
  assert.equal(F.count(0), '0');
  assert.equal(F.count(999), '999');
  assert.equal(F.count(9999), '9,999');
  assert.equal(F.count(12345), '1.2만');
  assert.equal(F.count(10000), '1만');
  assert.equal(F.count(1234567), '123만');
  assert.equal(F.count(234000000), '2.3억');
  assert.equal(F.count(12345, 'full'), '12,345');
  assert.equal(F.count(null), '');
  assert.equal(F.count(undefined), '');
});
