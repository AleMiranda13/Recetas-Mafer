// api/edamam.js — Vercel Serverless Function (con detalle por ID + user header)
export default async function handler(req, res) {
  const { EDAMAM_APP_ID, EDAMAM_APP_KEY, EDAMAM_USER } = process.env;
  if (!EDAMAM_APP_ID || !EDAMAM_APP_KEY) {
    res.status(500).json({ error: "Faltan variables EDAMAM_APP_ID / EDAMAM_APP_KEY" });
    return;
  }

  const q = (req.query.q || "").toString().trim();
  const id = (req.query.id || "").toString().trim(); // <-- si viene, pedimos DETALLE
  const limit = Math.min(parseInt(req.query.limit || "24", 10), 50);

  try {
    let url;
    if (id) {
      // Detalle por ID (el id es la parte después de #recipe_)
      url = new URL(`https://api.edamam.com/api/recipes/v2/${id}`);
      url.searchParams.set("type", "public");
    } else {
      // Búsqueda por texto/ingredientes
      url = new URL("https://api.edamam.com/api/recipes/v2");
      url.searchParams.set("type", "public");
      url.searchParams.set("q", q);
    }

    url.searchParams.set("app_id", EDAMAM_APP_ID);
    url.searchParams.set("app_key", EDAMAM_APP_KEY);
    // Pedimos campos útiles
    ["label","ingredientLines","instructionLines","dishType","calories","image","url","uri"]
      .forEach(f => url.searchParams.append("field", f));

    const r = await fetch(url.toString(), {
      headers: { "Edamam-Account-User": EDAMAM_USER || EDAMAM_APP_ID }
    });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).json({ error: `Edamam ${r.status}`, edamam: text });

    const data = JSON.parse(text);

    // Normalización común
    const mapRecipe = (rec) => ({
      id: rec.uri,
      edamamId: rec.uri?.split("#recipe_")[1] || null,     // para pedir detalle
      titulo: rec.label,
      categoria: (rec.dishType?.[0] || "general"),
      ingredientes: rec.ingredientLines || [],
      pasos: rec.instructionLines || [],
      kcal: rec.calories ? Math.round(rec.calories) : null,
      imagen: rec.image || null,
      sourceUrl: rec.url || null
    });

    if (id) {
      const rec = data.recipe || data; // formato detalle
      return res.status(200).json({ recipe: mapRecipe(rec) });
    } else {
      const recipes = (data.hits || []).slice(0, limit).map(h => mapRecipe(h.recipe));
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.status(200).json({ recipes });
    }
  } catch (err) {
    res.status(500).json({ error: "Error consultando Edamam", detail: String(err) });
  }
}