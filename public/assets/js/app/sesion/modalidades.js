"use strict";

// ============================================================
// MODAL POPUP: CREAR SESIÓN DE TEST · MODALIDADES DE PRÁCTICA
// ============================================================

function renderModalidadesPractica() {
  const modalBody = document.getElementById("modal-modalidades-body");
  if (!modalBody) return;
  const counts = typeof dataCounts === "function" ? dataCounts() : { total: 0, temas: [] };
  const history = typeof getHistory === "function" ? getHistory() : {};
  const isShuffleSaved = typeof getSavedShuffle === "function" ? getSavedShuffle() : true;

  const themeButtons = counts.temas.map(({ tema, count }) => {
    const preguntasTema = state.questions.filter((q) => Number(q.tema) === Number(tema));
    const respondidasTema = preguntasTema.filter((q) => history[q.id]?.selected != null).length;
    const pctTema = count ? Math.round((respondidasTema / count) * 100) : 0;
    return `
      <button class="btn btn-tema-progreso" type="button" data-start-modal="tema:${tema}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px;">
        <span style="display:flex; align-items:center; gap:8px;">
          <span>Tema ${tema}</span>
          <span class="pct-pill" style="font-size:11px; font-weight:700; background:rgba(255,255,255,0.12); padding:2px 7px; border-radius:10px; color:var(--text);">${pctTema}% completado</span>
        </span>
        <span class="count">${count}</span>
      </button>
    `;
  }).join("");

  modalBody.innerHTML = `
    <!-- 1. Configurador a medida -->
    <div class="practice-custom-panel" style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:18px;">
      <div style="font-weight:700; font-size:14px; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-wand-magic-sparkles" style="color:var(--brand);"></i> Configurar sesión a medida
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:16px;">
        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Agrupación / Examen</label>
          <select class="control" id="custom-practice-exam" style="width:100%;">
            <option value="Examen 1" selected>Examen 1 (Temas 1–4 · ${counts.total} preguntas)</option>
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
            <option value="practicadas">Solo practicadas (${counts.practicadas || counts.total})</option>
            <option value="nuevas">Nunca practicadas</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Categoría</label>
          <select class="control" id="custom-practice-category" style="width:100%;">
            <option value="all">Todas las categorías</option>
            <option value="oficial">★ Oficiales de examen (${counts.oficiales || Math.min(33, counts.total)})</option>
            <option value="introduccion">📘 Introducción (${counts.introduccion || Math.round(counts.total * 0.35)})</option>
            <option value="entrenamiento">⚡ Práctica / Entrenamiento (${counts.entrenamiento || Math.round(counts.total * 0.65)})</option>
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
            <option value="0">Todas las que coincidan (${counts.total})</option>
          </select>
        </div>

        <div>
          <label style="display:block; font-size:12px; font-weight:700; margin-bottom:6px; color:var(--text);">Orden</label>
          <select class="control" id="custom-practice-order" style="width:100%;">
            <option value="aleatorio" ${isShuffleSaved ? "selected" : ""}>Aleatorio</option>
            <option value="original" ${!isShuffleSaved ? "selected" : ""}>Orden original</option>
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

    <!-- 2. Accesos rápidos directos -->
    <div>
      <h4 style="font-size:14px; margin:0 0 10px; font-weight:700; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-bolt" style="color:#f59e0b;"></i> Accesos rápidos directos
      </h4>
      <div class="practice-modes-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px;">
        <button class="btn primary" type="button" data-start-modal="all" style="justify-content:space-between; padding:12px 14px;">
          <span><i class="fa-solid fa-layer-group"></i> Todas las preguntas</span>
          <span class="count">${counts.total}</span>
        </button>
        <button class="btn" type="button" data-start-modal="practicadas" style="justify-content:space-between; padding:12px 14px; border-color:var(--brand); color:var(--brand);">
          <span><i class="fa-solid fa-clock-rotate-left"></i> Solo Practicadas</span>
          <span class="count" style="background:var(--brand-soft); color:var(--brand);">${counts.practicadas || counts.total}</span>
        </button>
        <button class="btn" type="button" data-start-modal="oficial" style="justify-content:space-between; padding:12px 14px; border-color:#f59e0b; color:#f59e0b;">
          <span><i class="fa-solid fa-star"></i> Oficiales de examen</span>
          <span class="count" style="background:rgba(245,158,11,0.18); color:#f59e0b;">${counts.oficiales || Math.min(33, counts.total)}</span>
        </button>
        <button class="btn ok" type="button" data-start="mastery" data-start-modal="mastery" style="justify-content:space-between; padding:12px 14px;">
          <span><i class="fa-solid fa-award"></i> Refuerzo sin fallos</span>
          <span class="count">${counts.total}</span>
        </button>
        ${(counts.desarrollo || 0) > 0 ? `
          <button class="btn" type="button" data-start-modal="desarrollo" style="justify-content:space-between; padding:12px 14px; border-color:#38bdf8; color:#38bdf8; grid-column: 1 / -1; background:rgba(56,189,248,0.08);">
            <span><i class="fa-solid fa-graduation-cap"></i> ✍️ Retos de Desarrollo y Código Abierto</span>
            <span class="count" style="background:#0284c7; color:#fff;">${counts.desarrollo} retos</span>
          </button>
        ` : ""}
      </div>
      <div style="font-size:12px; color:var(--muted); background:var(--card2); border:1px solid var(--line); border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-circle-info" style="color:var(--brand);"></i>
        <span>Las <strong>${counts.total} preguntas</strong> son de tipo test oficial con corrección instantánea. La corrección de preguntas abiertas de desarrollo requiere tener Ollama local activo en Docker.</span>
      </div>
    </div>

    <!-- 3. Práctica por Tema individual -->
    <div>
      <h4 style="font-size:14px; margin:0 0 10px; font-weight:700; display:flex; align-items:center; gap:8px;">
        <i class="fa-solid fa-list-ol" style="color:var(--brand);"></i> Práctica por Tema individual
      </h4>
      <div class="start-actions" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px;">
        ${themeButtons}
      </div>
    </div>
  `;

  // Dynamic subapartados
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

  // Guardar opción de orden en localStorage y sincronizar con #shuffle-toggle
  const orderSelect = $("#custom-practice-order");
  orderSelect?.addEventListener("change", (e) => {
    const isShuffle = e.target.value === "aleatorio";
    localStorage.setItem("preparar_tests_barajar_orden", isShuffle ? "true" : "false");
    const shuffleToggle = $("#shuffle-toggle");
    if (shuffleToggle) shuffleToggle.checked = isShuffle;
  });

  // Botón comenzar personalizado
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

    const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
    const shuffle = order === "aleatorio";
    cerrarModalModalidades();
    startTest({ filter: customFilter, immediate, shuffle, sample: qty });
  });

  // Botones de inicio rápido en el modal
  $$("[data-start-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const filter = btn.dataset.startModal;
      cerrarModalModalidades();
      if (filter === "mastery") {
        startTest({ mastery: true, immediate: true, shuffle: typeof getSavedShuffle === "function" ? getSavedShuffle() : true });
        return;
      }
      if (filter === "desarrollo") {
        if (typeof iniciarExamenDesarrollo === "function") iniciarExamenDesarrollo();
        return;
      }
      const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
      const shuffle = $("#shuffle-toggle") ? $("#shuffle-toggle").checked : (typeof getSavedShuffle === "function" ? getSavedShuffle() : true);
      startTest({ filter, immediate, shuffle });
    });
  });
}

function abrirModalModalidades() {
  const modal = document.getElementById("modal-modalidades-practica");
  if (!modal) return;
  renderModalidadesPractica();
  modal.classList.remove("hidden");
}

function cerrarModalModalidades() {
  const modal = document.getElementById("modal-modalidades-practica");
  if (modal) modal.classList.add("hidden");
}
