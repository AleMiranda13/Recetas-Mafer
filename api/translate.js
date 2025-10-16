// api/translate.js — Proxy a LibreTranslate (traducción EN/auto → ES)
export default async function handler(req, res) {
  try {
    const { texts, text, target = "es" } = req.method === "POST" ? await readBody(req) : {};
    const LT = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate";

    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if (!items.length) return res.status(400).json({ error: "Falta 'texts' (array) o 'text' (string)" });

    const results = [];
    for (const q of items) {
      const r = await fetch(LT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, source: "auto", target, format: "text" })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.translatedText) {
        // Si falla, devolvemos el original (mejor que romper)
        results.push(q);
      } else {
        results.push(j.translatedText);
      }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ translations: results });
  } catch (e) {
    return res.status(500).json({ error: "Fallo al traducir", detail: String(e) });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(buf || "{}"); } catch { return {}; }
}