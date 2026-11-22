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
