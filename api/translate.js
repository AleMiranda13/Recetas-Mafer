// /api/translate.js — DeepL -> LibreTranslate -> MyMemory -> identity
// Resiliente, con timeouts cortos y cache pequeña

const SRV_CACHE = new Map();
const SRV_CACHE_MAX = 2000;
const REQUEST_TIMEOUT_MS = 1500;

function cacheGet(k){ return SRV_CACHE.get(k); }
function cacheSet(k,v){ if(SRV_CACHE.size>=SRV_CACHE_MAX){ const f=SRV_CACHE.keys().next().value; if(f) SRV_CACHE.delete(f);} SRV_CACHE.set(k,v); }

export default async function handler(req, res){
  if(req.method!=="POST"){
    res.setHeader("Allow","POST");
    return res.status(405).json({error:"Método no permitido"});
  }
  try{
    const { texts, text, target="es", prefer } = await readBody(req);
    const items = Array.isArray(texts) ? texts : (text ? [text] : []);
    if(!items.length){ res.setHeader("X-Translate-Provider","empty"); return res.status(200).json({translations:[]}); }

    // cache
    const out = new Array(items.length), need=[], idx=[];
    items.forEach((t,i)=>{ const k=`${target}|${t}`; const c=cacheGet(k); if(c!=null) out[i]=c; else{ need.push(t); idx.push(i); }});
    if(!need.length){ res.setHeader("X-Translate-Provider","cache"); return res.status(200).json({ translations: out }); }

    // prefer: "libre" fuerza probar Libre primero (útil cuando DeepL está sin cuota)
    const order = prefer==="libre" ? ["libre","deepl","mymemory"] : ["deepl","libre","mymemory"];

    let translated = null, provider = "identity";

    for (const prov of order){
      try{
        if (prov==="deepl") {
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateDeepL(need, target));
        } else if (prov==="libre") {
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateLibre(need, target));
        } else { // mymemory
          translated = await withTimeout(REQUEST_TIMEOUT_MS, translateMyMemory(need, target));
        }
        // si algún proveedor devolvió exactamente igual para TODO, probá el siguiente
        const allSame = translated.every((tr,i)=> (tr||"").trim().toLowerCase()===(need[i]||"").trim().toLowerCase());
        if (allSame) throw new Error("same-output");
        provider = prov; break;
      }catch{/* probar siguiente */}
    }

    if (!translated) { translated = need.slice(); provider="identity"; }

    translated.forEach((tr,k)=>{ const i=idx[k]; out[i]=tr??need[k]; cacheSet(`${target}|${need[k]}`, out[i]); });

    res.setHeader("Access-Control-Allow-Origin","*");
    res.setHeader("X-Translate-Provider", provider);
    return res.status(200).json({ translations: out });

  }catch(e){
    // emergencia: devolvé originales
    const raw = Array.isArray(texts) ? texts : (text ? [text] : []);
    res.setHeader("X-Translate-Provider","identity");
    return res.status(200).json({ translations: raw });
  }
}

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
  // target ej. "es". Usamos "auto|es"
  const out = [];
  for(const q of texts){
    try{
      const u = new URL("https://api.mymemory.translated.net/get");
      u.searchParams.set("q", q);
      u.searchParams.set("langpair", `auto|${target}`);
      const r = await fetch(u.toString());
      const j = await r.json().catch(()=>({}));
      const tr = j?.responseData?.translatedText || q;
      out.push(tr);
    }catch{ out.push(q); }
  }
  return out;
}

// utils
function withTimeout(ms,p){ return new Promise((res,rej)=>{ const id=setTimeout(()=>rej(new Error("timeout")),ms); p.then(v=>{clearTimeout(id);res(v);},e=>{clearTimeout(id);rej(e);}); }); }
async function readBody(req){ const chunks=[]; for await(const c of req) chunks.push(c); try{ return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}"); }catch{ return {}; } }
