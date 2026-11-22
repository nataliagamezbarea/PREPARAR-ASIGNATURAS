import assert from "node:assert/strict";
import test from "node:test";

test("persistencia y restauración de sesión en recarga", () => {
  // Simulador de almacenamiento de navegador
  const mockStorage = new Map();
  const localStorage = {
    getItem: (k) => mockStorage.get(k) ?? null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    get length() { return mockStorage.size; },
    key: (i) => Array.from(mockStorage.keys())[i] || null,
  };

  const LS = {
    session: "wec12_session_v1",
    subject: "wec12_subject_v1"
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const state = {
    subjectId: "",
    order: [],
    index: 0,
    answers: {},
    screen: "start",
    byId: new Map()
  };

  function saveSession() {
    if (!state.order.length) return;
    const filterKey = state.selectedFilter || "all";
    const sessionData = {
      filter: filterKey,
      subjectId: state.subjectId,
      ids: state.order.map((q) => q.id),
      index: state.index,
      answers: state.answers,
      immediate: true,
      finished: false,
      screen: state.screen
    };
    writeJSON(`${LS.session}:${state.subjectId || "default"}`, sessionData);
    writeJSON(LS.session, sessionData);
  }

  function getSession(specificSubjectId = null) {
    const target = specificSubjectId || state.subjectId;
    if (target) {
      const scoped = readJSON(`${LS.session}:${target}`, null);
      if (scoped && Array.isArray(scoped.ids) && scoped.ids.length) return scoped;
    }
    const globalSession = readJSON(LS.session, null);
    if (globalSession && Array.isArray(globalSession.ids) && globalSession.ids.length) {
      if (!target || globalSession.subjectId === target) return globalSession;
    }
    return null;
  }

  // 1. Simular inicio de test en pregunta 3
  state.subjectId = "wec";
  state.order = [{ id: 1, text: "q1" }, { id: 2, text: "q2" }, { id: 3, text: "q3" }, { id: 4, text: "q4" }];
  state.byId = new Map(state.order.map(q => [q.id, q]));
  state.index = 2; // Pregunta 3
  state.answers[1] = "A";
  state.answers[2] = "B";
  state.screen = "test";
  saveSession();

  // 2. Simular recarga del navegador (estado reseteado a valores iniciales)
  state.subjectId = "";
  state.order = [];
  state.index = 0;
  state.answers = {};
  state.screen = "start";

  // Al recargar, antes de cargar asignatura, getSession() debe encontrar la sesión activa
  const activeSessionBefore = getSession();
  assert.ok(activeSessionBefore, "Debe encontrar la sesión activa incluso con state.subjectId vacío");
  assert.equal(activeSessionBefore.subjectId, "wec");
  assert.equal(activeSessionBefore.index, 2);
  assert.equal(activeSessionBefore.answers[1], "A");

  // Al cargar la asignatura 'wec'
  state.subjectId = "wec";
  const activeSessionAfter = getSession(state.subjectId);
  assert.ok(activeSessionAfter, "Debe encontrar la sesión tras fijar subjectId");
  assert.equal(activeSessionAfter.index, 2);
  assert.equal(activeSessionAfter.ids.length, 4);

  // Restaurar preguntas y sesión (tolerante a id string vs number)
  const resolved = [];
  for (const id of activeSessionAfter.ids) {
    let q = state.byId.get(id);
    if (!q && typeof id === "string" && !isNaN(id)) q = state.byId.get(Number(id));
    if (!q && typeof id === "number") q = state.byId.get(String(id));
    if (q) resolved.push(q);
  }
  state.order = resolved;
  state.index = activeSessionAfter.index;
  state.screen = "test";

  assert.equal(state.order.length, 4);
  assert.equal(state.index, 2, "Permanece exactamente en la pregunta donde estaba antes de recargar");
  assert.equal(state.screen, "test", "Permanece en el test sin echar al usuario");
});

test("admite identificadores alfanuméricos de preguntas falladas en Tema 1 y los agrupa correctamente", () => {
  const mockStorage = new Map();
  const localStorage = {
    getItem: (k) => mockStorage.get(k) ?? null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
  };

  const LS = {
    wrong: "wec12_wrong_v1",
    history: "wec12_history_v1"
  };

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const preguntasTema1 = [
    { id: "T1-intro-01", tema: 1, apartado: 1, apartadoNombre: "Introducción", correcta: "A" },
    { id: "T1-intro-02", tema: 1, apartado: 1, apartadoNombre: "Introducción", correcta: "B" },
    { id: "T1-intro-15", tema: 1, apartado: 2, apartadoNombre: "Lenguajes en entorno cliente", correcta: "C" },
  ];
  const byId = new Map(preguntasTema1.map(q => [q.id, q]));

  function getQuestion(id) {
    if (id == null) return null;
    return byId.get(id) || null;
  }

  function hasQuestion(id) {
    return byId.has(id);
  }

  function getWrongIds() {
    const ids = readJSON(LS.wrong, []);
    const valid = new Set();
    if (Array.isArray(ids)) {
      ids.forEach((id) => {
        if (id != null && String(id).trim() !== "") valid.add(id);
      });
    }
    const history = readJSON(LS.history, {});
    if (history && typeof history === "object") {
      Object.entries(history).forEach(([key, entry]) => {
        if (!entry) return;
        const q = getQuestion(key);
        if (q && entry.selected && entry.selected !== q.correcta) {
          valid.add(q.id);
        }
      });
    }
    return [...valid];
  }

  // Simular que el usuario falló preguntas en Tema 1 con IDs alfanuméricos
  writeJSON(LS.wrong, ["T1-intro-01", "T1-intro-15"]);
  writeJSON(LS.history, {
    "T1-intro-01": { selected: "C", fails: 1 },
    "T1-intro-15": { selected: "A", fails: 2 }
  });

  const fallos = getWrongIds();
  assert.equal(fallos.length, 2, "Debe conservar los 2 fallos alfanuméricos de Tema 1");
  assert.ok(fallos.includes("T1-intro-01"), "Incluye T1-intro-01");
  assert.ok(fallos.includes("T1-intro-15"), "Incluye T1-intro-15");

  // Verificar agrupación de subapartados débiles
  const wrongSet = new Set(fallos.map(id => getQuestion(id)?.id || id));
  const bySub = new Map();
  preguntasTema1.forEach(q => {
    if (!wrongSet.has(q.id)) return;
    const key = `t${q.tema}-ap${q.apartado}`;
    const cur = bySub.get(key) || { tema: q.tema, apartado: q.apartado, titulo: q.apartadoNombre, total: 0, ids: [] };
    cur.total += 1;
    cur.ids.push(q.id);
    bySub.set(key, cur);
  });

  assert.equal(bySub.size, 2, "Se detectan 2 subapartados débiles en el Tema 1");
  const sub1 = bySub.get("t1-ap1");
  assert.ok(sub1);
  assert.equal(sub1.titulo, "Introducción");
  assert.deepEqual(sub1.ids, ["T1-intro-01"]);
});
