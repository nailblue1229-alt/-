/* 세 파일에 흩어진 기본 설정값이 서로 어긋나지 않는지 확인 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function extractDefaults(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const start = src.indexOf('DEFAULTS = {');
  assert.notEqual(start, -1, `${rel} 에 DEFAULTS 가 없다`);

  // 중괄호 짝을 세어 객체 리터럴 범위를 정확히 잘라낸다
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  assert.notEqual(end, -1, `${rel} 의 DEFAULTS 를 파싱하지 못했다`);

  // 다른 realm 의 객체라 그대로 비교하면 프로토타입이 달라진다 → 평범한 객체로 되살린다
  const parsed = vm.runInNewContext(`JSON.stringify(${src.slice(open, end + 1)})`);
  const obj = JSON.parse(parsed);
  assert.ok(Object.keys(obj).length >= 5, `${rel} 의 DEFAULTS 가 비어 보인다`);
  return obj;
}

test('content / popup / background 의 기본값이 같다', () => {
  const a = extractDefaults('src/content.js');
  const b = extractDefaults('src/popup.js');
  const c = extractDefaults('src/background.js');
  assert.deepEqual(b, a, 'popup.js 기본값이 content.js 와 다르다');
  assert.deepEqual(c, a, 'background.js 기본값이 content.js 와 다르다');
});

test('팝업 UI 가 모든 설정 항목을 다룬다', () => {
  const defaults = extractDefaults('src/content.js');
  const html = fs.readFileSync(path.join(ROOT, 'src', 'popup.html'), 'utf8');
  for (const key of Object.keys(defaults)) {
    assert.ok(html.includes(`id="${key}"`), `팝업에 ${key} 컨트롤이 없다`);
  }
});
