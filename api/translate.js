// /api/translate.js
// DeepL (Free/Pro) con fallback a LibreTranslate, timeout y "fail-soft".
// Si TODO falla, devuelve el mismo texto para no frenar la app.

const SRV_CACHE = new Map();           // cache servidor
const SRV_CACHE_MAX = 2000;
const REQUEST_TIMEOUT_MS = 1500;

function cacheGet(k) { return SRV_CACHE.get(k); }
function cacheSet(k, v) {
  if (SRV_CACHE.size >= SRV_CACHE_MAX) {
    const first = SRV_CACHE.keys().next().value;
    if (first) SRV_CACHE.delete(first);
  }
  SRV_CACHE.set(k, v);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { texts, text, target = "es" } = await readBody(req);
    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if (!items.length) return res.status(200).json({ translations: [] });

    // 1) cache servidor
    const out = new Array(items.length);
    const need = [];
    const idxs = [];
    items.forEach((t, i) => {
      const k = `${target}|${t}`;
      const c = cacheGet(k);
      if (c != null) out[i] = c; else { need.push(t); idxs.push(i); }
    });

    if (!need.length) {
      res.setHeader("X-Translate-Provider", "cache");
      return res.status(200).json({ translations: out });
    }

    // 2) intento DeepL -> si falla, Libre -> si falla, identidades
    let translated = null;
    let provider = "deepl";

    try {
      translated = await withTimeout(REQUEST_TIMEOUT_MS, translateDeepL(need, target));
    } catch {
      provider = "libre";
      try {
        translated = await withTimeout(REQUEST_TIMEOUT_MS, translateLibre(need, target));
      } catch {
        provider = "identity";
        translated = need.slice();
      }
    }

    translated.forEach((tr, k) => {
      const i = idxs[k];
      out[i] = tr ?? need[k];
      cacheSet(`${target}|${need[k]}`, out[i]);
    });

    res.setHeader("X-Translate-Provider", provider);
    return res.status(200).json({ translations: out });

  } catch (e) {
    // fallback total
    return res.status(200).json({ translations: (Array.isArray(texts) ? texts : [text]).filter(Boolean) });
  }
}

async function translateDeepL(texts, target) {
  const KEY  = process.env.DEEPL_API_KEY || "";
  const HOST = (process.env.DEEPL_API_HOST || "api-free.deepl.com").trim();
  if (!KEY) throw new Error("DEEPL_KEY missing");

  const r = await fetch(`https://${HOST}/v2/translate`, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts, target_lang: target.toUpperCase() })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`DEEPL ${r.status}`);
  return (j.translations || []).map(t => t.text || "");
}

async function translateLibre(texts, target) {
  const url = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate";
  const out = [];
  for (const q of texts) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, source: "auto", target, format: "text" }),
      });
      const j = await r.json().catch(() => ({}));
      out.push(j?.translatedText ?? q);
    } catch {
      out.push(q);
    }
  }
  return out;
}

function withTimeout(ms, p) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
