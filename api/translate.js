// api/translate.js — Proxy a DeepL API (EN/auto → ES)
export default async function handler(req, res) {
  try {
    const { texts, text, target = "ES" } = await readBody(req);
    const items = Array.isArray(texts) ? texts : text ? [text] : [];
    if (!items.length)
      return res.status(400).json({ error: "Falta 'texts' o 'text'" });

    const key = process.env.DEEPL_API_KEY;
    if (!key)
      return res
        .status(500)
        .json({ error: "Falta DEEPL_API_KEY en las variables de entorno" });

    const results = [];
    for (const q of items) {
      const r = await fetch("https://api-free.deepl.com/v2/translate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          auth_key: key,
          text: q,
          target_lang: target.toUpperCase(),
        }),
      });
      const j = await r.json();
      if (r.ok && j.translations && j.translations[0]?.text) {
        results.push(j.translations[0].text);
      } else {
        results.push(q);
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ translations: results });
  } catch (e) {
    console.error("Error en /api/translate:", e);
    return res
      .status(500)
      .json({ error: "Error al traducir", detail: String(e) });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(buf || "{}");
  } catch {
    return {};
  }
}