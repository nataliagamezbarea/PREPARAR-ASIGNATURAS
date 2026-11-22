"use strict";

function dataCounts() {
  const themes = new Map();
  const history = typeof getHistory === "function" ? getHistory() : {};
  let practicadas = 0;
  let oficiales = 0;
  let introduccion = 0;
  let entrenamiento = 0;

  state.questions.forEach((q) => {
    const key = Number(q.tema);
    themes.set(key, (themes.get(key) || 0) + 1);
    if (q.practicada || history[q.id] != null) practicadas++;
    const cat = String(q.categoria || q.tag || "").toLowerCase();
    if (cat.includes("oficial")) oficiales++;
    else if (cat.includes("introduc")) introduccion++;
    else if (cat.includes("entren") || cat.includes("pract")) entrenamiento++;
  });

  return {
    total: state.questions.length,
    temas: [...themes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tema, count]) => ({ tema, count })),
    teoria: state.questions.filter((q) => q.tipo === "teoria").length,
    codigo: state.questions.filter((q) => q.tipo === "codigo").length,
    desarrollo: state.questions.filter((q) => q.tipo === "escribir_codigo" || q.tipo === "traza_linea" || q.tipo === "desarrollo").length,
    escribir_codigo: state.questions.filter((q) => q.tipo === "escribir_codigo").length,
    traza_linea: state.questions.filter((q) => q.tipo === "traza_linea").length,
    fallos: typeof getWrongIds === "function" ? getWrongIds().filter((id) => hasQuestion(id)).length : 0,
    practicadas,
    oficiales,
    introduccion,
    entrenamiento
  };
}

function wrongQuestions() {
  return typeof getWrongIds === "function"
    ? getWrongIds().map((id) => getQuestion(id)).filter(Boolean)
    : [];
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = $("#theme-btn");
  if (btn) {
    btn.innerHTML = theme === "dark"
      ? '<i class="fa-solid fa-sun" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
    btn.title = theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  }
  try { localStorage.setItem(LS.theme, theme); } catch { /* noop */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(LS.theme); } catch { /* noop */ }
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
  $("#theme-btn")?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}

function setModeChip(text, tone = "brand") {
  const chip = $("#mode-chip");
  if (!chip) return;
  if (!text) {
    chip.classList.add("hidden");
    return;
  }
  chip.className = `chip ${tone}`;
  chip.textContent = text;
  chip.classList.remove("hidden");
}

function getCatalogFallback() {
  return { asignaturas: DEFAULT_CATALOG };
}

function getCustomSubjects() {
  const list = readJSON(LS.custom, []);
  return Array.isArray(list)
    ? list.filter((s) => s && s.id && s.localData && Array.isArray(s.localData.preguntas))
    : [];
}

function setCustomSubjects(list) {
  try {
    localStorage.setItem(LS.custom, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

async function loadCatalog() {
  let catalog = [];
  state.errorCatalogoApuntes = "";
  try {
    let res = null;
    try {
      res = await fetch("./data/asignaturas.json", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP fallback");
    } catch {
      res = await fetch("/data/asignaturas.json", { cache: "no-store" });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    catalog = Array.isArray(data.asignaturas) ? data.asignaturas : [];
    if (catalog.length) {
      guardarEnCacheOffline("catalogo", catalog);
    }
  } catch {
    const catalogoCache = await obtenerDeCacheOffline("catalogo");
    if (Array.isArray(catalogoCache) && catalogoCache.length) {
      catalog = catalogoCache;
    } else {
      catalog = getCatalogFallback().asignaturas;
    }
  }
  const esEntornoEstatico =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" ||
      window.location.hostname.endsWith("github.io") ||
      window.location.hostname.endsWith("pages.dev"));

  if (!esEntornoEstatico) {
    try {
      const respuesta = await fetch("/api/apuntes", { cache: "no-store" });
      const contentType = respuesta.headers.get("content-type") || "";
      if (respuesta.ok && contentType.includes("application/json")) {
        const datos = await respuesta.json();
        state.apuntesCatalogo = Array.isArray(datos.asignaturas) ? datos.asignaturas : [];
        for (const asignatura of datos.asignaturas || []) {
          if (!asignatura?.nombre || !Array.isArray(asignatura.temas)) continue;
          catalog.push({
            id: `apuntes-${slugify(asignatura.nombre)}`,
            nombre: asignatura.nombre,
            etiqueta: `${asignatura.nombre} · apuntes (${asignatura.temas.length} temas)`,
            nombreApuntes: asignatura.nombre,
            temas: asignatura.temas,
            descripcion: `${asignatura.temas.length} temas detectados`,
            apuntesPrivados: true,
          });
        }
      } else if (!respuesta.ok && respuesta.status !== 404) {
        state.errorCatalogoApuntes = `El servidor devolvió HTTP ${respuesta.status}`;
      }
    } catch {
      state.errorCatalogoApuntes = "";
    }
  }

  // Cargar asignaturas creadas por el usuario localmente (offline / GitHub Pages)
  try {
    const custom = JSON.parse(localStorage.getItem("preparar_tests_custom_subjects") || "[]");
    for (const c of custom) {
      if (c && c.id && !catalog.some((s) => s.id === c.id)) {
        catalog.push(c);
      }
    }
  } catch {}
  const byId = new Map();
  catalog
    .filter((s) => s && s.id && (s.archivo || s.localData))
    .forEach((s) => {
      byId.set(s.id, {
        ...s,
        nombre: s.nombre || s.id,
        etiqueta: `${s.nombre || s.id} (Banco de preguntas)`,
      });
    });

  catalog
    .filter((s) => s && s.apuntesPrivados)
    .forEach((s) => {
      const apId = s.id.startsWith("apuntes-") ? s.id : `apuntes-${slugify(s.nombre)}`;
      byId.set(apId, {
        ...s,
        id: apId,
        etiqueta: `${s.nombre} · apuntes privados (${s.temas?.length || 0} temas)`,
      });
    });

  getCustomSubjects().forEach((s) => byId.set(s.id, { ...s, custom: true }));
  if (
    ![...byId.values()].some(
      (asignatura) =>
        !asignatura.apuntesPrivados &&
        (asignatura.archivo || asignatura.localData),
    )
  ) {
    DEFAULT_CATALOG.forEach((asignatura) => {
      if (!byId.has(asignatura.id)) byId.set(asignatura.id, asignatura);
    });
  }
  state.catalog = byId.size ? [...byId.values()] : [...DEFAULT_CATALOG];
}

async function fetchSubjectData(entry) {
  if (entry.localData) {
    state.source = "local";
    return entry.localData;
  }
  const primaryUrl = (entry.archivo || "").startsWith("/") ? `.${entry.archivo}` : (entry.archivo || "");
  const cacheKey = `banco_${entry.id}`;
  try {
    let res = null;
    try {
      res = await fetch(primaryUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("Fallback to absolute path");
    } catch {
      res = await fetch(entry.archivo, { cache: "no-store" });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.source = "json";
    const data = await res.json();
    if (data && Array.isArray(data.preguntas)) {
      guardarEnCacheOffline(cacheKey, data);
    }
    return data;
  } catch (error) {
    const dataCache = await obtenerDeCacheOffline(cacheKey);
    if (dataCache && Array.isArray(dataCache.preguntas)) {
      state.source = "offline-cache";
      return dataCache;
    }
    throw new Error(`No se pudo cargar "${entry.archivo}". Comprueba que el archivo de preguntas esté disponible.`);
  }
}

async function loadSubject(subjectId) {
  const entry = state.catalog.find((s) => s.id === subjectId) || state.catalog[0];
  if (!entry) throw new Error("No hay asignaturas disponibles.");
  const data = await fetchSubjectData(entry);
  if (!data || !Array.isArray(data.preguntas)) {
    throw new Error(`La asignatura "${entry.nombre}" no tiene preguntas válidas.`);
  }
  state.subjectId = entry.id;
  state.subject = entry;
  try { localStorage.setItem(LS.subject, entry.id); } catch { /* noop */ }
  normalizeData(data);
  state.order = [];
  state.index = 0;
  state.answers = {};
  state.finished = false;
  state.wrongFilter = "todos";
  return entry;
}

function slugify(text) {
  return String(text || "test")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "test";
}

function validateQuestionBank(data) {
  const rawList = Array.isArray(data?.preguntas)
    ? data.preguntas
    : Array.isArray(data?.preguntes)
      ? data.preguntes
      : Array.isArray(data)
        ? data
        : [];
  if (!rawList.length) {
    throw new Error("El JSON debe tener un array preguntas con al menos una pregunta.");
  }
  const ids = new Set();
  const apartatsMap = data.apartats || {};
  return rawList.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`La pregunta ${index + 1} no es un objeto.`);

    const enunciado = String(raw.enunciado || raw.q || "").trim();
    const codigo = String(raw.codigo || raw.codi || "").trim();
    const explicacion = String(raw.explicacion || raw.exp || raw.solucio || raw.solucion || "Sin explicación.").trim();
    const explicacionClara = String(raw.explicacionClara || explicacion).trim();

    let tipoRaw = String(raw.tipo || raw.tipus || "teoria").toLowerCase();
    const tipoMap = {
      codi: "codigo",
      codigo: "codigo",
      código: "codigo",
      error: "teoria",
      teoria: "teoria",
      teoría: "teoria",
      escriure: "escribir_codigo",
      escribir: "escribir_codigo",
      escribir_codigo: "escribir_codigo",
      interpretar: "traza_linea",
      traza: "traza_linea",
      traza_linea: "traza_linea",
      oberta: "desarrollo",
      abierta: "desarrollo",
      desarrollo: "desarrollo",
    };
    const tipo = tipoMap[tipoRaw] || tipoRaw;

    let opciones = {};
    if (raw.opciones && typeof raw.opciones === "object" && !Array.isArray(raw.opciones)) {
      opciones = { ...raw.opciones };
    } else if (Array.isArray(raw.op || raw.opciones)) {
      const arr = raw.op || raw.opciones;
      const letters = ["A", "B", "C", "D"];
      arr.forEach((texto, i) => {
        if (i < 4) opciones[letters[i]] = String(texto);
      });
    }

    const esAbierta = tipo === "escribir_codigo" || tipo === "traza_linea" || tipo === "desarrollo";
    if (esAbierta && Object.keys(opciones).length < 4) {
      opciones = { A: opciones.A || "-", B: opciones.B || "-", C: opciones.C || "-", D: opciones.D || "-" };
    } else if (!esAbierta) {
      for (const letter of ["A", "B", "C", "D"]) {
        if (!opciones[letter] || typeof opciones[letter] !== "string" || !opciones[letter].trim()) {
          opciones[letter] = opciones[letter] || `Opción ${letter}`;
        }
      }
    }

    let correcta = "A";
    if (typeof raw.ok === "number" && raw.ok >= 0 && raw.ok < 4) {
      correcta = ["A", "B", "C", "D"][raw.ok];
    } else if (raw.correcta) {
      correcta = String(raw.correcta).trim().toUpperCase().charAt(0);
    } else if (typeof raw.ok === "string") {
      correcta = String(raw.ok).trim().toUpperCase().charAt(0);
    }
    if (!["A", "B", "C", "D"].includes(correcta)) correcta = "A";

    let id = raw.id;
    if (id == null || ids.has(id)) {
      id = index + 1;
    }
    ids.add(id);

    let tema = Number(raw.tema || 0);
    if (!tema) {
      const matchTema = String(raw.tema || raw.id || raw.apartat || raw.apartado || "").match(/T(\d+)|tema\s*(\d+)/i);
      tema = matchTema ? Number(matchTema[1] || matchTema[2]) : 1;
    }

    const apRaw = String(raw.apartat || raw.apartado || "");
    let apartadoNombre = raw.apartadoNombre || (apartatsMap ? apartatsMap[apRaw] : "") || "";
    let apartado = Number(raw.apartado || 0);
    if (!apartado) {
      if (apRaw === "intro") apartado = 1;
      else if (apRaw === "pract") apartado = tema === 2 ? 10 : 8;
      else {
        const match = apRaw.match(/\d+\.(\d+)/);
        if (match) apartado = Number(match[1]);
        else apartado = 1;
      }
    }

    return {
      ...raw,
      id,
      tema,
      apartado,
      apartadoNombre,
      tipo,
      dificultad: raw.dificultad || "media",
      tag: raw.tag || (tipoRaw === "error" ? "Detección de errores" : tipo === "codigo" ? "Código" : esAbierta ? "Desarrollo" : "Teoría"),
      enunciado,
      codigo,
      opciones,
      correcta,
      explicacion,
      explicacionClara,
      traza: Array.isArray(raw.traza) ? raw.traza : [],
      solucion: raw.solucio || raw.solucion || explicacion,
      rubrica: Array.isArray(raw.rubrica) ? raw.rubrica : [],
      punts: raw.punts || raw.puntos || 1,
    };
  });
}

function normalizeData(data) {
  const rawList = Array.isArray(data?.preguntas)
    ? data.preguntas
    : Array.isArray(data?.preguntes)
      ? data.preguntes
      : Array.isArray(data)
        ? data
        : [];
  state.meta = data.meta || { total: rawList.length, asignatura: "WEC", titulo: data.tema || "WEC" };
  const validadas = rawList.length ? validateQuestionBank({ ...data, preguntas: rawList }) : [];
  state.questions = validadas;
  state.byId = new Map(state.questions.map((q) => [q.id, q]));
}

function saveCustomSubject(data, name, stableId = "") {
  const preguntas = validateQuestionBank(data);
  const id = stableId || `local-${Date.now().toString(36)}`;
  const nombre = String(name || data.meta?.asignatura || data.meta?.titulo || "Asignatura local").trim().slice(0, 60);
  const payload = {
    meta: { ...(data.meta || {}), asignatura: nombre, titulo: nombre, total: preguntas.length },
    preguntas
  };
  const entry = {
    id,
    nombre,
    archivo: "(local)",
    descripcion: data.meta?.descripcion || "Asignatura generada o importada",
    localData: payload,
    custom: true
  };
  const list = getCustomSubjects().filter((s) => s.id !== id);
  list.push(entry);
  if (!setCustomSubjects(list)) {
    throw new Error("No hay espacio en el navegador. Descarga el JSON y usa «Añadir asignatura» con el archivo.");
  }
  state.catalog = [...state.catalog.filter((s) => s.id !== id), entry];
  return entry;
}

window.cargarBancoDePreguntas = async (banco) => {
  const nombre = banco?.meta?.titulo || banco?.meta?.asignatura || "Test de apuntes";
  const datos = {
    meta: {
      ...(banco.meta || {}),
      titulo: nombre,
      asignatura: banco.meta?.asignatura || nombre,
      total: banco.preguntas?.length || 0
    },
    preguntas: banco.preguntas || []
  };
  const entrada = saveCustomSubject(
    datos,
    nombre,
    `apuntes-${String(banco.clave || "banco").replace(/[^a-zA-Z0-9_-]/g, "-")}`
  );
  await loadSubject(entrada.id);
  if (typeof renderStart === "function") renderStart();
  if (typeof startTest === "function") startTest({ filter: "all", immediate: true, shuffle: true });
};

async function removeCustomSubject(id) {
  setCustomSubjects(getCustomSubjects().filter((s) => s.id !== id));
  state.catalog = state.catalog.filter((s) => s.id !== id);
  if (!state.catalog.length) state.catalog = [...DEFAULT_CATALOG];
  await loadSubject(state.catalog[0].id);
}

function importSubjectFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(String(reader.result));
      const fallbackName = file.name.replace(/\.json$/i, "");
      const entry = saveCustomSubject(data, data.meta?.asignatura || fallbackName);
      await loadSubject(entry.id);
      if (typeof renderStart === "function") renderStart();
      toast(`Asignatura "${entry.nombre}" añadida con ${entry.localData.preguntas.length} preguntas.`);
    } catch (error) {
      toast(`No se pudo añadir: ${error.message}`);
    }
  };
  reader.onerror = () => toast("No se pudo leer el archivo.");
  reader.readAsText(file);
}
