/* manifest.json 이 실제로 존재하는 파일만 가리키는지 확인 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('manifest 기본 항목', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.name && manifest.description);
});

test('참조하는 파일이 모두 존재한다', () => {
  const refs = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((cs) => [...(cs.js || []), ...(cs.css || [])])
  ];
  for (const rel of refs) assert.ok(exists(rel), `${rel} 파일이 없다`);
});

test('인스타그램 외 사이트에는 붙지 않는다', () => {
  const patterns = [
    ...manifest.host_permissions,
    ...manifest.content_scripts.flatMap((cs) => cs.matches)
  ];
  for (const p of patterns) {
    assert.match(p, /^https:\/\/(www\.)?instagram\.com\//, `${p} 범위가 너무 넓다`);
  }
});

test('format.js 가 content.js 보다 먼저 로드된다', () => {
  const iso = manifest.content_scripts.find((cs) => cs.world === 'ISOLATED');
  assert.deepEqual(iso.js, ['src/format.js', 'src/content.js']);
});

test('world:MAIN 을 쓰므로 최소 크로미움 버전을 선언한다', () => {
  const usesMainWorld = manifest.content_scripts.some((cs) => cs.world === 'MAIN');
  if (usesMainWorld) {
    assert.ok(Number(manifest.minimum_chrome_version) >= 111,
      'world:"MAIN" 콘텐츠 스크립트는 크로미움 111 이상이 필요하다');
  }
});

test('필요한 권한만 요청한다', () => {
  // 진단 패널이 tabs.query 를 쓰지만, 인스타그램 host_permissions 만으로 충분하다.
  // "방문 기록 읽기" 경고가 뜨는 tabs 권한은 요청하지 않는다.
  assert.deepEqual(manifest.permissions, ['storage']);
});
