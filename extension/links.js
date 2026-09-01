// 붙여넣은 공유 텍스트에서 노트 링크만 골라냅니다. (데스크톱 판 links.py 와 같은 규칙)
"use strict";

var URL_RE = /https?:\/\/[^\s<>"'\]]+/g;
var NOTE_ID_RE = /(?:item|explore|discovery\/item)\/([0-9a-f]{24})|\b([0-9a-f]{24})\b/i;

function noteIdFromUrl(url) {
  var match = NOTE_ID_RE.exec(url);
  if (!match) return "";
  return (match[1] || match[2] || "").toLowerCase();
}

function hostOf(url) {
  var rest = url.split("//")[1] || "";
  return rest.split("/")[0].toLowerCase();
}

/** 샤오홍슈 웹에서 현재 쓰는 /explore 형태로 맞춥니다. 쿼리(xsec_token)는 유지합니다. */
function exploreUrl(url) {
  var noteId = noteIdFromUrl(url);
  var host = hostOf(url);
  if (!noteId || host.indexOf("xiaohongshu.com") === -1) return url;
  var query = url.indexOf("?") !== -1 ? url.slice(url.indexOf("?") + 1) : "";
  var base = "https://www.xiaohongshu.com/explore/" + noteId;
  return query ? base + "?" + query : base;
}

/**
 * 번호·제목·토큰이 섞인 텍스트에서 링크 목록을 만듭니다.
 * 같은 노트가 여러 번 나오면 처음 것만 남깁니다.
 */
function extractLinks(text) {
  var matches = String(text || "").match(URL_RE) || [];
  var links = [];
  var seen = {};
  for (var i = 0; i < matches.length; i++) {
    var url = matches[i].replace(/[.,)\]]+$/, "");
    var host = hostOf(url);
    var isNote = host.indexOf("xiaohongshu.com") !== -1;
    var isShort = host.indexOf("xhslink.com") !== -1;
    if (!isNote && !isShort) continue;

    var noteId = isNote ? noteIdFromUrl(url) : "";
    if (isNote && !noteId) continue;

    var key = noteId || url;
    if (seen[key]) continue;
    seen[key] = true;
    links.push({ url: url, noteId: noteId, isShort: isShort });
  }
  return links;
}

if (typeof module !== "undefined") module.exports = { extractLinks: extractLinks, exploreUrl: exploreUrl, noteIdFromUrl: noteIdFromUrl };
