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
              <button class="btn tiny ok" type="button" data-generar-tema="${t.numero}"><i class="fa-solid fa-wand-magic-sparkles"></i> Generar</button>
            </div>
          </summary>
          <div class="tree-apartados-body">
            ${apartadosHTML || `<p class="muted" style="font-size:13px;padding:6px 0">No hay subapartados registrados en los apuntes para este tema.</p>`}
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
