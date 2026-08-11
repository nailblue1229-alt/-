const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function getApiKey(req) {
  return req.header('xi-api-key');
}

app.get('/api/voices', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(400).json({ error: 'API 키가 필요합니다.' });

  try {
    const upstream = await fetch(`${ELEVENLABS_BASE}/voices`, {
      headers: { 'xi-api-key': apiKey }
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.detail?.message || '보이스 조회에 실패했습니다.' });
    }
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'ElevenLabs 요청 중 오류가 발생했습니다.' });
  }
});

app.post('/api/tts', async (req, res) => {
  const apiKey = getApiKey(req);
  if (!apiKey) return res.status(400).json({ error: 'API 키가 필요합니다.' });

  const { voiceId, text, stability, similarityBoost, modelId } = req.body || {};
  if (!voiceId || !text) {
    return res.status(400).json({ error: 'voiceId와 text는 필수입니다.' });
  }

  try {
    const upstream = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: modelId || 'eleven_multilingual_v2',
        voice_settings: {
          stability: typeof stability === 'number' ? stability : 0.5,
          similarity_boost: typeof similarityBoost === 'number' ? similarityBoost : 0.75
        }
      })
    });

    if (!upstream.ok) {
      let message = 'TTS 생성에 실패했습니다.';
      try {
        const errBody = await upstream.json();
        message = errBody.detail?.message || message;
      } catch (_) {}
      return res.status(upstream.status).json({ error: message });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: 'ElevenLabs 요청 중 오류가 발생했습니다.' });
  }
});

app.listen(PORT, () => {
  console.log(`TTS Emotion Studio 실행 중: http://localhost:${PORT}`);
});
