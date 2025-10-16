// api/translate.js — Proxy robusto a LibreTranslate con fallback + api_key opcional
export default async function handler(req, res) {
  try {
    const body = req.method === "POST" ? await readBody(req) : {};
    const { texts, text, target = "es" } = body;

    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if (!items.length) {
      return res.status(400).json({ error: "Falta 'texts' (array) o 'text' (string)" });
    }

    // 1) Endpoints en orden de preferencia (se prueban como fallback)
    const fromEnv = process.env.LIBRETRANSLATE_URL && process.env.LIBRETRANSLATE_URL.trim();
    const endpoints = [
      fromEnv,
      "https://libretranslate.de/translate",
      "https://translate.argosopentech.com/translate",
      "https://libretranslate.com/translate"
    ].filter(Boolean);

    const apiKey = process.env.LIBRETRANSLATE_KEY || undefined;

    const results = [];
    for (const q of items) {
      let translated = null;

      for (const url of endpoints) {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "accept": "application/json"
            },
            body: JSON.stringify({
              q,
              source: "auto",
              target,
              format: "text",
              ...(apiKey ? { api_key: apiKey } : {})
            })
          });

          const j = await safeJson(r);
          // Distintas instancias devuelven {translatedText} o {error}
          if (r.ok && j && typeof j.translatedText === "string" && j.translatedText.length) {
            translated = j.translatedText;
            break; // éxito con este endpoint
          }
          // Si vino error explícito, probamos siguiente endpoint
        } catch (_) {
          // Ignoramos y probamos siguiente endpoint
        }
      }

      results.push(translated ?? q); // si no hubo suerte, devolvemos original
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

async function safeJson(r) {
  try { return await r.json(); } catch { return null; }
}