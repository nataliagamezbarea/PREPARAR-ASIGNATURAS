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

  // 4.1. Enlace directo a Generador de Apuntes (Cuaderno IA)
  const btnIrApuntes = document.getElementById("btn-ir-generador-apuntes");
  if (btnIrApuntes) {
    const esLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    btnIrApuntes.href = esLocal
      ? "http://localhost:8002"
      : (window.APP_CONFIG?.urlApuntes || "https://nataliagamezbarea.github.io/generador-apuntes/");
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
