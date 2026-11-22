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
    const history = getHistory();
    const wrongSet = new Set(getWrongIds());
    if (filter.repaso === "faltan") {
      // Las que faltan: o no se han respondido nunca, o no están superadas (passed !== true), o tienen fallos pendientes
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
    const history = getHistory();
    return state.questions.filter((q) => q.practicada || history[q.id] != null);
  }
  if (filter === "nuevas") {
    const history = getHistory();
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
    const wrong = new Set(getWrongIds().map((id) => getQuestion(id)?.id || id));
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
        <section class="home-card home-card-entrenar" style="grid-column: 1 / -1;">
          <h2>🎯 Modalidades de práctica</h2>
          <p class="lead">Configura tu sesión de test a medida (tema, tipo de repaso, categoría y cantidad) o usa los accesos rápidos.</p>

          <!-- Configurador de práctica a medida estilo 8765 -->
          <div class="practice-custom-panel" style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:18px; margin-bottom:20px;">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:16px;">
              <div style="grid-column: 1 / -1; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.18); padding:10px 14px; border-radius:6px; border:1px solid var(--line);">
                <div style="display:flex; align-items:center; gap:8px;">
                  <i class="fa-brands fa-github" style="font-size:18px; color:#a78bfa;"></i>
                  <span style="font-size:12px; font-weight:700;">Rama (GitHub privado):</span>
                  <select class="control" id="custom-practice-branch" style="min-width:240px; font-size:12px; padding:4px 8px;">
                    <option value="Segundo_grado_superior" selected>Segundo_grado_superior (DWEC)</option>
                    <option value="master">master</option>
                  </select>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:11px; color:var(--muted);">Carpeta:</span>
                  <input type="text" class="control" id="custom-practice-folder" value="datos/bancos/WEC" style="width:160px; font-size:11px; padding:4px 8px;" />
                  <button class="btn tiny ghost" type="button" id="btn-reload-branch" title="Recargar preguntas desde esta rama de GitHub"><i class="fa-solid fa-arrows-rotate"></i> Cargar de GitHub</button>
                </div>
              </div>

              <div>
                <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Agrupación / Examen</label>
                <select class="control" id="custom-practice-exam" style="width:100%;">
                  <option value="Examen 1" selected>Examen 1 (Temas 1–4 · 1.656 preguntas)</option>
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
                  <option value="practicadas">Solo practicadas (${counts.practicadas || 515})</option>
                  <option value="nuevas">Nunca practicadas</option>
                </select>
              </div>

              <div>
                <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Categoría</label>
                <select class="control" id="custom-practice-category" style="width:100%;">
                  <option value="all">Todas las categorías</option>
                  <option value="oficial">★ Oficiales de examen (${counts.oficiales || 33})</option>
                  <option value="introduccion">📘 Introducción (${counts.introduccion || 572})</option>
                  <option value="entrenamiento">⚡ Práctica / Entrenamiento (${counts.entrenamiento || 1051})</option>
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
                  <option value="0">Todas las que coincidan con la selección</option>
                </select>
              </div>

              <div>
                <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Orden</label>
                <select class="control" id="custom-practice-order" style="width:100%;">
                  <option value="aleatorio" selected>Aleatorio</option>
                  <option value="original">Orden original</option>
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

          <h3 style="font-size:15px; margin:20px 0 10px;"><i class="fa-solid fa-bolt"></i> Accesos rápidos directos</h3>
          <div class="practice-modes-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 16px;">
            <button class="btn primary" type="button" data-start="all" style="justify-content:space-between; padding:12px 14px;">
              <span><i class="fa-solid fa-layer-group"></i> Todas las preguntas</span>
              <span class="count">${counts.total}</span>
            </button>
            <button class="btn" type="button" data-start="practicadas" style="justify-content:space-between; padding:12px 14px; border-color:var(--brand); color:var(--brand);">
              <span><i class="fa-solid fa-clock-rotate-left"></i> Solo Practicadas</span>
              <span class="count" style="background:var(--brand-soft); color:var(--brand);">${counts.practicadas || 515}</span>
            </button>
            <button class="btn" type="button" data-start="oficial" style="justify-content:space-between; padding:12px 14px; border-color:#f59e0b; color:#f59e0b;">
              <span><i class="fa-solid fa-star"></i> Oficiales de examen</span>
              <span class="count" style="background:rgba(245,158,11,0.18); color:#f59e0b;">${counts.oficiales || 33}</span>
            </button>
            <button class="btn ok" type="button" data-start="mastery" style="justify-content:space-between; padding:12px 14px;">
              <span><i class="fa-solid fa-award"></i> Refuerzo sin fallos</span>
              <span class="count">${counts.total}</span>
            </button>
            ${(counts.desarrollo || 0) > 0 ? `
              <button class="btn" type="button" data-start="desarrollo" style="justify-content:space-between; padding:12px 14px; border-color:#38bdf8; color:#38bdf8; grid-column: 1 / -1; background:rgba(56,189,248,0.08);">
                <span><i class="fa-solid fa-graduation-cap"></i> ✍️ Retos de Desarrollo y Código Abierto (Corrección IA con Nota 0-10)</span>
                <span class="count" style="background:#0284c7; color:#fff;">${counts.desarrollo} retos</span>
              </button>
            ` : `
              <div style="grid-column: 1 / -1; font-size:12px; color:var(--muted); background:var(--card2); border:1px solid var(--line); border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-circle-info" style="color:var(--brand);"></i>
                <span>Las <strong>1.656 preguntas</strong> son de tipo test oficial con corrección instantánea. La corrección de preguntas abiertas de desarrollo requiere tener Ollama local activo en Docker.</span>
              </div>
            `}
          </div>

          <h3 style="font-size:15px; margin:20px 0 10px;"><i class="fa-solid fa-list-ol"></i> Práctica por Tema individual</h3>
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

  // Actualización dinámica de subapartados según el tema elegido
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

  // Inicializar selector de ramas de GitHub si está disponible
  const branchSelect = $("#custom-practice-branch");
  const folderInput = $("#custom-practice-folder");
  if (branchSelect && window.RepoBranchManager) {
    window.RepoBranchManager.poblarSelectorRamas(branchSelect);
    branchSelect.addEventListener("change", async () => {
      const selectedBranch = branchSelect.value;
      const folderVal = folderInput?.value.trim() || "datos/bancos/WEC";
      await window.RepoBranchManager.cargarPreguntasDeRama(selectedBranch, folderVal);
    });
    $("#btn-reload-branch")?.addEventListener("click", async () => {
      const selectedBranch = branchSelect.value;
      const folderVal = folderInput?.value.trim() || "datos/bancos/WEC";
      await window.RepoBranchManager.cargarPreguntasDeRama(selectedBranch, folderVal);
    });
  }

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

    const immediate = $("#immediate-toggle")?.checked !== false;
    const shuffle = order === "aleatorio";
    startTest({ filter: customFilter, immediate, shuffle, sample: qty });
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
          const raw = (btn.dataset.repasarFallosSub || "").split(",").map((s) => s.trim()).filter(Boolean);
          const ids = raw.map((id) => getQuestion(id)?.id || id).filter((id) => hasQuestion(id));
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
  initNavbarYGestionAsignaturas();
}

function initNavbarYGestionAsignaturas() {
  const branchSelected = state.ramaActual || localStorage.getItem("rama_actual") || "Segundo_grado_medio";
  const branchSelect = document.getElementById("navbar-branch-select");
  if (branchSelect) {
    branchSelect.value = branchSelected;
    if (!branchSelect.dataset.attached) {
      branchSelect.dataset.attached = "true";
      branchSelect.addEventListener("change", async (e) => {
        const val = e.target.value;
        state.ramaActual = val;
        try { localStorage.setItem("rama_actual", val); } catch (_) {}
        const matching = state.catalog.filter(s => val === "todas" || s.grado === val || (!s.grado && val === "Segundo_grado_medio"));
        if (matching.length && (!state.subject || (state.subject.grado !== val && val !== "todas"))) {
          await loadSubject(matching[0].id);
        }
        renderStart();
        const nombreRama = val === "Segundo_grado_medio" ? "Segundo grado medio" : (val === "Primer_grado_medio" ? "Primer grado medio" : (val === "Primer_grado_superior_DAW" ? "Primer grado superior DAW" : "Todas las ramas"));
        toast(`Grado activo: ${nombreRama}`);
      });
    }
  }

  const modal = document.getElementById("modal-gestionar-asignaturas");
  const btnAbrir = document.getElementById("btn-gestionar-asignaturas");
  const btnCerrar = document.getElementById("btn-cerrar-modal-gestionar");

  const tabCrear = document.getElementById("tab-crear-asig");
  const tabSubir = document.getElementById("tab-subir-tests");
  const panelCrear = document.getElementById("panel-crear-asig");
  const panelSubir = document.getElementById("panel-subir-tests");
  const selectSubirAsig = document.getElementById("select-subir-asig");

  if (modal && !modal.dataset.attached) {
    modal.dataset.attached = "true";

    btnAbrir?.addEventListener("click", () => {
      if (selectSubirAsig) {
        selectSubirAsig.innerHTML = state.catalog.map(s => `<option value="${esc(s.id)}" ${s.id === state.subjectId ? "selected" : ""}>${esc(s.nombre)} (${s.id})</option>`).join("");
      }
      modal.classList.remove("hidden");
    });

    btnCerrar?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    tabCrear?.addEventListener("click", () => {
      tabCrear.style.color = "var(--brand)";
      tabCrear.style.borderBottom = "2px solid var(--brand)";
      tabSubir.style.color = "var(--muted)";
      tabSubir.style.borderBottom = "2px solid transparent";
      panelCrear.style.display = "flex";
      panelSubir.style.display = "none";
    });

    tabSubir?.addEventListener("click", () => {
      tabSubir.style.color = "var(--brand)";
      tabSubir.style.borderBottom = "2px solid var(--brand)";
      tabCrear.style.color = "var(--muted)";
      tabCrear.style.borderBottom = "2px solid transparent";
      panelSubir.style.display = "flex";
      panelCrear.style.display = "none";
    });

    document.getElementById("btn-submit-crear-asig")?.addEventListener("click", async () => {
      const grado = document.getElementById("input-asig-grado")?.value || "Segundo_grado_medio";
      const nombre = (document.getElementById("input-asig-nombre")?.value || "").trim();
      const idRaw = (document.getElementById("input-asig-id")?.value || "").trim() || nombre;
      const desc = (document.getElementById("input-asig-desc")?.value || "").trim();
      const temasRaw = (document.getElementById("input-asig-temas")?.value || "").trim();

      if (!nombre) return alert("Por favor escribe el nombre de la asignatura.");
      const id = idRaw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!id) return alert("El identificador no es válido.");

      let temas = [];
      if (temasRaw) {
        temas = temasRaw.split("\n").map(l => l.trim()).filter(Boolean).map((linea, idx) => ({
          numero: idx + 1,
          nombre: linea.startsWith("Tema ") ? linea : `Tema ${idx + 1} · ${linea}`,
          apartados: [{ numero: 1, nombre: `${idx + 1}.1 Conceptos iniciales` }]
        }));
      }

      const btn = document.getElementById("btn-submit-crear-asig");
      btn.disabled = true;
      btn.textContent = "Creando asignatura...";

      try {
        const resp = await fetch("/api/asignaturas", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, nombre, grado, descripcion: desc, temas })
        });
        const resJson = await resp.json();
        if (!resp.ok) throw new Error(resJson.error || "Error al crear asignatura");

        await loadCatalog();
        state.ramaActual = grado;
        try { localStorage.setItem("rama_actual", grado); } catch (_) {}
        await loadSubject(id);
        modal.classList.add("hidden");
        renderStart();
        toast(`Asignatura "${nombre}" creada y lista.`);
      } catch (err) {
        alert("Error: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar y Registrar Asignatura';
      }
    });

    const fileInput = document.getElementById("input-file-test-json");
    const textarea = document.getElementById("textarea-test-json");
    const preview = document.getElementById("subir-test-preview");

    const updatePreview = (txt) => {
      try {
        const parsed = JSON.parse(txt);
        const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.preguntas) ? parsed.preguntas : []);
        if (list.length) {
          const temas = new Set(list.map(p => p.tema || 1));
          preview.style.display = "block";
          preview.innerHTML = `<span style="color:var(--ok); font-weight:700;">✅ Válido:</span> ${list.length} preguntas detectadas en ${temas.size} tema(s).`;
        } else {
          preview.style.display = "none";
        }
      } catch (_) {
        preview.style.display = "none";
      }
    };

    textarea?.addEventListener("input", () => updatePreview(textarea.value));
    fileInput?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) {
        const r = new FileReader();
        r.onload = () => {
          textarea.value = r.result;
          updatePreview(r.result);
        };
        r.readAsText(f);
      }
    });

    document.getElementById("btn-submit-subir-test")?.addEventListener("click", async () => {
      const idAsig = selectSubirAsig?.value;
      if (!idAsig) return alert("Selecciona la asignatura de destino.");
      const contenido = textarea?.value.trim();
      if (!contenido) return alert("Selecciona un archivo JSON o pega su contenido.");

      let preguntas = [];
      try {
        const parsed = JSON.parse(contenido);
        preguntas = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.preguntas) ? parsed.preguntas : Object.values(parsed));
      } catch (_) {
        return alert("El contenido no es JSON válido.");
      }

      if (!preguntas.length) return alert("No se encontraron preguntas en el JSON.");

      const btn = document.getElementById("btn-submit-subir-test");
      btn.disabled = true;
      btn.textContent = "Subiendo preguntas...";

      try {
        const resp = await fetch("/api/tests/subir", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idAsignatura: idAsig, preguntas })
        });
        const resJson = await resp.json();
        if (!resp.ok) throw new Error(resJson.error || "Error al subir test");

        await loadCatalog();
        await loadSubject(idAsig);
        modal.classList.add("hidden");
        renderStart();
        toast(`¡Test subido con éxito! ${resJson.totalPreguntas} preguntas disponibles.`);
      } catch (err) {
        alert("Error: " + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Guardar Test en el Banco Oficial';
      }
    });
  }
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
