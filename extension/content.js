// 페이지가 넘겨준 응답을 작업 페이지로 전달하는 다리 역할만 합니다.
window.addEventListener("message", function (event) {
  if (event.source !== window) return;
  var data = event.data;
  if (!data || data.__xhsdl !== true || typeof data.text !== "string") return;
  try {
    chrome.runtime.sendMessage({
      type: "xhs-capture",
      url: location.href,
      source: data.source,
      text: data.text,
    });
  } catch (error) {
    /* 확장이 갱신되는 중이면 무시합니다. */
  }
});
