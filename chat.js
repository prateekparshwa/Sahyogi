// Sarvam chat with a model cascade. All models run in parallel; we take the best-ranked one that
// answers in time, so a slow or failing model never blocks the demo. Failures are reported in detail.
const URL_ = "https://api.sarvam.ai/v2/chat/completions";
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
// Note to facts: quality first (DeepSeek, then GLM, then Gemma). Brief: spoken aloud, so speed first (Gemma, then DeepSeek).
const ORDERS = {
  extract: list(process.env.SARVAM_ORDER_EXTRACT || "deepseekv4.1-flash,glm5.3,gemma4"),
  brief: list(process.env.SARVAM_ORDER_BRIEF || "gemma4,deepseekv4.1-flash"),
};
const WAIT = [Number(process.env.SARVAM_WAIT1_MS || 9000), Number(process.env.SARVAM_WAIT2_MS || 12000)];
const HARD = Number(process.env.SARVAM_HARD_MS || 24000);

async function call(model, prompt, key) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), HARD);
  try {
    const r = await fetch(URL_, {
      method: "POST", signal: ctl.signal,
      headers: { "api-subscription-key": key, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 3000, temperature: 0.2 }),
    });
    if (!r.ok) { let b = ""; try { b = (await r.text()).slice(0, 160); } catch (e) {} return { model, error: "HTTP " + r.status + " " + b }; }
    const j = await r.json();
    let text = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return text ? { model, text } : { model, error: "empty reply" };
  } catch (e) { return { model, error: (e && e.name) + ": " + String((e && e.message) || "").slice(0, 100) }; } finally { clearTimeout(to); }
}
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("timeout"), Math.max(ms, 0)))]);
const ok = (v) => v && v !== "timeout" && v.text;

module.exports = async (req, res) => {
  const key = process.env.SARVAM_API_KEY;
  if (req.method === "GET") return res.status(200).json({ sarvam: !!key, orders: ORDERS, version: 3 });
  if (!key) return res.status(503).json({ error: "SARVAM_API_KEY not set" });
  const prompt = String((req.body && req.body.prompt) || "").slice(0, 6000);
  if (prompt.length < 3) return res.status(400).json({ error: "Empty prompt" });
  const MODELS = ORDERS[req.body && req.body.task] || ORDERS.extract;
  const t0 = Date.now();
  const jobs = MODELS.map((m) => call(m, prompt, key));
  const done = new Array(MODELS.length).fill(undefined);
  jobs.forEach((p, i) => p.then((v) => { done[i] = v; }));
  for (let i = 0; i < MODELS.length; i++) {
    const last = i === MODELS.length - 1;
    const limit = last ? HARD : WAIT[Math.min(i, WAIT.length - 1)];
    const v = await within(jobs[i], limit - (Date.now() - t0));
    if (ok(v)) return res.status(200).json({ text: v.text, model: v.model, ms: Date.now() - t0 });
    for (let k = i + 1; k < MODELS.length; k++) {
      if (ok(done[k])) return res.status(200).json({ text: done[k].text, model: done[k].model, ms: Date.now() - t0 });
    }
  }
  const tried = (await Promise.all(jobs.map((j) => within(j, 100)))).map((v, i) => (v && v !== "timeout" ? v.error || "ok" : "timeout") + " [" + MODELS[i] + "]");
  return res.status(502).json({ error: "No model answered", tried });
};
