// --- Caché simple en memoria (se borra al redeploy) ---
const CACHE = new Map();            // key = `${target}|${text}`
const CACHE_MAX = 2000;

function cacheGet(key) { return CACHE.get(key); }
function cacheSet(key, value) {
  if (CACHE.size >= CACHE_MAX) {
    // borro el primero (pseudo-LRU)
    const first = CACHE.keys().next().value;
    if (first) CACHE.delete(first);
  }
  CACHE.set(key, value);
}

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

    // 1) Respondo con lo que ya esté en caché y junto lo que falta
    const out = new Array(items.length);
    const need = [];
    const idx  = [];
    items.forEach((t, i) => {
      const key = `${target}|${t}`;
      const c = cacheGet(key);
      if (c != null) out[i] = c;
      else { need.push(t); idx.push(i); }
    });

    if (need.length) {
      // 2) Intento DeepL primero
      let provider = "deepl";
      let translated = null;
      try {
        translated = await translateDeepL(need, target);
      } catch (e) {
        // Si DeepL falla por quota/host (403/456) u otro error, intento LibreTranslate
        provider = "libre";
        translated = await translateLibre(need, target);
      }

      // 3) Relleno 'out' + guardo en caché
      translated.forEach((tr, k) => {
        const i = idx[k];
        out[i] = tr ?? need[k];
        cacheSet(`${target}|${need[k]}`, out[i]);
      });
      res.setHeader("X-Translate-Provider", provider);
    } else {
      res.setHeader("X-Translate-Provider", "cache");
    }

    return res.status(200).json({ translations: out });

  } catch (e) {
    return res.status(500).json({ error: "Fallo al traducir", detail: String(e) });
  }
}

// -------- DeepL ----------
async function translateDeepL(texts, target) {
  const DEEPL_KEY  = process.env.DEEPL_API_KEY || "";
  const DEEPL_HOST = (process.env.DEEPL_API_HOST || "api-free.deepl.com").trim();

  if (!DEEPL_KEY) throw new Error("DEEPL_KEY faltante");

  // DeepL acepta array
  const url = `https://${DEEPL_HOST}/v2/translate`;
  const body = {
    text: texts,
    target_lang: target.toUpperCase(), // "ES"
    // source_lang: "EN", // opcional
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
    // 403/456 => sin crédito o host equivocado
    const err = new Error(`DeepL error ${r.status}`);
    err.status = r.status;
    err.detail = j;
    throw err;
  }
  return (j.translations || []).map(t => t.text || "");
}

// -------- LibreTranslate (fallback) ----------
async function translateLibre(texts, target) {
  const LT = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate";
  const out = [];
  for (const q of texts) {
    try {
      const r = await fetch(LT, {
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

// -------- util --------
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(buf || "{}"); } catch { return {}; }
}