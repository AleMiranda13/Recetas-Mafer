// /api/translate.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { texts, text, target = "es" } = await readBody(req);
    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if (!items.length) {
      return res.status(400).json({ error: "Falta 'texts' (array) o 'text' (string)" });
    }

    const DEEPL_KEY  = process.env.DEEPL_API_KEY || "";
    const DEEPL_HOST = (process.env.DEEPL_API_HOST || "").trim(); // p.ej. "api-free.deepl.com"
    const LT_URL     = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate";

    // Si hay key de DeepL, usamos DeepL. Si no, usamos LibreTranslate.
    if (DEEPL_KEY) {
      const host = DEEPL_HOST || "api-free.deepl.com"; // por defecto: FREE
      const url = `https://${host}/v2/translate`;

      // DeepL acepta JSON con { text: [...], target_lang: 'ES', source_lang: 'EN' }
      // target_lang debe ir en mayúsculas: ES
      const body = {
        text: items,
        target_lang: (target || "es").toUpperCase(),
        // source_lang: "EN",  // opcional; DeepL auto-detecta. Descomenta si querés forzar.
      };

      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `DeepL-Auth-Key ${DEEPL_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        // Errores típicos:
        // 403 -> auth/host inválido, 456 -> quota exceeded
        return res.status(r.status).json({
          error: "Error al traducir con DeepL",
          detail: j,
        });
      }

      const translations = (j.translations || []).map(t => t.text || "");
      return res.status(200).json({ translations });
    }

    // ---- Fallback a LibreTranslate (sin key)
    const out = [];
    for (const q of items) {
      const rr = await fetch(LT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, source: "auto", target, format: "text" }),
      });
      const jj = await rr.json().catch(() => ({}));
      out.push(jj.translatedText || q);
    }
    return res.status(200).json({ translations: out });

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
