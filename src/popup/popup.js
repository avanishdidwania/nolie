import { MSG } from '../lib/constants.js';

const scanBtn = document.getElementById('scanBtn');
const openPanelBtn = document.getElementById('openPanelBtn');
const optionsLink = document.getElementById('optionsLink');
const historyLink = document.getElementById('historyLink');

scanBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  chrome.runtime.sendMessage({ type: MSG.SCAN_PAGE, tabId: tab.id });
  window.close();
});

// Live fact-check — must be triggered from popup for activeTab permission
const liveCaptionsBtn = document.getElementById('liveCaptionsBtn');
liveCaptionsBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ type: 'START_LIVE', tabId: tab.id, mode: 'captions' });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

const liveAudioBtn = document.getElementById('liveAudioBtn');
liveAudioBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ type: 'START_LIVE', tabId: tab.id, mode: 'audio' });
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

openPanelBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  window.close();
});

optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

historyLink.addEventListener('click', async (e) => {
  e.preventDefault();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.sidePanel.open({ tabId: tab.id });
  setTimeout(() => chrome.runtime.sendMessage({ type: MSG.GET_HISTORY }), 300);
  window.close();
});
