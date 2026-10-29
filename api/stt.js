// Sarvam speech to text. POST raw audio body, ?lang=kn-IN|hi-IN|en-IN|unknown, returns {text}.
module.exports = async (req, res) => {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return res.status(503).json({ error: "SARVAM_API_KEY not set" });
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (buf.length < 500) return res.status(400).json({ error: "Recording too short" });
  if (buf.length > 4000000) return res.status(413).json({ error: "Recording too long" });
  const type = String(req.headers["content-type"] || "audio/webm").split(";")[0];
  const allowed = ["kn-IN", "hi-IN", "en-IN", "unknown"];
  const lang = allowed.includes(req.query && req.query.lang) ? req.query.lang : "unknown";
  try {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type }), "note.webm");
    fd.append("model", process.env.SARVAM_STT_MODEL || "saaras:v4");
    fd.append("mode", process.env.SARVAM_STT_MODE || "codemix");
    fd.append("language_code", lang);
    const r = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST", headers: { "api-subscription-key": key }, body: fd,
    });
    if (!r.ok) return res.status(502).json({ error: "Sarvam stt " + r.status });
    const j = await r.json();
    return res.status(200).json({ text: j.transcript || "" });
  } catch (e) {
    return res.status(502).json({ error: "Sarvam stt failed" });
  }
};
module.exports.config = { api: { bodyParser: false } };
