/* ========= Estados de filtros ========= */
let misFilter = "";
let favFilter = "";

/* ========= Helpers básicos ========= */
const $  = s => document.querySelector(s);
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

/* ========= Cache global por ID (para que Ver/Importar funcione aunque cambies de pestaña) ========= */
const recipeCache = new Map();
function cacheRecipes(arr = []) { arr.forEach(r => { if (r?.id) recipeCache.set(r.id, r); }); }

/* ========= Traducción EN→ES ========= */
let TRANSLATE_ON = localStorage.getItem("translate_on") !== "0";
const shouldTranslate = () => TRANSLATE_ON;

// caché en cliente
const _tCache = new Map(); // key: `es|texto` -> traducción
const CLIENT_TIMEOUT_MS = 1500;

async function translateMany(texts) {
  if (!shouldTranslate() || !texts?.length) return texts;

  const out = new Array(texts.length);
  const need = [];
  const idx  = [];

  texts.forEach((t,i) => {
    const key = `es|${t}`;
    if (_tCache.has(key)) out[i] = _tCache.get(key);
    else { need.push(t); idx.push(i); }
  });

  if (!need.length) return out;

  // POST con timeout; si falla, devolvemos originales sin romper UX
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    const r = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: need, target: "es" }),
      signal: controller.signal
    });
    clearTimeout(id);

    const j = await r.json().catch(() => ({}));
    const trans = j?.translations || need;
    trans.forEach((tr,k) => {
      const i = idx[k];
      out[i] = tr ?? need[k];
      _tCache.set(`es|${need[k]}`, out[i]);
    });

  } catch {
    // falló la traducción -> devolvemos originales
    idx.forEach((i,k) => out[i] = need[k]);
  }

  // fusiono cacheados+traducidos
  texts.forEach((t,i) => { if (out[i] == null) out[i] = t; });
  return out;
}

// Traducir receta completa (título + ingredientes + pasos) — usar en modal
async function translateRecipe(r) {
  // traduce título, ingredientes y pasos (non-blocking en openDetalle)
  const title = r.titulo || "";
  const ings  = r.ingredientes || [];
  const pasos = r.pasos || [];
  const pack  = [title, ...ings, ...pasos];
  const tr    = await translateMany(pack);
  return {
    ...r,
    titulo: tr[0],
    ingredientes: tr.slice(1, 1+ings.length),
    pasos: tr.slice(1+ings.length)
  };
}

// Traducir SOLO títulos (para el listado — rápido)
async function translateTitles(recipes) {
  const titles = recipes.map(r => r.titulo || "");
  const tt = shouldTranslate() && titles.length ? await translateMany(titles) : titles;
  return recipes.map((r, i) => ({ ...r, titulo: tt[i] }));
}

/* ========= Navegación por pestañas ========= */
const sections = $$("main section");
const tabs = $$("nav .tab");
function showTab(id) {
  sections.forEach(s => s.classList.toggle("active", s.id === id));
  tabs.forEach(t => t.setAttribute("aria-selected", t.dataset.tab === id ? "true" : "false"));
  if (id === "mis-recetas") renderMisRecetas();
  if (id === "favoritas")  renderFavoritas();
}
tabs.forEach(t => t.addEventListener("click", () => showTab(t.dataset.tab)));
const firstSelected = $('nav .tab[aria-selected="true"]');
if (firstSelected) showTab(firstSelected.dataset.tab);

/* ========= LocalStorage ========= */
const LS_KEY = "recetas_v1";
const loadRecetas   = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] } };
const saveRecetas   = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr));
const upsertReceta  = r => { const a = loadRecetas(); const i = a.findIndex(x => x.id === r.id); i >= 0 ? a[i] = r : a.push(r); saveRecetas(a); };
const isSaved       = id => loadRecetas().some(r => r.id === id);

/* ========= Render de tarjetas ========= */
function recipeCard(r, opts = {}) {
  const actions = opts.actions || (r.createdAt ? ["ver", "fav", "eliminar"] : ["ver", "importar"]);
  const labels  = { ver: "Ver", importar: "Importar", fav: r.fav ? "Quitar ⭐" : "Marcar ⭐", eliminar: "Eliminar" };
  const btns    = actions.map(a => `<button class="btn" data-action="${a}">${labels[a]}</button>`).join("");
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
  cacheRecipes(tipicas);
}
renderTipicas();

/* ========= Modal detalle + edición ========= */
const modal     = $("#modal-detalle");
const mdTitulo  = $("#md-titulo");
const mdCat     = $("#md-cat");
const mdFecha   = $("#md-fecha");
const mdIng     = $("#md-ingredientes");
const mdPasos   = $("#md-pasos");
const mdCerrar  = $("#md-cerrar");
const mdEliminar= $("#md-eliminar");
const mdFav     = $("#md-fav");

// Botón Editar dinámico
let mdEditar = $("#md-editar");
if (!mdEditar) {
  const actions = modal?.querySelector(".actions.end");
  if (actions) {
    mdEditar = document.createElement("button");
    mdEditar.className = "btn";
    mdEditar.id = "md-editar";
    mdEditar.textContent = "Editar";
    actions.insertBefore(mdEditar, actions.firstChild);
  }
}

let modalRecetaId = null;
let editMode = false;
let editDraft = null;

function renderModalFields(r) {
  mdTitulo.textContent = r.titulo + (r.fav ? " ⭐" : "");
  mdCat.textContent    = r.categoria || "—";
  mdFecha.textContent  = r.createdAt ? "Guardada el " + formatDate(r.createdAt) : "";

  if (!editMode) {
    // --- Ingredientes
    mdIng.innerHTML = (r.ingredientes?.length ? r.ingredientes : ["—"])
      .map(i => `<li>${escapeHtml(i)}</li>`).join("");

    // --- Pasos (si hay)
    if (r.pasos && r.pasos.length) {
      mdPasos.innerHTML = r.pasos.map(p => `<li>${escapeHtml(p)}</li>`).join("");
    } else {
      // --- Mensaje especial cuando no vienen pasos de la API
      mdPasos.innerHTML = r.sourceUrl
        ? `<li class="muted">Esta receta no trae pasos en la API.<br>
            Mirá el paso a paso acá: 
            <a href="${r.sourceUrl}" target="_blank" rel="noopener">Receta original</a></li>`
        : `<li class="muted">Esta receta no trae pasos en la API.</li>`;
    }

  } else {
    // --- Modo edición
    mdIng.innerHTML = `
      <label class="muted">Título</label>
      <input id="ed-titulo" class="input" value="${escapeHtml(r.titulo)}">

      <label class="muted">Categoría</label>
      <input id="ed-cat" class="input" value="${escapeHtml(r.categoria || "")}">

      <label class="muted">Ingredientes (1 por línea)</label>
      <textarea id="ed-ings" class="input" rows="6">${escapeHtml((r.ingredientes || []).join("\n"))}</textarea>

      <label class="muted">Pasos (1 por línea)</label>
      <textarea id="ed-pasos" class="input" rows="8">${escapeHtml((r.pasos || []).join("\n"))}</textarea>
    `;
    mdPasos.innerHTML = ""; // vacío, ya están los campos arriba
  }

  // --- Actualiza el texto del botón Editar
  mdEditar.textContent = editMode ? "Guardar" : "Editar";
}

async function fetchRecipeDetailIfNeeded(r) {
  const faltaIng = !r.ingredientes || r.ingredientes.length === 0;
  const faltaPasos = !r.pasos || r.pasos.length === 0;
  if ((!faltaIng && !faltaPasos) || !r.edamamId) return r;

  try {
    const res = await fetch(`/api/edamam?id=${encodeURIComponent(r.edamamId)}`);
    const json = await res.json();
    if (json.recipe) {
      r.ingredientes = r.ingredientes?.length ? r.ingredientes : (json.recipe.ingredientes || []);
      r.pasos        = r.pasos?.length ? r.pasos : (json.recipe.pasos || []);
      r.sourceUrl    = r.sourceUrl || json.recipe.sourceUrl || null;
    }
  } catch {}
  return r;
}

async function openDetalle(r) {
  modalRecetaId = r.id;
  editMode = false;
  mdTitulo.textContent = r.titulo || "Receta";
  mdCat.textContent    = r.categoria || "—";
  mdFecha.textContent  = r.createdAt ? "Guardada el " + formatDate(r.createdAt) : "";
  mdIng.innerHTML      = (r.ingredientes?.length
                          ? r.ingredientes.map(i => `<li>${escapeHtml(i)}</li>`).join("")
                          : `<li class="muted">Buscando ingredientes…</li>`);
  mdPasos.innerHTML    = (r.pasos?.length
                          ? r.pasos.map(p => `<li>${escapeHtml(p)}</li>`).join("")
                          : `<li class="muted">Preparando pasos…</li>`);
  modal.showModal();

  let full = await fetchRecipeDetailIfNeeded({ ...r });
  
  renderModalFields(full);

  if (shouldTranslate()) {
    try {
      const traducida = await translateRecipe(full);
      if (modalRecetaId === r.id) {
        renderModalFields(traducida);
      }
    } catch (_) {
    }
  }
}

mdCerrar?.addEventListener("click", () => { editMode = false; modal.close(); });

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
  const data = loadRecetas();
  const r = data.find(x => x.id === modalRecetaId);
  if (!r) { alert("Para editar primero importá o guardá la receta."); return; }

  if (!editMode) {
    editMode = true;
    renderModalFields(r);
  } else {
    const titulo = ($("#ed-titulo")?.value || "").trim();
    const categoria = ($("#ed-cat")?.value || "").trim().toLowerCase();
    const ings = ($("#ed-ings")?.value || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const pasos = ($("#ed-pasos")?.value || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
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

/* ========= Buscar (con caché + cancelación) ========= */
const gridResultados = $("#grid-resultados");
let tempResults = [];

// Cache por query con TTL
const queryCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
function setQueryCache(key, value) { queryCache.set(key, { value, at: Date.now() }); }
function getQueryCache(key) {
  const item = queryCache.get(key);
  if (!item) return null;
  if (Date.now() - item.at > CACHE_TTL_MS) { queryCache.delete(key); return null; }
  return item.value;
}

// AbortControllers para cancelar peticiones en curso
let searchCtrl = null;
let genCtrl    = null;

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

  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();

  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = getQueryCache(cacheKey);
  if (cached) {
    tempResults = cached;
    gridResultados.innerHTML = cached.map(r => recipeCard(r)).join("");
    return;
  }

  gridResultados.innerHTML = `<p class="muted">Buscando recetas…</p>`;
  try {
    const res = await fetch(`/api/edamam?q=${encodeURIComponent(q)}&limit=24`, { signal: searchCtrl.signal });
    const json = await res.json();

    let merged = dedupByTitle(json.recipes || []);
    if (shouldTranslate() && merged.length) {
      const titles = await translateMany(merged.map(x => x.titulo || ""));
      merged = merged.map((r,i) => ({ ...r, titulo: titles[i] || r.titulo }));
    }
    cacheRecipes(merged);
    tempResults = merged;
    setQueryCache(cacheKey, merged);

    gridResultados.innerHTML = merged.length
      ? merged.map(r => recipeCard(r)).join("")
      : `<p class="muted">Sin resultados con “${escapeHtml(q)}”.</p>`;
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error(e);
    gridResultados.innerHTML = `<p class="muted">Error al buscar recetas.</p>`;
  } finally {
    searchCtrl = null;
  }
}

/* ========= Por ingredientes (con caché + cancelación) ========= */
$("#btn-generar")?.addEventListener("click", async () => {
  const raw = $("#ingredientes").value || "";
  const salida = $("#gen-salida");
  const list = raw.split(",").map(s => s.trim()).filter(Boolean);

  if (!list.length) { salida.textContent = "Escribí algunos ingredientes 🍫🍌"; return; }

  if (genCtrl) genCtrl.abort();
  genCtrl = new AbortController();

  const q = list.join(", ");
  const cacheKey = `ing:${q.toLowerCase()}`;

  const cached = getQueryCache(cacheKey);
  if (cached) {
    tempResults = cached;
    salida.innerHTML = cached.map(r => recipeCard(r)).join("");
    return;
  }

  salida.innerHTML = "Buscando con tus ingredientes…";
  try {
    const res = await fetch(`/api/edamam?q=${encodeURIComponent(q)}&limit=15`, { signal: genCtrl.signal });
    const json = await res.json();

    let merged = dedupByTitle(json.recipes || []);
    if (shouldTranslate() && merged.length) {
      const titles = await translateMany(merged.map(x => x.titulo || ""));
      merged = merged.map((r,i) => ({ ...r, titulo: titles[i] || r.titulo }));
    }
    cacheRecipes(merged);
    tempResults = merged;

    setQueryCache(cacheKey, merged);

    salida.innerHTML = merged.length
      ? merged.map(r => recipeCard(r)).join("")
      : "No encontré coincidencias 😅";
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error(e);
    salida.innerHTML = "Error consultando la API 😞";
  } finally {
    genCtrl = null;
  }
});

/* ========= Mis recetas / Favoritas ========= */
const gridMis  = $("#grid-mis");
const gridFavs = $("#grid-favs");
const emptyMis = $("#empty-mis");
const emptyFavs= $("#empty-favs");

function ensureSearchBar(container, id, placeholder, onInput) {
  const parent = container?.parentElement;
  if (!parent) return;
  let sb = parent.querySelector(`#${id}`);
  if (!sb) {
    sb = document.createElement("input");
    sb.id = id;
    sb.className = "input";
    sb.placeholder = placeholder;
    sb.style.marginBottom = "12px";
    parent.insertBefore(sb, container);
    sb.addEventListener("input", e => onInput(e.target.value.trim().toLowerCase()));
  }
  return sb;
}

function renderMisRecetas() {
  if (!gridMis) return;
  ensureSearchBar(gridMis, "mis-search", "Buscar en mis recetas…", (v) => { misFilter = v; renderMisRecetas(); });
  const base = loadRecetas().sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  const data = misFilter
    ? base.filter(r => (r.titulo||"").toLowerCase().includes(misFilter) ||
                       (r.ingredientes||[]).join(",").toLowerCase().includes(misFilter))
    : base;
  gridMis.innerHTML = data.map(r => recipeCard(r, { actions: ["ver","fav","eliminar"] })).join("");
  if (emptyMis) emptyMis.style.display = data.length ? "none" : "block";
}

function renderFavoritas() {
  if (!gridFavs) return;
  ensureSearchBar(gridFavs, "favs-search", "Buscar en favoritas…", (v) => { favFilter = v; renderFavoritas(); });
  const base = loadRecetas().filter(r => r.fav);
  const data = favFilter
    ? base.filter(r => (r.titulo||"").toLowerCase().includes(favFilter) ||
                       (r.ingredientes||[]).join(",").toLowerCase().includes(favFilter))
    : base;
  gridFavs.innerHTML = data.map(r => recipeCard(r, { actions: ["ver","fav","eliminar"] })).join("");
  if (emptyFavs) emptyFavs.style.display = data.length ? "none" : "block";
}

/* ========= Form Nueva Receta ========= */
const formNueva = $("#form-nueva");
if (formNueva) {
  formNueva.addEventListener("submit", (e) => {
    e.preventDefault();
    const titulo    = $("#titulo").value.trim();
    const categoria = ($("#categoria").value || "").trim().toLowerCase() || "general";
    const ing       = ($("#ing").value || "").trim();
    const pasos     = ($("#pasos").value || "").trim();
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
  const btn  = e.target.closest(".recipe .btn");
  if (!btn) return;
  const card = e.target.closest(".recipe");
  const id   = card?.dataset.id;
  if (!id) return;

  // Buscar primero en cache global; luego fallback
  let r = recipeCache.get(id) ||
          tipicas.find(x => x.id === id) ||
          tempResults.find(x => x.id === id) ||
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
    const rec  = data.find(x => x.id === id);
    if (!rec) { alert("Primero importá o guardá la receta para marcarla ⭐"); return; }
    rec.fav = !rec.fav;
    saveRecetas(data);
    renderMisRecetas();
    renderFavoritas();
  }

  if (btn.dataset.action === "eliminar") {
    const data = loadRecetas();
    if (!data.find(x => x.id === id)) { alert("Solo podés eliminar recetas guardadas."); return; }
    if (!confirm("¿Eliminar esta receta?")) return;
    saveRecetas(data.filter(x => x.id !== id));
    renderMisRecetas();
    renderFavoritas();
  }
});

/* ========= Buscar del inicio → ir a "Buscar" y ejecutar ========= */
$("#btn-home-search")?.addEventListener("click", () => {
  const q = $("#q-home").value;
  $("#q").value = q;
  showTab("explorar");
  doSearch(q);
});