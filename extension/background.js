// 아이콘을 누르면 작업 페이지를 엽니다. 이미 열려 있으면 그 탭으로 이동합니다.
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
