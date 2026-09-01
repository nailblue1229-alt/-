// 확장 프로그램의 링크 인식·주소 추출 로직 테스트.
// 실행: node --test tests/
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const links = require(path.join(__dirname, "..", "extension", "links.js"));
const extract = require(path.join(__dirname, "..", "extension", "extract.js"));

const NOTE_ID = "6a03cd76000000003501fda7";
const OTHER_ID = "6a101fc5000000003700fc9e";

// ---- 링크 인식 --------------------------------------------------------

test("번호·제목이 섞인 공유 텍스트에서 링크만 골라낸다", () => {
  const pasted = [
    "71 [终于让我发现一款超实用的电饭煲置物架了！ - 爱收纳的团子呀| rednote - 나만의 라이프스타일]",
    `YZPkJUjUDOFfRTq https://www.xiaohongshu.com/discovery/item/${NOTE_ID}` +
      "?source=webshare&xhsshare=pc_web&xsec_token=ABvAyuMyk1F-=&xsec_source=pc_share",
  ].join(" ");

  const found = links.extractLinks(pasted);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].noteId, NOTE_ID);
  assert.match(found[0].url, /xsec_token=ABvAyuMyk1F-=/);
});

test("같은 노트가 여러 번 나오면 한 번만 남긴다", () => {
  const text =
    `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}?xsec_token=A= ` +
    `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=B= ` +
    `https://www.xiaohongshu.com/explore/${OTHER_ID}?xsec_token=C=`;
  const found = links.extractLinks(text);
  assert.deepStrictEqual(found.map((item) => item.noteId), [NOTE_ID, OTHER_ID]);
});

test("샤오홍슈가 아닌 주소는 무시한다", () => {
  assert.deepStrictEqual(links.extractLinks("https://youtube.com/watch?v=abc"), []);
});

test("단축 링크는 노트 번호 없이도 남긴다", () => {
  const found = links.extractLinks("88 [다른 영상] http://xhslink.com/a/AbCdEf");
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].isShort, true);
});

test("예전 /discovery/item 경로를 /explore 로 바꾸고 쿼리는 유지한다", () => {
  const url = `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}?xsec_token=AB=&x=1`;
  assert.strictEqual(
    links.exploreUrl(url),
    `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=AB=&x=1`
  );
});

// ---- 주소 추출 --------------------------------------------------------

test("피드 API 응답(snake_case)에서 영상 주소를 뽑는다", () => {
  const payload = JSON.stringify({
    data: {
      items: [
        {
          id: NOTE_ID,
          note_card: {
            type: "video",
            title: "饭盒优等生",
            desc: "본문 설명",
            user: { nickname: "一碗小面面" },
            video: {
              media: {
                stream: {
                  h264: [
                    {
                      master_url: "https://sns-video-bd.xhscdn.com/abc.mp4",
                      backup_urls: ["https://sns-video-hw.xhscdn.com/abc.mp4"],
                    },
                  ],
                },
              },
            },
            image_list: [],
          },
        },
      ],
    },
  });

  const notes = extract.extractNotes(payload, NOTE_ID);
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].videoUrl, "https://sns-video-bd.xhscdn.com/abc.mp4");
  assert.strictEqual(notes[0].author, "一碗小面面");
  assert.strictEqual(notes[0].title, "饭盒优等生");
});

test("noteDetailMap 구조(camelCase)에서 노트 번호까지 살려낸다", () => {
  const payload = JSON.stringify({
    note: {
      noteDetailMap: {
        [OTHER_ID]: {
          note: {
            title: "제목",
            desc: "설명",
            user: { nickname: "작성자" },
            video: {
              media: { stream: { h264: [{ masterUrl: "https://sns-video-bd.xhscdn.com/x.mp4" }] } },
            },
            imageList: [],
          },
        },
      },
    },
  });

  const notes = extract.extractNotes(payload, "");
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].noteId, OTHER_ID);
  assert.strictEqual(notes[0].videoUrl, "https://sns-video-bd.xhscdn.com/x.mp4");
});

test("이미지 노트는 원본(WB_DFT)을 고른다", () => {
  const payload = JSON.stringify({
    data: {
      items: [
        {
          note_card: {
            title: "사진 노트",
            user: { nickname: "작가" },
            image_list: [
              {
                info_list: [
                  { image_scene: "WB_PRV", url: "https://a.xhscdn.com/prv.webp" },
                  { image_scene: "WB_DFT", url: "https://a.xhscdn.com/dft.webp" },
                ],
              },
              { url_default: "https://b.xhscdn.com/default.jpg?imageView=1" },
            ],
          },
        },
      ],
    },
  });

  const notes = extract.extractNotes(payload, "");
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].videoUrl, "");
  assert.deepStrictEqual(notes[0].imageUrls, [
    "https://a.xhscdn.com/dft.webp",
    "https://b.xhscdn.com/default.jpg",
  ]);
});

test("빈 껍데기(noteDetailMap.undefined)에서는 아무것도 뽑지 않는다", () => {
  // 실제로 브라우저 소스에서 관찰된 모양입니다.
  const payload = JSON.stringify({
    note: {
      noteDetailMap: {
        undefined: {
          comments: { list: [], cursor: "", hasMore: true },
          currentTime: 0,
          note: {},
        },
      },
    },
  });
  assert.deepStrictEqual(extract.extractNotes(payload, ""), []);
});

test("JSON 이 아닌 응답은 조용히 건너뛴다", () => {
  assert.deepStrictEqual(extract.extractNotes("<html>not json</html>", ""), []);
});

test("여러 노트가 섞여 오면 요청한 노트를 앞에 둔다", () => {
  const makeCard = (title, url) => ({
    note_card: {
      title,
      user: { nickname: "작가" },
      video: { media: { stream: { h264: [{ master_url: url }] } } },
    },
  });
  const payload = JSON.stringify({
    note: {
      noteDetailMap: {
        [OTHER_ID]: { note: makeCard("추천", "https://sns-video-bd.xhscdn.com/other.mp4").note_card },
        [NOTE_ID]: { note: makeCard("내가 찾던 것", "https://sns-video-bd.xhscdn.com/want.mp4").note_card },
      },
    },
  });

  const notes = extract.extractNotes(payload, NOTE_ID);
  assert.strictEqual(notes[0].noteId, NOTE_ID);
  assert.strictEqual(notes[0].videoUrl, "https://sns-video-bd.xhscdn.com/want.mp4");
});
