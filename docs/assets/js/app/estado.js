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
