// Sarvam text to speech. POST {text, lang} returns audio/wav.
const CODE = { kn: "kn-IN", hi: "hi-IN", en: "en-IN" };
const VOICE = { kn: "chaitra_kn_conversation", hi: "ritu_hi_conversation", en: "neha_en_customer" };
module.exports = async (req, res) => {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return res.status(503).json({ error: "SARVAM_API_KEY not set" });
  const lang = CODE[req.body && req.body.lang] ? req.body.lang : "en";
  const text = String((req.body && req.body.text) || "").slice(0, 1200);
  if (!text) return res.status(400).json({ error: "Empty text" });
  try {
    const r = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: { "api-subscription-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text, language_code: CODE[lang],
        model: process.env.SARVAM_TTS_MODEL || "bulbul:v4-flash",
        speaker: process.env["SARVAM_SPEAKER_" + lang.toUpperCase()] || VOICE[lang],
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "Sarvam tts " + r.status });
    const j = await r.json();
    const wav = Buffer.from(j.audios[0], "base64");
    res.setHeader("content-type", "audio/wav");
    return res.status(200).send(wav);
  } catch (e) {
    return res.status(502).json({ error: "Sarvam tts failed" });
  }
};
