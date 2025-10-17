// /api/translate.js — DeepL + Libre con preferencia opcional y timeout corto

const SRV_CACHE = new Map();
const SRV_CACHE_MAX = 2000;
const REQUEST_TIMEOUT_MS = 1500;

function cacheGet(k){ return SRV_CACHE.get(k); }
function cacheSet(k,v){ if(SRV_CACHE.size>=SRV_CACHE_MAX){ const f=SRV_CACHE.keys().next().value; if(f) SRV_CACHE.delete(f);} SRV_CACHE.set(k,v); }

export default async function handler(req, res){
  if(req.method!=="POST") return res.status(405).json({error:"Método no permitido"});
  try{
    const { texts, text, target="es", prefer } = await readBody(req); // ← prefer opcional
    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if(!items.length) return res.status(200).json({ translations: [] });

    const out = new Array(items.length), need=[], idx=[];
    items.forEach((t,i)=>{ const k=`${target}|${t}`; const c=cacheGet(k); if(c!=null) out[i]=c; else{ need.push(t); idx.push(i);} });
    if(!need.length){ res.setHeader("X-Translate-Provider","cache"); return res.status(200).json({ translations: out }); }

    const useLibreFirst = (prefer==="libre"); // ← fuerza Libre primero si lo pedís
    let translated = null, provider = "deepl";

    try{
      if(useLibreFirst){
        translated = await withTimeout(REQUEST_TIMEOUT_MS, translateLibre(need, target)); provider="libre";
        if(!translated?.length) throw new Error("libre empty");
      }else{
        translated = await withTimeout(REQUEST_TIMEOUT_MS, translateDeepL(need, target));
      }
    }catch{
      // fallback inverso
      try{
        if(useLibreFirst){
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateDeepL(need, target)); provider="deepl";
        }else{
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateLibre(need, target)); provider="libre";
        }
      }catch{
        provider="identity"; translated = need.slice();
      }
    }

    translated.forEach((tr,k)=>{ const i=idx[k]; out[i]=tr??need[k]; cacheSet(`${target}|${need[k]}`, out[i]); });
    res.setHeader("X-Translate-Provider", provider);
    return res.status(200).json({ translations: out });
  }catch{
    return res.status(200).json({ translations: (Array.isArray(texts)?texts:[text]).filter(Boolean) });
  }
}

async function translateDeepL(texts, target){
  const KEY  = process.env.DEEPL_API_KEY || "";
  const HOST = (process.env.DEEPL_API_HOST || "api-free.deepl.com").trim();
  if(!KEY) throw new Error("NO_KEY");
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
  const url = process.env.LIBRETRANSLATE_URL || "https://libretranslate.com/translate";
  const out = [];
  for(const q of texts){
    try{
      const r = await fetch(url,{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ q, source:"auto", target, format:"text" })});
      const j = await r.json().catch(()=>({}));
      out.push(j?.translatedText ?? q);
    }catch{ out.push(q); }
  }
  return out;
}

function withTimeout(ms,p){ return new Promise((res,rej)=>{ const id=setTimeout(()=>rej(new Error("timeout")),ms); p.then(v=>{clearTimeout(id);res(v);},e=>{clearTimeout(id);rej(e);}); }); }
async function readBody(req){ const chunks=[]; for await(const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); }catch{ return {}; } }