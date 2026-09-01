// 페이지와 같은 실행 공간에서 돌면서, 샤오홍슈가 노트 데이터를 받아오는
// 응답을 그대로 엿듣습니다. HTML에는 영상 주소가 없고 이 응답에만 있습니다.
(function () {
  "use strict";

  var MARKERS = ["note_card", "noteDetailMap", "masterUrl", "master_url", "imageList", "image_list"];
  var MAX_BYTES = 4000000;

  function looksUseful(text) {
    if (!text || text.length > MAX_BYTES) return false;
    for (var i = 0; i < MARKERS.length; i++) {
      if (text.indexOf(MARKERS[i]) !== -1) return true;
    }
    return false;
  }

  function report(source, text) {
    try {
      window.postMessage({ __xhsdl: true, source: source, text: text }, "*");
    } catch (error) {
      /* 창이 닫히는 중이면 무시합니다. */
    }
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function () {
      var promise = originalFetch.apply(this, arguments);
      promise
        .then(function (response) {
          try {
            response
              .clone()
              .text()
              .then(function (text) {
                if (looksUseful(text)) report("fetch", text);
              })
              .catch(function () {});
          } catch (error) {}
          return response;
        })
        .catch(function () {});
      return promise;
    };
  }

  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    this.addEventListener("load", function () {
      try {
        var text = typeof this.responseText === "string" ? this.responseText : "";
        if (looksUseful(text)) report("xhr", text);
      } catch (error) {}
    });
    return open.apply(this, arguments);
  };

  // 응답을 못 잡은 경우를 대비해, 화면이 다 그려진 뒤 페이지가 들고 있는
  // 데이터도 한 번 넘겨봅니다.
  function reportState() {
    try {
      var state = window.__INITIAL_STATE__;
      if (!state) return;
      var text = JSON.stringify(state);
      if (looksUseful(text)) report("state", text);
    } catch (error) {}
  }
  setTimeout(reportState, 2500);
  setTimeout(reportState, 6000);
})();
