chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "OPEN_SIDEPANEL") return;
  const tabId = sender.tab?.id;
  if (tabId) chrome.sidePanel.open({ tabId }).then(() => sendResponse({ ok: true }));
  return true;
});
