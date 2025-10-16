/* ========= Helpers básicos ========= */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const escapeHtml = s => String(s).replace(/[&<>"']/g, m => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));
const formatDate = iso => !iso ? "" : new Date(iso).toLocaleDateString("es-AR");
const dedupByTitle = arr => {
  const seen = new Set();
  return arr.filter(r => {
    const k = (r.titulo || "").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/* ========= LocalStorage ========= */
const LS_KEY = "recetas_v1";
const loadRecetas = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] } };
const saveRecetas = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr));
const upsertReceta = r => { const a = loadRecetas(); const i = a.findIndex(x => x.id === r.id); i >= 0 ? a[i] = r : a.push(r); saveRecetas(a); };

/* ========= Render de tarjetas ========= */
function recipeCard(r, opts = {}) {
  const btns = `
    <button class="btn" data-action="ver">Ver</button>
    <button class="btn" data-action="importar">Importar</button>`;
  return `
    <article class="recipe" data-id="${r.id}">
      <h3>${escapeHtml(r.titulo)}</h3>
      <div class="meta">
        <span class="badge">${escapeHtml(r.categoria || "—")}</span>
        ${r.kcal ? `<span>${r.kcal} kcal</span>` : ""}
      </div>
      <div class="row">${btns}</div>
    </article>`;
}

/* ========= Recetas típicas (inicio) ========= */
const tipicas = [
  {
    id: "t-brownie",
    titulo: "Brownie clásico",
    categoria: "dulce",
    ingredientes: [
      "180 g chocolate amargo", "120 g manteca", "200 g azúcar", "2 huevos",
      "80 g harina 0000", "1 cda cacao amargo", "1 pizca sal", "1 cdita esencia de vainilla"
    ],
    pasos: [
      "Derretí chocolate con manteca a baño María.",
      "Batí huevos con azúcar y vainilla.",
      "Uní mezclas y sumá secos tamizados.",
      "Horneá 20–25 min a 180°C."
    ],
    kcal: null
  },
  {
    id: "t-cheesecake",
    titulo: "Cheesecake sin horno",
    categoria: "dulce",
    ingredientes: [
      "200 g galletitas vainilla", "80 g manteca", "400 g queso crema",
      "200 ml crema de leche", "100 g azúcar", "1 cdita vainilla",
      "8 g gelatina sin sabor + 50 ml agua"
    ],
    pasos: [
      "Base: galletitas + manteca, enfriar.",
      "Hidratá y disolvé la gelatina.",
      "Relleno: queso + azúcar + vainilla + crema + gelatina.",
      "Enfriar 4 h y cubrir."
    ],
    kcal: null
  },
  {
    id: "t-budin",
    titulo: "Budín de banana (fit)",
    categoria: "fitness",
    ingredientes: [
      "2 bananas", "2 huevos", "120 g harina de avena",
      "1 cdita polvo de hornear", "2 cdas endulzante", "1 cdita canela", "1 pizca sal"
    ],
    pasos: [
      "Pisar bananas con huevos.",
      "Sumar secos y mezclar.",
      "Hornear 30–35 min a 180°C."
    ],
    kcal: null
  }
];

const gridTipicas = $("#grid-tipicas");
function renderTipicas() {
  if (!gridTipicas) return;
  gridTipicas.innerHTML = tipicas.map(r => recipeCard(r)).join("");
}
renderTipicas();

/* ========= Modal detalle ========= */
const modal = $("#modal-detalle");
const mdTitulo = $("#md-titulo");
const mdCat = $("#md-cat");
const mdFecha = $("#md-fecha");
const mdIng = $("#md-ingredientes");
const mdPasos = $("#md-pasos");
const mdCerrar = $("#md-cerrar");
let modalRecetaId = null;

function openDetalle(r) {
  modalRecetaId = r.id;
  mdTitulo.textContent = r.titulo;
  mdCat.textContent = r.categoria || "—";
  mdFecha.textContent = r.createdAt ? "Guardada el " + formatDate(r.createdAt) : "";
  mdIng.innerHTML = (r.ingredientes?.length ? r.ingredientes : ["—"]).map(i => `<li>${escapeHtml(i)}</li>`).join("");
  mdPasos.innerHTML = (r.pasos?.length ? r.pasos : ["—"]).map(p => `<li>${escapeHtml(p)}</li>`).join("");
  modal.showModal();
}
mdCerrar?.addEventListener("click", () => modal.close());

/* ========= Buscar recetas (Edamam vía Vercel API) ========= */
const gridResultados = $("#grid-resultados");
let tempResults = [];

$("#btn-buscar")?.addEventListener("click", () => doSearch($("#q").value));
$("#btn-home-search")?.addEventListener("click", () => {
  const q = $("#q-home").value;
  $("#q").value = q;
  document.querySelector('[data-tab="explorar"]').click();
  doSearch(q);
});

async function doSearch(qRaw) {
  const q = (qRaw || "").trim();
  if (!q) { gridResultados.innerHTML = ""; return; }
  gridResultados.innerHTML = `<p class="muted">Buscando recetas…</p>`;
  try {
    const res = await fetch(`/api/edamam?q=${encodeURIComponent(q)}&limit=24`);
    const json = await res.json();
    const merged = dedupByTitle(json.recipes || []);
    tempResults = merged;
    gridResultados.innerHTML = merged.length
      ? merged.map(r => recipeCard(r)).join("")
      : `<p class="muted">Sin resultados con “${escapeHtml(q)}”.</p>`;
  } catch (e) {
    console.error(e);
    gridResultados.innerHTML = `<p class="muted">Error al buscar recetas.</p>`;
  }
}

/* ========= Buscar por ingredientes ========= */
$("#btn-generar")?.addEventListener("click", async () => {
  const raw = $("#ingredientes").value || "";
  const salida = $("#gen-salida");
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (!list.length) { salida.textContent = "Escribí algunos ingredientes 🍫🍌"; return; }
  salida.innerHTML = "Buscando con tus ingredientes…";
  try {
    const q = list.join(", ");
    const res = await fetch(`/api/edamam?q=${encodeURIComponent(q)}&limit=15`);
    const json = await res.json();
    const merged = dedupByTitle(json.recipes || []);
    tempResults = merged;
    salida.innerHTML = merged.length
      ? merged.map(r => recipeCard(r)).join("")
      : "No encontré coincidencias 😅";
  } catch (e) {
    console.error(e);
    salida.innerHTML = "Error consultando la API 😞";
  }
});

/* ========= Eventos globales (Ver / Importar) ========= */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".recipe .btn");
  if (!btn) return;
  const card = e.target.closest(".recipe");
  const id = card?.dataset.id;

  // Buscar la receta en API o en las típicas del inicio
  let r = tempResults.find(x => x.id === id);
  if (!r) r = tipicas.find(x => x.id === id);
  if (!r) return;

  if (btn.dataset.action === "ver") {
    openDetalle(r);
  }

  if (btn.dataset.action === "importar") {
    const save = { ...r, id: Date.now().toString(), createdAt: new Date().toISOString(), fav: false };
    upsertReceta(save);
    alert("Guardada en Mis recetas ✅");
  }
});