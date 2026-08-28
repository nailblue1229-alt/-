/*
 * 확장 프로그램을 실제 크로미움에 로드해서, 인스타그램과 같은 구조의 가짜 페이지에
 * 배지가 정말 그려지는지 확인한다.
 *
 * 네트워크 요청은 전부 가로채 로컬에서 응답하므로 실제 인스타그램에는 접속하지 않는다.
 * 다만 페이지 오리진은 https://www.instagram.com 이라 콘텐츠 스크립트가 정상 주입된다.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const POSTS = [
  { code: 'ReelAAAAAA1', taken_at: 1756339200, play_count: 152340, comment_count: 412, like_count: 9876, product_type: 'clips' },
  { code: 'ReelBBBBBB2', taken_at: 1756252800, play_count: 8231, comment_count: 57, like_count: 1203, product_type: 'clips' },
  { code: 'PhotoCCCCC3', taken_at: 1756166400, comment_count: 8, like_count: 300, media_type: 1 }
];

const PAGE_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>가짜 인스타그램 프로필</title>
<style>
  body { margin: 0; font-family: sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(3, 180px); gap: 4px; padding: 20px; }
  .grid a { display: block; width: 180px; height: 240px; overflow: hidden; }
  .grid img { width: 100%; height: 100%; object-fit: cover; }
</style></head>
<body>
  <div class="grid">
    ${POSTS.map((p, i) => `<a href="/p/${p.code}/"><img alt="post ${i}" src="/thumb.png"></a>`).join('\n    ')}
  </div>
  <script>
    // 인스타그램 웹앱이 하듯이 자체 API 를 호출한다
    fetch('/api/v1/feed/user/12345/')
      .then((r) => r.json())
      .then((d) => { window.__loaded = d.items.length; });
  </script>
</body></html>`;

// 1x1 투명 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} - ${name}${detail ? `  (${detail})` : ''}`);
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igpd-e2e-'));

// 확장 프로그램은 headless shell 이 아니라 완전한 크로미움에서만 로드된다
const CHROME = process.env.IGPD_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ctx = await chromium.launchPersistentContext(userDataDir, {
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  headless: false,
  args: [
    '--headless=new',
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
    '--no-sandbox'
  ]
});

try {
  const page = await ctx.newPage();

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/v1/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: POSTS, status: 'ok' })
      });
    }
    if (url.pathname.endsWith('.png')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (url.pathname.includes('/embed/')) {
      return route.fulfill({ status: 404, contentType: 'text/html', body: 'not found' });
    }
    // 인스타그램처럼 엄격한 CSP 를 붙여, 페이지 월드 주입이 막히지 않는지도 함께 확인한다
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: process.env.IGPD_NO_CSP ? {} : {
        'content-security-policy':
          "default-src 'self'; script-src 'self' 'unsafe-inline' *.cdninstagram.com; " +
          "connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'"
      },
      body: PAGE_HTML
    });
  });

  await page.goto('https://www.instagram.com/someone/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__loaded === 3, null, { timeout: 10000 });

  // 배지가 그려질 때까지 기다린다
  await page.waitForSelector('.igpd-badge', { timeout: 10000 });
  const badges = await page.$$('.igpd-badge');
  check('썸네일마다 배지가 붙는다', badges.length === 3, `${badges.length}/3`);

  const first = await page.evaluate(() => {
    const a = document.querySelector('a[href="/p/ReelAAAAAA1/"]');
    const b = a && a.querySelector('.igpd-badge');
    if (!b) return null;
    return {
      text: b.innerText.replace(/\s+/g, ' ').trim(),
      date: b.querySelector('.igpd-date')?.innerText.trim() || null,
      views: b.querySelector('.igpd-views')?.innerText.trim() || null,
      comments: b.querySelector('.igpd-comments')?.innerText.trim() || null,
      likes: b.querySelector('.igpd-likes')?.innerText.trim() || null,
      visible: b.getBoundingClientRect().width > 0
    };
  });

  check('릴스 배지가 존재한다', first !== null, JSON.stringify(first));
  if (first) {
    check('날짜가 보인다', /\d{2}\.\d{2}/.test(first.date || ''), first.date);
    check('조회수가 보인다', (first.views || '').includes('15.2만'), first.views);
    check('댓글수가 보인다', (first.comments || '').includes('412'), first.comments);
    check('좋아요는 기본으로 숨김', first.likes === null, String(first.likes));
    check('배지가 실제로 화면에 그려진다', first.visible === true);
  }

  const photo = await page.evaluate(() => {
    const a = document.querySelector('a[href="/p/PhotoCCCCC3/"]');
    const b = a && a.querySelector('.igpd-badge');
    return b ? {
      views: b.querySelector('.igpd-views')?.innerText.trim() || null,
      comments: b.querySelector('.igpd-comments')?.innerText.trim() || null
    } : null;
  });
  check('사진 게시물은 조회수 없이 댓글수만', photo && photo.views === null && (photo.comments || '').includes('8'),
    JSON.stringify(photo));

  // 좁은 썸네일(180px)이라 날짜가 짧은 형태여야 한다
  check('좁은 썸네일에서는 짧은 날짜', first && !/\d{4}\./.test(first.date || ''), first && first.date);

  // 팝업이 쓰는 것과 같은 경로(chrome.tabs.sendMessage)로 진단을 실제로 물어본다
  const [existing] = ctx.serviceWorkers();
  const sw = existing || await ctx.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
  check('서비스 워커가 뜬다', Boolean(sw), sw ? new URL(sw.url()).host : 'none');

  const askDiag = () => sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    if (!tabs.length) return null;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'IGPD_DIAG' }, (r) =>
        resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r));
    });
  }).catch((e) => ({ error: String(e) }));

  // 통계는 500ms 간격으로 넘어오므로, 도착할 때까지 잠깐 기다린다
  let diag = null;
  if (sw) {
    const deadline = Date.now() + 5000;
    do {
      diag = await askDiag();
      if (diag && !diag.error && diag.net && diag.net.parsed >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);
  }

  check('진단 질의에 응답한다', Boolean(diag && !diag.error), diag && diag.error);
  if (diag && !diag.error) {
    check('진단: 확장 실행 중으로 보고', diag.enabled === true && diag.formatLoaded === true);
    check('진단: 게시물 링크를 찾았다고 보고', diag.dom.posts === 3, `posts=${diag.dom.posts}`);
    check('진단: 배지를 그렸다고 보고', diag.drawn === 3, `drawn=${diag.drawn}, noData=${diag.noData}`);
    check('진단: 가로챈 응답이 잡혔다고 보고', diag.net.parsed >= 1, JSON.stringify(diag.net));
    check('진단: 오류 없음', diag.lastError === null, String(diag.lastError));
    check('진단: 버전을 보고한다', diag.version === '1.1.0', diag.version);
  }

  const shotDir = path.join(ROOT, 'docs');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, 'screenshot-grid.png'), clip: { x: 0, y: 0, width: 592, height: 290 } });

  // 팝업 페이지가 오류 없이 뜨는지 확인
  const extId = sw ? new URL(sw.url()).host : null;
  if (extId) {
    const popup = await ctx.newPage();
    const errors = [];
    popup.on('pageerror', (e) => errors.push(e.message));
    await popup.goto(`chrome-extension://${extId}/src/popup.html`);
    await popup.waitForSelector('#diag');
    check('팝업이 오류 없이 열린다', errors.length === 0, errors.join(' / '));

    const controls = await popup.evaluate(() =>
      ['enabled', 'showDate', 'showViews', 'showComments', 'showLikes', 'dateFormat',
       'position', 'fontSize', 'autoFetch', 'diag', 'copyDiag', 'refreshDiag']
        .filter((id) => !document.getElementById(id)));
    check('팝업 컨트롤이 모두 있다', controls.length === 0, controls.join(','));

    await popup.setViewportSize({ width: 340, height: 900 });
    await popup.screenshot({ path: path.join(shotDir, 'screenshot-popup.png'), fullPage: true });
  }
} finally {
  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
