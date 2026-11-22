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
