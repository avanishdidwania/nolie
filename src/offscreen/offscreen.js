/**
 * NoLie Offscreen Document
 * Captures tab audio via mediaStream and streams to Deepgram WebSocket
 * for real-time transcription.
 */

let mediaStream = null;
let audioContext = null;
let processor = null;
let socket = null;
let active = false;
let utteranceBuffer = '';

// Backend URL for token issuance
const BACKEND_URL = 'https://nolie-backend.vercel.app';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    startCapture(msg.streamId, msg.language || 'en')
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'STOP_CAPTURE') {
    stopCapture();
    sendResponse({ ok: true });
  }
});

async function startCapture(streamId, language) {
  if (active) stopCapture();
  active = true;

  // Get temporary Deepgram token from backend
  let token;
  try {
    const res = await fetch(`${BACKEND_URL}/api/deepgram-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('Token fetch failed: ' + res.status);
    const data = await res.json();
    token = data.token;
    if (!token) throw new Error('No token in response');
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'LIVE_ERROR', message: 'Failed to get Deepgram token: ' + e.message });
    active = false;
    throw e;
  }

  // Capture tab audio stream
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    });
  } catch (e) {
    chrome.runtime.sendMessage({ type: 'LIVE_ERROR', message: 'Audio capture failed: ' + e.message });
    active = false;
    throw e;
  }

  // Connect to Deepgram WebSocket
  const wsUrl = 'wss://api.deepgram.com/v1/listen?' + [
    'encoding=linear16',
    'sample_rate=16000',
    'channels=1',
    'model=nova-2',
    'language=' + language,
    'punctuate=true',
    'interim_results=false',
    'utterance_end_ms=1500',
    'smart_format=true',
  ].join('&');

  socket = new WebSocket(wsUrl, ['token', token]);

  socket.onopen = () => {
    console.log('[NoLie Offscreen] Deepgram connected');
    startAudioPipeline();
    chrome.runtime.sendMessage({ type: 'LIVE_CONNECTED' });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'UtteranceEnd') {
        if (utteranceBuffer.trim()) {
          chrome.runtime.sendMessage({
            type: 'TRANSCRIPT_FINAL',
            text: utteranceBuffer.trim(),
          });
          utteranceBuffer = '';
        }
        return;
      }

      const result = data.channel?.alternatives?.[0];
      if (!result || !result.transcript) return;

      const text = result.transcript.trim();
      if (!text) return;

      const isFinal = data.is_final;
      const speechFinal = data.speech_final;

      if (isFinal && speechFinal) {
        // End of utterance
        const fullText = utteranceBuffer ? utteranceBuffer + ' ' + text : text;
        utteranceBuffer = '';
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_FINAL',
          text: fullText.trim(),
        });
      } else if (isFinal) {
        // Partial final — accumulate
        utteranceBuffer += (utteranceBuffer ? ' ' : '') + text;
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_INTERIM',
          text: utteranceBuffer,
        });
      }
    } catch (e) {
      console.error('[NoLie Offscreen] Parse error:', e);
    }
  };

  socket.onerror = (err) => {
    console.error('[NoLie Offscreen] WebSocket error:', err);
    chrome.runtime.sendMessage({ type: 'LIVE_ERROR', message: 'Transcription error' });
  };

  socket.onclose = (e) => {
    console.log('[NoLie Offscreen] WebSocket closed:', e.code);
    if (active && e.code !== 1000) {
      chrome.runtime.sendMessage({ type: 'LIVE_ERROR', message: 'Transcription disconnected (code ' + e.code + ')' });
    }
  };
}

function startAudioPipeline() {
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // Connect source to destination so user can still hear the audio
  source.connect(audioContext.destination);

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const float32 = e.inputBuffer.getChannelData(0);
    // Convert float32 to int16 for Deepgram
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
    }
    socket.send(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

function stopCapture() {
  active = false;
  utteranceBuffer = '';

  if (socket) {
    socket.close(1000);
    socket = null;
  }
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
}
