/* ============================
   🍓 Recetas de Mafer - script.js (FINAL)
   ============================ */

/* ====== CONFIG ====== */
const EDAMAM_APP_ID  = "5b2fe970";     
const EDAMAM_APP_KEY = "ff7960e1eab38cf330b0f3eda4e9fab9";    
const TRANSLATE_URL  = "/api/translate"; 

/* ====== STATE ====== */
const state = {
  tab: "home",
  results: [],
  mine: loadJSON("mafer_mis_recetas", []),
  favs:  loadJSON("mafer_favoritas", []),
  cacheTR: loadJSON("mafer_cache_tr", {}), 
};

/* ====== UTILS ====== */
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function saveJSON(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
function loadJSON(key, def){ try{ return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); }catch{ return def; } }
function fmtDate(d=new Date()){ return d.toLocaleDateString("es-AR", {year:"numeric",month:"short",day:"numeric"}); }
function uid(){ return "id_" + Math.random().toString(36).slice(2,10); }

/* =====================================================
   🍓 Toasts - avisos con fade y autodesaparición
   ===================================================== */
function showToast(msg, { type="info", duration=2500 } = {}) {
  document.querySelectorAll(".toast").forEach(t => t.remove()); // solo 1 a la vez
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  if (type === "success") toast.style.borderColor = "var(--brand)";
  if (type === "error")   toast.style.borderColor = "#ff8fa3";
  if (type === "warn")    toast.style.borderColor = "#FFD580";
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.style.opacity = "1");
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translate(-50%, 8px)";
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/* ===== Normalizador de recetas a un esquema común ===== */
function normalizeRecipe(src, rec){
  if(src==="mealdb"){
    const ing = [];
    for (let i=1;i<=20;i++){
      const iName = rec[`strIngredient${i}`];
      const iMeas = rec[`strMeasure${i}`];
      if(iName && iName.trim()) ing.push([iMeas||"", iName].join(" ").trim());
    }
    const steps = (rec.strInstructions||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    return {
      id: `mealdb_${rec.idMeal}`,
      source: "mealdb",
      title: rec.strMeal || "",
      category: rec.strCategory || "",
      image: rec.strMealThumb || "",
      ingredients: ing,
      steps,
      date: Date.now(),
      meta: { area: rec.strArea || "", tags: (rec.strTags||"").split(",").filter(Boolean) }
    };
  }
  if(src==="edamam"){
    const r = rec.recipe || rec;
    const ing = (r.ingredientLines||[]).slice(0,40);
    const steps = []; // Edamam no trae pasos en esta API
    const cat = (r.dietLabels||[]).concat(r.healthLabels||[]).slice(0,3).join(" • ");
    return {
      id: `edamam_${r.uri?.split("#recipe_")[1] || uid()}`,
      source: "edamam",
      title: r.label || "",
      category: cat,
      image: r.image || "",
      ingredients: ing,
      steps,
      date: Date.now(),
      meta: {
        calories: Math.round(r.calories||0),
        protein: (r.totalNutrients?.PROCNT?.quantity ? Math.round(r.totalNutrients.PROCNT.quantity) : null),
      }
    };
  }
  // propias (custom)
  return rec;
}

/* ====== FETCHERS ====== */
async function fetchJSON(url){
  const r = await fetch(url);
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/* TheMealDB: por nombre */
async function mealdbSearch(q){
  const url = `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`;
  const j = await fetchJSON(url);
  const items = (j.meals||[]).map(m=>normalizeRecipe("mealdb", m));
  return items;
}

/* TheMealDB: “típicas” para portada (seed aleatoria) */
async function mealdbPopularSeed(){
  const seeds = ["chocolate","pancake","chicken","salad","pasta","brownie","omelette"];
  const pick = seeds[Math.floor(Math.random()*seeds.length)];
  return mealdbSearch(pick);
}

/* Edamam: por nombre + filtros (opcional) */
async function edamamSearch(q, {diet="", health=""}={}){
  if(!EDAMAM_APP_ID || !EDAMAM_APP_KEY) return [];
  const base = new URL("https://api.edamam.com/search");
  base.searchParams.set("q", q || "dessert");
  base.searchParams.set("app_id", EDAMAM_APP_ID);
  base.searchParams.set("app_key", EDAMAM_APP_KEY);
  if(diet)   base.searchParams.set("diet", diet);     // e.g. high-protein
  if(health) base.searchParams.set("health", health); // e.g. sugar-conscious
  base.searchParams.set("to", "20");
  const j = await fetchJSON(base.toString());
  const items = (j.hits||[]).map(h=>normalizeRecipe("edamam", h));
  return items;
}

/* ====== TRADUCCIÓN (via backend) ====== */
async function translateBatch(texts){
  const target = "es";
  const hits = [];
  const need = [];
  const backIdx = [];
  // cache lookup
  texts.forEach((t,i)=>{
    const k = `${target}|${t}`;
    const cached = state.cacheTR[k];
    if(cached != null){ hits[i] = cached; }
    else { backIdx.push(i); need.push(t); }
  });

  if(need.length){
    try{
      const r = await fetch(`${TRANSLATE_URL}`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ texts: need, target })
      });
      const j = await r.json();
      const tr = j.translations || need;
      tr.forEach((val, k)=>{
        const i = backIdx[k];
        hits[i] = val;
        state.cacheTR[`${target}|${need[k]}`] = val;
      });
      saveJSON("mafer_cache_tr", state.cacheTR);
    }catch{
      backIdx.forEach((i,k)=>{ hits[i] = need[k]; });
      showToast("Error al traducir 😔", { type:"error", duration: 3000 });
    }
  }
  return hits;
}

/* Traduce un objeto receta (título + ingredientes + pasos) */
async function translateRecipe(rec){
  const texts = [rec.title, ...rec.ingredients, ...rec.steps];
  const out = await translateBatch(texts);
  const tTitle = out[0];
  const tIngr  = out.slice(1, 1 + rec.ingredients.length);
  const tSteps = out.slice(1 + rec.ingredients.length);
  return { ...rec, title: tTitle, ingredients: tIngr, steps: tSteps };
}

/* ====== RENDER ====== */
function recipeCard(rec){
  const fav = state.favs.includes(rec.id);
  return `
    <article class="recipe" data-id="${rec.id}">
      <div class="thumb" role="img" aria-label="${rec.title}">
        <img loading="lazy" src="${rec.image || "https://via.placeholder.com/400x300?text=Receta"}" alt="${rec.title}">
      </div>
      <div class="body">
        <h4 class="title">${rec.title}</h4>
        <div class="meta">
          <span class="badge">${rec.category || rec.source}</span>
          ${rec.meta?.protein ? `<span class="muted">${rec.meta.protein}g proteína</span>` : ""}
        </div>
        <div class="actions">
          <button class="btn small" data-action="ver">Ver</button>
          <button class="btn small ghost" data-action="guardar">Guardar</button>
          <button class="btn small ${fav ? "primary": ""}" data-action="fav">⭐</button>
        </div>
      </div>
    </article>
  `;
}

function renderGrid(el, items){
  el.innerHTML = items.map(recipeCard).join("") || `<div class="muted">Sin resultados.</div>`;
}

/* ====== Helper: de qué grid estoy re-renderizando ====== */
function gridDataFromParent(parentId){
  if (parentId === "grid-resultados") return state.results;
  if (parentId === "grid-tipicas")    return state.results.slice(0, 8);
  if (parentId === "grid-mis")        return state.mine;
  if (parentId === "grid-favs") {
    return [...state.mine, ...state.results].filter(r => state.favs.includes(r.id));
  }
  return [];
}

/* ====== MODAL DETALLE ====== */
function openModal(rec){
  $("#md-titulo").textContent = rec.title;
  $("#md-cat").textContent = rec.category || rec.source;
  $("#md-fecha").textContent = fmtDate(rec.date);
  $("#md-ingredientes").innerHTML = rec.ingredients.map(i=>`<li>${i}</li>`).join("") || "<li class='muted'>—</li>";
  $("#md-pasos").innerHTML = rec.steps.map(s=>`<li>${s}</li>`).join("") || "<li class='muted'>—</li>";
  $("#md-fav").dataset.id = rec.id;
  $("#md-eliminar").dataset.id = rec.id;

  // Traducción “on open”
  translateRecipe(rec).then(tr=>{
    $("#md-titulo").textContent = tr.title;
    $("#md-ingredientes").innerHTML = tr.ingredients.map(i=>`<li>${i}</li>`).join("") || "<li class='muted'>—</li>";
    $("#md-pasos").innerHTML = tr.steps.map(s=>`<li>${s}</li>`).join("") || "<li class='muted'>—</li>";
  });

  $("#modal-detalle").showModal();
}

/* ====== ACCIONES ====== */
function attachGridHandlers(root){
  root.addEventListener("click", (ev)=>{
    const btn = ev.target.closest("button[data-action]");
    if(!btn) return;
    const card = ev.target.closest(".recipe");
    const id = card?.dataset.id;
    const rec = findAnyRecipeById(id);
    if(!rec) return;

    const action = btn.dataset.action;
    if(action==="ver") openModal(rec);
    if(action==="guardar"){
      if(!state.mine.find(r=>r.id===rec.id)){
        state.mine.push(rec);
        saveJSON("mafer_mis_recetas", state.mine);
        refreshMine();
        showToast("Receta guardada 🍓", { type:"success" });
      }
    }
    if(action==="fav"){
      const i = state.favs.indexOf(rec.id);
      if(i<0) { state.favs.push(rec.id); showToast("Agregada a favoritas ⭐", { type:"success" }); }
      else    { state.favs.splice(i,1);  showToast("Quitada de favoritas", { type:"warn" }); }
      saveJSON("mafer_favoritas", state.favs);
      refreshFavs();
      // re-render para reflejar estrella
      const parent = card.parentElement;
      renderGrid(parent, gridDataFromParent(parent.id));
      attachGridHandlers(parent);
    }
  });
}

/* Busca receta por id entre resultados y mis recetas */
function findAnyRecipeById(id){
  return state.results.find(r=>r.id===id)
      || state.mine.find(r=>r.id===id)
      || state.results.find(r=> state.favs.includes(r.id) && r.id===id)
      || state.mine.find(r=> state.favs.includes(r.id) && r.id===id);
}

/* ====== TABS ====== */
$all("nav .tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    state.tab = btn.dataset.tab;
    $all("main section").forEach(s=>s.classList.remove("active"));
    $(`#${state.tab}`).classList.add("active");
    $all("nav .tab").forEach(b=>b.setAttribute("aria-selected", b===btn ? "true":"false"));
    if(state.tab==="mis-recetas") refreshMine();
    if(state.tab==="favoritas")   refreshFavs();
    if(state.tab==="fitness")     loadFitnessIntro();
  });
});

/* Enter para buscar */
$("#q-home").addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){ $("#btn-home-search").click(); }
});
$("#q").addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){ $("#btn-buscar").click(); }
});

/* ====== HOME: populares ====== */
async function loadHome(){
  const items = await mealdbPopularSeed();
  const titles = await translateBatch(items.map(r=>r.title)); // títulos en ES
  const merged = items.map((r,i)=>({ ...r, title: titles[i] || r.title }));
  state.results = merged; // base para reusar
  renderGrid($("#grid-tipicas"), merged.slice(0,8));
  attachGridHandlers($("#grid-tipicas"));
}

/* ====== BUSCAR ====== */
$("#btn-home-search").addEventListener("click", ()=> {
  const q = $("#q-home").value.trim();
  goSearch(q);
  $(`nav .tab[data-tab="explorar"]`).click();
});

$("#btn-buscar").addEventListener("click", ()=> {
  const q = $("#q").value.trim();
  goSearch(q, $("#filtro-cat").value);
});

async function goSearch(q, cat=""){
  const grid = $("#grid-resultados");
  // skeleton simple
  grid.innerHTML = `
    <div class="recipes">
      ${Array.from({length: 6}).map(()=> `<div class="skeleton"></div>`).join("")}
    </div>
  `;
  try{
    let items = await mealdbSearch(q||"chocolate");
    if(!items.length){
      const f = cat==="fitness" ? {diet:"high-protein"} : {};
      items = await edamamSearch(q||"dessert", f);
    }
    const titles = await translateBatch(items.map(r=>r.title));
    const merged = items.map((r,i)=>({ ...r, title: titles[i] || r.title }));
    state.results = merged;
    renderGrid(grid, merged);
    attachGridHandlers(grid);
    if(!merged.length){
      grid.innerHTML = `<div class="muted center">Sin resultados para “${q || "tendencias"}”.</div>`;
    }
  } catch(err){
    grid.innerHTML = `<div class="muted center">Error buscando recetas. Intentá de nuevo más tarde.</div>`;
    showToast("Error de red al buscar 😔", { type:"error", duration: 3500 });
    console.error("goSearch error:", err);
  }
}

/* ====== GENERADOR POR INGREDIENTES (demo simple) ====== */
$("#btn-generar").addEventListener("click", async ()=>{
  const input = $("#ingredientes").value.trim();
  if(!input){ $("#gen-salida").textContent = "Escribí al menos 2 ingredientes 😉"; return; }
  const first = input.split(",")[0].trim();
  let items = await mealdbSearch(first);
  if(!items.length) items = await edamamSearch(first);
  if(!items.length){
    $("#gen-salida").textContent = "No encontré nada con esos ingredientes 😔";
    return;
  }
  const pick = items[0];
  const tr = await translateRecipe(pick);
  $("#gen-salida").innerHTML = `
    <h4>${tr.title}</h4>
    <strong>Ingredientes</strong>
    <ul>${tr.ingredients.map(i=>`<li>${i}</li>`).join("")}</ul>
    <strong>Pasos</strong>
    <ol>${tr.steps.map(s=>`<li>${s}</li>`).join("") || "<li>—</li>"}</ol>
  `;
});

/* ====== NUEVA RECETA ====== */
$("#form-nueva").addEventListener("submit", (ev)=>{
  ev.preventDefault();
  const rec = normalizeRecipe("custom", {
    id: `mine_${uid()}`,
    source: "mine",
    title: $("#titulo").value.trim(),
    category: $("#categoria").value.trim(),
    image: "",
    ingredients: ($("#ing").value||"").split(",").map(s=>s.trim()).filter(Boolean),
    steps: ($("#pasos").value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean),
    date: Date.now(),
    meta: {}
  });
  if(!rec.title){ return; }
  state.mine.unshift(rec);
  saveJSON("mafer_mis_recetas", state.mine);
  $("#form-nueva").reset();
  refreshMine();
  showToast("¡Receta guardada! 🍓", { type:"success" });
});

function refreshMine(){
  const grid = $("#grid-mis");
  $("#empty-mis").style.display = state.mine.length ? "none":"block";
  renderGrid(grid, state.mine);
  attachGridHandlers(grid);
}

function refreshFavs(){
  const grid = $("#grid-favs");
  const favRecs = [...state.mine, ...state.results].filter(r=>state.favs.includes(r.id));
  $("#empty-favs").style.display = favRecs.length ? "none":"block";
  renderGrid(grid, favRecs);
  attachGridHandlers(grid);
}

/* ====== FITNESS ====== */
async function loadFitnessIntro(){
  const grid = $("#fitness .card + .card .recipes");
  if(!grid) {
    const holder = document.createElement("div");
    holder.className = "card";
    holder.innerHTML = `<h3>Ideas fitness</h3><div class="recipes"></div>`;
    $("#fitness").appendChild(holder);
  }
  const tgt = $("#fitness .recipes") || $("#fitness .card + .card .recipes");
  tgt.innerHTML = `<div class="muted">Cargando opciones altas en proteína…</div>`;
  const items = await edamamSearch("protein snack", {diet:"high-protein"});
  const titles = await translateBatch(items.map(r=>r.title));
  const merged = items.map((r,i)=>({ ...r, title: titles[i] || r.title }));
  renderGrid(tgt, merged.slice(0,12));
  attachGridHandlers(tgt);
}

/* ====== INIT ====== */
(async function init(){
  await loadHome();
})();