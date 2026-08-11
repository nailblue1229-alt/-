const state = {
  apiKey: localStorage.getItem('elevenlabs_api_key') || '',
  voices: [],
  stability: 0.5
};

const el = (id) => document.getElementById(id);

const apiKeyDialog = el('apiKeyDialog');
const apiKeyBtn = el('apiKeyBtn');
const apiKeyInput = el('apiKeyInput');
const voiceSelect = el('voiceSelect');
const voiceIdDisplay = el('voiceIdDisplay');
const scriptInput = el('scriptInput');
const stabilityGroup = el('stabilityGroup');
const emotionPanel = el('emotionPanel');
const emotionAdjustBtn = el('emotionAdjustBtn');
const emotionTagBtn = el('emotionTagBtn');
const generateBtn = el('generateBtn');
const statusEl = el('status');
const resultArea = el('resultArea');
const audioPlayer = el('audioPlayer');
const downloadLink = el('downloadLink');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function updateVoiceId() {
  const selected = state.voices.find((v) => v.voice_id === voiceSelect.value);
  voiceIdDisplay.value = selected ? selected.voice_id : '-';
}

async function loadVoices() {
  if (!state.apiKey) {
    voiceSelect.innerHTML = '<option value="">API 키를 먼저 설정하세요</option>';
    voiceIdDisplay.value = '-';
    return;
  }

  setStatus('보이스 목록을 불러오는 중...');
  try {
    const res = await fetch('/api/voices', {
      headers: { 'xi-api-key': state.apiKey }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '보이스 조회에 실패했습니다.');

    state.voices = data.voices || [];
    if (state.voices.length === 0) {
      voiceSelect.innerHTML = '<option value="">등록된 보이스가 없습니다</option>';
    } else {
      voiceSelect.innerHTML = state.voices
        .map((v) => `<option value="${v.voice_id}">${v.name}</option>`)
        .join('');
    }
    updateVoiceId();
    setStatus('');
  } catch (err) {
    setStatus(`보이스 목록을 불러오지 못했습니다: ${err.message}`, true);
  }
}

voiceSelect.addEventListener('change', updateVoiceId);

stabilityGroup.addEventListener('click', (event) => {
  const btn = event.target.closest('.seg-btn');
  if (!btn) return;
  [...stabilityGroup.children].forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.stability = parseFloat(btn.dataset.value);
});

function toggleEmotionPanel() {
  emotionPanel.classList.toggle('hidden');
}
emotionAdjustBtn.addEventListener('click', toggleEmotionPanel);
emotionTagBtn.addEventListener('click', toggleEmotionPanel);

emotionPanel.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-tag]');
  if (!btn) return;
  const tag = btn.dataset.tag;
  const start = scriptInput.selectionStart;
  const end = scriptInput.selectionEnd;
  const value = scriptInput.value;
  scriptInput.value = `${value.slice(0, start)}${tag} ${value.slice(end)}`;
  scriptInput.focus();
  const cursor = start + tag.length + 1;
  scriptInput.selectionStart = scriptInput.selectionEnd = cursor;
});

generateBtn.addEventListener('click', async () => {
  if (!state.apiKey) {
    setStatus('먼저 API 키를 설정하세요.', true);
    apiKeyInput.value = '';
    apiKeyDialog.showModal();
    return;
  }

  const voiceId = voiceSelect.value;
  const text = scriptInput.value.trim();
  if (!voiceId) return setStatus('보이스를 선택하세요.', true);
  if (!text) return setStatus('대본을 입력하세요.', true);

  generateBtn.disabled = true;
  setStatus('음성을 생성하는 중입니다... (대본 길이에 따라 시간이 걸릴 수 있어요)');
  resultArea.classList.add('hidden');

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': state.apiKey
      },
      body: JSON.stringify({
        voiceId,
        text,
        stability: state.stability,
        similarityBoost: 0.75,
        modelId: 'eleven_multilingual_v2'
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `요청 실패 (${res.status})`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioPlayer.src = url;
    downloadLink.href = url;
    resultArea.classList.remove('hidden');
    setStatus('생성 완료!');
  } catch (err) {
    setStatus(`생성 실패: ${err.message}`, true);
  } finally {
    generateBtn.disabled = false;
  }
});

apiKeyBtn.addEventListener('click', () => {
  apiKeyInput.value = state.apiKey;
  apiKeyDialog.showModal();
});

apiKeyDialog.addEventListener('close', () => {
  if (apiKeyDialog.returnValue === 'save') {
    state.apiKey = apiKeyInput.value.trim();
    localStorage.setItem('elevenlabs_api_key', state.apiKey);
    loadVoices();
  }
});

loadVoices();
