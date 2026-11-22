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
