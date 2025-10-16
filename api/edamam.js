// Vercel Serverless Function (Node 18+)
export default async function handler(req, res) {
  const { EDAMAM_APP_ID, EDAMAM_APP_KEY } = process.env;
  if (!EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
    res.status(500).json({ error: "Faltan variables EDAMAM_APP_ID / EDAMAM_APP_KEY" });
    return;
  }

  const q = (req.query.q || "").toString().trim();
  const limit = Math.min(parseInt(req.query.limit || "24", 10), 50);

  const url = new URL("https://api.edamam.com/api/recipes/v2");
  url.searchParams.set("type", "public");
  url.searchParams.set("q", q);
  url.searchParams.set("app_id", EDAMAM_APP_ID);
  url.searchParams.set("app_key", EDAMAM_APP_KEY);
  // Campos que queremos
  ["label","ingredientLines","instructionLines","dishType","calories","image"].forEach(f =>
    url.searchParams.append("field", f)
  );

  try {
    const r = await fetch(url.toString());
    if (!r.ok) throw new Error(`Edamam ${r.status}`);
    const data = await r.json();
    const hits = (data.hits || []).slice(0, limit);

    const recipes = hits.map(h => {
      const r = h.recipe;
      return {
        id: r.uri,
        titulo: r.label,
        categoria: (r.dishType?.[0] || "general"),
        ingredientes: r.ingredientLines || [],
        pasos: r.instructionLines || [],
        kcal: r.calories ? Math.round(r.calories) : null,
        imagen: r.image || null
      };
    });

    // CORS: como la llamada es mismo origen (tu dominio de Vercel), no hace falta,
    // pero lo dejamos abierto por si lo probás en local con file://
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ recipes });
  } catch (err) {
    res.status(500).json({ error: "Error consultando Edamam", detail: String(err) });
  }
}
