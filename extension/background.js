// 아이콘 클릭 처리와, 실제 파일 저장을 맡습니다.
// (내려받기는 확장 전체에서 한 곳으로 모읍니다.)
"use strict";

importScripts("naming.js");

chrome.action.onClicked.addListener(async function () {
  var url = chrome.runtime.getURL("app.html");
  var existing = await chrome.tabs.query({ url: url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: url });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== "xhs-download") return;

  (async function () {
    try {
      var settings = await chrome.storage.local.get(["folder"]);
      var folder = safeName(settings.folder || "xiaohongshu", "xiaohongshu");
      var base = safeName(
        [message.author, message.title].filter(Boolean).join(" "),
        message.noteId || "note"
      );

      for (var i = 0; i < message.urls.length; i++) {
        var suffix = message.urls.length > 1 ? "_" + String(i + 1).padStart(2, "0") : "";
        var name =
          folder + "/" + base + suffix +
          extensionFor(message.urls[i], message.isVideo ? ".mp4" : ".jpg");
        await chrome.downloads.download({
          url: message.urls[i],
          filename: name,
          conflictAction: "uniquify",
          saveAs: false,
        });
      }
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    }
  })();

  return true; // 비동기 응답을 쓰겠다는 표시.
});
