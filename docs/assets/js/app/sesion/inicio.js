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
}
