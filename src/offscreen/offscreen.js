// offscreen.js
// Captures tab audio via tabCapture and streams to Deepgram WebSocket.
// Matches InTruth's proven approach exactly.

let DEEPGRAM_KEY = '';
let mediaStream = null;
let audioContext = null;
let processor = null;
let socket = null;
let active = false;
let utteranceBuffer = '';

async function fetchDeepgramToken() {
  const res = await fetch('https://nolie-backend.vercel.app/api/deepgram-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('Failed to fetch Deepgram token: ' + res.status);
  const data = await res.json();
  if (!data.token) throw new Error('No token in response');
  return data.token;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    startCapture(msg.streamId, msg.language || 'en')
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[offscreen] error:', err);
        sendResponse({ ok: false, error: err.message });
      });
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

  // fetch Deepgram token from backend
  DEEPGRAM_KEY = await fetchDeepgramToken();

  // get tab audio stream
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });

  // connect deepgram websocket
  socket = new WebSocket(
    'wss://api.deepgram.com/v1/listen?' + [
      'encoding=linear16',
      'sample_rate=16000',
      'channels=1',
      'model=nova-2',
      'language=' + language,
      'punctuate=true',
      'interim_results=true',
      'utterance_end_ms=2500',
      'smart_format=true',
      'vad_events=true',
    ].join('&'),
    ['token', DEEPGRAM_KEY]
  );

  socket.onopen = () => {
    console.log('[offscreen] deepgram connected');
    chrome.runtime.sendMessage({ type: 'LIVE_CONNECTED' }).catch(() => {});
    startAudioPipeline();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'UtteranceEnd') {
        if (utteranceBuffer.trim()) {
          chrome.runtime.sendMessage({ type: 'TRANSCRIPT_FINAL', text: utteranceBuffer.trim() }).catch(() => {});
          utteranceBuffer = '';
        }
        return;
      }

      const result = data.channel?.alternatives?.[0];
      if (!result || !result.transcript) return;

      const text = result.transcript.trim();
      const isFinal = data.is_final;
      const speech = data.speech_final;

      if (!text) return;

      if (isFinal && speech) {
        const fullText = utteranceBuffer ? utteranceBuffer + ' ' + text : text;
        utteranceBuffer = '';
        chrome.runtime.sendMessage({ type: 'TRANSCRIPT_FINAL', text: fullText.trim() }).catch(() => {});
      } else if (isFinal && !speech) {
        utteranceBuffer += (utteranceBuffer ? ' ' : '') + text;
        chrome.runtime.sendMessage({ type: 'TRANSCRIPT_INTERIM', text: utteranceBuffer }).catch(() => {});
      }
    } catch (err) {
      console.error('[offscreen] message parse error:', err);
    }
  };

  socket.onerror = (err) => {
    console.error('[offscreen] deepgram error:', err);
    chrome.runtime.sendMessage({ type: 'LIVE_ERROR', message: 'Deepgram connection error. Check API key.' }).catch(() => {});
  };

  socket.onclose = (e) => {
    console.log('[offscreen] deepgram closed:', e.code, e.reason);
    if (active && e.code !== 1000) {
      chrome.runtime.sendMessage({ type: 'LIVE_ERROR', message: 'Deepgram disconnected (code ' + e.code + ')' }).catch(() => {});
    }
  };
}

function startAudioPipeline() {
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // reconnect so user still hears audio
  source.connect(audioContext.destination);

  processor = audioContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    if (socket?.readyState !== WebSocket.OPEN) return;

    const float32 = e.inputBuffer.getChannelData(0);
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
    }
    socket.send(int16.buffer);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  console.log('[offscreen] audio pipeline started');
}

function stopCapture() {
  active = false;
  utteranceBuffer = '';
  if (socket) { socket.close(); socket = null; }
  if (processor) { processor.disconnect(); processor = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
}
