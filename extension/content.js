// 노트 페이지에 저장 버튼을 띄우고, 페이지가 받아온 영상·이미지 주소로 내려받습니다.
// 보고 있는 페이지에서 그대로 동작하므로 로그인·차단 문제가 없습니다.
"use strict";

var latestNotes = [];
var button = null;
var statusLabel = null;

function currentNoteId() {
  var match = /(?:explore|item)\/([0-9a-f]{24})/i.exec(location.pathname);
  return match ? match[1].toLowerCase() : "";
}

function isNotePage() {
  return currentNoteId() !== "";
}

/** 지금 페이지의 노트를 고릅니다. 번호가 맞는 것이 없으면 하나뿐일 때만 인정합니다. */
function noteForThisPage() {
  var id = currentNoteId();
  for (var i = 0; i < latestNotes.length; i++) {
    if (latestNotes[i].noteId === id) return latestNotes[i];
  }
  return latestNotes.length === 1 ? latestNotes[0] : null;
}

// ---- 페이지에서 넘어오는 응답 모으기 ----------------------------------

window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  var data = event.data;
  if (!data || data.__xhsdl !== true || typeof data.text !== "string") return;

  var notes = extractNotes(data.text, currentNoteId());
  if (notes.length > 0) latestNotes = notes;

  // 일괄 작업 페이지도 이 내용을 씁니다.
  try {
    chrome.runtime.sendMessage({ type: "xhs-capture", url: location.href, text: data.text });
  } catch (error) {
    /* 확장이 갱신되는 중이면 무시합니다. */
  }

  refreshButton();
});

function askPageForState() {
  try {
    window.postMessage({ __xhsdlAsk: true }, "*");
  } catch (error) {}
}

// ---- 저장 버튼 --------------------------------------------------------

function makeButton() {
  var host = document.createElement("div");
  host.id = "xhsdl-button-host";
  // 샤오홍슈 CSS의 영향을 받지 않도록 그림자 DOM 안에 그립니다.
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML = [
    "<style>",
    ":host { all: initial; }",
    ".wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647;",
    "  font-family: 'Malgun Gothic', system-ui, sans-serif; }",
    ".btn { display: block; min-width: 132px; padding: 11px 16px; border: 0;",
    "  border-radius: 22px; background: #ff2442; color: #fff; font-size: 14px;",
    "  font-weight: 700; cursor: pointer; box-shadow: 0 3px 12px rgba(0,0,0,.28); }",
    ".btn:disabled { background: #bbb; cursor: default; }",
    ".msg { margin-top: 6px; padding: 5px 9px; border-radius: 6px; background: rgba(0,0,0,.78);",
    "  color: #fff; font-size: 12px; text-align: center; }",
    ".msg:empty { display: none; }",
    "</style>",
    '<div class="wrap"><button class="btn" type="button"></button><div class="msg"></div></div>',
  ].join("");

  (document.body || document.documentElement).appendChild(host);
  button = root.querySelector(".btn");
  statusLabel = root.querySelector(".msg");
  button.addEventListener("click", save);
}

function say(text) {
  if (statusLabel) statusLabel.textContent = text || "";
}

function refreshButton() {
  var host = document.getElementById("xhsdl-button-host");
  if (!isNotePage()) {
    if (host) host.style.display = "none";
    return;
  }
  if (!button) makeButton();
  document.getElementById("xhsdl-button-host").style.display = "";

  var note = noteForThisPage();
  if (!note) {
    button.textContent = "⬇ 준비 중…";
    button.disabled = true;
    return;
  }
  button.disabled = false;
  button.textContent = note.videoUrl
    ? "⬇ 영상 저장"
    : "⬇ 이미지 " + note.imageUrls.length + "장 저장";
}

function save() {
  var note = noteForThisPage();
  if (!note) {
    say("아직 영상 주소를 못 찾았습니다");
    askPageForState();
    return;
  }

  var urls = note.videoUrl ? [note.videoUrl] : note.imageUrls;
  if (urls.length === 0) {
    say("받을 수 있는 파일이 없습니다");
    return;
  }

  button.disabled = true;
  say("저장 중…");
  chrome.runtime.sendMessage(
    {
      type: "xhs-download",
      urls: urls,
      author: note.author,
      title: note.title,
      noteId: note.noteId || currentNoteId(),
      isVideo: Boolean(note.videoUrl),
    },
    function (response) {
      button.disabled = false;
      if (response && response.ok) {
        say("저장했습니다 (" + urls.length + "개)");
      } else {
        say("저장 실패: " + ((response && response.error) || "알 수 없는 오류"));
      }
      setTimeout(function () { say(""); }, 4000);
    }
  );
}

// ---- 페이지 이동 따라가기 ---------------------------------------------

var lastPath = location.pathname;
setInterval(function () {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  latestNotes = [];
  refreshButton();
  askPageForState();
}, 700);

function start() {
  refreshButton();
  askPageForState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
