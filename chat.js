// Sarvam chat. GET reports whether the key is set. POST {prompt} returns {text}.
const URL_ = "https://api.sarvam.ai/v2/chat/completions";
module.exports = async (req, res) => {
  const key = process.env.SARVAM_API_KEY;
  if (req.method === "GET") return res.status(200).json({ sarvam: !!key });
  if (!key) return res.status(503).json({ error: "SARVAM_API_KEY not set" });
  const prompt = String((req.body && req.body.prompt) || "").slice(0, 6000);
  if (prompt.length < 3) return res.status(400).json({ error: "Empty prompt" });
  try {
    const r = await fetch(URL_, {
      method: "POST",
      headers: { "api-subscription-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.SARVAM_CHAT_MODEL || "gemma4",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2500, temperature: 0.2,
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "Sarvam chat " + r.status });
    const j = await r.json();
    let text = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: "Sarvam chat failed" });
  }
};
