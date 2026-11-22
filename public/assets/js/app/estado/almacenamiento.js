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
