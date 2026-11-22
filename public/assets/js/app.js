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


// === assets/js/app/estado/utilidades.js ===
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
  { id: "wec", nombre: "WEC", archivo: "./data/asignaturas/wec/preguntas.json", descripcion: "Temas 1, 2, 3 y 4 · Banco de preguntas" }
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
  masteryRound: 0,
  ramaActual: ""
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
  if (value == null) return "";
  let text = String(value);

  // 1. Extraer bloques de código multilínea (1 a 4 backticks)
  const codeBlocks = [];
  const codeRegex = /(^|\n|:\s*)[ \t]*(`{1,4})([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*\2[ \t]*(?:\r?\n|$)|(?:\r?\n[ \t]*`{1,4}[ \t]*(?:\r?\n|$))|$)/g;
  text = text.replace(codeRegex, (match, prefix, fence, lang, code) => {
    const idx = codeBlocks.length;
    const escapedCode = String(code)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim();
    const langHtml = lang ? `<div class="md-code-header"><span class="md-code-lang">${esc(lang)}</span></div>` : "";
    codeBlocks.push(
      `<div class="md-code-wrapper">${langHtml}<pre class="md-code-block"><code>${escapedCode}</code></pre></div>`
    );
    return `${prefix ? prefix.trimEnd() : ""}\n@@@MDCODE${idx}@@@\n`;
  });

  // 2. Extraer código inline `code`
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="md-inline-code">${esc(code)}</code>`);
    return `@@@MDINL${idx}@@@`;
  });

  // 3. Escapar el resto del texto antes de formatear etiquetas
  text = esc(text);

  // 4. Negritas y cursivas
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1<em>$2</em>$3");
  text = text.replace(/(^|[^_])_([^_]+)_([^_]|$)/g, "$1<em>$2</em>$3");

  // 5. Procesar líneas para markdown estructurado
  const lines = text.split(/\r?\n/);
  const outLines = [];
  let inOl = false;
  let inUl = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.includes("@@@MDCODE")) {
      if (inOl) { outLines.push("</ol>"); inOl = false; }
      if (inUl) { outLines.push("</ul>"); inUl = false; }
      outLines.push(trimmed);
      continue;
    }

    const mOl = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (mOl) {
      if (!inOl) {
        if (inUl) { outLines.push("</ul>"); inUl = false; }
        outLines.push('<ol class="md-list">');
        inOl = true;
      }
      outLines.push(`<li>${mOl[2]}</li>`);
      continue;
    } else if (inOl) {
      outLines.push("</ol>");
      inOl = false;
    }

    const mUl = trimmed.match(/^[-*•+]\s+(.*)$/);
    if (mUl) {
      if (!inUl) {
        if (inOl) { outLines.push("</ol>"); inOl = false; }
        outLines.push('<ul class="md-list">');
        inUl = true;
      }
      outLines.push(`<li>${mUl[1]}</li>`);
      continue;
    } else if (inUl) {
      outLines.push("</ul>");
      inUl = false;
    }

    const mH4 = trimmed.match(/^####\s+(.*)$/);
    const mH3 = trimmed.match(/^###\s+(.*)$/);
    const mH2 = trimmed.match(/^##\s+(.*)$/);
    const mH1 = trimmed.match(/^#\s+(.*)$/);

    if (mH4) {
      outLines.push(`<h5 class="md-heading md-h4">${mH4[1]}</h5>`);
    } else if (mH3) {
      outLines.push(`<h4 class="md-heading md-h3">${mH3[1]}</h4>`);
    } else if (mH2) {
      outLines.push(`<h3 class="md-heading md-h2">${mH2[1]}</h3>`);
    } else if (mH1) {
      outLines.push(`<h2 class="md-heading md-h1">${mH1[1]}</h2>`);
    } else if (trimmed.startsWith("&gt;")) {
      outLines.push(`<blockquote class="md-quote">${trimmed.replace(/^&gt;\s*/, "")}</blockquote>`);
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      outLines.push('<hr class="md-divider">');
    } else if (!trimmed) {
      outLines.push('<div class="md-spacer"></div>');
    } else {
      outLines.push(`<div class="md-p">${rawLine}</div>`);
    }
  }

  if (inOl) outLines.push("</ol>");
  if (inUl) outLines.push("</ul>");

  let result = outLines.join("");
  result = result.replace(/@@@MDINL(\d+)@@@/g, (_, idx) => inlineCodes[Number(idx)] || "");
  result = result.replace(/@@@MDCODE(\d+)@@@/g, (_, idx) => codeBlocks[Number(idx)] || "");

  return result;
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


// === assets/js/app/estado/almacenamiento.js ===
"use strict";

// --- Caché persistente IndexedDB para funcionamiento sin conexión ---
const DB_CACHE_OFFLINE = "preparar-tests-offline-cache-v1";
const ALMACEN_CACHE_OFFLINE = "almacen";

function abrirDbOffline() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB no disponible"));
    }
    const req = indexedDB.open(DB_CACHE_OFFLINE, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(ALMACEN_CACHE_OFFLINE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Error abriendo IndexedDB"));
  });
}

async function guardarEnCacheOffline(clave, valor) {
  try {
    const db = await abrirDbOffline();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ALMACEN_CACHE_OFFLINE, "readwrite");
      tx.objectStore(ALMACEN_CACHE_OFFLINE).put(valor, clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    try {
      const str = JSON.stringify(valor);
      if (str.length < 500000) {
        localStorage.setItem(`pt_offline_${clave}`, str);
      }
    } catch {}
  }
}

async function obtenerDeCacheOffline(clave) {
  try {
    const db = await abrirDbOffline();
    const resultado = await new Promise((resolve, reject) => {
      const tx = db.transaction(ALMACEN_CACHE_OFFLINE, "readonly");
      const req = tx.objectStore(ALMACEN_CACHE_OFFLINE).get(clave);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (resultado) return resultado;
  } catch {}

  try {
    const raw = localStorage.getItem(`pt_offline_${clave}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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
  try {
    localStorage.setItem("preparar_tests_sync_pendiente", "true");
  } catch (_) {}
}

function removeStore(base) {
  try { localStorage.removeItem(scopeKey(base)); } catch { /* noop */ }
  try { localStorage.removeItem(base); } catch { /* noop */ }
}

function hasQuestion(id) {
  if (id == null) return false;
  if (state.byId.has(id)) return true;
  if (typeof id === "string" && !isNaN(id) && state.byId.has(Number(id))) return true;
  if (typeof id === "number" && state.byId.has(String(id))) return true;
  return false;
}

function getQuestion(id) {
  if (id == null) return null;
  if (state.byId.has(id)) return state.byId.get(id);
  if (typeof id === "string" && !isNaN(id) && state.byId.has(Number(id))) return state.byId.get(Number(id));
  if (typeof id === "number" && state.byId.has(String(id))) return state.byId.get(String(id));
  return null;
}

function getWrongIds() {
  const ids = readStore(LS.wrong, []);
  const valid = new Set();
  if (Array.isArray(ids)) {
    ids.forEach((id) => {
      if (id != null && String(id).trim() !== "") {
        valid.add(id);
      }
    });
  }

  const history = getHistory();
  if (history && typeof history === "object") {
    Object.entries(history).forEach(([key, entry]) => {
      if (!entry) return;
      const q = getQuestion(key);
      if (q) {
        if (entry.selected && entry.selected !== q.correcta) {
          valid.add(q.id);
        } else if (entry.fails > 0 && entry.selected !== q.correcta) {
          valid.add(q.id);
        }
      } else if (entry.fails > 0) {
        valid.add(key);
      }
    });
  }

  return [...valid];
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

function getStats() {
  return readStore(LS.stats, { attempts: 0, bestPct: 0, lastPct: 0 });
}

function setStats(stats) {
  writeStore(LS.stats, stats);
}

function getSavedShuffle() {
  try {
    const val = localStorage.getItem("preparar_tests_barajar_orden");
    return val !== null ? val === "true" : true;
  } catch (_) {
    return true;
  }
}

function getSavedImmediate() {
  try {
    const val = localStorage.getItem("preparar_tests_correccion_inmediata");
    return val !== null ? val === "true" : true;
  } catch (_) {
    return true;
  }
}

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


// === assets/js/app/estado/apartados.js ===
"use strict";

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
  const wrong = new Set(getWrongIds().map((id) => getQuestion(id)?.id || id));
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
  const wrong = new Set(getWrongIds().map((id) => getQuestion(id)?.id || id));
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


// === assets/js/app/estado/catalogo.js ===
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


// === assets/js/app/estado/sesiones.js ===
"use strict";

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

function getSession(specificSubjectId = null) {
  const target = specificSubjectId || state.subjectId;
  if (target) {
    const scoped = readJSON(`${LS.session}:${target}`, null);
    if (scoped && Array.isArray(scoped.ids) && scoped.ids.length) {
      return scoped;
    }
  }
  const globalSession = readJSON(LS.session, null);
  if (globalSession && Array.isArray(globalSession.ids) && globalSession.ids.length) {
    if (!target || globalSession.subjectId === target) {
      return globalSession;
    }
  }
  const defaultScoped = readJSON(`${LS.session}:default`, null);
  if (defaultScoped && Array.isArray(defaultScoped.ids) && defaultScoped.ids.length) {
    if (!target || defaultScoped.subjectId === target) {
      return defaultScoped;
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${LS.session}:`)) {
        const item = readJSON(key, null);
        if (item && Array.isArray(item.ids) && item.ids.length && !item.finished) {
          if (!target || item.subjectId === target) {
            return item;
          }
        }
      }
    }
  } catch { /* noop */ }
  return readStore(LS.session, null);
}

function saveSession() {
  if (!state.order.length) return;
  const filterKey = state.selectedFilter || "all";
  const aiEvaluations = {};
  for (const q of state.order) {
    if (q && q.evaluacionIA) {
      aiEvaluations[q.id] = {
        evaluacionIA: q.evaluacionIA,
        evaluacionMensajes: q.evaluacionMensajes || []
      };
    }
  }
  const sessionData = {
    filter: filterKey,
    subjectId: state.subjectId,
    ids: state.order.map((q) => q.id),
    index: state.index,
    answers: state.answers,
    aiEvaluations,
    immediate: state.immediate,
    startedAt: state.startedAt,
    finished: state.finished,
    screen: state.screen,
    masteryMode: state.masteryMode,
    masteryRound: state.masteryRound,
    updatedAt: Date.now()
  };
  writeStore(LS.session, sessionData);
  writeJSON(LS.session, sessionData);
  saveSessionForFilter(filterKey, sessionData);
  guardarEnCacheOffline("ultima_sesion", sessionData);
  guardarEnCacheOffline(`preguntas_sesion_${state.subjectId || "default"}`, state.order);
}

function clearSession() {
  removeStore(LS.session);
  try { localStorage.removeItem(LS.session); } catch { /* noop */ }
  if (state.selectedFilter) {
    saveSessionForFilter(state.selectedFilter, null);
  }
}


// === assets/js/app/estado.js ===
"use strict";

// ============================================================
// FACHADA UNIFICADA DE ESTADO Y ALMACENAMIENTO
// Los módulos especializados residen en public/assets/js/app/estado/
// - utilidades.js: funciones de escape, formato de texto y markdown
// - almacenamiento.js: acceso a almacenamiento local, IndexedDB y opciones
// - apartados.js: resolución de temas y detección de conceptos débiles
// - catalogo.js: carga y normalización de asignaturas y bancos
// - sesiones.js: persistencia y control de sesiones activas
// ============================================================


// === assets/js/app/supabase/cliente.js ===
"use strict";

// ============================================================
// CONFIGURACIÓN E INICIALIZACIÓN CLIENTE SUPABASE (Grados Informáticos)
// ============================================================

window.SUPABASE_URL = window.SUPABASE_URL || "";
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";

const SupabaseConfig = (() => {
  let client = null;

  function getClient() {
    if (client) return client;
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    if (window.supabase && typeof window.supabase.createClient === "function") {
      try {
        client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
          db: { schema: "grados-informaticos" },
          auth: {
            flowType: "pkce",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        window.supabaseClient = client;
        return client;
      } catch (err) {
        console.error("Error al inicializar cliente Supabase:", err);
      }
    }
    return null;
  }

  async function seedInitialProgress() {
    const keySeeded = "wec12_seeded_8765_v2";
    if (localStorage.getItem(keySeeded) === "true") return;

    try {
      const resp = await fetch("./data/progreso-8765.json");
      if (!resp.ok) return;
      const seedData = await resp.json();
      if (!seedData || !seedData.history) return;

      const currentHistory = typeof getHistory === "function" ? getHistory() : {};
      const currentWrong = typeof getWrongIds === "function" ? getWrongIds() : [];

      const mergedHistory = { ...seedData.history, ...currentHistory };
      const mergedWrong = [...new Set([...(seedData.wrongIds || []), ...currentWrong])];

      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);

      const existingStats = typeof getStats === "function" ? getStats() : null;
      if (!existingStats || existingStats.attempts === 0) {
        if (typeof setStats === "function") setStats(seedData.stats);
        else if (typeof writeStore === "function") writeStore(LS.stats, seedData.stats);
      }

      localStorage.setItem(keySeeded, "true");
      console.log(`[Supabase] Progreso inicial cargado con éxito (${Object.keys(seedData.history).length} practicadas, ${mergedWrong.length} fallos)`);
      if (typeof toast === "function") {
        toast("✓ Se ha cargado tu progreso anterior (515 preguntas practicadas)");
      }
    } catch (e) {
      console.warn("No se pudo cargar el progreso inicial:", e);
    }
  }

  return {
    getClient,
    seedInitialProgress
  };
})();


// === assets/js/app/supabase/progreso.js ===
"use strict";

// ============================================================
// SINCRONIZACIÓN DE PROGRESO CON SUPABASE Y CACHÉ LOCAL
// Guarda en el schema "grados-informaticos".progreso_tests
// y en user_metadata, con fallback en localStorage y auto-sincronización.
// ============================================================

const SupabaseProgreso = (() => {
  let isSyncing = false;
  let autoSyncTimer = null;

  function updateSyncStatusUI(text) {
    const statusEl = document.querySelector("#sync-cloud-status");
    if (statusEl) statusEl.textContent = text;
  }

  async function syncProgressWithCloud(forceUpload = false) {
    const c = SupabaseConfig.getClient();
    const currentUser = window.SupabaseAuth?.getCurrentUser?.();
    if (!c || !currentUser || isSyncing) {
      try {
        localStorage.setItem("preparar_tests_sync_pendiente", "true");
      } catch (_) {}
      return;
    }
    isSyncing = true;

    try {
      updateSyncStatusUI("Sincronizando con Supabase…");
      const localHistory = typeof getHistory === "function" ? getHistory() : {};
      const localWrong = typeof getWrongIds === "function" ? getWrongIds() : [];
      const localStats = typeof getStats === "function" ? getStats() : {};
      const localSession = typeof getSession === "function" ? getSession() : null;

      // Intentar leer de la tabla del schema "grados-informaticos"
      let schemaProgress = null;
      try {
        const { data: dbData } = await c.schema("grados-informaticos")
          .from("progreso_tests")
          .select("*")
          .eq("usuario_id", currentUser.id);
        if (Array.isArray(dbData) && dbData.length > 0) {
          schemaProgress = dbData[0];
        }
      } catch (_) {}

      const cloudProgress = schemaProgress?.historial
        ? {
            history: schemaProgress.historial,
            wrongIds: schemaProgress.fallos || [],
            stats: schemaProgress.estadisticas || {}
          }
        : (currentUser.user_metadata?.test_progress || null);

      let mergedHistory = { ...localHistory };
      let mergedWrong = [...new Set(localWrong)];
      let mergedStats = { ...localStats };

      if (cloudProgress && !forceUpload) {
        if (cloudProgress.history) {
          Object.entries(cloudProgress.history).forEach(([qid, item]) => {
            if (!mergedHistory[qid] || (item.at && (!mergedHistory[qid].at || item.at > mergedHistory[qid].at))) {
              mergedHistory[qid] = item;
            }
          });
        }
        if (Array.isArray(cloudProgress.wrongIds)) {
          mergedWrong = [...new Set([...mergedWrong, ...cloudProgress.wrongIds])];
        }
        if (cloudProgress.stats) {
          mergedStats.attempts = Math.max(mergedStats.attempts || 0, cloudProgress.stats.attempts || 0);
          mergedStats.bestPct = Math.max(mergedStats.bestPct || 0, cloudProgress.stats.bestPct || 0);
        }
      }

      const payload = {
        updatedAt: new Date().toISOString(),
        history: mergedHistory,
        wrongIds: mergedWrong,
        stats: mergedStats,
        session: localSession,
        countPracticadas: Object.keys(mergedHistory).length
      };

      // 1. Guardar en tabla del schema grados-informaticos
      try {
        await c.schema("grados-informaticos").from("progreso_tests").upsert({
          usuario_id: currentUser.id,
          email: currentUser.email,
          asignatura_id: (window.state?.subjectId || "general"),
          historial: mergedHistory,
          fallos: mergedWrong,
          estadisticas: mergedStats,
          actualizado_en: new Date().toISOString()
        }, { onConflict: "usuario_id,asignatura_id" });
      } catch (dbErr) {
        console.log("[SupabaseProgreso] Info schema:", dbErr?.message || dbErr);
      }

      // 2. Guardar en Supabase user_metadata (Auth)
      const { data: updateData, error: updateError } = await c.auth.updateUser({
        data: { test_progress: payload }
      });

      if (!updateError && updateData?.user && window.SupabaseAuth) {
        window.SupabaseAuth.setCurrentUser(updateData.user);
      }

      // 3. Aplicar al estado local (caché siempre actualizado)
      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);
      if (typeof setStats === "function") setStats(mergedStats);

      try {
        localStorage.removeItem("preparar_tests_sync_pendiente");
        localStorage.setItem("preparar_tests_ultima_sync", new Date().toISOString());
      } catch (_) {}

      updateSyncStatusUI(`Sincronizado (${payload.countPracticadas} preguntas)`);
      console.log(`[SupabaseProgreso] Sincronizado con Supabase (${payload.countPracticadas} preguntas)`);
    } catch (e) {
      console.error("[SupabaseProgreso] Error al sincronizar:", e);
      try {
        localStorage.setItem("preparar_tests_sync_pendiente", "true");
      } catch (_) {}
      updateSyncStatusUI("Guardado en caché (pendiente Supabase)");
    } finally {
      isSyncing = false;
    }
  }

  function autoSyncProgressDebounced() {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      syncProgressWithCloud(false).catch((e) => console.warn("Auto-sync error:", e));
    }, 1000);
  }

  return {
    syncProgressWithCloud,
    autoSyncProgressDebounced,
    updateSyncStatusUI
  };
})();


// === assets/js/app/supabase/auth.js ===
"use strict";

// ============================================================
// AUTENTICACIÓN Y VALIDACIÓN DE ROLES SUPABASE
// ============================================================

const SupabaseGestionAuth = (() => {
  let currentUser = null;

  function getCurrentUser() {
    return currentUser;
  }

  function setCurrentUser(user) {
    currentUser = user;
  }

  function purgarSesionYCookies() {
    currentUser = null;

    try { sessionStorage.clear(); } catch (_) {}

    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth") || k.includes("token") || k.includes("admin") || k.includes("invitado") || k.includes("verifier"))) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}

    try {
      const cookies = document.cookie.split(";");
      for (const c of cookies) {
        const eqPos = c.indexOf("=");
        const name = eqPos > -1 ? c.substring(0, eqPos).trim() : c.trim();
        if (name) {
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=;`;
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname};`;
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${window.location.hostname};`;
        }
      }
    } catch (_) {}

    try {
      if (window.location.hash || window.location.search) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (_) {}
  }

  async function cerrarSesionCompleta(mensaje = "Has cerrado sesión.") {
    const c = SupabaseConfig.getClient();
    if (c) {
      try {
        await Promise.race([
          c.auth.signOut({ scope: "global" }),
          new Promise((r) => setTimeout(r, 1500))
        ]);
      } catch (_) {}
    }
    purgarSesionYCookies();
    if (typeof SupabaseUI !== "undefined") SupabaseUI.updateAuthButton();
    const modal = document.querySelector("#auth-modal");
    if (modal) modal.classList.add("hidden");
    mostrarLoginGate(mensaje);
    window.location.replace(window.location.origin + window.location.pathname);
  }

  async function verificarPermisoAdmin(c, user) {
    if (!user) return false;
    const emailNorm = String(user.email || "").trim().toLowerCase();
    if (emailNorm === "nataliagbarea@gmail.com" || user.id === "553ae2cb-4832-4cda-a16d-e547032eb5b7") {
      return true;
    }

    try {
      const u = window.SUPABASE_URL;
      const k = window.SUPABASE_ANON_KEY;
      if (u && k) {
        const idFiltro = user.id ? `id=eq.${encodeURIComponent(user.id)}` : (user.email ? `email=eq.${encodeURIComponent(user.email)}` : null);
        if (idFiltro) {
          const resp = await fetch(`${u}/rest/v1/perfiles?select=rol&${idFiltro}`, {
            credentials: "omit",
            headers: { "apikey": k, "Authorization": `Bearer ${k}` }
          });
          if (resp.ok) {
            const arr = await resp.json();
            if (Array.isArray(arr) && arr.length > 0 && String(arr[0].rol || "").trim().toLowerCase() === "admin") {
              return true;
            }
          }
        }
      }
    } catch (_) {}

    if (!c) return false;
    try {
      let data = null;
      if (user.id) {
        const resId = await c.schema("public").from("perfiles")
          .select("id, email, rol").eq("id", user.id).maybeSingle();
        if (!resId.error && resId.data) data = resId.data;
      }
      if (!data && user.email) {
        const resEmail = await c.schema("public").from("perfiles")
          .select("id, email, rol").eq("email", user.email).maybeSingle();
        if (!resEmail.error && resEmail.data) data = resEmail.data;
      }
      return data && String(data.rol || "").trim().toLowerCase() === "admin";
    } catch (err) {
      console.warn("Fallo verificando permiso:", err);
      return false;
    }
  }

  function mostrarLoginGate(errorMsg = "") {
    const gate = document.getElementById("login-gate");
    if (gate) {
      gate.style.display = "flex";
      const errBox = document.getElementById("login-gate-error");
      if (errBox) {
        if (errorMsg) {
          errBox.textContent = errorMsg;
          errBox.style.display = "block";
        } else {
          errBox.style.display = "none";
        }
      }
    }
    const mainEl = document.getElementById("main") || document.getElementById("app");
    if (mainEl) mainEl.style.display = "none";
    const footer = document.getElementById("footer");
    if (footer) footer.style.display = "none";
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.display = "none";
  }

  function ocultarLoginGate() {
    const gate = document.getElementById("login-gate");
    if (gate) gate.style.display = "none";
    const mainEl = document.getElementById("main") || document.getElementById("app");
    if (mainEl) mainEl.style.display = "";
    const footer = document.getElementById("footer");
    if (footer) footer.style.display = "";
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.display = "";
    if (typeof window.renderizarInicioTests === "function") {
      window.renderizarInicioTests();
    }
  }

  async function autenticarConGate() {
    // Si el usuario inició autenticación desde generador-apuntes y Supabase redirigió aquí por Site URL.
    // localStorage NO se comparte entre puertos — usamos cookie como puente entre localhost:8002 y localhost:3000.
    try {
      function leerCookie(nombre) {
        const m = document.cookie.match(new RegExp("(?:^|; )" + nombre + "=([^;]*)"));
        return m ? decodeURIComponent(m[1]) : null;
      }
      const authOrigin = localStorage.getItem("auth_origin_app") || leerCookie("auth_origin_app");
      if (authOrigin && (authOrigin.includes("generador-apuntes") || authOrigin.includes(":8002"))) {
        document.cookie = "auth_origin_app=; path=/; max-age=0";
        localStorage.removeItem("auth_origin_app");
        const destino = new URL(authOrigin);
        // NO reenviar params de error (?error=...) — solo el hash con el token
        // Si hay token en el hash, lo pasamos; si hay error en la URL, lo descartamos
        const hayError = window.location.search.includes("error=");
        if (!hayError) destino.search = window.location.search;
        destino.hash = window.location.hash;
        window.location.replace(destino.toString());
        return false;
      }
    } catch (_) {}

    try {
      sessionStorage.removeItem("esInvitado");
      localStorage.removeItem("esInvitado");
    } catch (_) {}

    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasError = urlParams.has("error") || urlParams.has("error_description") || hashParams.has("error") || hashParams.has("error_description");
    let errorAlInicio = "";

    if (hasError) {
      const errDesc = urlParams.get("error_description") || urlParams.get("error") || hashParams.get("error_description") || hashParams.get("error") || "Error en autorización";
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (_) {}
      errorAlInicio = `Aviso: ${decodeURIComponent(errDesc).replace(/\+/g, " ")}.`;
    }

    const c = SupabaseConfig.getClient();
    if (!c) {
      mostrarLoginGate("No se pudo conectar con Supabase.");
      return false;
    }

    try {
      let { data: { session } } = await c.auth.getSession();
      const hasTokenInUrl = window.location.hash.includes("access_token") || window.location.search.includes("code=");

      if (!session && hasTokenInUrl) {
        if (window.location.search.includes("code=")) {
          const code = urlParams.get("code");
          if (code && typeof c.auth.exchangeCodeForSession === "function") {
            try {
              const resCode = await c.auth.exchangeCodeForSession(code);
              if (resCode.data?.session) session = resCode.data.session;
            } catch (errCode) {
              console.warn("exchangeCode aviso:", errCode);
            }
          }
        }

        if (!session) {
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const res = await c.auth.getSession();
            if (res.data?.session) {
              session = res.data.session;
              break;
            }
          }
        }
      }

      if (!session?.user) {
        mostrarLoginGate(errorAlInicio);
        return false;
      }

      if (hasTokenInUrl) {
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}
      }

      const esAdmin = await verificarPermisoAdmin(c, session.user);
      if (!esAdmin) {
        await c.auth.signOut().catch(() => {});
        currentUser = null;
        try { sessionStorage.removeItem("esAdmin"); } catch (_) {}
        mostrarLoginGate("Acceso denegado: tu usuario (" + (session.user.email || session.user.id) + ") no tiene rol admin en la tabla perfiles de Supabase.");
        return false;
      }

      currentUser = session.user;
      try { sessionStorage.setItem("esAdmin", "true"); } catch (_) {}
      ocultarLoginGate();
      if (typeof SupabaseUI !== "undefined") SupabaseUI.updateAuthButton();
      await SupabaseProgreso.syncProgressWithCloud();
      return true;
    } catch (err) {
      console.error("Error en validación de sesión:", err);
      mostrarLoginGate(errorAlInicio || "Error al validar la sesión con Supabase.");
      return false;
    }
  }

  return {
    getCurrentUser,
    setCurrentUser,
    purgarSesionYCookies,
    cerrarSesionCompleta,
    autenticarConGate,
    mostrarLoginGate,
    ocultarLoginGate
  };
})();


// === assets/js/app/supabase/ui.js ===
"use strict";

// ============================================================
// INTERFAZ DE USUARIO: MODAL DE AUTENTICACIÓN Y SINCRONIZACIÓN
// ============================================================

const SupabaseUI = (() => {
  function updateAuthButton() {
    const btn = document.querySelector("#auth-btn");
    const label = document.querySelector("#auth-btn-label");
    if (!btn || !label) return;

    const user = SupabaseGestionAuth.getCurrentUser();
    if (user && user.id !== "invitado") {
      const email = user.email || "Usuario";
      label.textContent = email.split("@")[0];
      btn.classList.add("primary");
      btn.title = `Conectado como ${email} · Clic para ver perfil y sincronización`;
    } else {
      label.textContent = "Iniciar sesión";
      btn.classList.remove("primary");
      btn.title = "Iniciar sesión con Supabase para guardar tu caché y progreso";
    }
  }

  function renderAuthModal() {
    let modal = document.querySelector("#auth-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "auth-modal";
      modal.className = "modal-overlay hidden";
      modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7);
        display: flex; align-items: center; justify-content: center; z-index: 1000;
        padding: 20px; backdrop-filter: blur(4px);
      `;
      document.body.appendChild(modal);
    }

    const user = SupabaseGestionAuth.getCurrentUser();
    const email = user?.email || "";
    const historyCount = typeof getHistory === "function" ? Object.keys(getHistory()).length : 0;
    const wrongCount = typeof getWrongIds === "function" ? getWrongIds().length : 0;

    modal.innerHTML = `
      <div class="modal-card" style="
        background: var(--card); color: var(--text); border: 1px solid var(--line);
        border-radius: var(--radius); width: 100%; max-width: 440px; padding: 28px;
        box-shadow: var(--shadow); position: relative; max-height: 90vh; overflow-y: auto;
      ">
        <button type="button" id="close-auth-modal" style="
          position: absolute; top: 16px; right: 16px; background: none; border: none;
          font-size: 20px; color: var(--muted); cursor: pointer; padding: 4px;
        " aria-label="Cerrar">&times;</button>

        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <div style="width:40px; height:40px; border-radius:10px; background:var(--brand-soft); color:var(--brand); display:flex; align-items:center; justify-content:center; font-size:18px;">
            <i class="fa-solid ${user ? "fa-cloud-arrow-up" : "fa-user"}"></i>
          </div>
          <div>
            <h3 style="margin:0; font-size:18px;">${user ? "Tu cuenta de Supabase" : "Iniciar sesión en Supabase"}</h3>
            <small style="color:var(--muted);">${user ? "Grados Informáticos · Sincronización activa" : "Guarda tu caché y progreso en la nube"}</small>
          </div>
        </div>

        ${user ? `
          <div style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:16px; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Usuario</span>
              <strong style="font-size:14px;">${esc(email)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas practicadas</span>
              <strong><span class="pct-pill" style="background:var(--ok-soft); color:var(--ok); font-size:12px; padding:2px 8px; border-radius:12px;">${historyCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas falladas</span>
              <strong><span class="pct-pill" style="background:var(--bad-soft); color:var(--bad); font-size:12px; padding:2px 8px; border-radius:12px;">${wrongCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:var(--muted);">Estado de nube</span>
              <span id="sync-cloud-status" style="font-size:12px; font-weight:600; color:var(--brand);">Conectado</span>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn primary" type="button" id="btn-sync-now" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-arrows-rotate"></i> Sincronizar ahora con Supabase
            </button>
            <button class="btn ghost warn" type="button" id="btn-logout" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-right-from-bracket"></i> Cerrar sesión
            </button>
          </div>
        ` : `
          <p style="font-size:13px; color:var(--muted); line-height:1.5; margin-bottom:20px;">
            Inicia sesión para sincronizar automáticamente tu caché, respuestas y progreso entre dispositivos.
          </p>

          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
            <button class="btn" type="button" id="btn-oauth-google" style="width:100%; justify-content:center; gap:10px; border:1px solid var(--line);">
              <i class="fa-brands fa-google" style="color:#ea4335;"></i> Continuar con Google
            </button>
            <button class="btn" type="button" id="btn-oauth-github" style="width:100%; justify-content:center; gap:10px; border:1px solid var(--line);">
              <i class="fa-brands fa-github"></i> Continuar con GitHub
            </button>
          </div>

          <div style="display:flex; align-items:center; gap:10px; margin:16px 0; color:var(--muted); font-size:12px;">
            <hr style="flex:1; border:0; border-top:1px solid var(--line);">
            <span>O con correo</span>
            <hr style="flex:1; border:0; border-top:1px solid var(--line);">
          </div>

          <form id="email-auth-form" style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;" for="auth-email">Correo electrónico</label>
              <input class="control" type="email" id="auth-email" required placeholder="tu@correo.com" style="width:100%; box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;" for="auth-password">Contraseña</label>
              <input class="control" type="password" id="auth-password" required placeholder="••••••••" style="width:100%; box-sizing:border-box;">
            </div>
            <div id="auth-error-msg" class="hidden" style="color:var(--bad); font-size:12px; background:var(--bad-soft); padding:8px 12px; border-radius:8px;"></div>
            <div style="display:flex; gap:10px; margin-top:8px;">
              <button class="btn primary" type="submit" id="btn-submit-login" style="flex:1; justify-content:center;">Entrar</button>
              <button class="btn ghost" type="button" id="btn-submit-signup" style="flex:1; justify-content:center;">Registrarse</button>
            </div>
          </form>
        `}
      </div>
    `;

    modal.classList.remove("hidden");

    modal.querySelector("#close-auth-modal")?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    if (user) {
      modal.querySelector("#btn-sync-now")?.addEventListener("click", async () => {
        const btn = modal.querySelector("#btn-sync-now");
        if (btn) { btn.disabled = true; btn.textContent = "Sincronizando…"; }
        await SupabaseProgreso.syncProgressWithCloud(true);
        if (typeof toast === "function") toast("✓ Progreso sincronizado con Supabase");
        renderAuthModal();
      });

      modal.querySelector("#btn-logout")?.addEventListener("click", async () => {
        await SupabaseGestionAuth.cerrarSesionCompleta("Has cerrado sesión.");
      });
    } else {
      modal.querySelector("#btn-oauth-google")?.addEventListener("click", async () => {
        const c = SupabaseConfig.getClient();
        if (!c) return;
        await c.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.href }
        });
      });

      modal.querySelector("#btn-oauth-github")?.addEventListener("click", async () => {
        const c = SupabaseConfig.getClient();
        if (!c) return;
        await c.auth.signInWithOAuth({
          provider: "github",
          options: { redirectTo: window.location.href }
        });
      });

      const form = modal.querySelector("#email-auth-form");
      const errBox = modal.querySelector("#auth-error-msg");

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const c = SupabaseConfig.getClient();
        if (!c) return;
        const emailVal = modal.querySelector("#auth-email").value.trim();
        const passVal = modal.querySelector("#auth-password").value;
        const submitBtn = modal.querySelector("#btn-submit-login");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Entrando…"; }
        errBox.classList.add("hidden");

        const { data, error } = await c.auth.signInWithPassword({ email: emailVal, password: passVal });
        if (error) {
          errBox.textContent = error.message;
          errBox.classList.remove("hidden");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Entrar"; }
        } else {
          SupabaseGestionAuth.setCurrentUser(data.user);
          updateAuthButton();
          await SupabaseProgreso.syncProgressWithCloud();
          if (typeof toast === "function") toast(`¡Bienvenida ${emailVal}!`);
          renderAuthModal();
        }
      });
    }
  }

  return {
    renderAuthModal,
    updateAuthButton
  };
})();


// === assets/js/app/supabase/github-ramas.js ===
"use strict";

// ============================================================
// GESTOR DE RAMAS Y REPOSITORIO PRIVADO DE GITHUB
// Permite listar ramas y descargar JSONs de tests desde GitHub
// ============================================================
const RepoBranchManager = (() => {
  const DEFAULT_REPO = "nataliagamezbarea/GRADOS_INFORMATICOS";
  const DEFAULT_BRANCH = "Segundo_grado_superior";
  const DEFAULT_FOLDER = "datos/bancos/WEC";
  const CACHE_BRANCHES_KEY = "cache_ramas_tests_v2";

  function getRepo() {
    return localStorage.getItem("gh_repo") || sessionStorage.getItem("gh_repo") || DEFAULT_REPO;
  }

  function getToken() {
    const fromStorage = localStorage.getItem("cache_gh_token") || sessionStorage.getItem("cache_gh_token") || "";
    if (fromStorage) return fromStorage;
    const fromWindow = window.GITHUB_CONFIG?.token || "";
    return fromWindow;
  }

  async function obtenerTokenDesdeSupabase() {
    let token = getToken();
    if (token) return token;

    const supabaseUrl = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const c = window.SupabaseAuth?.getClient?.();

    // 1. Intentar mediante el cliente Supabase
    if (c) {
      try {
        const { data, error } = await c.schema("grados-informaticos").from("configuracion_privada").select("clave, valor");
        if (!error && Array.isArray(data) && data.length > 0) {
          const rowToken = data.find((r) => r.clave === "gh_token" || r.clave === "gh_token_general");
          const rowRepo = data.find((r) => r.clave === "gh_repo" || r.clave === "gh_repo_general");
          if (rowToken?.valor) {
            token = rowToken.valor;
            localStorage.setItem("cache_gh_token", token);
          }
          if (rowRepo?.valor) {
            localStorage.setItem("gh_repo", rowRepo.valor);
          }
        }
      } catch (_) {}
    }

    // 2. Si aún no hay token, consultar vía REST pasando el token de sesión autenticada
    if (!token && supabaseUrl && anonKey) {
      try {
        let accessToken = anonKey;
        if (c?.auth?.getSession) {
          const sRes = await c.auth.getSession();
          if (sRes?.data?.session?.access_token) {
            accessToken = sRes.data.session.access_token;
          }
        }

        const url = `${supabaseUrl}/rest/v1/configuracion_privada?select=clave,valor&clave=in.(gh_repo,gh_repo_general,gh_token,gh_token_general)`;
        const resp = await fetch(url, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Accept-Profile": "grados-informaticos"
          },
          cache: "no-store"
        });

        if (resp.ok) {
          const filas = await resp.json();
          if (Array.isArray(filas) && filas.length > 0) {
            const rowToken = filas.find((r) => r.clave === "gh_token" || r.clave === "gh_token_general");
            const rowRepo = filas.find((r) => r.clave === "gh_repo" || r.clave === "gh_repo_general");
            if (rowToken?.valor) {
              token = rowToken.valor;
              localStorage.setItem("cache_gh_token", token);
            }
            if (rowRepo?.valor) {
              localStorage.setItem("gh_repo", rowRepo.valor);
            }
          }
        }
      } catch (err) {
        console.warn("Fallo leyendo configuracion_privada de Supabase:", err);
      }
    }

    return token || getToken();
  }

  async function listarRamas() {
    const token = await obtenerTokenDesdeSupabase();
    const repo = getRepo();

    let cached = [];
    try {
      cached = JSON.parse(localStorage.getItem(CACHE_BRANCHES_KEY) || "[]");
    } catch (_) {}

    try {
      const headers = { Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers, cache: "no-store" });
      if (res.ok) {
        const branches = await res.json();
        if (Array.isArray(branches) && branches.length > 0) {
          const names = branches.map((b) => b.name);
          localStorage.setItem(CACHE_BRANCHES_KEY, JSON.stringify(names));
          return names;
        }
      }
    } catch (err) {
      console.warn("No se pudieron listar ramas de GitHub en vivo:", err);
    }

    if (cached.length) return cached;
    return [DEFAULT_BRANCH, "master"];
  }

  async function poblarSelectorRamas(selectEl, selectedRama = null) {
    if (!selectEl) return;
    const branches = await listarRamas();
    const active = selectedRama || localStorage.getItem("selected_test_branch") || DEFAULT_BRANCH;

    selectEl.innerHTML = "";
    branches.forEach((branch) => {
      const opt = document.createElement("option");
      opt.value = branch;
      opt.textContent = `Rama: ${branch}${branch === DEFAULT_BRANCH ? " (DWEC - Segundo)" : ""}`;
      if (branch === active) opt.selected = true;
      selectEl.appendChild(opt);
    });

    if (!branches.includes(active)) {
      const opt = document.createElement("option");
      opt.value = active;
      opt.textContent = `Rama: ${active}`;
      opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  async function cargarPreguntasDeRama(rama, carpeta = DEFAULT_FOLDER) {
    const token = await obtenerTokenDesdeSupabase();
    const repo = getRepo();
    try {
      if (typeof toast === "function") toast(`Conectando con GitHub para leer "${rama}"…`);
      const headers = { Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${carpeta}?ref=${encodeURIComponent(rama)}`, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} al acceder a ${carpeta}`);
      }
      const files = await res.json();
      if (!Array.isArray(files)) {
        throw new Error("La respuesta no contiene archivos.");
      }

      const jsonFiles = files.filter((f) => f.name.endsWith(".json") && f.type === "file" && !f.name.includes("backup"));
      if (jsonFiles.length === 0) {
        throw new Error(`No hay JSONs de preguntas en ${carpeta}`);
      }

      let allQuestions = [];
      for (const file of jsonFiles) {
        const rawHeaders = { Accept: "application/vnd.github.raw" };
        if (token) rawHeaders.Authorization = `Bearer ${token}`;
        const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${file.path}?ref=${encodeURIComponent(rama)}`, { headers: rawHeaders });
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          const qList = Array.isArray(fileData?.preguntas) ? fileData.preguntas : (Array.isArray(fileData) ? fileData : []);
          allQuestions.push(...qList);
        }
      }

      if (allQuestions.length > 0 && typeof normalizeData === "function") {
        normalizeData({ preguntas: allQuestions });
        localStorage.setItem("selected_test_branch", rama);
        if (typeof renderApp === "function") renderApp();
        if (typeof toast === "function") toast(`✓ Cargadas ${allQuestions.length} preguntas de la rama "${rama}"`);
        return allQuestions;
      }
    } catch (err) {
      console.warn("Carga desde GitHub falló, manteniendo local:", err);
      if (typeof toast === "function") toast(`Aviso GitHub: ${err.message}. Usando banco local.`);
    }
    return null;
  }

  async function guardarPreguntasEnGitHub(rama, rutaArchivo, contenidoJson) {
    const token = await obtenerTokenDesdeSupabase();
    const repo = getRepo();
    if (!token) {
      throw new Error("No hay token de GitHub con permisos de escritura disponible.");
    }
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    };

    let sha = null;
    try {
      const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${rutaArchivo}?ref=${encodeURIComponent(rama)}`, { headers });
      if (getRes.ok) {
        const fileInfo = await getRes.json();
        sha = fileInfo.sha;
      }
    } catch (_) {}

    const jsonString = typeof contenidoJson === "string" ? contenidoJson : JSON.stringify(contenidoJson, null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

    const body = {
      message: `Actualizar banco de preguntas: ${rutaArchivo.split("/").pop()}`,
      content: base64Content,
      branch: rama
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${rutaArchivo}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body)
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${putRes.status}`);
    }

    if (typeof toast === "function") {
      toast(`✓ Guardado en GitHub en la rama "${rama}"`);
    }
    return true;
  }

  return {
    getRepo,
    getToken,
    obtenerTokenDesdeSupabase,
    listarRamas,
    poblarSelectorRamas,
    cargarPreguntasDeRama,
    guardarPreguntasEnGitHub,
    DEFAULT_BRANCH,
    DEFAULT_FOLDER
  };
})();

window.RepoBranchManager = RepoBranchManager;


// === assets/js/app/supabase.js ===
"use strict";

// ============================================================
// FACHADA UNIFICADA SUPABASE AUTH & PROGRESO
// ============================================================

const SupabaseAuth = {
  getClient: () => SupabaseConfig.getClient(),
  getCurrentUser: () => SupabaseGestionAuth.getCurrentUser(),
  setCurrentUser: (u) => SupabaseGestionAuth.setCurrentUser(u),
  seedInitialProgress: () => SupabaseConfig.seedInitialProgress(),
  syncProgressWithCloud: (force) => SupabaseProgreso.syncProgressWithCloud(force),
  autoSyncProgressDebounced: () => SupabaseProgreso.autoSyncProgressDebounced(),
  renderAuthModal: () => SupabaseUI.renderAuthModal(),
  cerrarSesion: (msg) => SupabaseGestionAuth.cerrarSesionCompleta(msg),
  purgarSesion: () => SupabaseGestionAuth.purgarSesionYCookies(),
  init: async () => {
    try {
      const res = await fetch("/api/configuracion");
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.supabaseUrl) window.SUPABASE_URL = cfg.supabaseUrl;
        if (cfg.supabaseAnonKey) window.SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        if (cfg.githubRepo) localStorage.setItem("gh_repo", cfg.githubRepo);
        if (cfg.githubBranch) localStorage.setItem("selected_test_branch", cfg.githubBranch);
        if (cfg.githubToken) localStorage.setItem("cache_gh_token", cfg.githubToken);
      }
    } catch (_) {}

    await SupabaseConfig.seedInitialProgress();
    await SupabaseGestionAuth.autenticarConGate();

    const c = SupabaseConfig.getClient();
    if (c) {
      c.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN") {
          await SupabaseGestionAuth.autenticarConGate();
        } else if (event === "SIGNED_OUT") {
          SupabaseGestionAuth.setCurrentUser(null);
          SupabaseUI.updateAuthButton();
          SupabaseGestionAuth.mostrarLoginGate();
        }
      });
    }

    // Gate OAuth buttons
    document.getElementById("gate-btn-github")?.addEventListener("click", async () => {
      const cl = SupabaseConfig.getClient();
      if (!cl) return;
      await cl.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });

    document.getElementById("gate-btn-google")?.addEventListener("click", async () => {
      const cl = SupabaseConfig.getClient();
      if (!cl) return;
      await cl.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });

    document.querySelector("#auth-btn")?.addEventListener("click", () => {
      SupabaseUI.renderAuthModal();
    });

    SupabaseUI.updateAuthButton();

    // Sincronizar automáticamente si había cambios en caché pendientes
    if (localStorage.getItem("preparar_tests_sync_pendiente") === "true") {
      SupabaseProgreso.syncProgressWithCloud().then(() => {
        if (typeof toast === "function") toast("✓ Progreso de caché sincronizado con Supabase");
      }).catch(() => {});
    }
  }
};

window.SupabaseAuth = SupabaseAuth;
window.cerrarSesion = SupabaseAuth.cerrarSesion;
window.purgarSesion = SupabaseAuth.purgarSesion;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => SupabaseAuth.init());
} else {
  SupabaseAuth.init();
}


// === assets/js/app/sesion/control.js ===
"use strict";

function countAnswered() {
  return state.order.reduce((acc, q) => acc + (state.answers[q.id] != null ? 1 : 0), 0);
}

function countCorrect() {
  return state.order.reduce((acc, q) => acc + (state.answers[q.id] === q.correcta ? 1 : 0), 0);
}

function filterPool(filter) {
  if (typeof filter === "object" && filter !== null) {
    let pool = state.questions;
    if (filter.tema && filter.tema !== "all") {
      pool = pool.filter((q) => Number(q.tema) === Number(filter.tema));
    }
    if (filter.subapartado && filter.subapartado !== "all") {
      pool = pool.filter((q) => {
        const ap = String(q.apartado || "");
        const tag = String(q.tag || "");
        const num = String(filter.subapartado);
        return ap === num || tag.includes(`.${num}`) || tag.includes(` ${num}`);
      });
    }
    if (filter.examen && filter.examen !== "all") {
      pool = pool.filter((q) => (q.examen || "Examen 1") === filter.examen);
    }
    if (filter.categoria && filter.categoria !== "all") {
      const catBusq = filter.categoria.toLowerCase();
      pool = pool.filter((q) => {
        const cat = String(q.categoria || q.tag || "").toLowerCase();
        return cat.includes(catBusq);
      });
    }
    const history = typeof getHistory === "function" ? getHistory() : {};
    const wrongSet = new Set(typeof getWrongIds === "function" ? getWrongIds() : []);
    if (filter.repaso === "faltan") {
      pool = pool.filter((q) => {
        const h = history[q.id];
        if (!h) return true;
        if (wrongSet.has(q.id)) return true;
        return !h.passed && (h.correct || 0) === 0;
      });
    } else if (filter.repaso === "nuevas") {
      pool = pool.filter((q) => !q.practicada && !history[q.id]);
    } else if (filter.repaso === "practicadas") {
      pool = pool.filter((q) => q.practicada || history[q.id] != null);
    } else if (filter.repaso === "con_errores") {
      pool = pool.filter((q) => wrongSet.has(q.id) || (history[q.id] && history[q.id].fails > 0));
    }
    return pool;
  }
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
  if (filter === "tema3") return state.questions.filter((q) => Number(q.tema) === 3);
  if (filter === "tema4") return state.questions.filter((q) => Number(q.tema) === 4);
  if (filter === "practicadas") {
    const history = typeof getHistory === "function" ? getHistory() : {};
    return state.questions.filter((q) => q.practicada || history[q.id] != null);
  }
  if (filter === "nuevas") {
    const history = typeof getHistory === "function" ? getHistory() : {};
    return state.questions.filter((q) => !q.practicada && !history[q.id]);
  }
  if (filter === "oficial" || filter === "oficiales") {
    return state.questions.filter((q) => String(q.categoria || q.tag || "").toLowerCase().includes("oficial"));
  }
  if (filter === "codigo") return state.questions.filter((q) => q.tipo === "codigo");
  if (filter === "teoria") return state.questions.filter((q) => q.tipo === "teoria");
  if (filter === "desarrollo") {
    return state.questions.filter((q) => q.tipo === "escribir_codigo" || q.tipo === "traza_linea" || q.tipo === "desarrollo");
  }
  if (filter === "escribir_codigo") {
    return state.questions.filter((q) => q.tipo === "escribir_codigo");
  }
  if (filter === "traza_linea") {
    return state.questions.filter((q) => q.tipo === "traza_linea");
  }
  if (filter === "fallos") {
    const wrong = new Set(typeof getWrongIds === "function" ? getWrongIds().map((id) => getQuestion(id)?.id || id) : []);
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
  let pool = ids ? ids.map((id) => getQuestion(id)).filter(Boolean) : filterPool(filter);
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
  const resolved = [];
  for (const id of session.ids) {
    let q = state.byId.get(id);
    if (!q && typeof id === "string" && !isNaN(id)) {
      q = state.byId.get(Number(id));
    }
    if (!q && typeof id === "number") {
      q = state.byId.get(String(id));
    }
    if (q) resolved.push(q);
  }
  if (!resolved.length) {
    clearSession();
    toast("La sesión guardada ya no es válida.");
    renderStart();
    return;
  }
  state.order = resolved;
  state.index = Math.min(Math.max(session.index || 0, 0), state.order.length - 1);
  state.answers = session.answers || {};

  if (session.aiEvaluations && typeof session.aiEvaluations === "object") {
    for (const q of state.order) {
      if (session.aiEvaluations[q.id]) {
        q.evaluacionIA = session.aiEvaluations[q.id].evaluacionIA;
        q.evaluacionMensajes = session.aiEvaluations[q.id].evaluacionMensajes || [];
      }
    }
  }

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

function startBloque(filterKey) {
  const allInFilter = filterPool(filterKey);
  if (!allInFilter.length) {
    toast("No hay preguntas en este apartado.");
    return;
  }
  const BLOCK_SIZE = 10;
  const currentPointer = getBloquePointer(filterKey);
  let nextPointer = currentPointer;
  if (nextPointer >= allInFilter.length) {
    nextPointer = 0;
  }
  const slice = allInFilter.slice(nextPointer, nextPointer + BLOCK_SIZE);
  saveBloquePointer(filterKey, nextPointer + slice.length);

  const immediate = typeof getSavedImmediate === "function" ? getSavedImmediate() : true;
  const shuffle = typeof getSavedShuffle === "function" ? getSavedShuffle() : true;
  startTest({
    filter: filterKey,
    ids: slice.map((q) => q.id),
    immediate,
    shuffle
  });
}


// === assets/js/app/sesion/arbol.js ===
"use strict";

const WEC_ESTRUCTURA_TEMAS = [
  {
    numero: 1,
    nombre: "Tema 1 · Selección de arquitecturas y de herramientas de programación",
    apartados: [
      { numero: 1, nombre: "1.1 Modelos de ejecución de código e Introducción" },
      { numero: 2, nombre: "1.2 Lenguajes en entorno cliente" },
      { numero: 3, nombre: "1.3 Mecanismos de ejecución en un navegador" },
      { numero: 4, nombre: "1.4 Capacidades y limitaciones de ejecución" },
      { numero: 5, nombre: "1.5 Programación de scripts" },
      { numero: 6, nombre: "1.6 Integración del código con las etiquetas HTML" },
      { numero: 7, nombre: "1.7 Herramientas de programación sobre clientes web" },
      { numero: 8, nombre: "Demos D1-D5 y práctica P00" },
    ],
  },
  {
    numero: 2,
    nombre: "Tema 2 · Aplicación y verificación de la sintaxis del lenguaje",
    apartados: [
      { numero: 1, nombre: "2.1 Selección de lenguaje de programación de clientes web" },
      { numero: 2, nombre: "2.2 Tipos de datos" },
      { numero: 3, nombre: "2.3 Variables" },
      { numero: 4, nombre: "2.4 Asignaciones" },
      { numero: 5, nombre: "2.5 Operadores" },
      { numero: 6, nombre: "2.6 Sentencias" },
      { numero: 7, nombre: "2.7 Estructuras de control" },
      { numero: 8, nombre: "2.8 Comentarios en el código" },
      { numero: 9, nombre: "2.9 Herramientas para programar, probar y depurar el código" },
      { numero: 10, nombre: "Demos D1-D5 y prácticas P01 y P02" },
    ],
  },
  {
    numero: 3,
    nombre: "Tema 3 · Fundamentos de JavaScript",
    apartados: [
      { numero: 1, nombre: "3.1 Variables y tipos de datos" },
      { numero: 2, nombre: "3.2 Conversiones y comparaciones" },
      { numero: 3, nombre: "3.3 Decisiones" },
      { numero: 4, nombre: "3.4 Bucles" },
      { numero: 5, nombre: "3.5 Depurar" },
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
  if (filter === "codigo") return "Solo código de examen";
  if (filter === "teoria") return "Solo teoría";
  if (filter === "desarrollo") return "Retos de desarrollo y funciones (Corrección IA)";
  if (filter === "escribir_codigo") return "Escribir funciones complejas para un 10";
  if (filter === "traza_linea") return "Traza línea a línea (Event Loop)";
  if (filter === "fallos") return "Repaso de fallos";
  return filter;
}

function construirArbolDashboardHTML() {
  const currentSubject = state.subject?.nombre || "WEC";
  const isWec = currentSubject.toUpperCase().includes("WEC");
  const apuntesEntry = (state.apuntesCatalogo || []).find(
    (a) => a.nombre.toLowerCase() === currentSubject.toLowerCase(),
  );
  const history = typeof getHistory === "function" ? getHistory() : {};

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

      let apartados = Array.isArray(t.apartados) ? [...t.apartados] : [];
      const apsFromQuestions = new Map();
      preguntasTema.forEach((q) => {
        const res = resolveApartadoForQuestion(q);
        const apNum = Number(res.apartado || q.apartado || 0);
        if (apNum > 0 && !apsFromQuestions.has(apNum)) {
          apsFromQuestions.set(apNum, q.apartadoNombre || res.titulo || `Apartado ${t.numero}.${apNum}`);
        }
      });
      for (const [apNum, apNombre] of apsFromQuestions.entries()) {
        if (!apartados.some((a) => Number(a.numero) === apNum)) {
          apartados.push({ numero: apNum, nombre: apNombre });
        }
      }
      apartados.sort((a, b) => Number(a.numero) - Number(b.numero));

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


// === assets/js/app/sesion/modalidades.js ===
"use strict";

// ============================================================
// MODAL POPUP: CREAR SESIÓN DE TEST · MODALIDADES DE PRÁCTICA
// ============================================================

function renderModalidadesPractica() {
  const modalBody = document.getElementById("modal-modalidades-body");
  if (!modalBody) return;
  const counts = typeof dataCounts === "function" ? dataCounts() : { total: 0, temas: [] };
  const history = typeof getHistory === "function" ? getHistory() : {};
  const isShuffleSaved = typeof getSavedShuffle === "function" ? getSavedShuffle() : true;

  const themeButtons = counts.temas.map(({ tema, count }) => {
    const preguntasTema = state.questions.filter((q) => Number(q.tema) === Number(tema));
    const respondidasTema = preguntasTema.filter((q) => history[q.id]?.selected != null).length;
    const pctTema = count ? Math.round((respondidasTema / count) * 100) : 0;
    return `
      <button class="btn btn-tema-progreso" type="button" data-start-modal="tema:${tema}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px;">
        <span style="display:flex; align-items:center; gap:8px;">
          <span>Tema ${tema}</span>
          <span class="pct-pill" style="font-size:11px; font-weight:700; background:rgba(255,255,255,0.12); padding:2px 7px; border-radius:10px; color:var(--text);">${pctTema}% completado</span>
        </span>
        <span class="count">${count}</span>
      </button>
    `;
  }).join("");

  modalBody.innerHTML = `
    <!-- 1. Configurador a medida -->
    <div class="practice-custom-panel" style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:18px;">
      <div style="font-weight:700; font-size:14px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--brand);"></i> Configurar sesión a medida
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:16px;">
        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Agrupación / Examen</label>
          <select class="control" id="custom-practice-exam" style="width:100%;">
            <option value="Examen 1" selected>Examen 1 (Temas 1–4 · ${counts.total} preguntas)</option>
            <option value="Examen 2">Examen 2 (Próximo / En preparación)</option>
            <option value="all">Todos los exámenes</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Tema / Alcance</label>
          <select class="control" id="custom-practice-theme" style="width:100%;">
            <option value="all">Todos los temas (${counts.total})</option>
            ${counts.temas.map(t => `<option value="${t.tema}">Tema ${t.tema} (${t.count} preguntas)</option>`).join("")}
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Subapartado</label>
          <select class="control" id="custom-practice-subapartado" style="width:100%;">
            <option value="all">Todos los subapartados</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Tipo de repaso</label>
          <select class="control" id="custom-practice-review" style="width:100%;">
            <option value="faltan" selected>★ Las que me faltan (pendientes de acertar)</option>
            <option value="todas">Todas las disponibles (${counts.total})</option>
            <option value="con_errores">Con algún error / fallo (${counts.fallos})</option>
            <option value="practicadas">Solo practicadas (${counts.practicadas || counts.total})</option>
            <option value="nuevas">Nunca practicadas</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Categoría</label>
          <select class="control" id="custom-practice-category" style="width:100%;">
            <option value="all">Todas las categorías</option>
            <option value="oficial">★ Oficiales de examen (${counts.oficiales || Math.min(33, counts.total)})</option>
            <option value="introduccion">📘 Introducción (${counts.introduccion || Math.round(counts.total * 0.35)})</option>
            <option value="entrenamiento">⚡ Práctica / Entrenamiento (${counts.entrenamiento || Math.round(counts.total * 0.65)})</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Número de preguntas</label>
          <select class="control" id="custom-practice-qty" style="width:100%;">
            <option value="10">10 preguntas</option>
            <option value="20">20 preguntas</option>
            <option value="30">30 preguntas</option>
            <option value="40" selected>40 preguntas (Recomendado)</option>
            <option value="50">50 preguntas</option>
            <option value="100">100 preguntas</option>
            <option value="200">200 preguntas</option>
            <option value="0">Todas las que coincidan (${counts.total})</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Orden</label>
          <select class="control" id="custom-practice-order" style="width:100%;">
            <option value="aleatorio" ${isShuffleSaved ? "selected" : ""}>Aleatorio</option>
            <option value="original" ${!isShuffleSaved ? "selected" : ""}>Orden original</option>
          </select>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; border-top:1px solid var(--line); padding-top:14px;">
        <div id="custom-practice-info" style="font-size:13px; color:var(--muted); display:flex; align-items:center; gap:8px;">
          <i class="fa-solid fa-circle-check" style="color:var(--ok);"></i>
          <span>Listo para comenzar tu sesión adaptada.</span>
        </div>
        <button class="btn primary large" type="button" id="custom-practice-start-btn" style="padding:10px 24px; font-weight:700; gap:8px;">
          <i class="fa-solid fa-play"></i> Comenzar sesión personalizada
        </button>
      </div>
    </div>

    <!-- 2. Accesos rápidos directos -->
    <div>
      <h4 style="font-size:14px; margin:0 0 10px; font-weight:700; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-bolt" style="color:#f59e0b;"></i> Accesos rápidos directos
      </h4>
      <div class="practice-modes-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px;">
        <button class="btn primary" type="button" data-start-modal="all" style="justify-content:space-between; padding:12px 14px;">
          <span><i class="fa-solid fa-layer-group"></i> Todas las preguntas</span>
          <span class="count">${counts.total}</span>
        </button>
        <button class="btn" type="button" data-start-modal="practicadas" style="justify-content:space-between; padding:12px 14px; border-color:var(--brand); color:var(--brand);">
          <span><i class="fa-solid fa-clock-rotate-left"></i> Solo Practicadas</span>
          <span class="count" style="background:var(--brand-soft); color:var(--brand);">${counts.practicadas || counts.total}</span>
        </button>
        <button class="btn" type="button" data-start-modal="oficial" style="justify-content:space-between; padding:12px 14px; border-color:#f59e0b; color:#f59e0b;">
          <span><i class="fa-solid fa-star"></i> Oficiales de examen</span>
          <span class="count" style="background:rgba(245,158,11,0.18); color:#f59e0b;">${counts.oficiales || Math.min(33, counts.total)}</span>
        </button>
        <button class="btn ok" type="button" data-start="mastery" data-start-modal="mastery" style="justify-content:space-between; padding:12px 14px;">
          <span><i class="fa-solid fa-award"></i> Refuerzo sin fallos</span>
          <span class="count">${counts.total}</span>
        </button>
        ${(counts.desarrollo || 0) > 0 ? `
          <button class="btn" type="button" data-start-modal="desarrollo" style="justify-content:space-between; padding:12px 14px; border-color:#38bdf8; color:#38bdf8; grid-column: 1 / -1; background:rgba(56,189,248,0.08);">
            <span><i class="fa-solid fa-graduation-cap"></i> ✍️ Retos de Desarrollo y Código Abierto</span>
            <span class="count" style="background:#0284c7; color:#fff;">${counts.desarrollo} retos</span>
          </button>
        ` : ""}
      </div>
      <div style="font-size:12px; color:var(--muted); background:var(--card2); border:1px solid var(--line); border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-circle-info" style="color:var(--brand);"></i>
        <span>Las <strong>${counts.total} preguntas</strong> son de tipo test oficial con corrección instantánea. La corrección de preguntas abiertas de desarrollo requiere tener Ollama local activo en Docker.</span>
      </div>
    </div>

    <!-- 3. Práctica por Tema individual -->
    <div>
      <h4 style="font-size:14px; margin:0 0 10px; font-weight:700; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-list-ol" style="color:var(--brand);"></i> Práctica por Tema individual
      </h4>
      <div class="start-actions" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px;">
        ${themeButtons}
      </div>
    </div>
  `;

  // Dynamic subapartados
  const themeSelect = $("#custom-practice-theme");
  const subapSelect = $("#custom-practice-subapartado");
  function actualizarSubapartados() {
    if (!subapSelect) return;
    const tVal = themeSelect?.value || "all";
    subapSelect.innerHTML = '<option value="all">Todos los subapartados</option>';
    let questionsPool = state.questions;
    if (tVal !== "all") {
      questionsPool = questionsPool.filter((q) => Number(q.tema) === Number(tVal));
    }
    const apartadosEncontrados = new Map();
    questionsPool.forEach((q) => {
      const apNum = q.apartado != null ? q.apartado : 1;
      if (!apartadosEncontrados.has(apNum)) {
        apartadosEncontrados.set(apNum, q.apartadoNombre || `Apartado ${apNum}`);
      }
    });
    const sortedAps = [...apartadosEncontrados.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    sortedAps.forEach(([num, nombre]) => {
      const opt = document.createElement("option");
      opt.value = num;
      opt.textContent = `${tVal !== "all" ? `${tVal}.${num}` : `Apartado ${num}`} · ${nombre}`;
      subapSelect.appendChild(opt);
    });
  }
  themeSelect?.addEventListener("change", actualizarSubapartados);
  actualizarSubapartados();

  // Guardar opción de orden en localStorage y sincronizar con #shuffle-toggle
  const orderSelect = $("#custom-practice-order");
  orderSelect?.addEventListener("change", (e) => {
    const isShuffle = e.target.value === "aleatorio";
    localStorage.setItem("preparar_tests_barajar_orden", isShuffle ? "true" : "false");
    const shuffleToggle = $("#shuffle-toggle");
    if (shuffleToggle) shuffleToggle.checked = isShuffle;
  });

  // Botón comenzar personalizado
  $("#custom-practice-start-btn")?.addEventListener("click", () => {
    const examen = $("#custom-practice-exam")?.value || "Examen 1";
    const tema = $("#custom-practice-theme")?.value || "all";
    const subapartado = $("#custom-practice-subapartado")?.value || "all";
    const repaso = $("#custom-practice-review")?.value || "faltan";
    const categoria = $("#custom-practice-category")?.value || "all";
    const qty = Number($("#custom-practice-qty")?.value) || 0;
    const order = $("#custom-practice-order")?.value || "aleatorio";

    const customFilter = { examen, tema, subapartado, repaso, categoria };
    const pool = filterPool(customFilter);
    if (!pool.length) {
      toast("No hay preguntas que coincidan con esa selección.");
      return;
    }

    const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
    const shuffle = order === "aleatorio";
    cerrarModalModalidades();
    startTest({ filter: customFilter, immediate, shuffle, sample: qty });
  });

  // Botones de inicio rápido en el modal
  $$("[data-start-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.startModal;
      cerrarModalModalidades();
      if (filter === "mastery") {
        startTest({ mastery: true, immediate: true, shuffle: typeof getSavedShuffle === "function" ? getSavedShuffle() : true });
        return;
      }
      if (filter === "desarrollo") {
        if (typeof iniciarExamenDesarrollo === "function") iniciarExamenDesarrollo();
        return;
      }
      const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
      const shuffle = $("#shuffle-toggle") ? $("#shuffle-toggle").checked : (typeof getSavedShuffle === "function" ? getSavedShuffle() : true);
      startTest({ filter, immediate, shuffle });
    });
  });
}

function abrirModalModalidades() {
  const modal = document.getElementById("modal-modalidades-practica");
  if (!modal) return;
  renderModalidadesPractica();
  modal.classList.remove("hidden");
}

function cerrarModalModalidades() {
  const modal = document.getElementById("modal-modalidades-practica");
  if (modal) modal.classList.add("hidden");
}


// === assets/js/app/sesion/desarrollo.js ===
"use strict";

// ============================================================
// ANÁLISIS DE SUBAPARTADOS DÉBILES Y RETOS DE DESARROLLO
// ============================================================

function renderWeakConceptsGrouped() {
  const weakContainer = $("#weak-concepts");
  if (!weakContainer) return;

  const weakGroups = typeof getWeakSubapartadosByTema === "function" ? getWeakSubapartadosByTema() : [];
  if (!weakGroups.length) {
    weakContainer.innerHTML = '<p class="muted" style="font-size:13px; padding:12px 0;">Aún no hay fallos suficientes para calcular subapartados débiles. En cuanto falles preguntas, aparecerán aquí agrupados por tema con sus porcentajes de error.</p>';
    return;
  }

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
    $$(".weak-tema-details").forEach((d) => (d.open = true));
  });
  $("#weak-plegar-todos")?.addEventListener("click", () => {
    $$(".weak-tema-details").forEach((d) => (d.open = false));
  });

  $$("[data-repasar-fallos-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = (btn.dataset.repasarFallosSub || "").split(",").map((s) => s.trim()).filter(Boolean);
      const ids = raw.map((id) => getQuestion(id)?.id || id).filter((id) => hasQuestion(id));
      if (ids.length) {
        const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
        startTest({ ids, immediate, shuffle: true });
      }
    });
  });

  $$("[data-start-apartado]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filter = "apartado:" + btn.dataset.startApartado;
      const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
      const shuffle = $("#shuffle-toggle") ? $("#shuffle-toggle").checked : (typeof getSavedShuffle === "function" ? getSavedShuffle() : true);
      startTest({ filter, immediate, shuffle });
    });
  });

  $$("[data-start-bloque]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filterKey = btn.dataset.startBloque;
      startBloque(filterKey);
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
}


// === assets/js/app/sesion/topbar.js ===
"use strict";

// ============================================================
// COMPONENTES Y CONTROLADORES DE LA BARRA SUPERIOR (TOPBAR)
// Y MODAL DE GESTIÓN DE ASIGNATURAS Y TESTS
// ============================================================

function inicializarTopbar() {
  const ramasConTests = new Set();
  if (Array.isArray(state.catalog)) {
    state.catalog.forEach((s) => {
      if (s.grado && (s.archivo || s.localData)) {
        ramasConTests.add(s.grado);
      }
    });
  }
  if (!ramasConTests.size) {
    ramasConTests.add("Segundo_grado_medio");
  }

  const nombresRamas = {
    "Segundo_grado_medio": "Segundo grado medio",
    "Primer_grado_medio": "Primer grado medio",
    "Primer_grado_superior_DAW": "Primer grado superior DAW",
  };

  // 1. Selector de Rama en Topbar con Popover en el icono
  const branchSelect = document.getElementById("navbar-branch-select");
  const btnToggleBranch = document.getElementById("btn-toggle-branch");
  const branchPopover = document.getElementById("branch-dropdown-popover");

  if (btnToggleBranch && branchPopover && !btnToggleBranch.dataset.attached) {
    btnToggleBranch.dataset.attached = "true";
    btnToggleBranch.addEventListener("click", (e) => {
      e.stopPropagation();
      branchPopover.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (!branchPopover.contains(e.target) && !btnToggleBranch.contains(e.target)) {
        branchPopover.classList.add("hidden");
      }
    });
  }

  if (branchSelect) {
    let htmlRamas = "";
    for (const [clave, label] of Object.entries(nombresRamas)) {
      if (ramasConTests.has(clave)) {
        htmlRamas += `<option value="${clave}">${label}</option>`;
      }
    }
    if (ramasConTests.size > 1) {
      htmlRamas += `<option value="todas">Todas las ramas</option>`;
    }
    branchSelect.innerHTML = htmlRamas || `<option value="Segundo_grado_medio">Segundo grado medio</option>`;

    let branchSelected = state.ramaActual || localStorage.getItem("rama_actual") || "";
    if (!ramasConTests.has(branchSelected) && branchSelected !== "todas") {
      branchSelected = [...ramasConTests][0] || "Segundo_grado_medio";
      state.ramaActual = branchSelected;
      try { localStorage.setItem("rama_actual", branchSelected); } catch (_) {}
    }
    branchSelect.value = branchSelected;

    if (!branchSelect.dataset.attached) {
      branchSelect.dataset.attached = "true";
      branchSelect.addEventListener("change", async (e) => {
        const val = e.target.value;
        branchPopover?.classList.add("hidden");
        state.ramaActual = val;
        try { localStorage.setItem("rama_actual", val); } catch (_) {}
        const matching = state.catalog.filter(s => val === "todas" || s.grado === val || (!s.grado && val === "Segundo_grado_medio"));
        if (matching.length && (!state.subject || (state.subject.grado !== val && val !== "todas"))) {
          await loadSubject(matching[0].id);
        }
        renderStart();
        const nombreRama = nombresRamas[val] || "Todas las ramas";
        toast(`Grado activo: ${nombreRama}`);
      });
    }
  }

  // 2. Selector de asignaturas en la barra superior (topbar)
  const navbarSubjectSelect = document.getElementById("navbar-subject-select");
  if (navbarSubjectSelect) {
    const branchSelected = state.ramaActual || localStorage.getItem("rama_actual") || "Segundo_grado_medio";
    const matchingSubjects = state.catalog.filter(s => {
      if (branchSelected === "todas" || branchSelected === "TODAS LAS RAMAS") return true;
      return s.grado === branchSelected || (!s.grado && branchSelected === "Segundo_grado_medio");
    });
    const listToRender = matchingSubjects.length ? matchingSubjects : state.catalog;
    navbarSubjectSelect.innerHTML = listToRender.map(s => {
      const label = s.etiqueta || s.nombre;
      return `<option value="${esc(s.id)}" ${s.id === state.subjectId ? "selected" : ""}>${esc(label)}</option>`;
    }).join("");

    if (!navbarSubjectSelect.dataset.attached) {
      navbarSubjectSelect.dataset.attached = "true";
      navbarSubjectSelect.addEventListener("change", async (e) => {
        const id = e.target.value;
        const seleccion = state.catalog.find(s => s.id === id);
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
    }
  }

  // 3. Botón para abrir el Modal de Modalidades de práctica desde la navbar
  const btnNavbarModalidades = document.getElementById("btn-navbar-modalidades");
  if (btnNavbarModalidades && !btnNavbarModalidades.dataset.attached) {
    btnNavbarModalidades.dataset.attached = "true";
    btnNavbarModalidades.addEventListener("click", () => {
      abrirModalModalidades();
    });
  }

  const btnCerrarModalidades = document.getElementById("btn-cerrar-modal-modalidades");
  const modalModalidades = document.getElementById("modal-modalidades-practica");
  if (btnCerrarModalidades && modalModalidades && !btnCerrarModalidades.dataset.attached) {
    btnCerrarModalidades.dataset.attached = "true";
    btnCerrarModalidades.addEventListener("click", () => cerrarModalModalidades());
    modalModalidades.addEventListener("click", (e) => {
      if (e.target === modalModalidades) cerrarModalModalidades();
    });
  }

  // 4. Botón de tests desde apuntes en la navbar
  const btnNavbarApuntes = document.getElementById("btn-navbar-apuntes");
  if (btnNavbarApuntes && !btnNavbarApuntes.dataset.attached) {
    btnNavbarApuntes.dataset.attached = "true";
    btnNavbarApuntes.addEventListener("click", () => {
      const asig = state.subject?.nombre || state.subject?.id || "";
      window.abrirPracticaDesdeApuntes?.(asig);
    });
  }

  // 5. Opciones de práctica y sincronización de caché (Barajar y Corrección inmediata)
  const shuffleToggle = $("#shuffle-toggle");
  if (shuffleToggle) {
    shuffleToggle.checked = typeof getSavedShuffle === "function" ? getSavedShuffle() : true;
    if (!shuffleToggle.dataset.attached) {
      shuffleToggle.dataset.attached = "true";
      shuffleToggle.addEventListener("change", (e) => {
        localStorage.setItem("preparar_tests_barajar_orden", e.target.checked ? "true" : "false");
        const orderEl = $("#custom-practice-order");
        if (orderEl) orderEl.value = e.target.checked ? "aleatorio" : "original";
      });
    }
  }

  const immToggle = $("#immediate-toggle");
  if (immToggle) {
    immToggle.checked = typeof getSavedImmediate === "function" ? getSavedImmediate() : true;
    if (!immToggle.dataset.attached) {
      immToggle.dataset.attached = "true";
      immToggle.addEventListener("change", (e) => {
        localStorage.setItem("preparar_tests_correccion_inmediata", e.target.checked ? "true" : "false");
      });
    }
  }

  // 5.b Token de NVIDIA NIM
  const inputNvidia = document.getElementById("input-nvidia-token");
  const btnGuardarNvidia = document.getElementById("btn-guardar-nvidia-token");
  if (inputNvidia) {
    inputNvidia.value = localStorage.getItem("preparar_tests_nvidia_key") || "";
  }
  if (btnGuardarNvidia && !btnGuardarNvidia.dataset.attached) {
    btnGuardarNvidia.dataset.attached = "true";
    btnGuardarNvidia.addEventListener("click", () => {
      const val = (inputNvidia?.value || "").trim();
      localStorage.setItem("preparar_tests_nvidia_key", val);
      toast(val ? "✓ Token NVIDIA guardado" : "Token NVIDIA eliminado");
    });
  }

  // 6. Modal Gestionar Asignaturas y Tests
  const modal = document.getElementById("modal-gestionar-asignaturas");
  const btnAbrir = document.getElementById("btn-gestionar-asignaturas");
  const btnCerrar = document.getElementById("btn-cerrar-modal-gestionar");
  const tabCrear = document.getElementById("tab-crear-asig");
  const tabSubir = document.getElementById("tab-subir-tests");
  const panelCrear = document.getElementById("panel-crear-asig");
  const panelSubir = document.getElementById("panel-subir-tests");

  if (btnAbrir && modal && !btnAbrir.dataset.attached) {
    btnAbrir.dataset.attached = "true";
    btnAbrir.addEventListener("click", () => {
      modal.classList.remove("hidden");
    });
    btnCerrar?.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    tabCrear?.addEventListener("click", () => {
      panelCrear?.classList.remove("hidden");
      panelSubir?.classList.add("hidden");
      tabCrear.style.color = "var(--brand)";
      tabCrear.style.borderBottom = "2px solid var(--brand)";
      tabSubir.style.color = "var(--muted)";
      tabSubir.style.borderBottom = "2px solid transparent";
    });

    tabSubir?.addEventListener("click", () => {
      panelSubir?.classList.remove("hidden");
      panelCrear?.classList.add("hidden");
      tabSubir.style.color = "var(--brand)";
      tabSubir.style.borderBottom = "2px solid var(--brand)";
      tabCrear.style.color = "var(--muted)";
      tabCrear.style.borderBottom = "2px solid transparent";
    });

    // Guardar Asignatura
    const btnGuardarAsig = document.getElementById("btn-guardar-asig");
    btnGuardarAsig?.addEventListener("click", async () => {
      const nombre = document.getElementById("input-asig-nombre")?.value.trim();
      const grado = document.getElementById("input-asig-grado")?.value;
      if (!nombre) {
        toast("Escribe el nombre de la asignatura");
        return;
      }
      btnGuardarAsig.disabled = true;
      btnGuardarAsig.textContent = "Creando…";
      const id = slugify(nombre);
      const nuevaAsig = {
        id,
        nombre,
        grado: grado || "General",
        descripcion: "Asignatura personalizada creada por el usuario",
        temas: [
          { numero: 1, nombre: "Tema 1", preguntas: 0 },
          { numero: 2, nombre: "Tema 2", preguntas: 0 }
        ],
        localData: {
          preguntas: [],
          stats: { total: 0, respondidas: 0, aciertos: 0 }
        }
      };

      try {
        const resp = await fetch("/api/asignaturas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre, grado })
        });
        const res = await resp.json().catch(() => null);
        if (resp.ok && res?.ok) {
          toast(`✓ Asignatura "${res.asignatura?.nombre || nombre}" creada.`);
        } else {
          toast(`✓ Asignatura "${nombre}" guardada.`);
        }
      } catch {
        toast(`✓ Asignatura "${nombre}" guardada localmente.`);
      }

      // Guardar siempre en localStorage para que esté disponible offline / Pages
      try {
        const custom = JSON.parse(localStorage.getItem("preparar_tests_custom_subjects") || "[]");
        if (!custom.some((s) => s.id === id)) {
          custom.push(nuevaAsig);
          localStorage.setItem("preparar_tests_custom_subjects", JSON.stringify(custom));
        }
      } catch {}

      modal.classList.add("hidden");
      await loadCatalog();
      await loadSubject(id);
      renderStart();
      btnGuardarAsig.disabled = false;
      btnGuardarAsig.textContent = "Crear y Guardar Asignatura";
    });

    // Subir Test JSON
    const btnSubirTest = document.getElementById("btn-subir-test");
    btnSubirTest?.addEventListener("click", async () => {
      const asigId = document.getElementById("select-subir-asig")?.value;
      const fileInput = document.getElementById("input-subir-archivo");
      const archivo = fileInput?.files?.[0];
      if (!archivo) {
        toast("Selecciona un archivo JSON");
        return;
      }
      btnSubirTest.disabled = true;
      btnSubirTest.textContent = "Subiendo…";
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const json = JSON.parse(reader.result);
            const resp = await fetch("/api/tests/subir", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ asignaturaId: asigId, nombreArchivo: archivo.name, contenido: json })
            });
            const res = await resp.json();
            if (resp.ok && res.ok) {
              toast(`✓ Test añadido (${res.totalPreguntas} preguntas)`);
              modal.classList.add("hidden");
              await loadCatalog();
              await loadSubject(asigId);
              renderStart();
            } else {
              toast(`Error: ${res.error || "Fallo al subir"}`);
            }
          } catch (pe) {
            toast(`El archivo no es un JSON válido: ${pe.message}`);
          } finally {
            btnSubirTest.disabled = false;
            btnSubirTest.textContent = "Subir y Guardar Test";
          }
        };
        reader.readAsText(archivo);
      } catch (err) {
        toast(`Error: ${err.message}`);
        btnSubirTest.disabled = false;
        btnSubirTest.textContent = "Subir y Guardar Test";
      }
    });
  }
}


// === assets/js/app/sesion/inicio.js ===
"use strict";

// ============================================================
// PANTALLA PRINCIPAL (INICIO / DASHBOARD)
// ============================================================

function applyDynamicHeader() {
  const counts = typeof dataCounts === "function" ? dataCounts() : { total: 0 };
  const meta = state.meta || {};
  const name = state.subject?.nombre || meta.titulo || "Test";
  document.title = `${name} · ${counts.total} preguntas`;
  const logo = $("#brand-logo");
  if (logo) logo.textContent = "PT";
  const title = $("#brand-title");
  if (title) title.textContent = "Tests";
  const sub = $("#brand-sub");
  if (sub) {
    sub.textContent = "";
    sub.style.display = "none";
  }
}

function renderStart() {
  state.screen = "start";
  if (typeof setModeChip === "function") setModeChip("");
  applyDynamicHeader();

  const stats = typeof getStats === "function" ? getStats() : { bestPct: 0, lastPct: 0 };
  const counts = typeof dataCounts === "function" ? dataCounts() : { total: 0, temas: [], teoria: 0, codigo: 0, fallos: 0 };
  const session = typeof getSession === "function" ? getSession() : null;
  const canResume = session && !session.finished && Array.isArray(session.ids) && session.ids.length;
  const canSeeLast = session && session.finished && Array.isArray(session.ids) && session.ids.length;
  const meta = state.meta || {};
  const best = Number(stats.bestPct || 0);
  const last = Number(stats.lastPct || 0);

  const themeSummary = counts.temas.map(({ tema, count }) => `Tema ${tema}: ${count}`).join(" · ");
  const branchSelected = state.ramaActual || localStorage.getItem("rama_actual") || "Segundo_grado_medio";
  const filteredCatalog = state.catalog.filter((s) => {
    if (!branchSelected || branchSelected === "todas" || branchSelected === "TODAS LAS RAMAS") return true;
    return s.grado === branchSelected || (!s.grado && branchSelected === "Segundo_grado_medio");
  });
  const catalogToUse = filteredCatalog.length ? filteredCatalog : state.catalog;
  const subjectOptions = catalogToUse.map((s) => {
    const suffix = s.localData ? ` (local) · ${s.localData.preguntas.length} preguntas` : "";
    const label = s.etiqueta || s.nombre;
    return `<option value="${esc(s.id)}" ${s.id === state.subjectId ? "selected" : ""}>${esc(label)}${suffix}</option>`;
  }).join("");

  main.innerHTML = `
    <section class="home">
      <header class="home-hero">
        <div class="home-hero-copy">
          <span class="hero-kicker">${esc(meta.titulo || state.subject?.nombre || "Test interactivo")}</span>
          <h1>${counts.total} preguntas disponibles</h1>
          <p>${themeSummary || "Sin temas"} · ${counts.teoria} de teoría · ${counts.codigo} de código.</p>
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:16px;">
            <button class="btn primary large" id="btn-hero-modalidades" type="button" style="display:inline-flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-sliders"></i>
              <span>Crear sesión de test · Modalidades de práctica</span>
            </button>
            <button class="btn ok large" type="button" data-start="all" style="display:inline-flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-bolt"></i>
              <span>Todas las preguntas (${counts.total})</span>
            </button>
          </div>
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

  // Botón Hero para abrir Modalidades de práctica
  $("#btn-hero-modalidades")?.addEventListener("click", () => {
    abrirModalModalidades();
  });

  // Botones start directos
  $$("[data-start]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.start || "all";
      if (filter === "mastery") {
        startTest({ filter: "all", immediate: true, shuffle: true, mastery: true });
        return;
      }
      const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
      const shuffle = $("#shuffle-toggle") ? $("#shuffle-toggle").checked : (typeof getSavedShuffle === "function" ? getSavedShuffle() : true);
      if (filter === "fallos" && !(typeof getWrongIds === "function" && getWrongIds().length)) {
        toast("Todavía no tienes fallos guardados.");
        return;
      }
      startTest({ filter, immediate, shuffle });
    });
  });

  // Tree desplegar / plegar
  $("#tree-desplegar-todos")?.addEventListener("click", () => {
    $$(".tree-tema-details").forEach((d) => (d.open = true));
  });
  $("#tree-plegar-todos")?.addEventListener("click", () => {
    $$(".tree-tema-details").forEach((d) => (d.open = false));
  });

  // Reanudar / reiniciar test a medias
  $("#resume-btn")?.addEventListener("click", () => resumeSession());
  $("#restart-btn")?.addEventListener("click", () => {
    const s = getSession();
    if (!s) return;
    const filter = s.filter || "all";
    clearSession();
    const immediate = typeof getSavedImmediate === "function" ? getSavedImmediate() : true;
    const shuffle = typeof getSavedShuffle === "function" ? getSavedShuffle() : true;
    startTest({ filter, immediate, shuffle });
  });
  $("#discard-btn")?.addEventListener("click", discardSession);
  $("#last-results-btn")?.addEventListener("click", () => {
    if (typeof renderResults === "function") renderResults();
  });

  // Toolbar asignatura select
  const subjSelect = $("#subject-select");
  subjSelect?.addEventListener("change", async (e) => {
    const id = e.target.value;
    const seleccion = state.catalog.find((s) => s.id === id);
    if (seleccion?.apuntesPrivados) {
      window.abrirPracticaDesdeApuntes?.(seleccion.nombreApuntes);
      return;
    }
    await loadSubject(id);
    renderStart();
  });

  $("#add-subject")?.addEventListener("click", () => $("#add-subject-file")?.click());
  $("#add-subject-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importSubjectFile(file);
    e.target.value = "";
  });
  $("#remove-subject")?.addEventListener("click", () => {
    if (state.subject?.id) removeCustomSubject(state.subject.id);
  });
  $("#open-notes-practice")?.addEventListener("click", () => {
    window.abrirPracticaDesdeApuntes?.();
  });

  // Subapartados donde más fallas
  if (typeof renderWeakConceptsGrouped === "function") {
    renderWeakConceptsGrouped();
  }

  // Inicializar listeners de la barra superior
  if (typeof inicializarTopbar === "function") {
    inicializarTopbar();
  }

  updateFooter();
}

function updateFooter() {
  const footer = $("#footer");
  if (!footer) return;
  const counts = typeof dataCounts === "function" ? dataCounts() : { total: 0, temas: [] };
  const source = state.source === "json"
    ? "Datos cargados desde el banco de preguntas."
    : "Preguntas locales guardadas en el navegador.";
  footer.innerHTML = `${esc(state.meta?.titulo || "Test")} · ${counts.total} preguntas · ${(counts.temas || []).map(({ tema, count }) => `Tema ${tema}: ${count}`).join(" · ")}. ${source}`;
  footer.style.display = "";
}

window.updateFooter = updateFooter;


// === assets/js/app/sesion.js ===
"use strict";

// ============================================================
// FACHADA UNIFICADA DE SESIÓN Y VISTAS
// Los módulos especializados residen en public/assets/js/app/sesion/
// - control.js: inicio y reanudación de sesiones de práctica
// - arbol.js: estructura y dashboard interactivo de temas
// - modalidades.js: configurador popup de tests a medida
// - inicio.js: pantalla principal y estadísticas
// - topbar.js: controladores de barra superior y gestión de asignaturas
// - desarrollo.js: subapartados débiles y retos de desarrollo
// ============================================================

window.renderizarInicioTests = renderStart;
window.updateFooter = updateFooter;


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

function generarTrazaFallback(q) {
  if (!q) return [];
  if (Array.isArray(q.traza) && q.traza.length) return q.traza;
  if (!q.codigo) return [];

  const lineas = String(q.codigo).replace(/\r/g, "").split("\n");
  const traza = [];

  lineas.forEach((lineaTexto, idx) => {
    const numLinea = idx + 1;
    const trim = lineaTexto.trim();
    if (!trim) return;

    let nota = `Línea ${numLinea}: ${trim}`;
    let salida = null;

    const matchLog = trim.match(/console\.log\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (matchLog && !trim.includes("setTimeout") && !trim.includes(".then")) {
      salida = matchLog[1];
      nota = `Ejecución síncrona: imprime "${salida}"`;
    } else if (trim.includes("setTimeout")) {
      nota = "Temporizador / Macrotarea: encola callback en la cola de macrotareas.";
    } else if (trim.includes("Promise") || trim.includes(".then")) {
      nota = "Promesa / Microtarea: encola callback en la cola de microtareas (alta prioridad).";
    }

    traza.push({
      linea: numLinea,
      nota,
      salida,
      vars: {}
    });
  });

  if (/microtarea|macrotarea|event loop|asincron/i.test((q.explicacion || "") + " " + (q.tag || ""))) {
    traza.push({
      linea: lineas.length,
      nota: "Event Loop (Fase Microtareas): procesa promesas resueltas de la cola de microtareas.",
      salida: null,
      vars: { "Fase Event Loop": "Microtareas" }
    });
    traza.push({
      linea: lineas.length,
      nota: "Event Loop (Fase Macrotareas): ejecuta los temporizadores encolados (setTimeout).",
      salida: null,
      vars: { "Fase Event Loop": "Macrotareas" }
    });
  }

  return traza.length ? traza : [{ linea: 1, nota: "Inicio de ejecución", vars: {} }];
}

function renderDebugView(container, q, selected) {
  if (!container) return;
  container.innerHTML = "";
  const card = document.createElement("div");
  card.className = "debug-card";
  card.style.cssText = `
    margin-top: 12px;
    padding: 14px;
    background: #0b1120;
    border: 1px solid #1e293b;
    border-radius: 12px;
    color: #e2e8f0;
    font-size: 13px;
  `;

  const head = document.createElement("div");
  head.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1e293b;
    flex-wrap: wrap;
    gap: 8px;
  `;
  head.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="color:#38bdf8; font-weight:700; font-size:13px;"><i class="fa-solid fa-bug" aria-hidden="true"></i> Depurador de pregunta</span>
      <span style="background:#1e293b; color:#94a3b8; padding:2px 8px; border-radius:999px; font-size:11px;">#${q.id ?? "?"} · Tema ${q.tema ?? "?"}</span>
    </div>
    <span style="font-size:11px; color:#64748b;">${esc(q.tag || q.apartadoNombre || "JavaScript")}</span>
  `;
  card.append(head);

  if (q.codigo) {
    const execBox = document.createElement("div");
    execBox.style.marginBottom = "14px";

    const execBtn = document.createElement("button");
    execBtn.type = "button";
    execBtn.className = "btn tiny primary";
    execBtn.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Ejecutar código en vivo';

    const consolePre = document.createElement("pre");
    consolePre.style.cssText = `
      display: none;
      margin-top: 8px;
      padding: 10px;
      background: #020617;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #22d3ee;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      max-height: 180px;
      overflow-y: auto;
    `;

    execBtn.addEventListener("click", () => {
      consolePre.style.display = "block";
      consolePre.textContent = "▶ Ejecutando…\n";
      const salidas = [];
      const fakeConsole = {
        log: (...args) => {
          const linea = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          salidas.push(linea);
          consolePre.textContent = salidas.join("\n");
          if (window.cv) window.cv.log(`[Ejecución #${q.id}] ${linea}`);
        },
        error: (...args) => {
          const linea = "❌ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          salidas.push(linea);
          consolePre.textContent = salidas.join("\n");
          if (window.cv) window.cv.error(`[Ejecución #${q.id}] ${linea}`);
        },
        warn: (...args) => {
          const linea = "⚠️ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          salidas.push(linea);
          consolePre.textContent = salidas.join("\n");
        }
      };

      try {
        const fn = new Function("console", q.codigo);
        fn(fakeConsole);
        if (!salidas.length) {
          consolePre.textContent = "(El código se ejecutó sin imprimir en consola)";
        }
      } catch (err) {
        fakeConsole.error(err.message);
      }
    });

    execBox.append(execBtn, consolePre);
    card.append(execBox);

    const tracePlayerBox = document.createElement("div");
    const traza = generarTrazaFallback(q);
    createTracePlayer(tracePlayerBox, q.codigo, traza);
    card.append(tracePlayerBox);
  } else {
    const info = document.createElement("div");
    info.style.cssText = "line-height:1.6; color:#94a3b8; font-size:12px;";
    info.innerHTML = `
      <div><b>Enunciado:</b> ${formatText(q.enunciado || "")}</div>
      <div style="margin-top:6px;"><b>Tu respuesta:</b> ${selected ? `<b>${selected})</b> ${formatText(q.opciones?.[selected] ?? "")}` : "Sin responder"}</div>
      <div><b>Respuesta correcta:</b> <b>${q.correcta})</b> ${formatText(q.opciones?.[q.correcta] ?? "")}</div>
      <div style="margin-top:6px; color:#64748b;">(Esta es una pregunta conceptual sin bloque de código ejecutable).</div>
    `;
    card.append(info);
  }

  container.append(card);
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
    const headers = { "Content-Type": "application/json" };
    const nvKey = localStorage.getItem("preparar_tests_nvidia_key");
    if (nvKey) headers["x-nvidia-api-key"] = nvKey;
    const res = await fetch(`${window.location.origin}${endpoint}`, {
      method: "POST",
      headers,
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

  const btnDebug = document.createElement("button");
  btnDebug.type = "button";
  btnDebug.className = "btn tiny debug-btn";
  btnDebug.innerHTML = '<i class="fa-solid fa-bug" aria-hidden="true"></i> Depurador';
  btnDebug.title = "Abrir depurador interactivo para esta pregunta";

  const hint = document.createElement("span");
  hint.className = "ai-hint";
  hint.textContent = "Otra forma de explicarlo, paso a paso y con un ejemplo.";
  actions.append(btn, btnDebug, hint);

  const slot = document.createElement("div");
  slot.className = "ai-answer hidden";

  const debugSlot = document.createElement("div");
  debugSlot.className = "debug-slot hidden";

  wrap.append(actions, slot, debugSlot);

  let loaded = false;
  let loading = false;
  let debugLoaded = false;

  btnDebug.addEventListener("click", () => {
    const isHidden = debugSlot.classList.toggle("hidden");
    btnDebug.innerHTML = isHidden
      ? '<i class="fa-solid fa-bug" aria-hidden="true"></i> Depurador'
      : '<i class="fa-solid fa-bug" aria-hidden="true"></i> Ocultar depurador';

    if (window.cv) {
      if (typeof window.cv.abrir === "function") {
        window.cv.abrir();
      } else {
        document.getElementById("cv-toggle")?.click();
      }
      window.cv.log(`[Debug Pregunta #${q.id ?? "?"}] Tema ${q.tema ?? "?"} · ${q.tag || q.apartadoNombre || "Sin apartado"}`);
      if (q.codigo) {
        window.cv.log(`Código:\n${q.codigo}`);
      }
      if (typeof window.cv.setEstado === "function") {
        window.cv.setEstado("preguntaActual", {
          id: q.id,
          tema: q.tema,
          apartado: q.apartado,
          seleccionada: selected,
          correcta: q.correcta,
          esCorrecta: selected === q.correcta
        });
      }
    }

    if (isHidden || debugLoaded) return;
    debugLoaded = true;
    if (typeof renderDebugView === "function") {
      renderDebugView(debugSlot, q, selected);
    }
  });

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
  attachAiExplain(box, q, selected);
  return box;
}

function esPreguntaAbierta(q) {
  if (!q) return false;
  const t = String(q.tipo || "").toLowerCase();
  return (
    t === "escribir_codigo" ||
    t === "escribir" ||
    t === "escriure" ||
    t === "traza_linea" ||
    t === "interpretar" ||
    t === "desarrollo" ||
    t === "abierta" ||
    t === "oberta"
  );
}

function obtenerPlaceholderAbierta(q) {
  if (q.tipo === "escribir_codigo" && q.codigo) {
    return "// Escribe aquí la función en JavaScript para sacar un 10:\nfunction miSolucion(...) {\n  // Tu código aquí\n}";
  }
  if (q.tipo === "traza_linea" || q.tipo === "interpretar") {
    return "// Explica paso a paso cada línea y la salida final:\n// Línea 1: ...\n// Línea 2: ...\n// Salida final por consola: ...";
  }
  return "Escribe aquí tu desarrollo técnico, enumeración de fases o solución detallada...";
}

function renderTest() {
  state.screen = "test";
  const q = currentQuestion();
  if (!q) {
    renderResults();
    return;
  }
  saveSession();
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
          <span class="chip ${esPreguntaAbierta(q) ? "ok" : q.tipo === "codigo" ? "brand" : ""}">${q.tipo === "escribir_codigo" ? (q.codigo ? "Escribir función" : "Desarrollo / Escrito") : (q.tipo === "traza_linea" || q.tipo === "interpretar") ? "Traza línea a línea" : esPreguntaAbierta(q) ? "Pregunta abierta / Desarrollo" : q.tipo === "codigo" ? "Código" : "Teoría"}</span>
          <span class="chip ${difTone}">${esc(q.dificultad || "media")}</span>
        </div>
        <div class="test-live" id="live-score">${liveScoreHTML()}</div>
      </div>
      <div class="progress" aria-hidden="true"><div class="progress-bar" style="width:${progress}%"></div></div>
      <article class="question-card" id="question-card">
        <div class="q-tag">${esc(limpiarPistasEnunciado(q.tag || "WEC"))}</div>
        <h2 class="q-text">${formatText(limpiarPistasEnunciado(q.enunciado))}</h2>
        ${q.codigo ? '<div class="code-slot" id="code-slot"></div>' : ""}
        ${esPreguntaAbierta(q) ? `
          <div class="open-area" id="open-area" style="margin: 16px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
              <label for="open-textarea" style="font-size:13px; font-weight:700; color:#38bdf8;">
                ${(q.tipo === "escribir_codigo" && q.codigo) ? "💻 Tu solución en código JavaScript (escribe tu función):" : (q.tipo === "traza_linea" || q.tipo === "interpretar") ? "🔍 Traza línea a línea (explica qué hace cada línea y la salida final):" : "✍️ Tu explicación técnica y respuesta:"}
              </label>
              <span style="font-size:11px; color:#94a3b8; background:#0f172a; padding:3px 8px; border-radius:999px; border:1px solid #334155;"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> Corrección IA (Nota 0-10)</span>
            </div>
            <textarea id="open-textarea" class="open-textarea" rows="10" style="width:100%; box-sizing:border-box; background:#020617; border:1px solid #334155; border-radius:10px; color:#e2e8f0; font-family:${q.tipo === 'desarrollo' || q.tipo === 'abierta' || q.tipo === 'oberta' || (!q.codigo && q.tipo === 'escribir_codigo') ? 'inherit' : 'ui-monospace, SFMono-Regular, Menlo, monospace'}; font-size:13px; padding:12px; line-height:1.5; resize:vertical;" placeholder="${esc(obtenerPlaceholderAbierta(q))}">${esc(selected || "")}</textarea>
            <div style="display:flex; gap:10px; margin-top:10px; align-items:center; flex-wrap:wrap;">
              ${(q.tipo === "escribir_codigo" && q.codigo) ? '<button type="button" class="btn tiny ghost" id="test-code-btn"><i class="fa-solid fa-play" aria-hidden="true"></i> Probar en consola</button>' : ''}
              <button type="button" class="btn primary tiny" id="submit-open-btn"><i class="fa-solid fa-robot" aria-hidden="true"></i> Enviar a la IA para corrección (Nota 0-10)</button>
              <span id="open-eval-status" style="font-size:12px; color:#94a3b8;"></span>
            </div>
            <div id="open-console-out" style="display:none; margin-top:10px; padding:10px; background:#020617; border:1px solid #334155; border-radius:8px; font-family:monospace; font-size:12px; color:#38bdf8; max-height:150px; overflow-y:auto; white-space:pre-wrap;"></div>
            <div id="open-eval-result" style="margin-top:14px; display:${q.evaluacionIA ? 'block' : 'none'};"></div>
          </div>
        ` : `
          <div class="options" id="options" role="group" aria-label="Opciones de respuesta">
            ${["A", "B", "C", "D"].map((letter) => optionHTML(q, letter, selected, practice, isAnswered)).join("")}
          </div>
        `}
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
  if (esPreguntaAbierta(q)) {
    if (q.evaluacionIA) {
      const evalSlot = $("#open-eval-result");
      if (evalSlot) {
        renderAiConversation(evalSlot, q, selected || "", { answer: q.evaluacionIA, messages: q.evaluacionMensajes || [] }, true);
      }
    }
    $("#test-code-btn")?.addEventListener("click", () => {
      const textarea = $("#open-textarea");
      const val = textarea?.value?.trim() || "";
      const consoleBox = $("#open-console-out");
      if (!consoleBox) return;
      consoleBox.style.display = "block";
      consoleBox.textContent = "▶ Probando código en consola…\n";
      const logs = [];
      const fakeConsole = {
        log: (...args) => {
          const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          logs.push(msg);
          consoleBox.textContent = logs.join("\n");
        },
        error: (...args) => {
          const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          logs.push("❌ " + msg);
          consoleBox.textContent = logs.join("\n");
        },
      };
      try {
        const fn = new Function("console", val);
        fn(fakeConsole);
        if (!logs.length) {
          consoleBox.textContent = "✅ Código sintácticamente correcto (sin llamadas console.log directas).";
        }
      } catch (err) {
        consoleBox.textContent = `❌ Error de sintaxis o ejecución: ${err.message}`;
      }
    });

    const openTextarea = $("#open-textarea");
    openTextarea?.addEventListener("input", () => {
      state.answers[q.id] = openTextarea.value;
      saveSession();
    });

    $("#submit-open-btn")?.addEventListener("click", async () => {
      const textarea = $("#open-textarea");
      const val = textarea?.value?.trim() || "";
      if (!val) {
        toast("Escribe tu respuesta antes de enviarla.");
        textarea?.focus();
        return;
      }
      state.answers[q.id] = val;
      saveSession();
      const btn = $("#submit-open-btn");
      const status = $("#open-eval-status");
      const evalSlot = $("#open-eval-result");
      if (btn) btn.disabled = true;
      if (status) status.innerHTML = '<span class="ai-dot"></span> Evaluando con la IA para nota del 0 al 10…';
      try {
        const data = await requestAi("/api/explain", {
          pregunta: {
            ...q,
            tipo: q.tipo,
            enunciado: q.enunciado,
            codigo: q.codigo || "",
            explicacion: q.explicacion || "",
          },
          selected: val,
          esDesarrollo: true,
          subject: state.subject?.nombre || "WEC",
        });
        const text = aiExplanationText(data);
        if (!text) throw new Error("La IA no devolvió corrección.");
        q.evaluacionIA = text;
        const notaMatch = text.match(/Nota:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
        const nota = notaMatch ? parseFloat(notaMatch[1]) : null;
        if (nota !== null) {
          if (nota < 5) {
            updateWrongForAnswer(q, val, null);
          } else {
            const set = new Set(getWrongIds());
            set.delete(q.id);
            setWrongIds([...set]);
            const history = getHistory();
            if (history[q.id]) {
              history[q.id].passed = true;
              history[q.id].selected = val;
            }
            setHistory(history);
            writePersistenceFile();
          }
        }
        if (evalSlot) {
          evalSlot.style.display = "block";
          renderAiConversation(evalSlot, q, val, { answer: text, messages: [] }, true);
        }
        if (status) status.textContent = "✅ Evaluado por la IA";
        toast("Respuesta evaluada por la IA.");
      } catch {
        const feedbackLocal = `### Evaluación didáctica de referencia\n\n**Tu respuesta:**\n\`\`\`javascript\n${val}\n\`\`\`\n\n**Solución modelo y criterios para un 10:**\n${q.explicacion}\n\n*(Inicia el servidor local con Ollama para corrección automática interactiva).*`;
        q.evaluacionIA = feedbackLocal;
        if (evalSlot) {
          evalSlot.style.display = "block";
          renderAiConversation(evalSlot, q, val, { answer: feedbackLocal, messages: [] }, false);
        }
        if (status) status.textContent = "Respuesta guardada con solución de referencia.";
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  } else {
    if (practice && isAnswered) {
      $("#feedback-slot")?.append(renderFeedback(q, selected));
    }
    $$(".option").forEach((btn) => {
      btn.addEventListener("click", () => selectOption(btn.dataset.letter));
    });
  }
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
  const prev = history[q.id] || { fails: 0, correct: 0, attempts: 0 };
  const isCorrect = (selected === q.correcta);

  if (isCorrect) {
    set.delete(q.id);
    history[q.id] = {
      selected,
      at: new Date().toISOString(),
      fails: Number(prev.fails) || 0,
      correct: (Number(prev.correct) || 0) + 1,
      attempts: (Number(prev.attempts) || 0) + 1,
      passed: true
    };
  } else {
    set.add(q.id);
    history[q.id] = {
      selected,
      at: new Date().toISOString(),
      fails: (Number(prev.fails) || 0) + 1,
      correct: Number(prev.correct) || 0,
      attempts: (Number(prev.attempts) || 0) + 1,
      passed: false
    };
  }
  setWrongIds([...set]);
  setHistory(history);
  writePersistenceFile();

  if (window.SupabaseAuth && typeof window.SupabaseAuth.autoSyncProgressDebounced === "function") {
    window.SupabaseAuth.autoSyncProgressDebounced();
  }
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

  const traza = (Array.isArray(q.traza) && q.traza.length) ? q.traza : (typeof generarTrazaFallback === "function" ? generarTrazaFallback(q) : []);
  if (q.tipo === "codigo" && q.codigo && traza.length) {
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
          createTracePlayer(traceSlot, q.codigo, traza);
        }
      });
      details.append(summary, traceSlot);
      item.append(details);
    } else {
      createTracePlayer(traceSlot, q.codigo, traza);
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
      const nvKey = (typeof localStorage !== "undefined" && localStorage.getItem("preparar_tests_nvidia_key")) || "";
      const res = await fetch(`${window.location.origin}/api/generar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(nvKey ? { "x-nvidia-api-key": nvKey } : {}),
        },
        body: JSON.stringify({
          ...solicitud,
          ...(nvKey ? { nvidiaApiKey: nvKey } : {}),
        }),
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
      const raw = (btn.dataset.repeatSub || "").split(",").map((s) => s.trim()).filter(Boolean);
      const ids = raw.map((id) => getQuestion(id)?.id || id).filter((id) => hasQuestion(id));
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
  const onLeave = () => {
    if (state.screen === "test" && state.order.length) {
      saveSession();
    }
  };
  window.addEventListener("beforeunload", onLeave);
  window.addEventListener("pagehide", onLeave);
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
    let activeSession = getSession();
    if (activeSession && activeSession.subjectId) {
      saved = activeSession.subjectId;
    }
    const asignaturaSesion = (activeSession && activeSession.subjectId)
      ? state.catalog.find(
          (asignatura) =>
            asignatura.id === activeSession.subjectId &&
            !asignatura.apuntesPrivados &&
            (asignatura.archivo || asignatura.localData),
        )
      : null;
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
    const branchBoot = state.ramaActual || localStorage.getItem("rama_actual") || "Segundo_grado_medio";
    const asignaturaDeRama = state.catalog.find(
      (a) =>
        (branchBoot === "todas" || a.grado === branchBoot || (!a.grado && branchBoot === "Segundo_grado_medio")) &&
        !a.apuntesPrivados &&
        (a.archivo || a.localData),
    );
    const asignaturaInicial =
      asignaturaSesion ||
      (saved && asignaturaGuardada && (branchBoot === "todas" || asignaturaGuardada.grado === branchBoot) ? asignaturaGuardada : null) ||
      asignaturaDeRama ||
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

    activeSession = getSession(asignaturaInicial.id) || activeSession;

    const canResume =
      activeSession &&
      Array.isArray(activeSession.ids) &&
      activeSession.ids.length > 0 &&
      !activeSession.finished;

    if (!document.querySelector(".practica-apuntes") && state.screen !== "notes") {
      if (canResume) {
        resumeSession(activeSession);
        toast("Has vuelto a tu test donde lo dejaste.");
      } else {
        renderStart();
      }
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

