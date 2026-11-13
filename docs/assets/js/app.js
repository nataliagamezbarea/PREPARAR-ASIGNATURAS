// === assets/js/app/persistencia-archivos.js ===
(function () {
  const nombreBaseDatos = "preparar-tests-borradores";
  const nombreAlmacen = "borradores";
  const versionBaseDatos = 1;

  function abrirBaseDatos() {
    return new Promise((resolver, rechazar) => {
      const solicitud = indexedDB.open(nombreBaseDatos, versionBaseDatos);
      solicitud.onupgradeneeded = () => {
        solicitud.result.createObjectStore(nombreAlmacen);
      };
      solicitud.onsuccess = () => resolver(solicitud.result);
      solicitud.onerror = () =>
        rechazar(solicitud.error ?? new Error("No se pudo abrir el almacenamiento local."));
      solicitud.onblocked = () =>
        rechazar(new Error("Cierra otras pestañas de Preparar tests para guardar el borrador."));
    });
  }

  async function ejecutarTransaccion(modo, operacion) {
    const baseDatos = await abrirBaseDatos();
    try {
      return await new Promise((resolver, rechazar) => {
        const transaccion = baseDatos.transaction(nombreAlmacen, modo);
        const almacen = transaccion.objectStore(nombreAlmacen);
        let resultado;
        operacion(almacen, (valor) => {
          resultado = valor;
        });
        transaccion.oncomplete = () => resolver(resultado);
        transaccion.onerror = () =>
          rechazar(transaccion.error ?? new Error("No se pudo guardar el borrador."));
        transaccion.onabort = () =>
          rechazar(transaccion.error ?? new Error("Se canceló el guardado del borrador."));
      });
    } finally {
      baseDatos.close();
    }
  }

  async function guardarArchivosPersistidos(clave, archivos, valores = {}) {
    const archivosGuardados = await Promise.all(
      archivos.map(async (archivo) => ({
        nombre: archivo.name,
        tipo: archivo.type,
        modificado: archivo.lastModified,
        ruta: archivo.webkitRelativePath || archivo.name,
        contenido: archivo.slice(0, archivo.size, archivo.type),
      })),
    );
    await ejecutarTransaccion("readwrite", (almacen) => {
      almacen.put({ archivos: archivosGuardados, valores }, clave);
    });
  }

  async function cargarArchivosPersistidos(clave) {
    const borrador = await ejecutarTransaccion("readonly", (almacen, resolver) => {
      const solicitud = almacen.get(clave);
      solicitud.onsuccess = () => resolver(solicitud.result ?? null);
      solicitud.onerror = () =>
        resolver(Promise.reject(solicitud.error ?? new Error("No se pudo leer el borrador.")));
    });
    if (!borrador) return { archivos: [], valores: {} };
    const archivos = (borrador.archivos ?? []).map((archivo) => {
      const restaurado = new File([archivo.contenido], archivo.nombre, {
        type: archivo.tipo,
        lastModified: archivo.modificado,
      });
      if (archivo.ruta && archivo.ruta !== archivo.nombre) {
        Object.defineProperty(restaurado, "webkitRelativePath", {
          value: archivo.ruta,
        });
      }
      return restaurado;
    });
    return { archivos, valores: borrador.valores ?? {} };
  }

  async function borrarArchivosPersistidos(clave) {
    await ejecutarTransaccion("readwrite", (almacen) => almacen.delete(clave));
  }

  window.prepararTestsPersistencia = {
    borrarArchivosPersistidos,
    cargarArchivosPersistidos,
    guardarArchivosPersistidos,
  };
})();


// === assets/js/app/estado.js ===
"use strict";

const LS = {
  session: "wec12_session_v1",
  wrong: "wec12_wrong_v1",
  history: "wec12_history_v1",
  stats: "wec12_stats_v1",
  theme: "wec12_theme_v1",
  subject: "wec12_subject_v1",
  custom: "wec12_custom_subjects_v1",
  ai: "wec12_ai_url_v1"
};

const DEFAULT_CATALOG = [
  { id: "wec", nombre: "WEC", archivo: "./data/asignaturas/wec/preguntas.json", descripcion: "Temas 1, 2, 3 y 4 · 3000 preguntas de teoría, código y examen" }
];

const state = {
  meta: null,
  questions: [],
  byId: new Map(),
  order: [],
  index: 0,
  answers: {},
  immediate: true,
  startedAt: 0,
  finished: false,
  screen: "start",
  source: "embedded",
  selectedFilter: "all",
  wrongFilter: "todos",
  catalog: [],
  errorCatalogoApuntes: "",
  subjectId: "",
  subject: null,
  apuntesCatalogo: [],
  sampleSize: 0,
  masteryMode: false,
  masteryRound: 0
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const main = $("#main");
const toastEl = $("#toast");
let toastTimer = null;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatText(value) {
  let out = esc(value);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\n/g, "<br>");
  return out;
}

function letterIndex(letter) {
  return "ABCD".indexOf(letter);
}

function letterAt(index) {
  return "ABCD"[index] || "";
}

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
}

function scopeKey(base) {
  return `${base}:${state.subjectId || "default"}`;
}

function readStore(base, fallback) {
  const scoped = readJSON(scopeKey(base), null);
  if (scoped !== null) return scoped;
  if (state.subjectId === "wec") return readJSON(base, fallback);
  return fallback;
}

function writeStore(base, value) {
  writeJSON(scopeKey(base), value);
}

function removeStore(base) {
  try { localStorage.removeItem(scopeKey(base)); } catch { /* noop */ }
  try { localStorage.removeItem(base); } catch { /* noop */ }
}

function getWrongIds() {
  const ids = readStore(LS.wrong, []);
  return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : [];
}

function setWrongIds(ids) {
  writeStore(LS.wrong, [...new Set(ids)]);
}

function getHistory() {
  const value = readStore(LS.history, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function setHistory(history) {
  writeStore(LS.history, history);
}

function dataCounts() {
  const themes = new Map();
  state.questions.forEach((q) => {
    const key = Number(q.tema);
    themes.set(key, (themes.get(key) || 0) + 1);
  });
  return {
    total: state.questions.length,
    temas: [...themes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tema, count]) => ({ tema, count })),
    teoria: state.questions.filter((q) => q.tipo === "teoria").length,
    codigo: state.questions.filter((q) => q.tipo === "codigo").length,
    fallos: getWrongIds().filter((id) => state.byId.has(id)).length
  };
}

function wrongQuestions() {
  return getWrongIds()
    .map((id) => state.byId.get(id))
    .filter(Boolean);
}

function limpiarTituloApartado(texto) {
  let limpio = String(texto || "").trim();
  limpio = limpio
    .replace(/Col[·•.\s]*legi[\s\S]*$/i, "")
    .replace(/Math\..*$/i, "")
    .replace(/localStorage[\s\S]*$/i, "")
    .replace(/^[·•\s-]+/, "")
    .trim();

  const mTema = limpio.match(/Tema\s*\d+(?:\.\d+)*\s*[:·-]\s*([^·\n\r]{3,60})/i);
  if (mTema && mTema[1]) {
    limpio = mTema[1].trim();
  } else {
    limpio = limpio.replace(/^ABANS DE COMENÇAR[^·\n\r]*[·\n\r]*/i, "").trim();
    const partes = limpio.split(/[·\n\r]/).map((p) => p.trim()).filter(Boolean);
    if (partes.length > 1) {
      const candidata = partes.find(
        (p) =>
          p.length >= 4 &&
          p.length <= 60 &&
          !p.toLowerCase().includes("col") &&
          !p.toLowerCase().includes("abans") &&
          !p.toLowerCase().includes("desenvolupament web"),
      );
      if (candidata) limpio = candidata;
    }
  }

  limpio = limpio
    .replace(/^Tema\s*\d+(?:\.\d+)*\s*[:·-]?\s*/i, "")
    .replace(/^[·•\s-]+/, "")
    .replace(/[·•\s-]+$/, "")
    .trim();

  if (limpio.toLowerCase() === "undefined" || limpio.toLowerCase() === "null") {
    return "Variables y tipos primitivos";
  }

  if (limpio.length > 55) {
    limpio = limpio.slice(0, 52) + "…";
  }
  return limpio;
}

function resolveApartadoForQuestion(q) {
  if (!q) return { tema: 1, apartado: 0, codigo: "Tema 1", titulo: "Tema 1", tag: "" };
  const temaNum = Number(q.tema) || 1;
  let apNum = Number(q.apartado) || 0;
  let apNombre = q.apartadoNombre || "";

  const currentSubject = state.subject?.nombre || "WEC";
  const apuntesEntry = (state.apuntesCatalogo || []).find(
    (a) => a.nombre.toLowerCase() === currentSubject.toLowerCase(),
  );

  if (!apNum && apuntesEntry?.temas) {
    const temaObj = apuntesEntry.temas.find((t) => Number(t.numero) === temaNum);
    if (temaObj?.apartados) {
      const matchWords = (s1, s2) => {
        const w1 = (s1 || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 4);
        const w2 = (s2 || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 4);
        return w1.some((w) => w2.includes(w));
      };
      const foundAp = temaObj.apartados.find(
        (ap) => matchWords(q.tag, ap.nombre) || matchWords(q.apartadoNombre, ap.nombre),
      );
      if (foundAp) {
        apNum = Number(foundAp.numero);
        apNombre = foundAp.nombre;
      }
    }
  }

  if (!apNum && temaNum === 1) {
    const t = String(q.tag || "").toLowerCase();
    if (t.includes("origen") || t.includes("diseño") || t.includes("cliente-servidor") || t.includes("capas")) {
      apNum = 1; apNombre = "Origen y alcance de la web";
    } else if (t.includes("lenguaje") || t.includes("scripts")) {
      apNum = 2; apNombre = "Lenguajes de programación en entorno cliente";
    } else if (t.includes("arquitectura") || t.includes("motor") || t.includes("límite")) {
      apNum = 3; apNombre = "Arquitectura del navegador y motores de ejecución";
    } else if (t.includes("comunica") || t.includes("red")) {
      apNum = 4; apNombre = "Subsistema de comunicaciones";
    } else if (t.includes("intèrpret") || t.includes("ejecución")) {
      apNum = 5; apNombre = "Intérprete de JavaScript";
    } else if (t.includes("html") || t.includes("integración") || t.includes("dom") || t.includes("form") || t.includes("valida")) {
      apNum = 6; apNombre = "Integración con HTML y eventos";
    } else if (t.includes("seguridad") || t.includes("herramienta")) {
      apNum = 7; apNombre = "Seguridad web y herramientas de cliente";
    }
  } else if (!apNum && temaNum === 2) {
    const t = String(q.tag || "").toLowerCase();
    if (t.includes("undefined") || t.includes("null") || t.includes("variable") || t.includes("primitivo") || t.includes("reservada")) {
      apNum = 1; apNombre = "Variables y tipos primitivos";
    } else if (t.includes("operador") || t.includes("asignac") || t.includes("booleano") || t.includes("falsy") || t.includes("precedencia") || t.includes("ternario")) {
      apNum = 2; apNombre = "Operadores y expresiones";
    } else if (t.includes("bucle") || t.includes("for") || t.includes("while") || t.includes("break") || t.includes("continue") || t.includes("switch") || t.includes("if")) {
      apNum = 3; apNombre = "Estructuras de control y bucles";
    } else if (t.includes("comentario") || t.includes("depurac")) {
      apNum = 4; apNombre = "Comentarios y depuración de código";
    } else {
      apNum = 1; apNombre = "Sintaxis, tipos y operadores";
    }
  }

  let subTitulo = apNombre ? limpiarTituloApartado(apNombre) : "";
  if (!subTitulo || subTitulo.toLowerCase() === "undefined" || subTitulo.toLowerCase() === "null") {
    subTitulo = temaNum === 2 ? "Variables y tipos primitivos" : `Tema ${temaNum} · Contenidos generales`;
  }

  const tagClean = String(q.tag || "").trim();
  const concepto = (tagClean && tagClean.toLowerCase() !== "sin clasificar" && tagClean.toLowerCase() !== "undefined")
    ? tagClean
    : (tagClean.toLowerCase() === "undefined" ? "Tipo undefined" : "");

  return {
    tema: temaNum,
    apartado: apNum,
    codigo: apNum ? `${temaNum}.${apNum}` : `Tema ${temaNum}`,
    titulo: subTitulo,
    tag: concepto,
  };
}

function getWeakSubapartados(topN = 20) {
  const wrong = new Set(getWrongIds().filter((id) => state.byId.has(id)));
  const history = getHistory();
  const bySub = new Map();

  state.questions.forEach((q) => {
    if (!wrong.has(q.id)) return;
    const h = history[q.id] || {};
    const fails = Math.max(1, Number(h.fails) || 1);

    const res = resolveApartadoForQuestion(q);
    const key = `t${res.tema}-ap${res.apartado || res.titulo}`;

    const cur = bySub.get(key) || {
      key,
      tema: res.tema,
      apartado: res.apartado,
      codigo: res.codigo,
      titulo: res.titulo,
      fails: 0,
      total: 0,
      tags: new Set(),
      ids: [],
    };
    cur.fails += fails;
    cur.total += 1;
    if (res.tag) {
      cur.tags.add(res.tag);
    }
    cur.ids.push(q.id);
    bySub.set(key, cur);
  });

  return [...bySub.values()]
    .map((item) => {
      const allInSub = state.questions.filter((q) => {
        const r = resolveApartadoForQuestion(q);
        return r.tema === item.tema && r.apartado === item.apartado;
      });
      const answeredInSub = allInSub.filter((q) => history[q.id]?.selected != null);
      const denominator = answeredInSub.length || item.total;
      const pctFallo = denominator ? Math.min(100, Math.round((item.total / denominator) * 100)) : 100;
      return {
        ...item,
        pctFallo,
        totalBanco: allInSub.length,
        tags: [...item.tags],
      };
    })
    .sort((a, b) => b.pctFallo - a.pctFallo || b.fails - a.fails || b.total - a.total)
    .slice(0, topN);
}

function getWeakSubapartadosByTema() {
  const allWeak = getWeakSubapartados(50);
  const byTema = new Map();

  allWeak.forEach((sub) => {
    const t = sub.tema;
    const cur = byTema.get(t) || {
      tema: t,
      subapartados: [],
      totalFails: 0,
      totalPreguntasFalladas: 0,
      allIds: [],
    };
    cur.subapartados.push(sub);
    cur.totalFails += sub.fails;
    cur.totalPreguntasFalladas += sub.total;
    cur.allIds.push(...sub.ids);
    byTema.set(t, cur);
  });

  return [...byTema.values()]
    .sort((a, b) => a.tema - b.tema)
    .map((group) => {
      const uniqueIds = [...new Set(group.allIds)];
      const avgFailPct = group.subapartados.length
        ? Math.round(group.subapartados.reduce((acc, s) => acc + s.pctFallo, 0) / group.subapartados.length)
        : 100;
      group.subapartados.sort((a, b) => b.pctFallo - a.pctFallo || b.fails - a.fails);
      return {
        ...group,
        uniqueIds,
        failRate: avgFailPct,
      };
    });
}

function getWeakConcepts(topN = 8) {
  const wrong = new Set(
    getWrongIds().filter((id) => state.byId.has(id)),
  );
  const history = getHistory();
  const byTag = new Map();
  state.questions.forEach((q) => {
    if (!wrong.has(q.id)) return;
    const h = history[q.id] || {};
    const fails = Math.max(1, Number(h.fails) || 1);
    const rawTag = q.tag || q.apartadoNombre || "";
    const tagStr = String(rawTag).trim();
    if (
      !tagStr ||
      tagStr.toLowerCase() === "undefined" ||
      tagStr.toLowerCase() === "null" ||
      tagStr.toLowerCase() === "sin clasificar"
    ) {
      return;
    }
    const cur = byTag.get(tagStr) || { tag: tagStr, fails: 0, total: 0, ids: [] };
    cur.fails += fails;
    cur.total += 1;
    cur.ids.push(q.id);
    byTag.set(tagStr, cur);
  });
  return [...byTag.values()]
    .sort(
      (a, b) =>
        b.fails - a.fails ||
        b.total - a.total ||
        (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
    )
    .slice(0, topN);
}

const LS_AI_GENERADAS = "wec12_ai_generadas_v1";

function readAiGeneratedMap() {
  const value = readJSON(LS_AI_GENERADAS, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function writeAiGeneratedMap(map) {
  writeJSON(LS_AI_GENERADAS, map);
}
function getAiGenerated(subjectId) {
  const entry = readAiGeneratedMap()[subjectId || "default"];
  return entry && Array.isArray(entry.enunciados) ? entry.enunciados : [];
}
function recordAiGenerated(subjectId, enunciados) {
  const map = readAiGeneratedMap();
  map[subjectId || "default"] = {
    enunciados: Array.isArray(enunciados) ? enunciados.slice(-300) : [],
    updatedAt: new Date().toISOString(),
  };
  writeAiGeneratedMap(map);
}

function buildExportPayload() {
  return {
    app: "test-interactivo",
    schema: 1,
    exportedAt: new Date().toISOString(),
    asignatura: state.subject ? { id: state.subject.id, nombre: state.subject.nombre } : null,
    meta: state.meta || null,
    totalPreguntas: state.questions.length,
    wrongIds: getWrongIds(),
    history: getHistory(),
    stats: getStats()
  };
}

function isWrongEntry(value) {
  return value && typeof value === "object" && typeof value.selected === "string";
}

function applyImportedData(data) {
  if (!data || typeof data !== "object") throw new Error("El archivo no contiene un objeto JSON válido.");
  const rawIds = Array.isArray(data.wrongIds) ? data.wrongIds : Array.isArray(data.fallos) ? data.fallos : null;
  if (!rawIds) throw new Error("El archivo no tiene la lista wrongIds.");
  const incomingIds = rawIds.map(Number).filter((id) => Number.isInteger(id) && state.byId.has(id));
  const incomingHistory = data.history && typeof data.history === "object" && !Array.isArray(data.history) ? data.history : {};

  const mergedWrong = new Set(getWrongIds().filter((id) => state.byId.has(id)));
  incomingIds.forEach((id) => mergedWrong.add(id));
  const mergedHistory = getHistory();
  Object.entries(incomingHistory).forEach(([key, entry]) => {
    const id = Number(key);
    if (Number.isInteger(id) && state.byId.has(id) && isWrongEntry(entry)) {
      mergedHistory[id] = {
        selected: String(entry.selected).charAt(0).toUpperCase(),
        at: typeof entry.at === "string" ? entry.at : new Date().toISOString(),
        fails: Math.max(1, Number(entry.fails) || 1)
      };
      if (!mergedWrong.has(id)) mergedWrong.add(id);
    }
  });
  setWrongIds([...mergedWrong]);
  setHistory(mergedHistory);

  if (data.stats && typeof data.stats === "object") {
    const current = getStats();
    const imported = data.stats;
    const importedDate = imported.lastDate ? Date.parse(imported.lastDate) : 0;
    const currentDate = current.lastDate ? Date.parse(current.lastDate) : 0;
    const merged = {
      attempts: Math.max(Number(current.attempts) || 0, Number(imported.attempts) || 0),
      bestPct: Math.max(Number(current.bestPct) || 0, Number(imported.bestPct) || 0),
      lastPct: importedDate > currentDate ? Number(imported.lastPct) || 0 : Number(current.lastPct) || 0,
      lastTotal: importedDate > currentDate ? Number(imported.lastTotal) || 0 : Number(current.lastTotal) || 0,
      lastDate: importedDate > currentDate ? imported.lastDate : current.lastDate
    };
    setStats(merged);
  }
  writePersistenceFile();
  return incomingIds.length;
}

function exportWrongsFile() {
  const payload = buildExportPayload();
  if (!payload.wrongIds.length) {
    toast("Todavía no hay fallos que exportar.");
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `${slugify(state.subject?.nombre || "test")}-fallos-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`Exportados ${payload.wrongIds.length} fallos a archivo.`);
}

function importWrongsFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const count = applyImportedData(data);
      renderWrongBook();
      toast(`Importados ${count} fallos. Total: ${getWrongIds().length}.`);
    } catch (error) {
      toast(`Archivo no válido: ${error.message}`);
    }
  };
  reader.onerror = () => toast("No se pudo leer el archivo.");
  reader.readAsText(file);
}

/* Persistencia opcional en un archivo real mediante File System Access API */
let persistenceHandle = null;
let persistenceFileName = "";

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("Sin IndexedDB"));
    const req = indexedDB.open("wec12-files", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("handles")) req.result.createObjectStore("handles");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

function canLinkFile() {
  return typeof window.showSaveFilePicker === "function";
}

async function writePersistenceFile(force = false) {
  if (!persistenceHandle) return false;
  try {
    if (!force && typeof persistenceHandle.queryPermission === "function") {
      const permission = await persistenceHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") return false;
    }
    const writable = await persistenceHandle.createWritable();
    await writable.write(JSON.stringify(buildExportPayload(), null, 2) + "\n");
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

function persistenceKey() {
  return `wrongsFile:${state.subjectId || "default"}`;
}

async function loadPersistenceHandle() {
  try {
    const handle = await idbGet(persistenceKey());
    if (handle) {
      persistenceHandle = handle;
      persistenceFileName = handle.name || "fallos.json";
      await writePersistenceFile(false);
    }
  } catch { /* IndexedDB no disponible */ }
}

async function linkPersistenceFile() {
  if (!canLinkFile()) {
    toast("Este navegador no permite vincular un archivo. Usa Exportar/Importar JSON.");
    return;
  }
  const suggestedName = `${slugify(state.subject?.nombre || "test")}-fallos.json`;
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: "Datos de fallos", accept: { "application/json": [".json"] } }]
    });
    persistenceHandle = handle;
    persistenceFileName = handle.name || suggestedName;
    await idbSet(persistenceKey(), handle);
    const ok = await writePersistenceFile(true);
    toast(ok ? `Fallos vinculados a ${persistenceFileName}.` : "Archivo elegido, pero no se pudo escribir.");
    renderWrongBook();
  } catch (error) {
    if (error?.name !== "AbortError") toast("No se pudo vincular el archivo.");
  }
}

async function unlinkPersistenceFile() {
  persistenceHandle = null;
  persistenceFileName = "";
  try { await idbSet(persistenceKey(), null); } catch { /* noop */ }
  renderWrongBook();
  toast("Archivo desvinculado. La copia del navegador sigue activa.");
}

function getStats() {
  return readStore(LS.stats, { attempts: 0, bestPct: 0, lastPct: 0, lastTotal: 0, lastDate: null });
}

function setStats(stats) {
  writeStore(LS.stats, stats);
}

const LS_BLOCK_POINTERS = "wec12_block_pointers_v1";

function getBloquePointersMap() {
  const subjectId = state.subjectId || "wec";
  const allMaps = readJSON(LS_BLOCK_POINTERS, {});
  return allMaps && typeof allMaps === "object" && allMaps[subjectId] ? allMaps[subjectId] : {};
}

function getBloquePointer(filterKey) {
  if (!filterKey) return 0;
  const map = getBloquePointersMap();
  const val = Number(map[filterKey]);
  return Number.isSafeInteger(val) && val >= 0 ? val : 0;
}

function saveBloquePointer(filterKey, pointer) {
  if (!filterKey) return;
  const subjectId = state.subjectId || "wec";
  const allMaps = readJSON(LS_BLOCK_POINTERS, {});
  const safeMap = allMaps && typeof allMaps === "object" ? allMaps : {};
  if (!safeMap[subjectId]) safeMap[subjectId] = {};
  safeMap[subjectId][filterKey] = Math.max(0, Number(pointer) || 0);
  writeJSON(LS_BLOCK_POINTERS, safeMap);
}

const LS_SESSIONS_MAP = "wec12_sessions_by_filter_v1";

function getSessionsMap() {
  const subjectId = state.subjectId || "wec";
  const allMaps = readJSON(LS_SESSIONS_MAP, {});
  return allMaps && typeof allMaps === "object" && allMaps[subjectId] ? allMaps[subjectId] : {};
}

function getSessionForFilter(filterKey) {
  if (!filterKey) return null;
  const map = getSessionsMap();
  const session = map[filterKey];
  if (session && !session.finished && Array.isArray(session.ids) && session.ids.length) {
    return session;
  }
  const current = getSession();
  if (current && current.filter === filterKey && !current.finished && Array.isArray(current.ids)) {
    return current;
  }
  return null;
}

function saveSessionForFilter(filterKey, sessionData) {
  if (!filterKey) return;
  const subjectId = state.subjectId || "wec";
  const allMaps = readJSON(LS_SESSIONS_MAP, {});
  if (!allMaps || typeof allMaps !== "object") return;
  if (!allMaps[subjectId]) allMaps[subjectId] = {};
  if (sessionData && !sessionData.finished) {
    allMaps[subjectId][filterKey] = sessionData;
  } else {
    delete allMaps[subjectId][filterKey];
  }
  writeJSON(LS_SESSIONS_MAP, allMaps);
}

function getSession() {
  return readStore(LS.session, null);
}

function saveSession() {
  if (!state.order.length) return;
  const filterKey = state.selectedFilter || "all";
  const sessionData = {
    filter: filterKey,
    ids: state.order.map((q) => q.id),
    index: state.index,
    answers: state.answers,
    immediate: state.immediate,
    startedAt: state.startedAt,
    finished: state.finished,
    masteryMode: state.masteryMode,
    masteryRound: state.masteryRound
  };
  writeStore(LS.session, sessionData);
  saveSessionForFilter(filterKey, sessionData);
}

function clearSession() {
  removeStore(LS.session);
  if (state.selectedFilter) {
    saveSessionForFilter(state.selectedFilter, null);
  }
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
  } catch {
    catalog = getCatalogFallback().asignaturas;
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
  const byId = new Map();
  // 1. Conservar siempre todos los bancos oficiales y locales que contienen preguntas
  catalog
    .filter((s) => s && s.id && (s.archivo || s.localData))
    .forEach((s) => {
      byId.set(s.id, {
        ...s,
        nombre: s.nombre || s.id,
        etiqueta: `${s.nombre || s.id} (Banco de examen · ${s.id === "wec" ? "3.000 preguntas" : "preguntas"})`,
      });
    });

  // 2. Añadir entradas de apuntes privados detectadas sin sobreescribir los bancos existentes
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
    return await res.json();
  } catch (error) {
    throw new Error(`No se pudo cargar "${entry.archivo}". Comprueba que el archivo de preguntas esté disponible.`);
  }
}

async function loadSubject(subjectId) {
  const entry = state.catalog.find((s) => s.id === subjectId) || state.catalog[0];
  if (!entry) throw new Error("No hay asignaturas disponibles.");
  const data = await fetchSubjectData(entry);
  if (!data || !Array.isArray(data.preguntas) || !data.preguntas.length) {
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
  persistenceHandle = null;
  persistenceFileName = "";
  await loadPersistenceHandle();
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
  if (!data || !Array.isArray(data.preguntas) || !data.preguntas.length) {
    throw new Error("El JSON debe tener un array preguntas con al menos una pregunta.");
  }
  const ids = new Set();
  return data.preguntas.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`La pregunta ${index + 1} no es un objeto.`);
    const opciones = raw.opciones || {};
    for (const letter of ["A", "B", "C", "D"]) {
      if (typeof opciones[letter] !== "string" || !opciones[letter].trim()) {
        throw new Error(`La pregunta ${index + 1} necesita las opciones A, B, C y D.`);
      }
    }
    const correcta = String(raw.correcta || "").trim().toUpperCase().charAt(0);
    if (!["A", "B", "C", "D"].includes(correcta)) {
      throw new Error(`La pregunta ${index + 1} tiene una respuesta correcta inválida.`);
    }
    let id = Number(raw.id);
    if (!Number.isInteger(id) || id <= 0 || ids.has(id)) id = index + 1;
    ids.add(id);
    return {
      ...raw,
      id,
      tema: Number(raw.tema) || 1,
      tipo: raw.tipo === "codigo" ? "codigo" : "teoria",
      dificultad: raw.dificultad || "media",
      tag: raw.tag || "Generado",
      opciones,
      correcta,
      explicacion: raw.explicacion || "Sin explicación.",
      traza: Array.isArray(raw.traza) ? raw.traza : []
    };
  });
}

function normalizeData(data) {
  state.meta = data.meta || { total: data.preguntas.length };
  state.questions = data.preguntas.map((q) => ({
    ...q,
    opciones: q.opciones || {},
    traza: Array.isArray(q.traza) ? q.traza : []
  }));
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
  renderStart();
  startTest({ filter: "all", immediate: true, shuffle: true });
};

window.renderizarInicioTests = renderStart;

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
      renderStart();
      toast(`Asignatura "${entry.nombre}" añadida con ${entry.localData.preguntas.length} preguntas.`);
    } catch (error) {
      toast(`No se pudo añadir: ${error.message}`);
    }
  };
  reader.onerror = () => toast("No se pudo leer el archivo.");
  reader.readAsText(file);
}


// === assets/js/app/sesion.js ===
"use strict";

function countAnswered() {
  return state.order.reduce((acc, q) => acc + (state.answers[q.id] != null ? 1 : 0), 0);
}

function countCorrect() {
  return state.order.reduce((acc, q) => acc + (state.answers[q.id] === q.correcta ? 1 : 0), 0);
}

function filterPool(filter) {
  if (typeof filter === "string" && filter.startsWith("tema:")) {
    const parts = filter.split(":");
    const tema = Number(parts[1]);
    const sub = parts[2];
    if (sub === "codigo") {
      return state.questions.filter((q) => Number(q.tema) === tema && q.tipo === "codigo");
    }
    if (sub === "teoria") {
      return state.questions.filter((q) => Number(q.tema) === tema && q.tipo === "teoria");
    }
    return state.questions.filter((q) => Number(q.tema) === tema);
  }
  if (typeof filter === "string" && filter.startsWith("apartado:")) {
    const [, temaStr, apartadoStr, sub] = filter.split(":");
    const temaNum = Number(temaStr);
    const apartadoNum = Number(apartadoStr);
    return state.questions.filter((q) => {
      const res = resolveApartadoForQuestion(q);
      const match = Number(res.tema) === temaNum && Number(res.apartado) === apartadoNum;
      if (!match) return false;
      if (sub === "codigo") return q.tipo === "codigo";
      if (sub === "teoria") return q.tipo === "teoria";
      return true;
    });
  }
  if (filter === "tema1") return state.questions.filter((q) => Number(q.tema) === 1);
  if (filter === "tema2") return state.questions.filter((q) => Number(q.tema) === 2);
  if (filter === "codigo") return state.questions.filter((q) => q.tipo === "codigo");
  if (filter === "teoria") return state.questions.filter((q) => q.tipo === "teoria");
  if (filter === "fallos") {
    const wrong = new Set(getWrongIds());
    return state.questions.filter((q) => wrong.has(q.id));
  }
  return state.questions;
}

function startTest({
  filter = "all",
  ids = null,
  immediate = true,
  shuffle = false,
  sample = 0,
  mastery = false,
  continueMastery = false,
} = {}) {
  let pool = ids ? ids.map((id) => state.byId.get(id)).filter(Boolean) : filterPool(filter);
  if (!pool.length) {
    toast("No hay preguntas para esa opción.");
    return;
  }
  const limit = Number(sample) || 0;
  if (limit > 0 && limit < pool.length) {
    pool = shuffleArray(pool).slice(0, limit);
  } else if (shuffle) {
    pool = shuffleArray(pool);
  }
  state.order = pool;
  state.index = 0;
  state.answers = {};
  state.immediate = immediate;
  state.startedAt = Date.now();
  state.finished = false;
  state.selectedFilter = filter;
  state.sampleSize = limit;
  state.masteryMode = mastery;
  state.masteryRound = mastery
    ? continueMastery
      ? state.masteryRound + 1
      : 1
    : 0;
  saveSession();
  renderTest();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resumeSession(sessionObj = null) {
  const session = (sessionObj && sessionObj.ids) ? sessionObj : getSession();
  if (!session || !Array.isArray(session.ids) || !session.ids.length) return;
  const ids = session.ids.filter((id) => state.byId.has(id));
  if (!ids.length) {
    clearSession();
    toast("La sesión guardada ya no es válida.");
    renderStart();
    return;
  }
  state.order = ids.map((id) => state.byId.get(id));
  state.index = Math.min(Math.max(session.index || 0, 0), state.order.length - 1);
  state.answers = session.answers || {};
  state.immediate = session.immediate !== false;
  state.startedAt = session.startedAt || Date.now();
  state.finished = Boolean(session.finished);
  state.selectedFilter = session.filter || "all";
  state.masteryMode = Boolean(session.masteryMode);
  state.masteryRound = state.masteryMode
    ? Math.max(1, Number(session.masteryRound) || 1)
    : 0;
  if (state.finished) {
    renderResults();
  } else {
    renderTest();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function discardSession() {
  clearSession();
  renderStart();
  toast("Sesión descartada.");
}

function formatearFiltroLegible(filter) {
  if (!filter || filter === "all") return "Test completo (Ambas)";
  if (filter.startsWith("tema:")) {
    const parts = filter.split(":");
    const t = parts[1];
    const sub = parts[2];
    if (sub === "codigo") return `Tema ${t} · Solo código y desarrollo`;
    if (sub === "teoria") return `Tema ${t} · Solo teoría`;
    return `Tema ${t}`;
  }
  if (filter.startsWith("apartado:")) {
    const [, t, ap, sub] = filter.split(":");
    if (sub === "codigo") return `Apartado ${t}.${ap} · Solo código`;
    if (sub === "teoria") return `Apartado ${t}.${ap} · Solo teoría`;
    return `Apartado ${t}.${ap}`;
  }
  if (filter === "codigo") return "Solo código y desarrollo";
  if (filter === "teoria") return "Solo teoría";
  if (filter === "fallos") return "Repaso de fallos";
  return filter;
}

const WEC_ESTRUCTURA_TEMAS = [
  {
    numero: 1,
    nombre: "Tema 1 · Arquitecturas y herramientas de programación web",
    apartados: [
      { numero: 1, nombre: "Origen y alcance de la web" },
      { numero: 2, nombre: "Lenguajes de programación en entorno cliente" },
      { numero: 3, nombre: "Arquitectura del navegador y motores de ejecución" },
      { numero: 4, nombre: "Subsistema de comunicacions" },
      { numero: 5, nombre: "Intèrpret de JavaScript" },
      { numero: 6, nombre: "Conceptos e Introducción a la Integración del Código con HTML" },
      { numero: 7, nombre: "EINES DE PROGRAMACIÓ SOBRE CLIENTS WEB" },
    ],
  },
  {
    numero: 2,
    nombre: "Tema 2 · Sintaxis, tipos de datos, operadores y estructuras de control",
    apartados: [
      { numero: 1, nombre: "Selección del lenguaje de programación del cliente" },
    ],
  },
  {
    numero: 3,
    nombre: "Tema 3 · Objetos predefinidos y modelo de objetos del documento",
    apartados: [
      { numero: 1, nombre: "Objetos predefinidos y modelo de objetos del documento (DOM)" },
    ],
  },
  {
    numero: 4,
    nombre: "Tema 4 · Programación con funciones, arrays y objetos",
    apartados: [
      { numero: 1, nombre: "Tema 4.1 · Funciones: para qué sirven y cómo se definen" },
      { numero: 2, nombre: "Tema 4.2 · Arrays: crear y leer posiciones" },
      { numero: 3, nombre: "Tema 4.3 · Métodos de array (map, filter, reduce)" },
      { numero: 4, nombre: "Tema 4.4 · Objectes literals i JSON" },
      { numero: 5, nombre: "Part B · Ejercicios de desarrollo de examen" },
    ],
  },
];

function startBloque(filterKey) {
  const pool = filterPool(filterKey);
  if (!pool || !pool.length) {
    toast("No hay preguntas para este apartado.");
    return;
  }
  let pointer = getBloquePointer(filterKey);
  if (pointer >= pool.length) {
    pointer = 0;
  }
  const blockSize = 40;
  const sliced = pool.slice(pointer, pointer + blockSize);
  const nextPointer = (pointer + blockSize) >= pool.length ? 0 : pointer + blockSize;
  saveBloquePointer(filterKey, nextPointer);

  const immediate = $("#immediate-toggle")?.checked !== false;
  const shuffle = Boolean($("#shuffle-toggle")?.checked);

  startTest({
    filter: filterKey,
    ids: sliced.map((q) => q.id),
    immediate,
    shuffle,
    sample: 0,
  });
}

function construirArbolDashboardHTML() {
  const currentSubject = state.subject?.nombre || "WEC";
  const isWec = currentSubject.toUpperCase().includes("WEC");
  const apuntesEntry = (state.apuntesCatalogo || []).find(
    (a) => a.nombre.toLowerCase() === currentSubject.toLowerCase(),
  );
  const history = getHistory();

  let listaTemas = [];
  if (isWec) {
    listaTemas = WEC_ESTRUCTURA_TEMAS;
  } else if (apuntesEntry && Array.isArray(apuntesEntry.temas) && apuntesEntry.temas.length) {
    listaTemas = apuntesEntry.temas;
  } else {
    const counts = dataCounts();
    listaTemas = counts.temas.map(({ tema }) => ({
      numero: tema,
      nombre: `Tema ${tema}`,
      apartados: [],
    }));
  }

  if (!listaTemas.length) {
    return `<p class="muted" style="padding:12px">No se encontraron temas para esta asignatura.</p>`;
  }

  return listaTemas
    .map((t) => {
      const preguntasTema = state.questions.filter(
        (q) => Number(q.tema) === Number(t.numero),
      );
      const codigoTema = preguntasTema.filter((q) => q.tipo === "codigo").length;
      const teoriaTema = preguntasTema.filter((q) => q.tipo === "teoria").length;
      const respondidasTema = preguntasTema.filter(
        (q) => history[q.id]?.selected != null,
      );
      const aciertosTema = preguntasTema.filter(
        (q) => history[q.id]?.selected === q.correcta,
      );
      const fallosTema = respondidasTema.length - aciertosTema.length;

      const apartados = Array.isArray(t.apartados) ? t.apartados : [];
      const apartadosHTML = apartados
        .map((ap) => {
          const preguntasAp = preguntasTema.filter((q) => {
            const res = resolveApartadoForQuestion(q);
            return Number(res.apartado) === Number(ap.numero);
          });
          const codigoAp = preguntasAp.filter((q) => q.tipo === "codigo").length;
          const teoriaAp = preguntasAp.filter((q) => q.tipo === "teoria").length;
          const respondidasAp = preguntasAp.filter(
            (q) => history[q.id]?.selected != null,
          );
          const aciertosAp = preguntasAp.filter(
            (q) => history[q.id]?.selected === q.correcta,
          );

          const filterAp = "apartado:" + t.numero + ":" + ap.numero;
          const sesionAp = getSessionForFilter(filterAp);
          const tieneAMediasAp = Boolean(
            sesionAp && !sesionAp.finished && Array.isArray(sesionAp.ids) && sesionAp.ids.length
          );
          const pregActualAp = tieneAMediasAp
            ? Math.min((sesionAp.index || 0) + 1, sesionAp.ids.length)
            : 0;

          const pointerAp = getBloquePointer(filterAp);
          const totalAp = preguntasAp.length;
          const startBloqueAp = Math.min(pointerAp + 1, Math.max(1, totalAp));
          const endBloqueAp = Math.min(pointerAp + 40, totalAp);
          const numBloqueAp = Math.floor(pointerAp / 40) + 1;
          const totalBloquesAp = Math.ceil(totalAp / 40) || 1;

          let btnPracticarOContinuarAp = "";
          if (tieneAMediasAp) {
            btnPracticarOContinuarAp = `
              <button class="btn tiny primary" type="button" data-resume-filter="${filterAp}" title="Continuar el test que dejaste a medias">▶ Continuar (${pregActualAp}/${sesionAp.ids.length})</button>
              <button class="btn tiny ghost" type="button" data-restart-filter="${filterAp}" title="Volver a empezar desde la pregunta 1">↺ Reiniciar</button>
            `;
          } else if (totalAp > 40) {
            btnPracticarOContinuarAp = `
              <button class="btn tiny primary" type="button" data-start-bloque="${filterAp}" title="Practicar un bloque de 40 preguntas (avanza automáticamente en caché)">⚡ Bloque ${numBloqueAp}/${totalBloquesAp} (preg. ${startBloqueAp}–${endBloqueAp})</button>
              <button class="btn tiny ghost" type="button" data-start-apartado="${t.numero}:${ap.numero}" title="Practicar todas las preguntas de este apartado">Todas (${totalAp})</button>
            `;
          } else if (totalAp > 0) {
            btnPracticarOContinuarAp = `
              <button class="btn tiny primary" type="button" data-start-apartado="${t.numero}:${ap.numero}">▶ Practicar (${totalAp})</button>
            `;
          }

          let badgeEstado = "";
          if (preguntasAp.length > 0 && respondidasAp.length >= preguntasAp.length) {
            badgeEstado = `<span class="tree-chip done-chip"><i class="fa-solid fa-check"></i> Hecho (${aciertosAp.length}/${preguntasAp.length})</span>`;
          } else if (tieneAMediasAp) {
            badgeEstado = `<span class="tree-chip pend-chip" style="font-weight:700"><i class="fa-solid fa-clock-rotate-left"></i> A medias (${pregActualAp}/${sesionAp.ids.length})</span>`;
          } else if (respondidasAp.length > 0) {
            badgeEstado = `<span class="tree-chip done-chip"><i class="fa-solid fa-clock-rotate-left"></i> En curso (${respondidasAp.length}/${preguntasAp.length})</span>`;
          } else if (preguntasAp.length > 0) {
            badgeEstado = `<span class="tree-chip pend-chip"><i class="fa-regular fa-clock"></i> Pendiente</span>`;
          } else {
            badgeEstado = `<span class="tree-chip empty-chip">Sin preguntas</span>`;
          }

          return `
            <div class="tree-subapartado-row">
              <div class="tree-sub-info">
                <span class="tree-sub-code">${t.numero}.${ap.numero}</span>
                <span class="tree-sub-title" title="${esc(ap.nombre)}">${esc(limpiarTituloApartado(ap.nombre))}</span>
              </div>
              <div class="tree-sub-meta">
                <span class="tree-chip bank-chip"><i class="fa-solid fa-list-check"></i> ${preguntasAp.length} en banco</span>
                ${codigoAp > 0 ? `<span class="tree-chip" style="font-size:10.5px; opacity:0.85"><i class="fa-solid fa-code"></i> ${codigoAp}</span>` : ""}
                ${teoriaAp > 0 ? `<span class="tree-chip" style="font-size:10.5px; opacity:0.85"><i class="fa-solid fa-book"></i> ${teoriaAp}</span>` : ""}
                ${badgeEstado}
              </div>
              <div class="tree-sub-btns">
                ${btnPracticarOContinuarAp}
                <button class="btn tiny ghost" type="button" data-generar-apartado="${t.numero}:${ap.numero}" title="Generar preguntas con IA para este apartado"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
              </div>
            </div>
          `;
        })
        .join("");

      const filterTema = "tema:" + t.numero;
      const sesionTema = getSessionForFilter(filterTema);
      const tieneAMediasTema = Boolean(
        sesionTema && !sesionTema.finished && Array.isArray(sesionTema.ids) && sesionTema.ids.length
      );
      const pregActualTema = tieneAMediasTema
        ? Math.min((sesionTema.index || 0) + 1, sesionTema.ids.length)
        : 0;

      const pointerTema = getBloquePointer(filterTema);
      const totalTema = preguntasTema.length;
      const startBloqueTema = Math.min(pointerTema + 1, Math.max(1, totalTema));
      const endBloqueTema = Math.min(pointerTema + 40, totalTema);
      const numBloqueTema = Math.floor(pointerTema / 40) + 1;
      const totalBloquesTema = Math.ceil(totalTema / 40) || 1;

      const pctTema = preguntasTema.length
        ? Math.round((respondidasTema.length / preguntasTema.length) * 100)
        : 0;
      const pctAcierto = respondidasTema.length
        ? Math.round((aciertosTema.length / respondidasTema.length) * 100)
        : 0;

      let btnPracticarOContinuarTema = "";
      if (tieneAMediasTema) {
        btnPracticarOContinuarTema = `
          <button class="btn tiny primary" type="button" data-resume-filter="${filterTema}" title="Continuar el test que dejaste a medias">▶ Continuar (${pregActualTema}/${sesionTema.ids.length})</button>
          <button class="btn tiny ghost" type="button" data-restart-filter="${filterTema}" title="Reiniciar">↺ Reiniciar</button>
        `;
      } else if (totalTema > 40) {
        btnPracticarOContinuarTema = `
          <button class="btn tiny primary" type="button" data-start-bloque="${filterTema}" title="Practicar un bloque de 40 preguntas de este tema">⚡ Bloque 40 (${startBloqueTema}–${endBloqueTema})</button>
          <button class="btn tiny ghost" type="button" data-start="tema:${t.numero}">Todo el tema (${totalTema})</button>
        `;
      } else {
        btnPracticarOContinuarTema = `
          <button class="btn tiny primary" type="button" data-start="tema:${t.numero}">▶ Hacer todo (${totalTema})</button>
        `;
      }

      return `
        <details class="tree-tema-details" open>
          <summary class="tree-tema-summary">
            <div class="tree-tema-summary-left">
              <i class="fa-solid fa-folder-open tree-folder-icon"></i>
              <span class="tree-tema-name">${esc(t.nombre || "Tema " + t.numero)}</span>
              <div class="tree-tema-progress" title="${pctTema}% completado · ${pctAcierto}% aciertos">
                <div class="tree-tema-progress-bar"><div class="tree-tema-progress-fill" style="width: ${pctTema}%"></div></div>
                <span class="tree-tema-pct-chip ${pctTema === 100 ? "done" : ""}">${pctTema}%</span>
              </div>
              <span class="tree-chip tema-total">${preguntasTema.length} preg.</span>
              ${
                tieneAMediasTema
                  ? `<span class="tree-chip pend-chip" style="font-weight:700">A medias (${pregActualTema}/${sesionTema.ids.length})</span>`
                  : respondidasTema.length > 0
                    ? `<span class="tree-chip done-chip">${respondidasTema.length} hechas · ${aciertosTema.length} aciertos (${pctAcierto}%)</span>`
                    : `<span class="tree-chip pend-chip">Sin empezar</span>`
              }
            </div>
            <div class="tree-tema-summary-actions" onclick="event.stopPropagation()">
              ${btnPracticarOContinuarTema}
              ${codigoTema ? `<button class="btn tiny ghost" type="button" data-start="tema:${t.numero}:codigo" title="Solo código"><i class="fa-solid fa-code"></i> ${codigoTema}</button>` : ""}
              ${teoriaTema ? `<button class="btn tiny ghost" type="button" data-start="tema:${t.numero}:teoria" title="Solo teoría"><i class="fa-solid fa-book"></i> ${teoriaTema}</button>` : ""}
              <button class="btn tiny ok" type="button" data-generar-tema="${t.numero}" title="Generar con IA"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
            </div>
          </summary>
          <div class="tree-apartados-body">
            ${apartadosHTML || `<p class="muted" style="font-size:13px;padding:6px 0">No hay subapartados registrados para este tema.</p>`}
          </div>
        </details>
      `;
    })
    .join("");
}

function applyDynamicHeader() {
  const counts = dataCounts();
  const meta = state.meta || {};
  const name = state.subject?.nombre || meta.titulo || "Test";
  document.title = `${name} · ${counts.total} preguntas`;
  const logo = $("#brand-logo");
  if (logo) logo.textContent = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "T";
  const title = $("#brand-title");
  if (title) title.textContent = name;
  const sub = $("#brand-sub");
  if (sub) sub.textContent = `${counts.total} preguntas · ${counts.temas.length} temas · ${counts.codigo} de código`;
}

function renderStart() {
  state.screen = "start";
  setModeChip("");
  applyDynamicHeader();
  const stats = getStats();
  const counts = dataCounts();
  const session = getSession();
  const canResume = session && !session.finished && Array.isArray(session.ids) && session.ids.length;
  const canSeeLast = session && session.finished && Array.isArray(session.ids) && session.ids.length;
  const meta = state.meta || {};
  const best = Number(stats.bestPct || 0);
  const last = Number(stats.lastPct || 0);
  const history = getHistory();
  const themeButtons = counts.temas.map(({ tema, count }) => {
    const preguntasTema = state.questions.filter((q) => Number(q.tema) === Number(tema));
    const respondidasTema = preguntasTema.filter((q) => history[q.id]?.selected != null).length;
    const pctTema = count ? Math.round((respondidasTema / count) * 100) : 0;
    return `
      <button class="btn btn-tema-progreso" type="button" data-start="tema:${tema}" style="display:flex; justify-content:space-between; align-items:center;">
        <span style="display:flex; align-items:center; gap:8px;">
          <span>Tema ${tema}</span>
          <span class="pct-pill" style="font-size:11px; font-weight:700; background:rgba(255,255,255,0.12); padding:2px 7px; border-radius:10px; color:var(--text);">${pctTema}% completado</span>
        </span>
        <span class="count">${count}</span>
      </button>
    `;
  }).join("");
  const themeSummary = counts.temas.map(({ tema, count }) => `Tema ${tema}: ${count}`).join(" · ");
  const subjectOptions = state.catalog.map((s) => {
    const suffix = s.localData ? ` (local) · ${s.localData.preguntas.length} preguntas` : "";
    const label = s.etiqueta || s.nombre;
    return `<option value="${esc(s.id)}" ${s.id === state.subjectId ? "selected" : ""}>${esc(label)}${suffix}</option>`;
  }).join("");
  const sampleChoices = [10, 20, 30, 50, 75].filter((n) => n < counts.total);
  const sampleOptions = `<option value="0">Todas (${counts.total})</option>${sampleChoices.map((n) => `<option value="${n}">${n} al azar</option>`).join("")}`;

  main.innerHTML = `
    <section class="home">
      <header class="home-hero">
        <div class="home-hero-copy">
          <span class="hero-kicker">${esc(meta.titulo || "Test de preguntas")}</span>
          <h1>${counts.total} preguntas</h1>
          <p>${themeSummary || "Sin temas"} · ${counts.teoria} de teoría · ${counts.codigo} de código.</p>
        </div>
        <div class="mini-stats">
          <div class="mini-stat"><b>${best ? best + "%" : "—"}</b><span>Mejor</span></div>
          <div class="mini-stat"><b>${last ? last + "%" : "—"}</b><span>Último</span></div>
          <div class="mini-stat"><b>${counts.fallos}</b><span>Fallos</span></div>
        </div>
      </header>

      ${canResume ? `
        <div class="resume-card">
          <div>
            <strong>Test a medias</strong>
            <span>Pregunta ${Math.min((session.index || 0) + 1, session.ids.length)} de ${session.ids.length}${session.filter ? ` · ${formatearFiltroLegible(session.filter)}` : ""}</span>
          </div>
          <div class="resume-actions">
            <button class="btn tiny primary" type="button" id="resume-btn">Continuar</button>
            <button class="btn tiny ghost" type="button" id="restart-btn" title="Volver a empezar este test desde la pregunta 1">Volver a empezar</button>
            <button class="btn tiny ghost" type="button" id="discard-btn">Descartar</button>
          </div>
        </div>` : ""}
      ${canSeeLast ? `
        <div class="resume-card">
          <div><strong>Últimos resultados guardados</strong><span>Puedes volver a verlos o repetir los fallos.</span></div>
          <div class="resume-actions"><button class="btn tiny primary" type="button" id="last-results-btn">Ver resultados</button></div>
        </div>` : ""}

      <div class="home-toolbar">
        <label for="subject-select">Asignatura</label>
        <select class="control" id="subject-select">${subjectOptions}</select>
        <div class="home-toolbar-actions">
          ${state.subject?.custom ? `<button class="btn tiny ghost" type="button" id="remove-subject" title="Quitar esta asignatura local">Quitar</button>` : ""}
          <button class="btn tiny" type="button" id="add-subject" title="Añadir una asignatura desde un JSON"><i class="fa-solid fa-plus" aria-hidden="true"></i> Añadir JSON</button>
          <button class="btn tiny ok" type="button" id="open-notes-practice" title="Crear tests desde tus apuntes privados"><i class="fa-solid fa-book-open" aria-hidden="true"></i> Tests desde apuntes</button>
        </div>
        <input class="hidden" type="file" id="add-subject-file" accept="application/json,.json">
      </div>
      ${state.errorCatalogoApuntes ? `<p class="catalog-error" role="status">No se pudieron detectar las asignaturas de tus apuntes: ${esc(state.errorCatalogoApuntes)}. Puedes volver a intentarlo en «Tests desde apuntes».</p>` : ""}

      <section class="home-card home-dashboard-tree-card">
        <div class="tree-header-row">
          <div>
            <h2><i class="fa-solid fa-sitemap"></i> Dashboard de apartados y subsecciones</h2>
            <p class="lead">Estructura completa de temas y subapartados. Puedes hacer todos los apuntes del tema o practicar solo las subsecciones que elijas.</p>
          </div>
          <div class="tree-toggle-btns">
            <button class="btn tiny ghost" type="button" id="tree-desplegar-todos"><i class="fa-solid fa-angles-down"></i> Desplegar todos</button>
            <button class="btn tiny ghost" type="button" id="tree-plegar-todos"><i class="fa-solid fa-angles-up"></i> Plegar todos</button>
          </div>
        </div>
        <div class="dashboard-tree-body" id="dashboard-tree-body">
          ${construirArbolDashboardHTML()}
        </div>
      </section>

      <div class="home-grid">
        <section class="home-card home-card-entrenar">
          <h2>🎯 Modalidades de práctica</h2>
          <p class="lead">Practica el test completo (ambas), solo código/desarrollo de examen, o solo teoría.</p>
          <div class="practice-modes-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px;">
            <button class="btn primary" type="button" data-start="all" style="justify-content:space-between; padding:12px 14px;">
              <span><i class="fa-solid fa-layer-group"></i> Ambas (Completo)</span>
              <span class="count">${counts.total}</span>
            </button>
            <button class="btn" type="button" data-start="codigo" style="justify-content:space-between; padding:12px 14px; border-color:#10b981; color:#10b981;">
              <span><i class="fa-solid fa-code"></i> Solo Código / Escrito</span>
              <span class="count" style="background:rgba(16,185,129,0.18); color:#10b981;">${counts.codigo}</span>
            </button>
            <button class="btn" type="button" data-start="teoria" style="justify-content:space-between; padding:12px 14px; border-color:#f59e0b; color:#f59e0b;">
              <span><i class="fa-solid fa-book"></i> Solo Teoría</span>
              <span class="count" style="background:rgba(245,158,11,0.18); color:#f59e0b;">${counts.teoria}</span>
            </button>
            <button class="btn" type="button" data-start-bloque="all" style="justify-content:space-between; padding:12px 14px; border-color:var(--brand);">
              <span><i class="fa-solid fa-bolt"></i> Bloque de 40 (en caché)</span>
              <span class="count">40</span>
            </button>
            <button class="btn ok" type="button" data-start="mastery" style="justify-content:space-between; padding:12px 14px;">
              <span><i class="fa-solid fa-award"></i> Refuerzo sin fallos</span>
              <span class="count">${counts.total}</span>
            </button>
          </div>
          <h3 style="font-size:15px; margin:16px 0 8px;"><i class="fa-solid fa-list-ol"></i> Práctica rápida por Tema</h3>
          <div class="start-actions">
            ${themeButtons}
          </div>
        </section>

        <section class="home-card home-card-repasar">
          <h2>Repasar fallos</h2>
          <p class="lead">Lo que fallas es lo que más sube la nota.</p>
          <div class="start-actions single">
            <button class="btn warn" type="button" data-start="fallos" ${counts.fallos ? "" : "disabled"}>Repaso de fallos <span class="count">${counts.fallos}</span></button>
            <button class="btn ghost" type="button" data-open-wrongs>Ver mis fallos <span class="count">${counts.fallos}</span></button>
          </div>
        </section>

        <section class="home-card home-weak-section" style="grid-column: 1 / -1; width: 100%;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
            <div>
              <h2 style="margin:0"><i class="fa-solid fa-triangle-exclamation"></i> Subapartados donde más fallas</h2>
              <p class="lead" style="margin:4px 0 0">Desglose exacto agrupado por tema con porcentaje de error de cada apartado para saber cuál fallas más y reforzarlo.</p>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="btn tiny ghost" type="button" id="weak-desplegar-todos"><i class="fa-solid fa-angles-down"></i> Desplegar todos</button>
              <button class="btn tiny ghost" type="button" id="weak-plegar-todos"><i class="fa-solid fa-angles-up"></i> Plegar todos</button>
              <button class="btn tiny ghost" type="button" data-open-wrongs><i class="fa-solid fa-book"></i> Ver todos los fallos</button>
            </div>
          </div>
          <div id="weak-concepts"></div>
        </section>
      </div>

      <footer class="home-foot">
        <span>Atajos: <b>1–4</b> o <b>A–D</b> responden · <b>Enter</b> o → siguiente · ← anterior.</span>
        <button class="btn tiny ghost" type="button" id="reset-history">Borrar historial</button>
      </footer>
    </section>
  `;

  $$("[data-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.start || "all";
      if (filter === "mastery") {
        startTest({ filter: "all", immediate: true, shuffle: true, mastery: true });
        return;
      }
      const immediate = $("#immediate-toggle")?.checked !== false;
      const shuffle = Boolean($("#shuffle-toggle")?.checked);
      const sample = Number($("#sample-select")?.value) || 0;
      if (filter === "fallos" && !getWrongIds().length) {
        toast("Todavía no tienes fallos guardados.");
        return;
      }
      startTest({ filter, immediate, shuffle, sample });
    });
  });
  $$("[data-resume-filter]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filterKey = btn.dataset.resumeFilter;
      const s = getSessionForFilter(filterKey);
      if (s) {
        resumeSession(s);
      } else {
        toast("No se encontró la sesión guardada.");
      }
    });
  });
  $$("[data-restart-filter]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filterKey = btn.dataset.restartFilter;
      saveSessionForFilter(filterKey, null);
      if (state.selectedFilter === filterKey) {
        clearSession();
      }
      const immediate = $("#immediate-toggle")?.checked !== false;
      const shuffle = Boolean($("#shuffle-toggle")?.checked);
      const sample = Number($("#sample-select")?.value) || 0;
      startTest({ filter: filterKey, immediate, shuffle, sample });
    });
  });
  $("#restart-btn")?.addEventListener("click", () => {
    const s = getSession();
    if (!s) return;
    const filter = s.filter || "all";
    clearSession();
    const immediate = $("#immediate-toggle")?.checked !== false;
    const shuffle = Boolean($("#shuffle-toggle")?.checked);
    const sample = Number($("#sample-select")?.value) || 0;
    startTest({ filter, immediate, shuffle, sample });
  });
  $$("[data-start-bloque]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filterKey = btn.dataset.startBloque;
      startBloque(filterKey);
    });
  });
  $("#dropdown-reset-progress-btn")?.addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres borrar todo tu progreso, fallos guardados y sesiones?")) return;
    removeStore(LS.session);
    removeStore(LS.wrong);
    removeStore(LS.history);
    removeStore(LS.stats);
    writeJSON(LS_SESSIONS_MAP, {});
    writeJSON(LS_BLOCK_POINTERS, {});
    clearSession();
    toast("Todo el progreso ha sido eliminado con éxito.");
    $("#options-dropdown")?.classList.add("hidden");
    renderStart();
  });
  $$("[data-start-apartado]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = "apartado:" + btn.dataset.startApartado;
      const immediate = $("#immediate-toggle")?.checked !== false;
      const shuffle = Boolean($("#shuffle-toggle")?.checked);
      const sample = Number($("#sample-select")?.value) || 0;
      startTest({ filter, immediate, shuffle, sample });
    });
  });
  $$("[data-generar-tema]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const temaNum = Number(btn.dataset.generarTema);
      window.abrirPracticaDesdeApuntes?.(state.subject?.nombre || "WEC", { tema: temaNum });
    });
  });
  $$("[data-generar-apartado]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const [temaStr, apStr] = btn.dataset.generarApartado.split(":");
      window.abrirPracticaDesdeApuntes?.(state.subject?.nombre || "WEC", {
        tema: Number(temaStr),
        apartado: Number(apStr),
      });
    });
  });
  $("#tree-desplegar-todos")?.addEventListener("click", () => {
    $$(".tree-tema-details").forEach((d) => { d.open = true; });
  });
  $("#tree-plegar-todos")?.addEventListener("click", () => {
    $$(".tree-tema-details").forEach((d) => { d.open = false; });
  });
  window.renderizarInicioTests = renderStart;
  $$("[data-open-wrongs]").forEach((btn) => btn.addEventListener("click", renderWrongBook));
  $("#subject-select")?.addEventListener("change", async (event) => {
    const id = event.target.value;
    const seleccion = state.catalog.find((s) => s.id === id);
    if (seleccion?.apuntesPrivados) {
      window.abrirPracticaDesdeApuntes?.(seleccion.nombreApuntes);
      return;
    }
    try {
      await loadSubject(id);
      renderStart();
      toast(`Asignatura: ${state.subject?.nombre || id}`);
    } catch (error) {
      toast(`No se pudo cargar: ${error.message}`);
    }
  });
  $("#add-subject")?.addEventListener("click", () => $("#add-subject-file")?.click());
  $("#add-subject-file")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    importSubjectFile(file);
    event.target.value = "";
  });
  $("#remove-subject")?.addEventListener("click", async () => {
    if (!state.subject?.custom) return;
    if (!confirm(`¿Quitar la asignatura local "${state.subject.nombre}"? Se borra de este navegador.`)) return;
    await removeCustomSubject(state.subjectId);
    renderStart();
    toast("Asignatura local eliminada.");
  });
  $("#open-notes-practice")?.addEventListener("click", () => {
    window.abrirPracticaDesdeApuntes?.();
  });
  $("#resume-btn")?.addEventListener("click", resumeSession);
  $("#discard-btn")?.addEventListener("click", discardSession);
  $("#last-results-btn")?.addEventListener("click", resumeSession);
  $("#reset-history")?.addEventListener("click", () => {
    if (!confirm("¿Borrar historial, fallos y sesión guardada de esta asignatura?")) return;
    removeStore(LS.session);
    removeStore(LS.wrong);
    removeStore(LS.history);
    removeStore(LS.stats);
    writePersistenceFile();
    renderStart();
    toast("Historial borrado.");
  });

  const weakContainer = $("#weak-concepts");
  const weakGroups = getWeakSubapartadosByTema();
  if (weakContainer) {
    if (!weakGroups.length) {
      weakContainer.innerHTML = '<p class="muted" style="font-size:13px; padding:12px 0;">Aún no hay fallos suficientes para calcular subapartados débiles. En cuanto falles preguntas, aparecerán aquí agrupados por tema con sus porcentajes de error.</p>';
    } else {
      weakContainer.innerHTML = weakGroups.map((group) => `
        <details class="weak-tema-details tree-tema-details" open style="margin-bottom:14px; border:1px solid var(--line); border-radius:14px; background:var(--card); overflow:hidden;">
          <summary class="tree-tema-summary" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:12px 18px; background:color-mix(in srgb, var(--card) 93%, var(--text) 7%); flex-wrap:wrap; gap:10px;">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <i class="fa-solid fa-folder-open" style="color:var(--brand)"></i>
              <b style="font-size:15px; color:var(--text)">Tema ${group.tema}</b>
              <span class="chip" style="font-weight:800; font-size:12px; background:rgba(239,68,68,0.16); color:var(--bad)">
                ${group.failRate}% de fallos (${group.totalFails} fallo${group.totalFails !== 1 ? "s" : ""})
              </span>
              <span class="tree-chip bank-chip" style="font-weight:600">${group.uniqueIds.length} preg. falladas</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation()">
              <button class="btn tiny warn" type="button" data-repasar-fallos-sub="${group.uniqueIds.join(",")}" title="Hacer un test con todos los fallos del Tema ${group.tema}">
                Repetir ${group.uniqueIds.length} fallos Tema ${group.tema}
              </button>
              <button class="btn tiny" type="button" data-start="tema:${group.tema}" title="Hacer test de todas las preguntas del Tema ${group.tema}">
                Practicar Tema ${group.tema}
              </button>
            </div>
          </summary>
          <div class="weak-tema-body" style="padding:14px 18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:12px; border-top:1px solid var(--line); background:color-mix(in srgb, var(--card) 97%, var(--text) 3%);">
            ${group.subapartados.map((item) => `
              <div class="weak-subapartado-card" style="border:1px solid var(--line); border-radius:12px; padding:13px 15px; background:var(--card); display:flex; flex-direction:column; gap:9px; box-shadow:var(--shadow-soft);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                  <div style="min-width:0; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span class="tree-chip bank-chip" style="font-weight:700">${item.codigo}</span>
                    <b style="font-size:13.5px; color:var(--text);">${esc(item.titulo)}</b>
                  </div>
                  <span style="font-weight:800; font-size:12.5px; color:var(--bad); background:rgba(239,68,68,0.15); padding:3px 8px; border-radius:8px; flex-shrink:0;">
                    ${item.pctFallo}% de fallos
                  </span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; opacity:.85; flex-wrap:wrap; gap:4px;">
                  <span><b>${item.fails}</b> fallo${item.fails !== 1 ? "s" : ""} (${item.total} preg. con error de ${item.totalBanco || item.total})</span>
                  ${item.tags && item.tags.length ? `<span class="chip ghost" style="font-size:11px; padding:1px 6px">${item.tags.map(esc).join(", ")}</span>` : ""}
                </div>
                <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:3px;">
                  <button class="btn tiny warn" type="button" data-repasar-fallos-sub="${item.ids.join(",")}" title="Hacer un test solo con los fallos de este subapartado">
                    Repetir ${item.ids.length} fallo${item.ids.length !== 1 ? "s" : ""}
                  </button>
                  ${item.apartado ? `
                    <button class="btn tiny" type="button" data-start-apartado="${item.tema}:${item.apartado}" title="Practicar todas las preguntas de este subapartado">
                      Practicar apartado
                    </button>
                  ` : `
                    <button class="btn tiny" type="button" data-start="tema:${item.tema}">
                      Practicar tema
                    </button>
                  `}
                </div>
              </div>
            `).join("")}
          </div>
        </details>
      `).join("");

      $("#weak-desplegar-todos")?.addEventListener("click", () => {
        $$(".weak-tema-details").forEach((d) => { d.open = true; });
      });
      $("#weak-plegar-todos")?.addEventListener("click", () => {
        $$(".weak-tema-details").forEach((d) => { d.open = false; });
      });

      $$("[data-repasar-fallos-sub]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ids = (btn.dataset.repasarFallosSub || "").split(",").map(Number).filter(Boolean);
          if (ids.length) {
            const immediate = $("#immediate-toggle")?.checked !== false;
            startTest({ ids, immediate, shuffle: true });
          }
        });
      });
      $$("[data-start-bloque]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filterKey = btn.dataset.startBloque;
      startBloque(filterKey);
    });
  });
  $("#dropdown-reset-progress-btn")?.addEventListener("click", () => {
    if (!confirm("¿Seguro que quieres borrar todo tu progreso, fallos guardados y sesiones?")) return;
    removeStore(LS.session);
    removeStore(LS.wrong);
    removeStore(LS.history);
    removeStore(LS.stats);
    writeJSON(LS_SESSIONS_MAP, {});
    writeJSON(LS_BLOCK_POINTERS, {});
    clearSession();
    toast("Todo el progreso ha sido eliminado con éxito.");
    $("#options-dropdown")?.classList.add("hidden");
    renderStart();
  });
  $$("[data-start-apartado]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const filter = "apartado:" + btn.dataset.startApartado;
          const immediate = $("#immediate-toggle")?.checked !== false;
          const shuffle = Boolean($("#shuffle-toggle")?.checked);
          startTest({ filter, immediate, shuffle });
        });
      });
    }
  }
  updateFooter();
}

function updateFooter() {
  const footer = $("#footer");
  if (!footer) return;
  const counts = dataCounts();
  const source = state.source === "json"
    ? "Datos cargados desde el banco de preguntas."
    : "Preguntas locales guardadas en el navegador.";
  footer.innerHTML = `${esc(state.meta?.titulo || "Test")} · ${counts.total} preguntas · ${counts.temas.map(({ tema, count }) => `Tema ${tema}: ${count}`).join(" · ")}. ${source}`;
}


// === assets/js/app/depurador.js ===
"use strict";

const TOKEN_RE = /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:let|const|var|if|else|for|while|do|switch|case|break|continue|return|function|new|typeof|instanceof|true|false|null|undefined|NaN|console|parseInt|parseFloat|Number|String|Boolean|Object|Array|Math|Date|document|window|prompt|alert)\b|\b\d+(?:\.\d+)?\b)/g;

function highlightLine(line) {
  if (!line) return "";
  let out = "";
  let last = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    out += esc(line.slice(last, match.index));
    const token = match[0];
    let cls = "tok-key";
    if (token.startsWith("//") || token.startsWith("/*")) cls = "tok-com";
    else if (/^["'`]/.test(token)) cls = "tok-str";
    else if (/^\d/.test(token)) cls = "tok-num";
    out += `<span class="${cls}">${esc(token)}</span>`;
    last = match.index + token.length;
  }
  out += esc(line.slice(last));
  return out;
}

function renderCodeInto(container, code, activeLine = null) {
  if (!container) return null;
  container.innerHTML = "";
  const block = document.createElement("div");
  block.className = "code-block";
  const head = document.createElement("div");
  head.className = "code-head";
  head.innerHTML = "<span>JavaScript</span><span class=\"code-dots\">● ● ●</span>";
  const pre = document.createElement("pre");
  pre.className = "code-pre";
  const lines = String(code).replace(/\r/g, "").split("\n");
  lines.forEach((line, i) => {
    const row = document.createElement("div");
    row.className = "code-line" + (activeLine === i + 1 ? " active" : "");
    row.dataset.line = String(i + 1);
    const ln = document.createElement("span");
    ln.className = "ln";
    ln.textContent = String(i + 1);
    const lc = document.createElement("span");
    lc.className = "lc";
    lc.innerHTML = highlightLine(line) || "&nbsp;";
    row.append(ln, lc);
    pre.append(row);
  });
  block.append(head, pre);
  container.append(block);
  return block;
}

function varValueHTML(value) {
  if (value === "undefined") return '<span class="v-undef">undefined</span>';
  if (value === null) return '<span class="v-null">null</span>';
  if (value === "NaN") return '<span class="v-num">NaN</span>';
  if (typeof value === "string") return `<span class="v-str">"${esc(value)}"</span>`;
  if (typeof value === "number") return `<span class="v-num">${esc(value)}</span>`;
  if (typeof value === "boolean") return `<span class="v-bool">${value}</span>`;
  return esc(String(value));
}

function createTracePlayer(container, code, trace) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(trace) || !trace.length) {
    renderCodeInto(container, code, null);
    return;
  }
  const player = document.createElement("div");
  player.className = "trace-player";
  player.innerHTML = `
    <div class="trace-head">
      <div><span class="trace-kicker">Depurador</span><strong>Ejecución paso a paso</strong></div>
      <span class="trace-counter"></span>
    </div>
    <div class="trace-code"></div>
    <div class="trace-grid">
      <div class="trace-panel"><div class="panel-title">Scope · variables</div><div class="scope-vars"></div></div>
      <div class="trace-panel"><div class="panel-title">Salida · consola</div><pre class="console-out"></pre></div>
    </div>
    <div class="trace-note"></div>
    <div class="trace-controls">
      <button class="btn tiny" type="button" data-act="prev"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Anterior</button>
      <button class="btn tiny primary" type="button" data-act="next">Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
      <button class="btn tiny ghost" type="button" data-act="reset"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reiniciar</button>
      <button class="btn tiny ghost" type="button" data-act="play"><i class="fa-solid fa-play" aria-hidden="true"></i> Reproducir</button>
    </div>
  `;
  const codeBox = player.querySelector(".trace-code");
  renderCodeInto(codeBox, code, trace[0].linea || 1);
  let cur = 0;
  let timer = null;
  const total = trace.length;

  function stopPlay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function update() {
    const step = trace[cur];
    player.querySelector(".trace-counter").textContent = `Paso ${cur + 1} / ${total}`;
    $$(".code-line", player).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.line) === Number(step.linea));
    });
    const varsBox = player.querySelector(".scope-vars");
    const entries = Object.entries(step.vars || {});
    varsBox.innerHTML = entries.length
      ? entries.map(([key, value]) => `<span class="var-chip"><b>${esc(key)}</b> = ${varValueHTML(value)}</span>`).join("")
      : '<span class="muted" style="font-size:12px">—</span>';
    const out = [];
    for (let i = 0; i <= cur; i++) {
      if (trace[i].salida != null) out.push(trace[i].salida);
      if (trace[i].error) out.push(`Error: ${trace[i].error}`);
    }
    player.querySelector(".console-out").textContent = out.length ? out.join("\n") : "—";
    player.querySelector(".trace-note").innerHTML = step.nota
      ? `<span class="note-icon"><i class="fa-solid fa-angle-right" aria-hidden="true"></i></span> ${formatText(step.nota)}`
      : "";
    player.querySelector('[data-act="prev"]').disabled = cur === 0;
    const nextBtn = player.querySelector('[data-act="next"]');
    if (nextBtn) {
      nextBtn.disabled = false;
      if (total <= 1) {
        nextBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Repetir';
      } else if (cur >= total - 1) {
        nextBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Repetir desde inicio';
      } else {
        nextBtn.innerHTML = 'Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
      }
    }
    const playBtn = player.querySelector('[data-act="play"]');
    playBtn.innerHTML = timer
      ? '<i class="fa-solid fa-pause" aria-hidden="true"></i> Pausa'
      : '<i class="fa-solid fa-play" aria-hidden="true"></i> Reproducir';
    playBtn.disabled = total <= 1;
  }

  function next() {
    stopPlay();
    if (cur < total - 1) {
      cur++;
    } else {
      cur = 0;
    }
    update();
  }

  function prev() {
    stopPlay();
    if (cur > 0) {
      cur--;
      update();
    }
  }

  function reset() {
    stopPlay();
    cur = 0;
    update();
  }

  function play() {
    if (timer) {
      stopPlay();
      update();
      return;
    }
    if (cur >= total - 1) cur = 0;
    update();
    timer = setInterval(() => {
      if (cur >= total - 1) {
        stopPlay();
        update();
        return;
      }
      cur++;
      update();
    }, 950);
  }

  player.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "next") next();
    else if (btn.dataset.act === "prev") prev();
    else if (btn.dataset.act === "reset") reset();
    else if (btn.dataset.act === "play") play();
  });
  update();
  container.append(player);
}


// === assets/js/app/preguntas.js ===
"use strict";

function limpiarPistasEnunciado(str) {
  return String(str || "")
    .replace(/\s*\((?:Caso|Caso de estudio|Caso práctico)\s*[^)]*\)\s*:?/gi, "")
    .replace(/\s*\[(?:Caso|Caso de estudio|Caso práctico)\s*[^\]]*\]\s*:?/gi, "")
    .trim();
}

function currentQuestion() {
  return state.order[state.index] || null;
}

function optionHTML(q, letter, selected, practice, isAnswered) {
  const text = q.opciones?.[letter] ?? "";
  const classes = ["option"];
  if (selected === letter) classes.push("selected");
  if (practice && isAnswered) {
    if (letter === q.correcta) classes.push("correct");
    else if (selected === letter) classes.push("wrong");
  }
  const disabled = practice && isAnswered ? "disabled" : "";
  return `
    <button class="${classes.join(" ")}" type="button" data-letter="${letter}" ${disabled}>
      <span class="option-letter">${letter}</span>
      <span class="option-text">${formatText(text)}</span>
    </button>`;
}

function liveScoreHTML() {
  if (state.immediate) {
    const correct = countCorrect();
    const failed = countAnswered() - correct;
    return `Aciertos <b>${correct}</b> · Fallos <b>${failed}</b>`;
  }
  return `Respondidas <b>${countAnswered()}</b> / ${state.order.length}`;
}

const AI_DEFAULT_URL = window.location.origin;

function aiBaseUrl() {
  const stored = readJSON(LS.ai, "");
  return String(stored || AI_DEFAULT_URL).trim().replace(/\/+$/, "");
}

function setAiBaseUrl(url) {
  writeJSON(LS.ai, String(url || "").trim().replace(/\/+$/, ""));
}

async function requestAi(endpoint, payload, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${window.location.origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* respuesta no JSON */ }
    if (!res.ok) {
      const detail = data?.detail || data?.error || raw || `HTTP ${res.status}`;
      throw Object.assign(
        new Error(typeof detail === "string" ? detail : JSON.stringify(detail)),
        { status: res.status },
      );
    }
    if (!data) throw new Error("El servicio de IA devolvió una respuesta vacía.");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("La IA tardó demasiado. Prueba otra vez.");
    if (error instanceof TypeError) throw new Error(`No se puede conectar con la API de esta aplicación en ${window.location.origin}. ¿Está levantado Preparar tests?`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function aiExplanationText(data) {
  return String(
    data?.explanation || data?.explicacion || data?.text || data?.data?.text || data?.answer || ""
  ).trim();
}

function aiExplanationKey(question, selected) {
  return `${state.subjectId || "default"}:${question.id}:${selected || ""}`;
}

function readAiConversation(question, selected) {
  const explanations = readJSON("preparar-tests.explicaciones-ia", {});
  const saved = explanations[aiExplanationKey(question, selected)];
  if (typeof saved === "string") return { answer: saved, messages: [] };
  if (!saved || typeof saved.answer !== "string")
    return { answer: "", messages: [] };
  return {
    answer: saved.answer,
    messages: Array.isArray(saved.messages)
      ? saved.messages.filter(
          (message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string",
        )
      : [],
  };
}

function saveAiConversation(question, selected, conversation) {
  const explanations = readJSON("preparar-tests.explicaciones-ia", {});
  explanations[aiExplanationKey(question, selected)] = conversation;
  writeJSON("preparar-tests.explicaciones-ia", explanations);
}

function preguntaParaIA(q) {
  return {
    id: q.id,
    tema: q.tema,
    apartado: q.apartado ?? 0,
    apartadoNombre: q.apartadoNombre || "",
    tipo: q.tipo,
    tag: q.tag,
    enunciado: q.enunciado,
    codigo: q.codigo || "",
    opciones: q.opciones,
    correcta: q.correcta,
    explicacion: q.explicacion || "",
  };
}

function renderAiConversation(slot, question, selected, conversation, saved) {
  slot.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "ai-answer-head";
  heading.innerHTML = saved
    ? '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Explicación guardada · disponible sin IA'
    : '<i class="fa-solid fa-robot" aria-hidden="true"></i> Explicación de la IA · guardada automáticamente';
  const explanation = document.createElement("div");
  explanation.className = "ai-answer-body";
  explanation.innerHTML = formatText(conversation.answer);
  slot.append(heading, explanation);

  const chat = document.createElement("section");
  chat.className = "ai-chat";
  const chatHeading = document.createElement("h3");
  chatHeading.className = "ai-chat-title";
  chatHeading.textContent = "¿Te quedan dudas? Pregúntame";
  const messages = document.createElement("div");
  messages.className = "ai-chat-messages";
  messages.setAttribute("aria-live", "polite");
  for (const message of conversation.messages) {
    const bubble = document.createElement("div");
    bubble.className = `ai-chat-message ${message.role}`;
    bubble.innerHTML = formatText(message.content);
    messages.append(bubble);
  }

  const form = document.createElement("form");
  form.className = "ai-chat-form";
  const input = document.createElement("textarea");
  input.className = "ai-chat-input";
  input.rows = 2;
  input.maxLength = 1000;
  input.placeholder = "Escribe tu duda sobre esta pregunta…";
  input.setAttribute("aria-label", "Tu pregunta de seguimiento");
  input.required = true;
  const send = document.createElement("button");
  send.className = "btn tiny primary";
  send.type = "submit";
  send.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Enviar';
  const status = document.createElement("div");
  status.className = "ai-chat-status";
  status.setAttribute("role", "status");
  form.append(input, send);
  chat.append(chatHeading, messages, form, status);
  slot.append(chat);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userQuestion = input.value.trim();
    if (!userQuestion || send.disabled) return;
    const history = conversation.messages.slice(-10);
    input.disabled = true;
    send.disabled = true;
    status.textContent = "Preparando una respuesta…";
    send.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Pensando…';
    try {
      const data = await requestAi("/api/explain", {
        pregunta: preguntaParaIA(question),
        selected: selected || null,
        subject: state.subject?.nombre || "",
        followUp: userQuestion,
        initialExplanation: conversation.answer,
        conversation: history,
        language: "es",
      });
      const answer = aiExplanationText(data);
      if (!answer) throw new Error("La IA no devolvió ninguna respuesta.");
      conversation.messages.push(
        { role: "user", content: userQuestion },
        { role: "assistant", content: answer },
      );
      saveAiConversation(question, selected, conversation);
      renderAiConversation(slot, question, selected, conversation, true);
    } catch (error) {
      input.disabled = false;
      send.disabled = false;
      send.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Enviar';
      status.textContent = `No se pudo responder: ${error.message}`;
      input.focus();
    }
  });
}

function attachAiExplain(container, q, selected) {
  const wrap = document.createElement("div");
  wrap.className = "ai-explain";

  const actions = document.createElement("div");
  actions.className = "ai-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn tiny ai-btn";
  btn.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i> Explícamelo mejor';
  const hint = document.createElement("span");
  hint.className = "ai-hint";
  hint.textContent = "Otra forma de explicarlo, paso a paso y con un ejemplo.";
  actions.append(btn, hint);

  const slot = document.createElement("div");
  slot.className = "ai-answer hidden";
  wrap.append(actions, slot);

  let loaded = false;
  let loading = false;

  btn.addEventListener("click", async () => {
    if (loaded) {
      slot.classList.toggle("hidden");
      return;
    }
    if (loading) return;
    loading = true;
    btn.disabled = true;
    slot.classList.remove("hidden");
    const conversacionGuardada = readAiConversation(q, selected);
    if (conversacionGuardada.answer) {
      loaded = true;
      renderAiConversation(slot, q, selected, conversacionGuardada, true);
      btn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Ocultar explicación';
      loading = false;
      btn.disabled = false;
      return;
    }
    if (q.explicacionClara) {
      const conversation = { answer: q.explicacionClara, messages: [] };
      saveAiConversation(q, selected, conversation);
      loaded = true;
      renderAiConversation(slot, q, selected, conversation, false);
      btn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Ocultar explicación';
      loading = false;
      btn.disabled = false;
      return;
    }
    btn.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i> Pensando…';
    slot.innerHTML = '<div class="ai-loading"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span> Preparando una explicación clara…</div>';
    try {
      const data = await requestAi("/api/explain", {
        pregunta: preguntaParaIA(q),
        selected: selected || null,
        subject: state.subject?.nombre || "",
        language: "es"
      });
      const text = aiExplanationText(data);
      if (!text) throw new Error("La IA no devolvió ninguna explicación.");
      const conversation = { answer: text, messages: [] };
      saveAiConversation(q, selected, conversation);
      loaded = true;
      renderAiConversation(slot, q, selected, conversation, false);
      btn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Ocultar explicación';
    } catch (error) {
      slot.innerHTML = `
        <div class="ai-answer-head bad">${error.status ? "El servidor devolvió un error" : "No se pudo conectar con la IA"}</div>
        <div class="ai-answer-body">${esc(error.message)}</div>
        <div class="ai-answer-body" style="margin-top:6px">${error.status ? "El servidor recibió la solicitud, pero no pudo completar la explicación. Revisa el detalle y vuelve a intentarlo." : "Comprueba que Preparar tests esté activo y que Ollama tenga el modelo local."}</div>
      `;
      btn.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Reintentar';
    } finally {
      loading = false;
      btn.disabled = false;
    }
  });

  container.append(wrap);
  return wrap;
}

function renderFeedback(q, selected) {
  const correct = selected === q.correcta;
  const correctText = q.opciones?.[q.correcta] ?? "";
  const selectedText = selected ? (q.opciones?.[selected] ?? "") : "";
  const box = document.createElement("div");
  box.className = `feedback ${correct ? "ok" : "bad"}`;
  box.innerHTML = `
    <div class="feedback-head">
      <span class="feedback-icon"><i class="fa-solid ${correct ? "fa-check" : "fa-xmark"}" aria-hidden="true"></i></span>
      <span>${correct ? "Correcto" : "Incorrecto"}</span>
    </div>
    <p>${formatText(q.explicacion || "")}</p>
    <div class="answer-line">
      ${selected ? `Tu respuesta: <b>${selected})</b> ${formatText(selectedText)}` : "Sin responder"}
      ${correct ? "" : ` · Correcta: <b>${q.correcta})</b> ${formatText(correctText)}`}
    </div>
  `;
  if (q.tipo === "codigo" && q.codigo && q.traza && q.traza.length) {
    const wrap = document.createElement("div");
    wrap.className = "trace-wrap";
    if (correct) {
      const details = document.createElement("details");
      details.className = "trace-details";
      const summary = document.createElement("summary");
      summary.textContent = "Ver ejecución paso a paso";
      const slot = document.createElement("div");
      details.append(summary, slot);
      let built = false;
      details.addEventListener("toggle", () => {
        if (details.open && !built) {
          built = true;
          createTracePlayer(slot, q.codigo, q.traza);
        }
      });
      wrap.append(details);
    } else {
      createTracePlayer(wrap, q.codigo, q.traza);
    }
    box.append(wrap);
  }
  attachAiExplain(box, q, selected);
  return box;
}

function renderTest() {
  state.screen = "test";
  const q = currentQuestion();
  if (!q) {
    renderResults();
    return;
  }
  setModeChip(state.immediate ? "Práctica" : "Examen", state.immediate ? "brand" : "warn");
  const selected = state.answers[q.id] || null;
  const isAnswered = selected != null;
  const practice = state.immediate;
  const progress = Math.round((countAnswered() / state.order.length) * 100);
  const difTone = q.dificultad === "dificil" ? "warn" : "brand";

  main.innerHTML = `
    <section class="test-shell">
      <div class="test-top">
        <div class="test-meta">
          <span class="chip brand">Pregunta ${state.index + 1} / ${state.order.length}</span>
          <span class="chip">Tema ${q.tema}</span>
          ${q.apartado ? `<span class="chip">Apartado ${q.tema}.${q.apartado}${q.apartadoNombre ? ` · ${esc(q.apartadoNombre)}` : ""}</span>` : q.apartadoNombre ? `<span class="chip">Apartado: ${esc(q.apartadoNombre)}</span>` : ""}
          <span class="chip ${q.tipo === "codigo" ? "brand" : ""}">${q.tipo === "codigo" ? "Código" : "Teoría"}</span>
          <span class="chip ${difTone}">${esc(q.dificultad || "media")}</span>
        </div>
        <div class="test-live" id="live-score">${liveScoreHTML()}</div>
      </div>
      <div class="progress" aria-hidden="true"><div class="progress-bar" style="width:${progress}%"></div></div>
      <article class="question-card" id="question-card">
        <div class="q-tag">${esc(limpiarPistasEnunciado(q.tag || "WEC"))}</div>
        <h2 class="q-text">${formatText(limpiarPistasEnunciado(q.enunciado))}</h2>
        ${q.codigo ? '<div class="code-slot" id="code-slot"></div>' : ""}
        <div class="options" id="options" role="group" aria-label="Opciones de respuesta">
          ${["A", "B", "C", "D"].map((letter) => optionHTML(q, letter, selected, practice, isAnswered)).join("")}
        </div>
        <div id="feedback-slot"></div>
        <div class="test-actions">
          <div class="right">
            <button class="btn ghost" type="button" id="prev-btn" ${state.index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Anterior</button>
            <button class="btn ghost" type="button" id="exit-btn">Inicio</button>
          </div>
          <button class="btn primary" type="button" id="next-btn">${state.index === state.order.length - 1 ? "Ver resultados" : 'Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>'}</button>
        </div>
      </article>
    </section>
  `;

  if (q.codigo) {
    renderCodeInto($("#code-slot"), q.codigo, null);
  }
  if (practice && isAnswered) {
    $("#feedback-slot")?.append(renderFeedback(q, selected));
  }
  $$(".option").forEach((btn) => {
    btn.addEventListener("click", () => selectOption(btn.dataset.letter));
  });
  $("#prev-btn")?.addEventListener("click", prevQuestion);
  $("#next-btn")?.addEventListener("click", nextQuestion);
  $("#exit-btn")?.addEventListener("click", () => {
    saveSession();
    renderStart();
    toast("Sesión guardada. Puedes continuar cuando quieras.");
  });
  updateFooter();
  document.activeElement?.blur?.();
}

function updateWrongForAnswer(q, selected, previous = null) {
  const set = new Set(getWrongIds());
  const history = getHistory();
  if (selected === q.correcta) {
    set.delete(q.id);
    delete history[q.id];
  } else {
    set.add(q.id);
    const prev = history[q.id] || {};
    history[q.id] = {
      selected,
      at: new Date().toISOString(),
      fails: previous == null ? (Number(prev.fails) || 0) + 1 : Math.max(1, Number(prev.fails) || 1)
    };
  }
  setWrongIds([...set]);
  setHistory(history);
  writePersistenceFile();
}

function selectOption(letter) {
  const q = currentQuestion();
  if (!q) return;
  if (!["A", "B", "C", "D"].includes(letter)) return;
  if (state.immediate && state.answers[q.id] != null) return;
  const previous = state.answers[q.id] ?? null;
  state.answers[q.id] = letter;
  updateWrongForAnswer(q, letter, previous);
  saveSession();
  renderTest();
}

function nextQuestion() {
  const q = currentQuestion();
  if (!q) return;
  if (state.immediate && state.answers[q.id] == null) {
    toast("Elige una opción antes de continuar.");
    return;
  }
  if (state.index >= state.order.length - 1) {
    finishTest();
    return;
  }
  state.index++;
  saveSession();
  renderTest();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function prevQuestion() {
  if (state.index <= 0) return;
  state.index--;
  saveSession();
  renderTest();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function failedQuestions() {
  return state.order.filter((q) => state.answers[q.id] !== q.correcta);
}

function gradeMessage(pct, total) {
  if (!total) return "No hay preguntas en este test.";
  if (pct >= 95) return "Nivel examen: sobresaliente. Ya casi lo tienes dominado.";
  if (pct >= 85) return "Muy buen nivel. Repasa solo los fallos y el 10 está cerca.";
  if (pct >= 70) return "Vas bien, pero hay trampas de examen que se te escapan. Insiste en los fallos.";
  if (pct >= 50) return "Base hecha. Toca repasar teoría y sobre todo el código paso a paso.";
  return "Todavía hay que trabajar el temario. Empieza por la teoría y vuelve al código después.";
}

function finishTest() {
  if (!state.order.length) return;
  state.finished = true;
  state.screen = "results";
  const total = state.order.length;
  const correct = countCorrect();
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const stats = getStats();
  stats.attempts = (Number(stats.attempts) || 0) + 1;
  stats.lastPct = pct;
  stats.lastTotal = total;
  stats.lastDate = new Date().toISOString();
  stats.bestPct = Math.max(Number(stats.bestPct) || 0, pct);
  setStats(stats);
  saveSession();
  renderResults();
  window.scrollTo({ top: 0, behavior: "smooth" });
}


// === assets/js/app/fallos.js ===
"use strict";

function renderWrongItem(q, position, options = {}) {
  const selected = options.selected !== undefined ? options.selected : (state.answers[q.id] || null);
  const number = options.number || q.id;
  const fails = Number(options.fails) || 0;
  const lazyTrace = Boolean(options.lazyTrace);
  const item = document.createElement("article");
  item.className = "wrong-item";

  const res = resolveApartadoForQuestion(q);
  const head = document.createElement("div");
  head.className = "wrong-head";
  head.innerHTML = `
    <span class="wrong-num">${position}</span>
    <span class="chip brand">Pregunta ${number}</span>
    <span class="chip" style="font-weight:700">Tema ${res.tema}</span>
    <span class="chip" style="font-weight:600">Apartado ${res.codigo} · ${esc(res.titulo)}</span>
    ${res.tag ? `<span class="chip ghost" style="font-size:11px">${esc(res.tag)}</span>` : ""}
    <span class="chip ${q.tipo === "codigo" ? "brand" : ""}">${q.tipo === "codigo" ? "Código" : "Teoría"}</span>
    ${fails > 1 ? `<span class="chip warn">Fallada ${fails} veces</span>` : ""}
    ${selected ? "" : '<span class="chip warn">Sin responder</span>'}
  `;
  item.append(head);

  const title = document.createElement("h3");
  title.innerHTML = formatText(q.enunciado);
  item.append(title);

  if (q.codigo) {
    const codeSlot = document.createElement("div");
    codeSlot.className = "code-slot";
    renderCodeInto(codeSlot, q.codigo, null);
    item.append(codeSlot);
  }

  const compare = document.createElement("div");
  compare.className = "answer-compare";
  const selectedText = selected ? (q.opciones?.[selected] ?? "") : "";
  compare.innerHTML = `
    <div class="line bad-line">${selected ? `Tu respuesta: ${selected}) ${formatText(selectedText)}` : "Sin responder"}</div>
    <div class="line ok-line">Correcta: ${q.correcta}) ${formatText(q.opciones?.[q.correcta] ?? "")}</div>
  `;
  item.append(compare);

  const explain = document.createElement("p");
  explain.className = "explain";
  explain.innerHTML = formatText(q.explicacion || "");
  item.append(explain);

  if (q.tipo === "codigo" && q.codigo && q.traza && q.traza.length) {
    const traceSlot = document.createElement("div");
    traceSlot.style.marginTop = "14px";
    if (lazyTrace) {
      const details = document.createElement("details");
      details.className = "trace-details";
      const summary = document.createElement("summary");
      summary.textContent = "Ver ejecución paso a paso";
      let built = false;
      details.addEventListener("toggle", () => {
        if (details.open && !built) {
          built = true;
          createTracePlayer(traceSlot, q.codigo, q.traza);
        }
      });
      details.append(summary, traceSlot);
      item.append(details);
    } else {
      createTracePlayer(traceSlot, q.codigo, q.traza);
      item.append(traceSlot);
    }
  }
  attachAiExplain(item, q, selected);

  return item;
}

function renderAllAnswers() {
  const details = document.createElement("details");
  details.className = "all-answers";
  const correct = countCorrect();
  details.innerHTML = `<summary>Ver las ${state.order.length} respuestas (${correct} aciertos)</summary>`;
  const list = document.createElement("div");
  list.className = "all-list";
  state.order.forEach((q) => {
    const selected = state.answers[q.id] || null;
    const ok = selected === q.correcta;
    const row = document.createElement("div");
    row.className = "all-item";
    row.innerHTML = `
      <div class="all-q"><i class="fa-solid ${ok ? "fa-check" : "fa-xmark"}" aria-hidden="true"></i> ${esc(q.enunciado.length > 120 ? q.enunciado.slice(0, 117) + "…" : q.enunciado)}</div>
      <div class="all-a">Tu respuesta: <b>${selected ? selected : "—"}</b> · Correcta: <b>${q.correcta}</b></div>
    `;
    list.append(row);
  });
  details.append(list);
  return details;
}

function renderWrongBook() {
  state.screen = "wrongs";
  setModeChip("Mis fallos", "bad");
  applyDynamicHeader();
  const all = wrongQuestions();
  const history = getHistory();
  const filter = state.wrongFilter || "todos";
  const counts = dataCounts();

  const matches = (q) => {
    if (filter === "todos") return true;
    if (typeof filter === "string" && filter.startsWith("tema:")) return Number(q.tema) === Number(filter.slice(5));
    if (filter === "codigo") return q.tipo === "codigo";
    if (filter === "teoria") return q.tipo === "teoria";
    return true;
  };
  const filtered = all.filter(matches);
  const themeFilters = counts.temas.map(({ tema }) => {
    const value = `tema:${tema}`;
    const active = filter === value;
    return `<button class="btn tiny ${active ? "primary" : ""}" type="button" data-wrong-filter="${value}">Tema ${tema}</button>`;
  }).join("");

  main.innerHTML = `
    <section class="test-shell">
      <div class="test-top">
        <div class="test-meta">
          <span class="chip bad">Mis fallos</span>
          <span class="chip">${all.length} guardados</span>
          <span class="chip brand">${filtered.length} en esta vista</span>
        </div>
        <button class="btn ghost tiny" type="button" id="book-home"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Inicio</button>
      </div>

      <article class="question-card" style="margin-bottom:16px">
        <div class="q-tag">Guardado automático</div>
        <h2 class="q-text" style="font-size:20px">Tus fallos se guardan solos</h2>
        <p class="muted" style="margin:6px 0 14px;font-size:13.5px">
          Cada vez que fallas una pregunta queda guardada automáticamente en este navegador. No tienes que importar
          ni vincular nada: si vuelves a fallar la misma, se actualiza; si la aciertas, desaparece de la lista.
          La copia JSON es solo un extra por si quieres llevártela.
        </p>
        <div class="test-meta" style="margin-bottom:14px">
          <span class="chip ok"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Guardado automático</span>
          <span class="chip">${Object.keys(history).length} con última respuesta guardada</span>
          <span class="chip">${all.filter((q) => q.tipo === "codigo").length} de código</span>
        </div>
        <div class="test-meta">
          <button class="btn tiny" type="button" id="book-export">Descargar copia JSON</button>
          <button class="btn tiny ghost" type="button" id="book-clear" ${all.length ? "" : "disabled"}>Borrar fallos</button>
        </div>
      </article>

      <div class="test-meta" style="margin-bottom:16px">
        <button class="btn tiny ${filter === "todos" ? "primary" : ""}" type="button" data-wrong-filter="todos">Todos (${all.length})</button>
        ${themeFilters}
        <button class="btn tiny ${filter === "codigo" ? "primary" : ""}" type="button" data-wrong-filter="codigo">Código (${all.filter((q) => q.tipo === "codigo").length})</button>
        <button class="btn tiny ${filter === "teoria" ? "primary" : ""}" type="button" data-wrong-filter="teoria">Teoría (${all.filter((q) => q.tipo === "teoria").length})</button>
      </div>

      <div class="test-actions" style="margin:0 0 18px">
        <div></div>
        <div class="right">
          <button class="btn primary" type="button" id="book-repeat" ${all.length ? "" : "disabled"}>Repetir todos los fallos (${all.length})</button>
          <button class="btn" type="button" id="book-back-test">Volver al inicio</button>
        </div>
      </div>

      <div class="wrong-list" id="wrong-book-list"></div>
    </section>
  `;

  const list = $("#wrong-book-list");
  if (!all.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <div class="emoji"><i class="fa-solid fa-folder-open" aria-hidden="true"></i></div>
      <h3>No hay fallos guardados</h3>
      <p>En cuanto falles una pregunta en un test, aparecerá aquí sola. No hay que importar nada.</p>
      <div style="margin-top:14px"><button class="btn primary" type="button" id="book-empty-start">Hacer un test</button></div>
    `;
    list.append(empty);
  } else if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="emoji"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></div><h3>Nada en este filtro</h3><p>Prueba con otro tema o con «Todos».</p>`;
    list.append(empty);
  } else {
    filtered.forEach((q, i) => {
      const entry = history[q.id] || {};
      list.append(renderWrongItem(q, i + 1, {
        selected: entry.selected || null,
        number: q.id,
        fails: entry.fails || 0,
        lazyTrace: true
      }));
    });
  }

  $("#book-home")?.addEventListener("click", renderStart);
  $("#book-back-test")?.addEventListener("click", renderStart);
  $("#book-empty-start")?.addEventListener("click", renderStart);
  $("#book-export")?.addEventListener("click", exportWrongsFile);
  $("#book-clear")?.addEventListener("click", () => {
    if (!confirm("¿Borrar todos los fallos guardados? Esta acción no borra tu historial de notas, solo los fallos.")) return;
    setWrongIds([]);
    setHistory({});
    writePersistenceFile();
    renderWrongBook();
    toast("Fallos borrados.");
  });
  $("#book-repeat")?.addEventListener("click", () => {
    if (!all.length) return;
    startTest({ filter: "fallos", immediate: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $$("[data-wrong-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.wrongFilter = btn.dataset.wrongFilter || "todos";
      renderWrongBook();
    });
  });
  updateFooter();
}


// === assets/js/app/ia.js ===
"use strict";

const {
  borrarArchivosPersistidos,
  cargarArchivosPersistidos,
  guardarArchivosPersistidos,
} = window.prepararTestsPersistencia;

let aiDraftTimer;

const AI_DEFAULT_INSTRUCCIONES = "Genera preguntas originales para un examen tipo test. No copies frases ni ejemplos literales del material; parafrasea y cambia los datos, los nombres y el contexto. Usa distractores plausibles, evita «todas/ninguna de las anteriores» y asegúrate de que cada pregunta tenga una sola respuesta justificable con el material. Prioriza la comprensión, la aplicación a casos nuevos y la detección de errores. En preguntas de código, incluye una traza paso a paso coherente (línea, variables y salida). No inventes contenido para completar el número solicitado.";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderAiScreen() {
  state.screen = "ai";
  setModeChip("Generar con IA", "ok");
  applyDynamicHeader();

  let instruccionesPrev = sessionStorage.getItem("wec12_ai_instrucciones") || "";
  let contextoPrev = sessionStorage.getItem("wec12_ai_contexto") || "";
  sessionStorage.removeItem("wec12_ai_origen");
  sessionStorage.removeItem("wec12_ai_instrucciones");
  sessionStorage.removeItem("wec12_ai_contexto");

  const temasDelSubject = (state.subject?.temas ?? [])
    .map((t) => Number(t.numero))
    .filter((n) => Number.isInteger(n) && n > 0);
  const temaDefault = temasDelSubject.length === 1 ? temasDelSubject[0] : 0;
  const temasParam = temasDelSubject.length ? temasDelSubject.join(",") : "todos";

  const valoresBorrador = {};
  let borradorRestaurado = false;
  try {
    const borrador = cargarArchivosPersistidos("generacion-ia");
    if (borrador && borrador.valores) {
      Object.assign(valoresBorrador, borrador.valores);
      borradorRestaurado = true;
    }
  } catch { /* sin borrador guardado */ }

  const asignaturaValue = String(
    valoresBorrador.asignatura || state.subject?.nombre || "Nueva asignatura",
  ).slice(0, 80);
  const countValue = Number(valoresBorrador.count) || 10;
  const typesValue = valoresBorrador.tipos || "mixto";
  const contextoValue = contextoPrev || String(valoresBorrador.contexto || "");
  let draftInstrucciones = String(valoresBorrador.instrucciones || "");
  if (draftInstrucciones.includes("CONCEPTOS DÉBILES")) {
    draftInstrucciones = "";
  }
  let prevInstrucciones = String(instruccionesPrev || "");
  if (prevInstrucciones.includes("CONCEPTOS DÉBILES")) {
    prevInstrucciones = "";
  }
  const instruccionesValue =
    prevInstrucciones || draftInstrucciones || AI_DEFAULT_INSTRUCCIONES;

  const tiposLabel = { mixto: "Teoría y código", teoria: "Solo teoría", codigo: "Solo código" }[typesValue] || "Teoría y código";

  main.innerHTML = `
    <section class="test-shell">
      <div class="test-top">
        <div class="test-meta">
          <span class="chip ok"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar con IA</span>
          <span class="chip">Ollama local · gratis · sin límites de uso</span>
        </div>
        <button class="btn ghost tiny" type="button" id="ai-home"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Inicio</button>
      </div>

      <article class="question-card">
        <div class="ai-grid">
          <div>
            <h2 class="q-text" style="font-size:22px">Generar preguntas con tu IA local</h2>
            <p class="muted" style="margin:6px 0 16px;font-size:13.5px">
              Las preguntas las redacta tu modelo Ollama local (Docker, sin claves de API y sin límites de uso).
              El material de estudio puede ser <b>tus apuntes privados</b> de la asignatura seleccionada
              o un <b>contexto de texto libre</b> (por ejemplo, tus conceptos más débiles). La IA no copia los
              apuntes: parafrasea, añade casos prácticos y trampas de examen.
            </p>

            <div class="ai-field">
              <label for="ai-subject">Nombre de la asignatura</label>
              <input class="control" id="ai-subject" value="${esc(asignaturaValue)}" maxlength="80">
            </div>

            <div class="ai-field" style="display:flex;gap:12px;flex-wrap:wrap">
              <div style="flex:0 0 150px">
                <label for="ai-count">Nº de preguntas</label>
                <input class="control" id="ai-count" type="number" min="1" max="80" value="${countValue}" style="width:100%">
              </div>
              <div style="flex:1 1 220px">
                <label for="ai-types">Tipo</label>
                <select class="control" id="ai-types" style="width:100%">
                  <option value="mixto">Teoría + código</option>
                  <option value="teoria">Solo teoría</option>
                  <option value="codigo">Solo código</option>
                </select>
              </div>
            </div>

            <div class="ai-field">
              <label for="ai-context">Contexto de estudio (material libre)</label>
              <textarea id="ai-context" rows="4" placeholder="Ej.: diferencias entre GET y POST, errores típicos con punteros en C, cómo funciona el bucle de eventos de Node.js…">${esc(contextoValue)}</textarea>
              <p class="muted" style="font-size:12px">Deja vacío para generar a partir de los apuntes privados de la asignatura seleccionada.</p>
            </div>

            <div class="ai-field">
              <label for="ai-instrucciones">Instrucciones para la IA</label>
              <textarea id="ai-instrucciones" rows="5">${esc(instruccionesValue)}</textarea>
              <p class="muted" style="font-size:12px">Aquí va lo que la IA debe seguir obligatoriamente (estilo, nivel, «no repitas estos enunciados», conceptos débiles prioritarios…).</p>
            </div>

            <div class="test-meta" style="margin-top:16px">
              <button class="btn primary" type="button" id="ai-generate"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar preguntas</button>
              <button class="btn ghost" type="button" id="ai-clear">Limpiar</button>
              <span id="ai-tema-info" class="chip" style="font-size:12px">Temas: ${temasParam === "todos" ? "todos" : temasParam}</span>
            </div>
            <div class="ai-log" id="ai-log"></div>
          </div>

          <div>
            <h2 class="q-text" style="font-size:22px">Resultado</h2>
            <p class="muted" style="margin:6px 0 14px;font-size:13.5px">
              Revisa las preguntas generadas y practica con ellas. Se guardan como una asignatura local
              y la próxima generación evitará repetir sus enunciados.
            </p>
            <div class="test-meta" id="ai-result-actions" style="margin-bottom:12px"></div>
            <div class="ai-preview" id="ai-preview">
              <div class="empty-state">
                <div class="emoji"><i class="fa-solid fa-robot" aria-hidden="true"></i></div>
                <h3>Todavía no hay preguntas</h3>
                <p>Rellena el contexto (o usa tus apuntes) y pulsa «Generar preguntas».</p>
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;

  const log = $("#ai-log");
  const logMensaje = (mensaje) => {
    if (log) log.textContent = mensaje;
  };

  const programarGuardado = () => {
    window.clearTimeout(aiDraftTimer);
    aiDraftTimer = window.setTimeout(() => {
      try {
        guardarArchivosPersistidos("generacion-ia", [], {
          asignatura: $("#ai-subject")?.value || "",
          count: $("#ai-count")?.value || "",
          tipos: $("#ai-types")?.value || "",
          contexto: $("#ai-context")?.value || "",
          instrucciones: $("#ai-instrucciones")?.value || "",
        });
      } catch { /* IndexedDB no disponible */ }
    }, 400);
  };

  for (const selector of [
    "#ai-subject", "#ai-prompt", "#ai-count", "#ai-types", "#ai-context", "#ai-instrucciones",
  ]) {
    $(selector)?.addEventListener("input", programarGuardado);
    $(selector)?.addEventListener("change", programarGuardado);
  }
  $("#ai-types")?.addEventListener("change", () => {
    const el = $("#ai-tema-info");
    // el tema no cambia con el tipo; solo refresca el borrador
    programarGuardado();
  });

  $("#ai-home")?.addEventListener("click", renderStart);

  $("#ai-clear")?.addEventListener("click", () => {
    $("#ai-subject").value = String(state.subject?.nombre || "Nueva asignatura");
    $("#ai-count").value = "10";
    $("#ai-types").value = "mixto";
    $("#ai-context").value = "";
    $("#ai-instrucciones").value = AI_DEFAULT_INSTRUCCIONES;
    $("#ai-preview").innerHTML = aiEmptyPreview();
    $("#ai-result-actions").innerHTML = "";
    logMensaje("Listo.");
    try { borrarArchivosPersistidos("generacion-ia"); } catch { /* noop */ }
  });

  async function vigilarTarea(id) {
    return new Promise((resolve, reject) => {
      let pasos = 0;
      const tick = async () => {
        if (!aiGenerating) {
          reject(new Error("Generación cancelada."));
          return;
        }
        try {
          const res = await fetch(
            `${window.location.origin}/api/generar/${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          if (!res.ok) {
            reject(new Error(`No se pudo consultar el progreso (HTTP ${res.status}).`));
            return;
          }
          const tarea = await res.json();
          const detalle = tarea.detalle ? ` · ${tarea.detalle}` : "";
          logMensaje(`${tarea.fase}: ${tarea.mensaje}${detalle}`);
          if (tarea.terminado) {
            aiGenerating = false;
            aiTaskId = null;
            if (aiPollTimer) { clearTimeout(aiPollTimer); aiPollTimer = null; }
            resolve(tarea);
            return;
          }
          pasos += 1;
          if (pasos > 400) {
            reject(new Error("La generación ha superado el tiempo de espera."));
            return;
          }
          aiPollTimer = setTimeout(tick, 1500);
        } catch (error) {
          reject(error);
        }
      };
      tick();
    });
  }

  function mostrarResultado(banco, nuevasIds) {
    const preview = $("#ai-preview");
    preview.innerHTML = "";
    banco.preguntas.forEach((q, i) => {
      preview.append(renderWrongItem(q, i + 1, { number: q.id, lazyTrace: true }));
    });
    const acciones = $("#ai-result-actions");
    const labelTipo = tiposLabel.charAt(0).toUpperCase() + tiposLabel.slice(1);
    const nuevas = nuevasIds.length;
    const textoNuevas = nuevas
      ? `${nuevas} nueva${nuevas !== 1 ? "s" : ""}`
      : "sin preguntas nuevas";
    acciones.innerHTML = `
      <button class="btn tiny primary" type="button" id="ai-practicar">
        <i class="fa-solid fa-play" aria-hidden="true"></i> Practicar este banco (${banco.preguntas.length} preguntas · ${textoNuevas})
      </button>
      <span class="chip ok">${banco.preguntas.length} preguntas guardadas como "${esc($("#ai-subject")?.value || banco.meta.asignatura)}"</span>
    `;
    $("#ai-practicar")?.addEventListener("click", () => {
      window.cargarBancoDePreguntas(banco);
    });
    logMensaje(
      `Listo: ${banco.preguntas.length} preguntas en el banco${nuevas ? ` (${nuevas} nueva${nuevas !== 1 ? "s" : ""} esta tanda)` : ""}.`,
    );
    toast(`${banco.preguntas.length} preguntas generadas.`);
  }

  $("#ai-generate")?.addEventListener("click", async () => {
    if (aiGenerating) return;
    const subjectName = ($("#ai-subject")?.value || "").trim() || "Asignatura IA";
    const count = Math.max(1, Math.min(80, Number($("#ai-count")?.value) || 10));
    const types = $("#ai-types")?.value || "mixto";
    const contexto = ($("#ai-context")?.value || "").trim();
    const instrucciones = ($("#ai-instrucciones")?.value || "").trim();

    if (!contexto && temasDelSubject.length === 0) {
      toast("Escribe un contexto de estudio o selecciona una asignatura con temas privados.");
      return;
    }

    const solicitud = {
      asignatura: subjectName,
      tema: temaDefault,
      temas: temasParam === "todos" ? "todos" : temasDelSubject,
      apartado: 0,
      cantidad: count,
      modoExamen: "personalizado",
      contextoExamen: `${tiposLabel}. Examen tipo test estándar con preguntas de aplicación y trampas frecuentes.`,
      tipoPreguntas: types,
      ...(contexto ? { context: contexto } : {}),
      ...(instrucciones ? { instrucciones } : {}),
    };

    aiGenerating = true;
    aiTaskId = null;
    const btn = $("#ai-generate");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Generando…';
    $("#ai-preview").innerHTML = '<div class="ai-loading" style="padding:20px">Contactando con tu Ollama local…</div>';
    $("#ai-result-actions").innerHTML = "";
    logMensaje("Iniciando generación con la IA local…");

    try {
      const res = await fetch(`${window.location.origin}/api/generar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(solicitud),
      });
      const raw = await res.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!res.ok) {
        const detail = data?.detail || data?.error || raw || `HTTP ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      if (!data?.id) throw new Error("El servicio no inició la generación.");
      aiTaskId = data.id;
      logMensaje(`Generación iniciada (tarea ${aiTaskId}). Esperando a Ollama…`);

      const tarea = await vigilarTarea(aiTaskId);
      if (tarea.cancelado) {
        logMensaje("Generación cancelada.");
        return;
      }
      if (tarea.error) {
        throw new Error(tarea.error || "La generación terminó con error.");
      }

      const bancoTema = temaDefault || 1;
      const bancoTemas = temasDelSubject.length ? temasDelSubject : [1];
      const bancoUrl = new URL(`${window.location.origin}/api/banco`);
      bancoUrl.searchParams.set("asignatura", subjectName);
      bancoUrl.searchParams.set("tema", String(bancoTema));
      bancoUrl.searchParams.set("temas", bancoTemas.join(","));
      bancoUrl.searchParams.set("apartado", "0");
      const bancoRes = await fetch(bancoUrl, { cache: "no-store" });
      if (!bancoRes.ok) {
        throw new Error(`No se pudo leer el banco generado (HTTP ${bancoRes.status}).`);
      }
      const banco = await bancoRes.json();
      if (!banco.preguntas?.length) {
        throw new Error("El banco generado no contiene preguntas.");
      }

      const claveIA = subjectName || state.subjectId || "default";
      const previas = new Set(getAiGenerated(claveIA));
      const nuevasIds = banco.preguntas
        .filter((q) => !previas.has(q.enunciado))
        .map((q) => q.id);
      recordAiGenerated(claveIA, banco.preguntas.map((q) => q.enunciado));

      mostrarResultado(banco, nuevasIds);
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "La IA tardó demasiado. Prueba con menos preguntas o un modelo más rápido."
          : error.message;
      $("#ai-preview").innerHTML = `
        <div class="empty-state" style="background:var(--bad-soft);border-color:var(--bad)">
          <div class="emoji"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></div>
          <h3>No se pudo generar</h3>
          <p>${esc(message)}</p>
          <p style="margin-top:8px;font-size:12px">Asegúrate de que Preparar tests y Ollama estén activos (<code>docker compose up -d</code> en esta carpeta).</p>
        </div>`;
      logMensaje(message);
    } finally {
      const current = $("#ai-generate");
      if (current) {
        aiGenerating = false;
        current.disabled = false;
        current.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar preguntas';
      }
    }
  });

  if (borradorRestaurado) logMensaje("Se restauró el borrador de generación con IA.");
  updateFooter();
}


// === assets/js/app/resultados.js ===
"use strict";

function renderResults() {
  state.screen = "results";
  state.finished = true;
  setModeChip("Resultados", "ok");
  const total = state.order.length;
  const correct = countCorrect();
  const answered = countAnswered();
  const failed = total - correct;
  const unanswered = total - answered;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const grade = total ? (correct / total) * 10 : 0;
  const wrongInSession = failedQuestions();
  const refuerzoSuperado = state.masteryMode && wrongInSession.length === 0;
  const themeStats = [...new Set(state.order.map((q) => Number(q.tema)))]
    .sort((a, b) => a - b)
    .map((tema) => {
      const list = state.order.filter((q) => Number(q.tema) === tema);
      return { tema, total: list.length, ok: list.filter((q) => state.answers[q.id] === q.correcta).length };
    });
  const subStatsMap = new Map();
  state.order.forEach((q) => {
    const isOk = state.answers[q.id] === q.correcta;
    const res = resolveApartadoForQuestion(q);
    const key = `t${res.tema}-ap${res.apartado || res.titulo}`;
    const cur = subStatsMap.get(key) || {
      tema: res.tema,
      apartado: res.apartado,
      codigo: res.codigo,
      titulo: res.titulo,
      tag: res.tag,
      total: 0,
      ok: 0,
      fails: 0,
      ids: [],
    };
    cur.total += 1;
    if (isOk) cur.ok += 1;
    else {
      cur.fails += 1;
      cur.ids.push(q.id);
    }
    subStatsMap.set(key, cur);
  });

  const subStats = [...subStatsMap.values()]
    .filter((s) => s.fails > 0)
    .map((s) => {
      const failPct = s.total ? Math.round((s.fails / s.total) * 100) : 100;
      return { ...s, failPct };
    })
    .sort((a, b) => b.failPct - a.failPct || b.fails - a.fails);
  const codeQs = state.order.filter((q) => q.tipo === "codigo");
  const okCode = codeQs.filter((q) => state.answers[q.id] === q.correcta).length;

  main.innerHTML = `
    <section class="results">
      <div class="score-card">
        <div class="score-ring" style="--pct:${pct}">
          <div><b>${grade.toFixed(1)}</b><span>sobre 10</span></div>
        </div>
        <div class="score-copy">
          <h1>${refuerzoSuperado ? "¡Temario reforzado sin fallos!" : esc(gradeMessage(pct, total))}</h1>
          <p>Has acertado <b>${correct}</b> de <b>${total}</b> preguntas (${pct}%). ${unanswered ? `Te quedaron ${unanswered} sin responder.` : "Contestaste todas."}</p>
          ${state.masteryMode ? `<p class="section-sub">Ronda ${state.masteryRound} de refuerzo. ${refuerzoSuperado ? "Has completado una ronda perfecta de todo el banco disponible." : "Revisa las explicaciones y repite el banco completo hasta completar una ronda sin fallos."}</p>` : ""}
          <div class="score-chips">
            <span class="chip">Aciertos ${correct}</span>
            <span class="chip">Fallos ${failed}</span>
            <span class="chip">Sin responder ${unanswered}</span>
          </div>
        </div>
      </div>

      <div class="breakdown">
        <div class="break-card"><b>${correct}</b><span>Aciertos (${pct}%)</span></div>
        <div class="break-card"><b>${failed}</b><span>Errores (${100 - pct}%)</span></div>
        ${themeStats.map(({ tema, total: t, ok }) => {
          const tFailPct = t ? Math.round(((t - ok) / t) * 100) : 0;
          return `<div class="break-card"><b>${ok}/${t}</b><span>Tema ${tema} · ${tFailPct}% fallos</span></div>`;
        }).join("")}
      </div>

      ${subStats.length ? `
      <div class="weak-topics">
        <h2><i class="fa-solid fa-triangle-exclamation"></i> Qué repasar primero</h2>
        <p class="section-sub">Los apartados y temas donde más has fallado en este test con sus porcentajes de error. Vuelve a sus apuntes antes de repetir.</p>
        <div class="results-weak-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:12px; margin-top:14px;">
          ${subStats.map((item) => `
            <div class="result-weak-card" style="background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span class="chip" style="font-weight:700; background:rgba(59,130,246,0.18); color:var(--brand); border-radius:6px; font-size:12px; padding:2px 8px;">Tema ${item.tema}</span>
                  <span class="tree-chip bank-chip" style="font-weight:700">${item.codigo}</span>
                  ${item.tag ? `<span class="chip ghost" style="font-size:11px">${esc(item.tag)}</span>` : ""}
                </div>
                <span style="font-weight:800; font-size:12.5px; color:var(--bad); background:rgba(239,68,68,0.14); padding:3px 8px; border-radius:8px;">
                  ${item.failPct}% fallos
                </span>
              </div>
              <div style="font-size:14px; font-weight:600; color:var(--text);">
                ${esc(item.titulo)}
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; opacity:.85; margin-top:4px;">
                <span>Has fallado <b>${item.fails}</b> de ${item.total} preg. (${item.ok} aciertos)</span>
                <button class="btn tiny warn" type="button" data-repeat-sub="${item.ids.join(",")}" title="Repetir solo los fallos de este subapartado">Repetir ${item.fails} fallo${item.fails !== 1 ? "s" : ""}</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>` : ""}

      <div class="results-actions">
        <button class="btn primary" type="button" id="repeat-wrong" ${wrongInSession.length ? "" : "disabled"}>Repetir solo fallos (${wrongInSession.length})</button>
        ${state.masteryMode && !refuerzoSuperado ? `<button class="btn ok" type="button" id="mastery-next-round">Repetir todo el temario · ronda ${state.masteryRound + 1}</button>` : ""}
        <button class="btn" type="button" id="open-wrong-book">Ver todos mis fallos</button>
        <button class="btn ok" type="button" id="gen-ia-mas"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar más preguntas con IA</button>
        <button class="btn" type="button" id="repeat-test">Repetir este test</button>
        <button class="btn" type="button" id="new-test">Elegir otro test</button>
        <button class="btn ghost" type="button" id="print-results">Imprimir</button>
      </div>

      <h2>${wrongInSession.length ? "Qué has fallado y por qué" : "Sin fallos: ¡enhorabuena!"}</h2>
      <p class="section-sub">${wrongInSession.length
        ? "Cada error lleva su explicación. En las preguntas de código, el depurador muestra línea a línea qué hace el programa."
        : "No hay errores que revisar en este test. Puedes repetirlo o subir de dificultad con el test completo."}</p>
      <div class="wrong-list" id="wrong-list"></div>
      ${codeQs.length ? `<p class="section-sub" style="margin-top:14px">Interpretación de código: <b>${okCode}/${codeQs.length}</b> correctas.</p>` : ""}
      <div id="all-answers-slot" style="margin-top:18px"></div>
    </section>
  `;

  const wrongList = $("#wrong-list");
  if (wrongInSession.length) {
    wrongInSession.forEach((q, i) => wrongList.append(renderWrongItem(q, i + 1)));
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="emoji"><i class="fa-solid fa-party-horn" aria-hidden="true"></i></div><h3>Ningún fallo</h3><p>Has acertado las ${total} preguntas de este test.</p>`;
    wrongList.append(empty);
  }

  $("#all-answers-slot")?.append(renderAllAnswers());

  $("#repeat-wrong")?.addEventListener("click", () => {
    const ids = wrongInSession.map((q) => q.id);
    if (!ids.length) return;
    startTest({ filter: "fallos", ids, immediate: true, shuffle: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#repeat-test")?.addEventListener("click", () => {
    const ids = state.order.map((q) => q.id);
    const filter = state.selectedFilter === "fallos" ? "fallos" : state.selectedFilter || "all";
    startTest({
      filter,
      ids,
      immediate: state.immediate,
      shuffle: false,
      mastery: state.masteryMode,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#mastery-next-round")?.addEventListener("click", () => {
    startTest({
      filter: "all",
      immediate: true,
      shuffle: true,
      mastery: true,
      continueMastery: true,
    });
  });
  $("#new-test")?.addEventListener("click", renderStart);
  $("#open-wrong-book")?.addEventListener("click", renderWrongBook);
  $$("[data-repeat-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ids = (btn.dataset.repeatSub || "").split(",").map(Number).filter(Boolean);
      if (ids.length) {
        const immediate = $("#immediate-toggle")?.checked !== false;
        startTest({ ids, immediate, shuffle: true });
      }
    });
  });
  $("#gen-ia-mas")?.addEventListener("click", () => {
    sessionStorage.setItem("wec12_ai_origen", "resultados");
    sessionStorage.setItem("wec12_ai_instrucciones", "");
    sessionStorage.setItem("wec12_ai_contexto", "");
    renderAiScreen();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#print-results")?.addEventListener("click", () => window.print());
  updateFooter();
}


// === assets/js/app/inicio.js ===
"use strict";

function handleKeys(event) {
  const tag = (event.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (state.screen === "test") {
    const key = event.key.toLowerCase();
    const byNumber = ["1", "2", "3", "4"].indexOf(key);
    const byLetter = ["a", "b", "c", "d"].indexOf(key);
    const index = byNumber >= 0 ? byNumber : byLetter;
    if (index >= 0) {
      event.preventDefault();
      selectOption(letterAt(index));
      return;
    }
    if (key === "arrowright" || event.key === "Enter" || key === "n") {
      event.preventDefault();
      nextQuestion();
      return;
    }
    if (key === "arrowleft" || key === "p") {
      event.preventDefault();
      prevQuestion();
      return;
    }
  } else if (state.screen === "results") {
    if (event.key === "Escape") {
      event.preventDefault();
      renderStart();
    }
  }
}

function irAlInicio(event) {
  if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button > 0)) return;
  event?.preventDefault();
  renderStart();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function boot() {
  initTheme();
  document.addEventListener("keydown", handleKeys);
  $(".brand-link")?.addEventListener("click", irAlInicio);
  const optionsBtn = document.querySelector("#options-toggle-btn");
  const optionsDropdown = document.querySelector("#options-dropdown");
  optionsBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    optionsDropdown?.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!optionsDropdown?.contains(e.target) && !optionsBtn?.contains(e.target)) {
      optionsDropdown?.classList.add("hidden");
    }
  });
  try {
    await loadCatalog();
    let saved = "";
    try { saved = localStorage.getItem(LS.subject) || ""; } catch { /* noop */ }
    const asignaturaGuardada = state.catalog.find(
      (asignatura) =>
        asignatura.id === saved &&
        !asignatura.apuntesPrivados &&
        (asignatura.archivo || asignatura.localData),
    );
    const asignaturaWec = state.catalog.find(
      (asignatura) =>
        asignatura.nombre.trim().toLocaleUpperCase("es") === "WEC" &&
        !asignatura.apuntesPrivados &&
        (asignatura.archivo || asignatura.localData),
    );
    const asignaturaInicial =
      asignaturaWec ||
      asignaturaGuardada ||
      state.catalog.find(
        (asignatura) =>
          !asignatura.apuntesPrivados &&
          (asignatura.archivo || asignatura.localData),
      ) ||
      state.catalog.find((asignatura) => asignatura.localData);
    if (!asignaturaInicial)
      throw new Error("No hay ningún banco de preguntas disponible para iniciar.");
    await loadSubject(asignaturaInicial.id);
    if (!document.querySelector(".practica-apuntes") && state.screen !== "notes") {
      renderStart();
    }
  } catch (error) {
    main.innerHTML = `
      <div class="empty-state" style="background:var(--bad-soft);border-color:var(--bad)">
        <div class="emoji"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></div>
        <h3>No se pudieron cargar las preguntas</h3>
        <p>Inicia Preparar tests desde su acceso directo y revisa la ruta de apuntes y la conexión con Ollama.</p>
        <p style="margin-top:8px"><code>${esc(String(error && error.message ? error.message : error))}</code></p>
      </div>`;
    const footer = $("#footer");
    if (footer) footer.textContent = String(error);
  }
}

boot();

