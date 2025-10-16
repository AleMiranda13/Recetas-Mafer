// api/edamam.js — Vercel Serverless Function (con userID requerido por Edamam)
export default async function handler(req, res) {
  const { EDAMAM_APP_ID, EDAMAM_APP_KEY, EDAMAM_USER } = process.env;

  if (!EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
    res.status(500).json({ error: "Faltan variables EDAMAM_APP_ID / EDAMAM_APP_KEY" });
    return;
  }

  const q = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit || "24", 10), 50);
  if (!q) { res.status(400).json({ error: "Falta parámetro ?q=" }); return; }

  const url = new URL("https://api.edamam.com/api/recipes/v2");
  url.searchParams.set("type", "public");
  url.searchParams.set("q", q);
  url.searchParams.set("app_id", EDAMAM_APP_ID);
  url.searchParams.set("app_key", EDAMAM_APP_KEY);
  ["label","ingredientLines","instructionLines","dishType","calories","image"]
    .forEach(f => url.searchParams.append("field", f));

  try {
    const r = await fetch(url.toString(), {
      headers: { "Edamam-Account-User": EDAMAM_USER || EDAMAM_APP_ID }
    });

    if (!r.ok) {
      const text = await r.text();
      res.status(r.status).json({ error: `Edamam ${r.status}`, edamam: text });
      return;
    }

    const data = await r.json();
    const recipes = (data.hits || []).slice(0, limit).map(h => {
      const rec = h.recipe;
      return {
        id: rec.uri,
        titulo: rec.label,
        categoria: (rec.dishType?.[0] || "general"),
        ingredientes: rec.ingredientLines || [],
        pasos: rec.instructionLines || [],
        kcal: rec.calories ? Math.round(rec.calories) : null,
        imagen: rec.image || null
      };
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ recipes });
  } catch (err) {
    res.status(500).json({ error: "Error consultando Edamam", detail: String(err) });
  }
}
