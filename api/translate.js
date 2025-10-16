// /api/translate.js — DeepL API proxy con control de errores y batching

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { texts, text, target = "es" } = await readBody(req);
    const key = process.env.DEEPL_API_KEY;

    if (!key) {
      return res.status(500).json({ error: "Falta DEEPL_API_KEY en variables de entorno" });
    }

    const toTranslate = Array.isArray(texts)
      ? texts.filter(Boolean)
      : text ? [text] : [];

    if (!toTranslate.length) {
      return res.status(400).json({ error: "Falta 'texts' (array) o 'text' (string)" });
    }

    // DeepL permite varios textos con el mismo parámetro 'text'
    const params = new URLSearchParams();
    for (const t of toTranslate) params.append("text", t);
    params.append("target_lang", target.toUpperCase());

    const resp = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok || !json.translations) {
      console.error("DeepL error:", json);
      return res.status(resp.status).json({
        error: "Error al traducir con DeepL",
        detail: json
      });
    }

    const translated = json.translations.map(t => t.text);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ translations: translated });

  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).json({ error: "Fallo interno al traducir", detail: String(e) });
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
