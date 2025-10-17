// /api/translate.js — DeepL -> LibreTranslate -> MyMemory -> identity
// Resiliente, con timeouts, cache pequeña, bypass y circuit breaker

const SRV_CACHE = new Map();
const SRV_CACHE_MAX = 2000;
const REQUEST_TIMEOUT_MS = 2500; // algo más generoso para Libre
const CACHE_VERSION = "v3";

// ---- Salud / backoff por proveedor ----
const HEALTH = {
  deepl:    { retryAt: 0, backoffMs: 15 * 60 * 1000 }, // 15 min si falla (cuota/timeout)
  libre:    { retryAt: 0, backoffMs:  3 * 60 * 1000 },
  mymemory: { retryAt: 0, backoffMs:  2 * 60 * 1000 },
};
function isHealthy(name){ return Date.now() >= (HEALTH[name]?.retryAt || 0); }
function markFailure(name){
  const h = HEALTH[name]; if (!h) return;
  h.retryAt = Date.now() + Math.min(h.backoffMs, 60*60*1000);
}
function clearFailure(name){ const h = HEALTH[name]; if (h) h.retryAt = 0; }

// ---- Helpers cache ----
function cacheGet(k){ return SRV_CACHE.get(k); }
function cacheSet(k,v){
  if(SRV_CACHE.size>=SRV_CACHE_MAX){
    const f=SRV_CACHE.keys().next().value; if(f) SRV_CACHE.delete(f);
  }
  SRV_CACHE.set(k,v);
}

// ---- URL query helper ----
function getQuery(req){
  try { return new URL(req.url, "http://localhost").searchParams; }
  catch { return new URLSearchParams(); }
}

// ---- Timeout wrapper ----
function withTimeout(ms,p){
  return new Promise((res,rej)=>{
    const id=setTimeout(()=>rej(new Error("timeout")),ms);
    p.then(v=>{clearTimeout(id);res(v);},e=>{clearTimeout(id);rej(e);});
  });
}

// ---- Body reader ----
async function readBody(req){
  const chunks=[]; for await(const c of req) chunks.push(c);
  try{ return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); }catch{ return {}; }
}

// ---- Providers ----
async function translateDeepL(texts, target){
  const KEY  = (process.env.DEEPL_API_KEY || "").trim();
  const HOST = (process.env.DEEPL_API_HOST || "api-free.deepl.com").trim();
  if(!KEY) throw new Error("DEEPL_NO_KEY");
  const r = await fetch(`https://${HOST}/v2/translate`, {
    method:"POST",
    headers:{ "Authorization":`DeepL-Auth-Key ${KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({ text: texts, target_lang: target.toUpperCase() })
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(`DEEPL_${r.status}`);
  return (j.translations||[]).map(t=>t.text||"");
}

async function translateLibre(texts, target){
  const url = (process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate").trim();
  const out = [];
  for(const q of texts){
    try{
      const r = await fetch(url, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ q, source:"auto", target, format:"text" })
      });
      const j = await r.json().catch(()=>({}));
      out.push(j?.translatedText ?? q);
    }catch{ out.push(q); }
  }
  return out;
}

async function translateMyMemory(texts, target){
  // MyMemory no acepta "auto" → asumimos en
  const out = [];
  for (const q of texts) {
    try {
      const u = new URL("https://api.mymemory.translated.net/get");
      u.searchParams.set("q", q);
      u.searchParams.set("langpair", `en|${target}`);
      const r = await fetch(u.toString());
      const j = await r.json().catch(() => ({}));
      const tr = j?.responseData?.translatedText || q;
      out.push(tr);
    } catch {
      out.push(q);
    }
  }
  return out;
}

// ---- Handler (Next.js API Route o similar) ----
export default async function handler(req, res){
  // CORS y preflight (útil si lo consumís desde otro origen)
  if(req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bypass-Cache");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }

  if(req.method!=="POST"){
    res.setHeader("Allow","POST, OPTIONS");
    return res.status(405).json({error:"Método no permitido"});
  }

  try{
    const qs = getQuery(req);
    const bypassCache  = qs.get("bypassCache")==="1" || req.headers["x-bypass-cache"]==="1";
    const forceProvider = qs.get("provider"); // debug opcional
    const { texts, text, target="es", prefer } = await readBody(req);

    const trg = String(target || "es").toLowerCase();
    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if(!items.length){
      res.setHeader("Access-Control-Allow-Origin","*");
      res.setHeader("X-Translate-Provider","empty");
      return res.status(200).json({translations:[]});
    }

    // ---------- CACHE READ ----------
    const out = new Array(items.length), need=[], idx=[];
    items.forEach((t,i)=>{
      const k = `${CACHE_VERSION}:${trg}|${t}`;
      const c = !bypassCache ? cacheGet(k) : null;
      if(c!=null) out[i]=c; else { need.push(t); idx.push(i); }
    });
    if(!need.length){
      res.setHeader("Access-Control-Allow-Origin","*");
      res.setHeader("X-Translate-Provider","cache");
      return res.status(200).json({ translations: out });
    }

    // ---------- ORDEN DINÁMICO + CIRCUIT BREAKER ----------
    let base = (prefer==="libre") ? ["libre","deepl","mymemory"] : ["deepl","libre","mymemory"];
    if (forceProvider) base = [forceProvider, ...base.filter(p=>p!==forceProvider)];
    const dynamic = base.filter(p => isHealthy(p));
    const finalOrder = dynamic.length ? dynamic : base;

    let translated = null, provider = "identity";

    for (const prov of finalOrder){
      try{
        if (prov==="deepl") {
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateDeepL(need, trg));
        } else if (prov==="libre") {
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateLibre(need, trg));
        } else {
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateMyMemory(need, trg));
        }
        // si TODO vino exactamente igual, probá siguiente
        const allSame = translated.every((tr,i)=> (tr||"").trim().toLowerCase()===(need[i]||"").trim().toLowerCase());
        if (allSame) throw new Error("same-output");
        clearFailure(prov);
        provider = prov; break;
      }catch(e){
        markFailure(prov);
        const msg = String(e && e.message || "");
        if (prov==="deepl" && (msg.includes("DEEPL_429") || msg.includes("DEEPL_456") || msg.includes("timeout"))){
          HEALTH.deepl.retryAt = Date.now() + 15 * 60 * 1000; // 15 min off
        }
        // probar siguiente
      }
    }

    if (!translated) { translated = need.slice(); provider="identity"; }

    // ---------- WRITE + NO CACHE PARA IDENTITY ----------
    translated.forEach((tr,k)=>{
      const i = idx[k];
      out[i] = tr ?? need[k];
      if (provider !== "identity") {
        cacheSet(`${CACHE_VERSION}:${trg}|${need[k]}`, out[i]);
      }
    });

    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("X-Translate-Provider", provider);
    return res.status(200).json({ translations: out });

  }catch(e){
    const raw = Array.isArray(texts) ? texts : (text ? [text] : []);
    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("X-Translate-Provider","identity");
    return res.status(200).json({ translations: raw });
  }
}
