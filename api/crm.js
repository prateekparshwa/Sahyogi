// Mock CRM service. Same fields a real CRM would hold. State lives in Redis when configured
// (Upstash via Vercel Storage), otherwise in memory (fine for a single warm instance, not for production).
const SEED = require("./_shops.json");
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "sahyogi:crm:v1";
let MEM = null;

const clone = (o) => JSON.parse(JSON.stringify(o));
function fresh() {
  return { day: 1, outage: false, shops: Object.fromEntries(SEED.map((s) => [s.id, clone(s)])), actions: {}, events: [], closed: [], writes: 0, rejected: 0 };
}
async function redis(cmd) {
  const r = await fetch(RURL, { method: "POST", headers: { Authorization: "Bearer " + RTOK }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}
async function load() {
  if (RURL) { const v = await redis(["GET", KEY]); return v ? JSON.parse(v) : fresh(); }
  return MEM || fresh();
}
async function save(s) {
  s.events = s.events.slice(-200);
  if (RURL) await redis(["SET", KEY, JSON.stringify(s)]); else MEM = s;
}
function ev(s, kind, shop, msg) {
  s.events.push({ t: new Date().toISOString(), day: s.day, kind, shop: shop || null, shopName: shop && s.shops[shop] ? s.shops[shop].name : null, msg });
}
function view(s) {
  return { day: s.day, outage: s.outage, shops: s.shops, closed: s.closed, writes: s.writes, rejected: s.rejected, events: s.events.slice(-60).reverse(), store: RURL ? "redis" : "memory" };
}

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  try {
    let s = await load();
    if (req.method === "GET") return res.status(200).json(view(s));
    const b = req.body || {};
    const op = b.op;
    if (op === "reset") { s = fresh(); ev(s, "reset", null, "Demo data reset"); await save(s); return res.status(200).json(view(s)); }
    if (op === "outage") { s.outage = !!b.on; ev(s, "outage", null, s.outage ? "CRM set to UNAVAILABLE (simulated outage)" : "CRM restored"); await save(s); return res.status(200).json({ outage: s.outage }); }

    if (op === "action") {
      const id = String(b.shop), sh = s.shops[id], key = String(b.key || "");
      if (!sh || !key) return res.status(400).json({ error: "bad request" });
      if (s.actions[key] && s.actions[key].state === "done") {
        ev(s, "duplicate_blocked", id, "Duplicate write ignored (same idempotency key): " + (b.label || key));
        await save(s); return res.status(200).json({ state: "duplicate", shop: sh, day: s.day });
      }
      if (s.outage) { s.rejected++; ev(s, "write_rejected", id, "Write rejected, CRM unavailable: " + (b.label || key)); await save(s); return res.status(503).json({ error: "CRM unavailable" }); }
      const t = sh.open_ticket;
      if (b.type === "ticket_update") {
        const prop = { text: String(b.label || "Replacement").slice(0, 160), day: s.day, at: new Date().toISOString() };
        const note = `Day ${s.day}: replacement proposed by executive, waiting for Sales Head`;
        if (t) { t.status = "pending_approval"; t.proposal = prop; delete t.denied; (t.history = t.history || []).push(note); }
        else sh.open_ticket = { id: "T-" + (1100 + Object.keys(s.actions).length), issue: "Device issue", opened_days_ago: 0, status: "pending_approval", proposal: prop, history: [note] };
        sh.status = "pending_approval";
        ev(s, "approval_requested", id, `Replacement for ${sh.open_ticket.id} sent to the Sales Head for approval`);
      } else if (b.type === "loan_link") { sh.loan.interested = true; sh.loan.link_sent = true; }
      else if (b.type === "revisit") { sh.promise_due = { text: String(b.promise || "Confirm replacement delivery").slice(0, 120), due_day: s.day + 1 }; }
      else if (b.type === "crm_entry") { sh.last_visit = `Day ${s.day}: ${String(b.summary || "").slice(0, 300)}`; }
      sh.updated_at = new Date().toISOString(); s.actions[key] = { state: "done", shop: id }; s.writes++;
      ev(s, "write_ok", id, "Sahyogi: " + (b.label || b.type));
      await save(s); return res.status(200).json({ state: "done", shop: sh, day: s.day });
    }

    if (op === "decide") {
      const sh = s.shops[String(b.shop)], t = sh && sh.open_ticket;
      if (!t || t.status !== "pending_approval") return res.status(400).json({ error: "nothing awaiting approval" });
      sh.updated_at = new Date().toISOString();
      if (b.accept) {
        t.status = "replacement_scheduled"; sh.status = "replacement_scheduled"; delete t.denied;
        (t.history = t.history || []).push(`Day ${s.day}: replacement approved by Sales Head`);
        ev(s, "approved", sh.id, `Sales Head APPROVED the replacement for ${t.id}`);
      } else {
        const reason = String(b.reason || "No reason given").slice(0, 160);
        t.status = "open"; sh.status = "open"; t.denied = { reason, day: s.day };
        (t.history = t.history || []).push(`Day ${s.day}: replacement denied by Sales Head (${reason})`);
        ev(s, "denied", sh.id, `Sales Head DENIED the replacement for ${t.id}: ${reason}`);
      }
      await save(s); return res.status(200).json({ ok: true, shop: sh, day: s.day });
    }

    if (op === "proof") {
      const id = String(b.shop), sh = s.shops[id], t = sh && sh.open_ticket;
      if (s.outage) { s.rejected++; ev(s, "write_rejected", id, "Proof upload rejected, CRM unavailable"); await save(s); return res.status(503).json({ error: "CRM unavailable" }); }
      if (!t) return res.status(400).json({ error: "no open ticket for this merchant" });
      const thumb = String(b.thumb || "");
      if (thumb.length > 90000) return res.status(413).json({ error: "image too large" });
      const kind = b.kind === "video" ? "video" : "photo";
      t.proofs = (t.proofs || []).slice(-2);
      t.proofs.push({ kind, name: String(b.name || kind).slice(0, 80), size: Number(b.size) || 0, thumb, day: s.day, at: new Date().toISOString() });
      (t.history = t.history || []).push(`Day ${s.day}: ${kind} proof added by executive`);
      sh.updated_at = new Date().toISOString(); s.writes++;
      ev(s, "proof_added", id, `Executive added ${kind} proof to ${t.id}`);
      await save(s); return res.status(200).json({ ok: true, shop: sh, day: s.day });
    }

    if (op === "nextday") {
      s.day++; let n = 0;
      for (const sh of Object.values(s.shops)) {
        const t = sh.open_ticket;
        if (t && t.status === "replacement_scheduled") {
          t.status = "awaiting_merchant_confirmation"; (t.history = t.history || []).push(`Day ${s.day}: replacement delivered per ticket system`);
          sh.status = "awaiting_merchant_confirmation"; sh.device = { model: sh.device.model, status: "online", offline_days: 0 }; n++;
          ev(s, "ticket_delivered", sh.id, `Ticket ${t.id}: replacement delivered, awaiting merchant confirmation`);
        }
      }
      ev(s, "day", null, "Moved to day " + s.day);
      await save(s); return res.status(200).json({ changed: n, ...view(s) });
    }

    if (op === "confirm") {
      const sh = s.shops[String(b.shop)];
      const t = sh && sh.open_ticket;
      if (!t || t.status !== "awaiting_merchant_confirmation") return res.status(400).json({ error: "nothing awaiting confirmation" });
      if (b.positive) {
        const evidence = { ticket: t.id, ticket_state: "delivered", merchant_reply: "Yes, the speaker works", closed_on_day: s.day, approved_by: "Sales Head", proofs: (t.proofs || []).slice(-2).map((p) => ({ kind: p.kind, name: p.name, thumb: p.thumb })) };
        s.closed.push({ id: t.id, shop: sh.id, shopName: sh.name, issue: t.issue, evidence });
        sh.status = "resolved"; sh.promise_due = null; sh.open_ticket = null;
        ev(s, "ticket_closed", sh.id, `Ticket ${t.id} CLOSED with evidence: delivered + merchant confirmed`);
        await save(s); return res.status(200).json({ closed: true, evidence, shop: sh });
      }
      t.status = "open"; t.opened_days_ago += 1;
      ev(s, "ticket_escalated", sh.id, `Ticket ${t.id} reopened and escalated to area manager (merchant says still failing)`);
      await save(s); return res.status(200).json({ closed: false, shop: sh });
    }
    return res.status(400).json({ error: "unknown op" });
  } catch (e) {
    return res.status(500).json({ error: "CRM error" });
  }
};
