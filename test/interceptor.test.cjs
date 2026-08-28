/* 네트워크 가로채기 + 게시물 데이터 추출 테스트 */
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'interceptor.js'), 'utf8');

/** interceptor.js 를 가짜 브라우저 환경에서 실행하고, 관찰 지점을 돌려준다. */
function boot({ inlineJson = [] } = {}) {
  const messages = [];
  const fetchCalls = [];

  class FakeXHR {
    constructor() { this.listeners = {}; this.responseType = ''; }
    open(method, url) { this.method = method; this.url = url; }
    send() { this.sent = true; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    /** 서버 응답이 도착한 것처럼 흉내낸다 */
    finish(text) {
      this.responseText = text;
      for (const fn of this.listeners.load || []) fn.call(this);
    }
  }

  const sandbox = {
    console,
    JSON, Math, Date, Number, String, Array, Object, RegExp, Promise, Error,
    setTimeout, clearTimeout,
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelectorAll: () => inlineJson.map((textContent) => ({ textContent }))
    }
  };
  sandbox.window = sandbox;
  sandbox.location = sandbox.window.location = { origin: 'https://www.instagram.com' };
  sandbox.postMessage = (msg) => messages.push(msg);
  sandbox.addEventListener = () => {};
  sandbox.XMLHttpRequest = FakeXHR;
  sandbox.fetch = (url) => {
    fetchCalls.push(url);
    const body = sandbox.__nextBody ?? '{}';
    return Promise.resolve({
      clone: () => ({ text: () => Promise.resolve(body) })
    });
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, messages, fetchCalls, FakeXHR };
}

/** 여러 postMessage 로 흩어진 결과를 code -> item 으로 모은다 */
function collect(messages) {
  const out = new Map();
  for (const m of messages) {
    assert.equal(m.channel, 'IGPD::media');
    for (const item of m.items) out.set(item.code, item);
  }
  return out;
}

const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));

test('fetch 응답에서 릴스 정보를 뽑는다', async () => {
  const { sandbox, messages } = boot();
  sandbox.__nextBody = JSON.stringify({
    data: {
      items: [{
        code: 'CzAbc_1-xyz',
        taken_at: 1700000000,
        play_count: 152340,
        comment_count: 412,
        like_count: 9876,
        product_type: 'clips',
        user: { username: 'someone' }
      }]
    }
  });

  await sandbox.window.fetch('https://www.instagram.com/api/v1/feed/reels_media/');
  await flush();

  const got = collect(messages);
  const item = got.get('CzAbc_1-xyz');
  assert.ok(item, '게시물이 수집되어야 한다');
  assert.equal(item.ts, 1700000000);
  assert.equal(item.views, 152340);
  assert.equal(item.comments, 412);
  assert.equal(item.likes, 9876);
  assert.equal(item.type, 'reel');
  assert.equal(item.username, 'someone');
});

test('구형 GraphQL edge 구조도 읽는다', async () => {
  const { sandbox, messages } = boot();
  sandbox.__nextBody = JSON.stringify({
    data: {
      user: {
        edge_owner_to_timeline_media: {
          edges: [{
            node: {
              __typename: 'GraphVideo',
              shortcode: 'ABCDEfghij',
              taken_at_timestamp: 1650000000,
              video_view_count: 8231,
              edge_media_to_comment: { count: 57 },
              edge_liked_by: { count: 1203 },
              owner: { username: 'creator' }
            }
          }]
        }
      }
    }
  });

  await sandbox.window.fetch('https://www.instagram.com/graphql/query');
  await flush();

  const item = collect(messages).get('ABCDEfghij');
  assert.ok(item);
  assert.equal(item.ts, 1650000000);
  assert.equal(item.views, 8231);
  assert.equal(item.comments, 57);
  assert.equal(item.likes, 1203);
  assert.equal(item.type, 'video');
});

test('대상이 아닌 URL 은 파싱하지 않는다', async () => {
  const { sandbox, messages } = boot();
  sandbox.__nextBody = JSON.stringify({ code: 'ZZZZZZZZZZ', taken_at: 1700000000 });

  await sandbox.window.fetch('https://www.instagram.com/static/bundle.js');
  await flush();

  assert.equal(messages.length, 0);
});

test('XHR 응답도 가로챈다', async () => {
  const { sandbox, messages, FakeXHR } = boot();
  const xhr = new FakeXHR();
  xhr.open('GET', 'https://www.instagram.com/api/v1/media/1/info/');
  xhr.send();
  xhr.finish(JSON.stringify({
    items: [{ code: 'XhrCode123', taken_at: 1690000000, comment_count: 3 }]
  }));

  await flush();
  const item = collect(messages).get('XhrCode123');
  assert.ok(item);
  assert.equal(item.ts, 1690000000);
  assert.equal(item.comments, 3);
  assert.equal(item.views, null);
});

test('첫 화면 HTML 에 박힌 JSON 도 읽는다', async () => {
  const { messages } = boot({
    inlineJson: [JSON.stringify({
      require: [['x', 'y', [], [{ code: 'InlineCode9', taken_at: 1680000000, comment_count: 11 }]]]
    })]
  });
  await flush();

  const item = collect(messages).get('InlineCode9');
  assert.ok(item);
  assert.equal(item.ts, 1680000000);
  assert.equal(item.comments, 11);
});

test('타임스탬프도 지표도 없으면 버린다', async () => {
  const { sandbox, messages } = boot();
  sandbox.__nextBody = JSON.stringify({ items: [{ code: 'NoDataHere', caption: 'hi' }] });
  await sandbox.window.fetch('https://www.instagram.com/api/v1/x/');
  await flush();
  assert.equal(collect(messages).size, 0);
});

test('말이 안 되는 타임스탬프는 무시한다', async () => {
  const { sandbox, messages } = boot();
  sandbox.__nextBody = JSON.stringify({
    items: [{ code: 'WeirdTime1', taken_at: 12, comment_count: 5 }]
  });
  await sandbox.window.fetch('https://www.instagram.com/api/v1/x/');
  await flush();

  const item = collect(messages).get('WeirdTime1');
  assert.ok(item);
  assert.equal(item.ts, null, '범위를 벗어난 값은 null 이어야 한다');
  assert.equal(item.comments, 5);
});

test('JSON 이 아니어도 죽지 않는다', async () => {
  const { sandbox, messages } = boot();
  sandbox.__nextBody = '<!doctype html><html>"code" 라는 글자만 있는 문서</html>';
  await sandbox.window.fetch('https://www.instagram.com/api/v1/x/');
  await flush();
  assert.equal(messages.length, 0);
});
