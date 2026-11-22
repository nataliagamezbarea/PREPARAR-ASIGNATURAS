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
