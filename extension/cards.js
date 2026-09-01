// 목록(저장·검색·피드)의 카드마다 다운로드 버튼을 붙입니다.
//
// 목록 응답에는 표지 이미지만 있고 영상 주소가 없습니다. 그래서 버튼을 누르면
// 그 노트를 잠깐 열어(사이트가 하는 것과 같은 클릭) 주소를 읽고, 받은 뒤 닫습니다.
"use strict";

var CARD_LINK_SELECTOR = 'a[href*="/explore/"], a[href*="/discovery/item/"]';
var OPEN_TIMEOUT_MS = 20000;
var MARK = "xhsdlCard";

var queue = [];
var working = false;

/** content.js 가 "카드 N개 인식됨" 표시에 씁니다. 화면에서 직접 셉니다. */
function cardCount() {
  return document.querySelectorAll("[data-xhsdl-note]").length;
}

function cardNoteId(href) {
  var match = /(?:explore|item)\/([0-9a-f]{24})/i.exec(href || "");
  return match ? match[1].toLowerCase() : "";
}

/** 버튼을 얹을 상자를 고릅니다. 링크가 표지 전체를 감싸는 것이 보통입니다. */
function containerFor(anchor) {
  var node = anchor;
  for (var depth = 0; depth < 3 && node; depth++) {
    var box = node.getBoundingClientRect();
    if (box.width >= 80 && box.height >= 80) return node;
    node = node.parentElement;
  }
  return anchor;
}

function makeCardButton(noteId, href) {
  var button = document.createElement("button");
  button.type = "button";
  button.textContent = "⬇";
  button.title = "이 노트 저장";
  button.setAttribute("data-xhsdl-note", noteId);
  button.style.cssText = [
    "position:absolute", "top:8px", "left:8px", "z-index:99",
    "width:30px", "height:30px", "padding:0", "border:0", "border-radius:50%",
    "background:rgba(255,36,66,.92)", "color:#fff", "font-size:15px",
    "line-height:30px", "cursor:pointer", "box-shadow:0 1px 5px rgba(0,0,0,.3)",
  ].join(";");

  button.addEventListener("click", function (event) {
    // 카드를 여는 사이트 기본 동작을 막고, 우리 순서대로 처리합니다.
    event.preventDefault();
    event.stopPropagation();
    enqueue({ noteId: noteId, href: href, button: button });
  });
  return button;
}

function decorateCards() {
  var anchors = document.querySelectorAll(CARD_LINK_SELECTOR);
  for (var i = 0; i < anchors.length; i++) {
    var anchor = anchors[i];
    var noteId = cardNoteId(anchor.getAttribute("href"));
    if (!noteId) continue;

    var container = containerFor(anchor);
    if (container.dataset[MARK]) continue;
    // 표지와 제목이 각각 링크인 카드가 있어, 같은 노트에 두 번 붙지 않게 합니다.
    if (container.querySelector('[data-xhsdl-note="' + noteId + '"]')) continue;
    // 노트를 연 화면(팝업) 안의 링크에는 붙이지 않습니다. 거기엔 큰 버튼이 있습니다.
    if (container.closest("#noteContainer, .note-detail-mask")) continue;

    container.dataset[MARK] = "1";
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(makeCardButton(noteId, anchor.href));
  }
}

// ---- 하나씩 처리 ------------------------------------------------------

function enqueue(job) {
  queue.push(job);
  job.button.textContent = "…";
  job.button.disabled = true;
  if (!working) processQueue();
}

async function processQueue() {
  working = true;
  while (queue.length > 0) {
    var job = queue.shift();
    try {
      await handle(job);
    } catch (error) {
      mark(job.button, "!", "실패: " + error);
    }
    await wait(800);
  }
  working = false;
}

function mark(button, text, title) {
  button.textContent = text;
  button.disabled = false;
  if (title) button.title = title;
  setTimeout(function () { button.textContent = "⬇"; }, 3000);
}

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/** 노트가 열려 그 주소가 잡힐 때까지 기다립니다. (content.js 가 채워 줍니다) */
function waitForNote(noteId) {
  return new Promise(function (resolve) {
    var deadline = Date.now() + OPEN_TIMEOUT_MS;
    var timer = setInterval(function () {
      var note = noteById(noteId);
      if (note) {
        clearInterval(timer);
        resolve(note);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        resolve(null);
      }
    }, 400);
  });
}

function closeOpenNote(previousPath) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
  if (location.pathname !== previousPath) history.back();
}

async function handle(job) {
  var previousPath = location.pathname;

  // 이미 받아 둔 주소가 있으면 열 것도 없습니다.
  var note = noteById(job.noteId);
  if (!note) {
    forgetNotes();
    // 사이트가 하는 것과 똑같이 카드를 엽니다.
    var anchor = document.querySelector('a[href*="' + job.noteId + '"]');
    if (anchor) {
      anchor.click();
    } else {
      location.href = job.href;
    }
    note = await waitForNote(job.noteId);
    closeOpenNote(previousPath);
  }

  if (!note) {
    mark(job.button, "!", "영상 주소를 찾지 못했습니다. 노트를 직접 열어 보세요.");
    return;
  }

  var urls = note.videoUrl ? [note.videoUrl] : note.imageUrls;
  if (urls.length === 0) {
    mark(job.button, "!", "받을 수 있는 파일이 없습니다.");
    return;
  }

  await new Promise(function (resolve) {
    chrome.runtime.sendMessage(
      {
        type: "xhs-download",
        urls: urls,
        author: note.author,
        title: note.title,
        noteId: note.noteId || job.noteId,
        isVideo: Boolean(note.videoUrl),
      },
      function (response) {
        if (response && response.ok) {
          mark(job.button, "✓", "저장했습니다: " + (note.title || ""));
        } else {
          mark(job.button, "!", "저장 실패: " + ((response && response.error) || ""));
        }
        resolve();
      }
    );
  });
}

// 목록은 스크롤할수록 카드가 늘어납니다.
setInterval(decorateCards, 1200);
