// 파일 이름 만들기. 작업 페이지와 배경 스크립트가 같은 규칙을 씁니다.
"use strict";

var MAX_NAME_LEN = 80;

/** 윈도우/맥/리눅스 모두에서 안전한 파일명 조각으로 정리합니다. */
function safeName(text, fallback) {
  var name = String(text || "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.]+|[\s.]+$/g, "");
  if (name.length > MAX_NAME_LEN) {
    name = name.slice(0, MAX_NAME_LEN).replace(/[\s.]+$/, "");
  }
  return name || fallback;
}

/** 주소 끝의 확장자를 살립니다. 없으면 기본값을 씁니다. */
function extensionFor(url, fallback) {
  var tail = String(url || "").split("?")[0].split("/").pop() || "";
  var dot = tail.lastIndexOf(".");
  if (dot !== -1) {
    var ext = tail.slice(dot).toLowerCase();
    if (ext.length >= 2 && ext.length <= 6 && /^\.[a-z0-9]+$/.test(ext)) return ext;
  }
  return fallback;
}

if (typeof module !== "undefined") {
  module.exports = { safeName: safeName, extensionFor: extensionFor };
}
