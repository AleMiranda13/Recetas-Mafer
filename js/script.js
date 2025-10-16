/* =========================================================
   Recetas de Mafer — script.js (Vercel + Edamam + CRUD)
   - Búsqueda por nombre e ingredientes (via /api/edamam)
   - Recetas típicas en inicio
   - Mis recetas / Favoritas (localStorage)
   - Modal con Ver / Importar / ⭐ / Eliminar / Editar
   ========================================================= */

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
const clone = obj => JSON.parse(JSON.stringify(obj));

/* ========= Navegación por pestañas (tabs) ========= */
const sections = $$("main section");
const tabs = $$("nav .tab");

function showTab(id) {
  sections.forEach(s => s.classList.toggle("active", s.id === id));
  tabs.forEach(t => t.setAttribute("aria-selected", t.dataset.tab === id ? "true" : "false"));
  // Render on-demand
  if (id === "mis-recetas") renderMisRecetas();
  if (id === "favoritas")  renderFavoritas();
}
tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
const firstSelected = $('nav .tab[aria-selected="true"]');
if (firstSelected) showTab(firstSelected.dataset.tab);

/* ========= LocalStorage ========= */
const LS_KEY = "recetas_v1";
const loadRecetas = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] } };
const saveRecetas = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr));
const upsertReceta = r => { const a = loadRecetas(); const i = a.findIndex(x => x.id === r.id); i >= 0 ? a[i] = r : a.push(r); saveRecetas(a); };
const isSaved = id => loadRecetas().some(r => r.id === id);

/* ========= Render de tarjetas ========= */
function recipeCard(r, opts = {}) {
  const actions = opts.actions || (r.createdAt ? ["ver", "fav", "eliminar"] : ["ver", "importar"]);
  const labels = {
    ver: "Ver",
    importar: "Importar",
    fav: r.fav ? "Quitar ⭐" : "Marcar ⭐",
    eliminar: "Eliminar"
  };
  const btns = actions.map(a => `<button class="btn" data-action="${a}">${labels[a]}</button>`).join("");

  return `
    <article class="recipe" data-id="${r.id}">
      <h3>${escapeHtml(r.titulo)} ${r.fav ? "⭐" : ""}</h3>
      <div class="meta">
        <span class="badge">${escapeHtml(r.categoria || "—")}</span>
        ${r.kcal ? `<span>${r.kcal} kcal</span>` : ""}
        ${r.createdAt ? `<span>${formatDate(r.createdAt)}</span>` : ""}
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
      "180 g chocolate amargo","120 g manteca","200 g azúcar","2 huevos",
      "80 g harina 0000","1 cda cacao amargo","1 pizca sal","1 cdita esencia de vainilla"
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
      "200 g galletitas vainilla","80 g manteca","400 g queso crema",
      "200 ml crema de leche","100 g azúcar","1 cdita vainilla",
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
      "2 bananas","2 huevos","120 g harina de avena",
      "1 cdita polvo de hornear","2 cdas endulzante","1 cdita canela","1 pizca sal"
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

/* ========= Modal detalle + edición ========= */
const modal = $("#modal-detalle");
const mdTitulo = $("#md-titulo");
const mdCat = $("#md-cat");
const mdFecha = $("#md-fecha");
const mdIng = $("#md-ingredientes");
const mdPasos = $("#md-pasos");
const mdCerrar = $("#md-cerrar");
const mdEliminar = $("#md-eliminar");
const mdFav = $("#md-fav");

// botón Editar (lo agregamos si no existe)
let mdEditar = $("#md-editar");
if (!mdEditar) {
  const actions = modal?.querySelector(".actions.end");
  if (actions) {
    mdEditar = document.createElement("button");
    mdEditar.className = "btn";
    mdEditar.id = "md-editar";
    mdEditar.textContent = "Editar";
    actions.insertBefore(mdEditar, actions.firstChild); // antes de Eliminar/⭐
  }
}

let modalRecetaId = null;
let editMode = false;
let editDraft = null;

function renderModalFields(r) {
  mdTitulo.textContent = r.titulo + (r.fav ? " ⭐" : "");
  mdCat.textContent = r.categoria || "—";
  mdFecha.textContent = r.createdAt ? "Guardada el " + formatDate(r.createdAt) : "";

  if (!editMode) {
    mdIng.innerHTML = (r.ingredientes?.length ? r.ingredientes : ["—"]).map(i => `<li>${escapeHtml(i)}</li>`).join("");
    mdPasos.innerHTML = (r.pasos?.length ? r.pasos : ["—"]).map(p => `<li>${escapeHtml(p)}</li>`).join("");
  } else {
    // Modo edición: mostramos inputs
    mdIng.innerHTML = `
      <label class="muted">Título</label>
      <input id="ed-titulo" class="input" value="${escapeHtml(r.titulo)}">
      <label class="muted">Categoría</label>
      <input id="ed-cat" class="input" value="${escapeHtml(r.categoria||"")}">
      <label class="muted">Ingredientes (1 por línea)</label>
      <textarea id="ed-ings" class="input" rows="6">${escapeHtml((r.ingredientes||[]).join("\n"))}</textarea>
      <label class="muted">Pasos (1 por línea)</label>
      <textarea id="ed-pasos" class="input" rows="8">${escapeHtml((r.pasos||[]).join("\n"))}</textarea>
    `;
    mdPasos.innerHTML = ""; // lo dejamos vacío en edición (ya tenemos textarea arriba)
  }
  // Botones según estado
  mdEditar.textContent = editMode ? "Guardar" : "Editar";
}

async function openDetalle(r) {
  modalRecetaId = r.id;
  editMode = false;

  // Si viene de API y falta info, completamos con el detalle
  const full = await fetchRecipeDetailIfNeeded({ ...r });
  editDraft = clone(full);

  // Render básico
  mdTitulo.textContent = full.titulo + (full.fav ? " ⭐" : "");
  mdCat.textContent = full.categoria || "—";
  mdFecha.textContent = full.createdAt ? "Guardada el " + formatDate(full.createdAt) : "";

  // Ingredientes
  mdIng.innerHTML = (full.ingredientes?.length ? full.ingredientes : ["—"])
    .map(i => `<li>${escapeHtml(i)}</li>`).join("");

  // Pasos (si no hay, dejamos un link a la fuente si existe)
  if (full.pasos && full.pasos.length) {
    mdPasos.innerHTML = full.pasos.map(p => `<li>${escapeHtml(p)}</li>`).join("");
  } else {
    mdPasos.innerHTML = full.sourceUrl
      ? `<li>Esta receta no trae pasos en la API. Podés ver el paso a paso acá: 
           <a href="${full.sourceUrl}" target="_blank" rel="noopener">Receta original</a></li>`
      : `<li class="muted">Esta receta no trae pasos en la API.</li>`;
  }

  modal.showModal();
}

async function fetchRecipeDetailIfNeeded(r) {
  // Si ya tenemos ingredientes y pasos, no hace falta
  const faltaIng = !r.ingredientes || r.ingredientes.length === 0;
  const faltaPasos = !r.pasos || r.pasos.length === 0;
  if ((!faltaIng && !faltaPasos) || !r.edamamId) return r;

  try {
    const res = await fetch(`/api/edamam?id=${encodeURIComponent(r.edamamId)}`);
    const json = await res.json();
    if (json.recipe) {
      // Completamos vacíos con lo que venga del detalle
      r.ingredientes = r.ingredientes && r.ingredientes.length ? r.ingredientes : (json.recipe.ingredientes || []);
      r.pasos = r.pasos && r.pasos.length ? r.pasos : (json.recipe.pasos || []);
      r.sourceUrl = r.sourceUrl || json.recipe.sourceUrl || null;
    }
  } catch {}
  return r;
}

mdCerrar?.addEventListener("click", () => {
  editMode = false;
  modal.close();
});

mdEliminar?.addEventListener("click", () => {
  if (!modalRecetaId) return;
  const data = loadRecetas();
  const found = data.find(r => r.id === modalRecetaId);
  if (!found) { alert("Solo podés eliminar recetas guardadas."); return; }
  if (!confirm("¿Eliminar esta receta de Mis recetas?")) return;
  saveRecetas(data.filter(r => r.id !== modalRecetaId));
  modal.close();
  renderMisRecetas(); renderFavoritas();
});

mdFav?.addEventListener("click", () => {
  if (!modalRecetaId) return;
  const data = loadRecetas();
  const r = data.find(x => x.id === modalRecetaId);
  if (!r) { alert("Primero importá o guardá la receta para marcarla ⭐"); return; }
  r.fav = !r.fav; saveRecetas(data);
  renderModalFields(r);
  renderMisRecetas(); renderFavoritas();
});

mdEditar?.addEventListener("click", () => {
  if (!modalRecetaId) return;

  // Solo recetas guardadas se pueden editar
  const data = loadRecetas();
  const r = data.find(x => x.id === modalRecetaId);
  if (!r) { alert("Para editar primero importá o guardá la receta."); return; }

  if (!editMode) {
    // Entrar a modo edición
    editMode = true;
    renderModalFields(r);
  } else {
    // Guardar cambios
    const titulo = ($("#ed-titulo")?.value || "").trim();
    const categoria = ($("#ed-cat")?.value || "").trim().toLowerCase();
    const ings = ($("#ed-ings")?.value || "")
      .split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const pasos = ($("#ed-pasos")?.value || "")
      .split(/\r?\n/).map(x => x.trim()).filter(Boolean);

    if (!titulo) { alert("Poné un título 🙂"); return; }

    r.titulo = titulo;
    r.categoria = categoria || r.categoria || "general";
    r.ingredientes = ings;
    r.pasos = pasos;
    upsertReceta(r);

    editMode = false;
    renderModalFields(r);
    renderMisRecetas(); renderFavoritas();
    alert("Cambios guardados ✅");
  }
});

/* ========= Buscar recetas (Edamam vía Vercel API) ========= */
const gridResultados = $("#grid-resultados");
let tempResults = [];

$("#btn-buscar")?.addEventListener("click", () => doSearch($("#q").value));
$("#btn-home-search")?.addEventListener("click", () => {
  const q = $("#q-home").value;
  $("#q").value = q;
  showTab("explorar");
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

/* ========= Mis recetas / Favoritas ========= */
const gridMis  = $("#grid-mis");
const gridFavs = $("#grid-favs");
const emptyMis = $("#empty-mis");
const emptyFavs = $("#empty-favs");

function renderMisRecetas() {
  if (!gridMis) return;
  const data = loadRecetas().sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  gridMis.innerHTML = data.map(r => recipeCard(r, { actions: ["ver","fav","eliminar"] })).join("");
  if (emptyMis) emptyMis.style.display = data.length ? "none" : "block";
}
function renderFavoritas() {
  if (!gridFavs) return;
  const favs = loadRecetas().filter(r => r.fav);
  gridFavs.innerHTML = favs.map(r => recipeCard(r, { actions: ["ver","fav","eliminar"] })).join("");
  if (emptyFavs) emptyFavs.style.display = favs.length ? "none" : "block";
}

/* ========= Form Nueva Receta ========= */
const formNueva = $("#form-nueva");
if (formNueva) {
  formNueva.addEventListener("submit", (e) => {
    e.preventDefault();
    const titulo = $("#titulo").value.trim();
    const categoria = ($("#categoria").value || "").trim().toLowerCase() || "general";
    const ing = ($("#ing").value || "").trim();
    const pasos = ($("#pasos").value || "").trim();

    if (!titulo) { alert("Poné un título 🙂"); return; }

    const receta = {
      id: Date.now().toString(),
      titulo,
      categoria,
      ingredientes: ing ? ing.split(",").map(s => s.trim()).filter(Boolean) : [],
      pasos: pasos ? pasos.split(/\n+|\. +(?!\d)/).map(s => s.trim()).filter(Boolean) : [],
      fav: false,
      createdAt: new Date().toISOString()
    };

    upsertReceta(receta);
    formNueva.reset();
    showTab("mis-recetas");
    renderMisRecetas();
    alert("¡Receta guardada en Mis recetas! ✅");
  });
}

/* ========= Eventos globales (Ver / Importar / ⭐ / Eliminar) ========= */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".recipe .btn");
  if (!btn) return;
  const card = e.target.closest(".recipe");
  const id = card?.dataset.id;

  // Buscar en resultados (API) o en típicas o en Mis recetas
  let r = tempResults.find(x => x.id === id) ||
          tipicas.find(x => x.id === id) ||
          loadRecetas().find(x => x.id === id);
  if (!r) return;

  if (btn.dataset.action === "ver") {
    openDetalle(r);
  }

  if (btn.dataset.action === "importar") {
    const save = { ...r, id: Date.now().toString(), createdAt: new Date().toISOString(), fav: false };
    upsertReceta(save);
    renderMisRecetas();
    alert("Guardada en Mis recetas ✅");
  }

  if (btn.dataset.action === "fav") {
    const data = loadRecetas();
    const rec = data.find(x => x.id === id);
    if (!rec) { alert("Primero importá o guardá la receta para marcarla ⭐"); return; }
    rec.fav = !rec.fav; saveRecetas(data);
    renderMisRecetas(); renderFavoritas();
  }

  if (btn.dataset.action === "eliminar") {
    const data = loadRecetas();
    if (!data.find(x => x.id === id)) { alert("Solo podés eliminar recetas guardadas."); return; }
    if (!confirm("¿Eliminar esta receta?")) return;
    saveRecetas(data.filter(x => x.id !== id));
    renderMisRecetas(); renderFavoritas();
  }
});

/* ========= Buscar del inicio → ir a "Buscar" y ejecutar (extra) ========= */
$("#btn-home-search")?.addEventListener("click", () => {
  const q = $("#q-home").value;
  $("#q").value = q;
  showTab("explorar");
  doSearch(q);
});