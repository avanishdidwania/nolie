import { STORAGE_KEY, MODEL, GROQ_MODEL, GROQ_BASE_URL, DEFAULT_VERIFY_PROMPT } from '../lib/constants.js';

const groqKeyInput = document.getElementById('groqKeyInput');
const toggleGroqBtn = document.getElementById('toggleGroqBtn');
const saveGroqBtn = document.getElementById('saveGroqBtn');
const groqStatus = document.getElementById('groqStatus');
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleKeyBtn = document.getElementById('toggleKeyBtn');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const keyStatus = document.getElementById('keyStatus');
const analyzeImages = document.getElementById('analyzeImages');
const crossVerify = document.getElementById('crossVerify');
const agentMode = document.getElementById('agentMode');
const saveHistory = document.getElementById('saveHistory');
const maxClaims = document.getElementById('maxClaims');
const promptTextarea = document.getElementById('promptTextarea');
const resetPromptBtn = document.getElementById('resetPromptBtn');

async function loadSettings() {
  const data = await chrome.storage.local.get([STORAGE_KEY.API_KEY, STORAGE_KEY.GROQ_KEY, STORAGE_KEY.SETTINGS]);
  if (data[STORAGE_KEY.API_KEY]) apiKeyInput.value = data[STORAGE_KEY.API_KEY];
  if (data[STORAGE_KEY.GROQ_KEY]) groqKeyInput.value = data[STORAGE_KEY.GROQ_KEY];
  const s = data[STORAGE_KEY.SETTINGS] || {};
  analyzeImages.checked = s.analyzeImages !== false;
  crossVerify.checked = s.crossVerify === true;
  agentMode.checked = s.agentMode === true;
  saveHistory.checked = s.saveHistory !== false;
  maxClaims.value = s.maxClaims || '10';
  promptTextarea.value = s.customPrompt || DEFAULT_VERIFY_PROMPT;
}

// Groq key toggle
toggleGroqBtn.addEventListener('click', () => {
  const isPassword = groqKeyInput.type === 'password';
  groqKeyInput.type = isPassword ? 'text' : 'password';
  toggleGroqBtn.textContent = isPassword ? '🙈' : '👁';
});

// Save & test Groq key
saveGroqBtn.addEventListener('click', async () => {
  const key = groqKeyInput.value.trim();
  if (!key) { showGroqStatus('Please enter a Groq API key.', 'error'); return; }
  showGroqStatus('Testing Groq key...', 'info');
  saveGroqBtn.disabled = true;
  try {
    const res = await fetch(GROQ_BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 10,
      }),
    });
    if (res.ok) {
      await chrome.storage.local.set({ [STORAGE_KEY.GROQ_KEY]: key });
      showGroqStatus('Groq key saved and verified!', 'success');
    } else {
      const err = await res.json();
      showGroqStatus('Error: ' + (err?.error?.message || 'Invalid key'), 'error');
    }
  } catch (e) { showGroqStatus('Connection error: ' + e.message, 'error'); }
  finally { saveGroqBtn.disabled = false; }
});

// Gemini key toggle
toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  toggleKeyBtn.textContent = isPassword ? '🙈' : '👁';
});

// Save & test Gemini key
saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus('Please enter an API key.', 'error'); return; }
  showStatus('Testing Gemini key...', 'info');
  saveKeyBtn.disabled = true;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Say hello' }] }], generationConfig: { maxOutputTokens: 10 } }) }
    );
    if (res.ok) {
      await chrome.storage.local.set({ [STORAGE_KEY.API_KEY]: key });
      showStatus('Gemini key saved and verified!', 'success');
    } else {
      const err = await res.json();
      showStatus('Error: ' + (err?.error?.message || 'Invalid key'), 'error');
    }
  } catch (e) { showStatus('Connection error: ' + e.message, 'error'); }
  finally { saveKeyBtn.disabled = false; }
});

// Preferences
function savePreferences() {
  chrome.storage.local.set({ [STORAGE_KEY.SETTINGS]: {
    analyzeImages: analyzeImages.checked,
    crossVerify: crossVerify.checked,
    agentMode: agentMode.checked,
    saveHistory: saveHistory.checked, maxClaims: maxClaims.value,
    customPrompt: promptTextarea.value,
  }});
}
analyzeImages.addEventListener('change', savePreferences);
crossVerify.addEventListener('change', savePreferences);
agentMode.addEventListener('change', savePreferences);
saveHistory.addEventListener('change', savePreferences);
maxClaims.addEventListener('change', savePreferences);

// Auto-save prompt on edit (debounced)
let promptTimer = null;
promptTextarea.addEventListener('input', () => {
  clearTimeout(promptTimer);
  promptTimer = setTimeout(savePreferences, 800);
});
resetPromptBtn.addEventListener('click', () => {
  promptTextarea.value = DEFAULT_VERIFY_PROMPT;
  savePreferences();
});

function showStatus(msg, type) { keyStatus.textContent = msg; keyStatus.className = 'status ' + type; }
function showGroqStatus(msg, type) { groqStatus.textContent = msg; groqStatus.className = 'status ' + type; }

loadSettings();
