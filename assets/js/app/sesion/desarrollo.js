"use strict";

// ============================================================
// ANÁLISIS DE SUBAPARTADOS DÉBILES Y RETOS DE DESARROLLO
// ============================================================

function renderWeakConceptsGrouped() {
  const weakContainer = $("#weak-concepts");
  if (!weakContainer) return;

  const weakGroups = typeof getWeakSubapartadosByTema === "function" ? getWeakSubapartadosByTema() : [];
  if (!weakGroups.length) {
    weakContainer.innerHTML = '<p class="muted" style="font-size:13px; padding:12px 0;">Aún no hay fallos suficientes para calcular subapartados débiles. En cuanto falles preguntas, aparecerán aquí agrupados por tema con sus porcentajes de error.</p>';
    return;
  }

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
    $$(".weak-tema-details").forEach((d) => (d.open = true));
  });
  $("#weak-plegar-todos")?.addEventListener("click", () => {
    $$(".weak-tema-details").forEach((d) => (d.open = false));
  });

  $$("[data-repasar-fallos-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = (btn.dataset.repasarFallosSub || "").split(",").map((s) => s.trim()).filter(Boolean);
      const ids = raw.map((id) => getQuestion(id)?.id || id).filter((id) => hasQuestion(id));
      if (ids.length) {
        const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
        startTest({ ids, immediate, shuffle: true });
      }
    });
  });

  $$("[data-start-apartado]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filter = "apartado:" + btn.dataset.startApartado;
      const immediate = $("#immediate-toggle") ? $("#immediate-toggle").checked : (typeof getSavedImmediate === "function" ? getSavedImmediate() : true);
      const shuffle = $("#shuffle-toggle") ? $("#shuffle-toggle").checked : (typeof getSavedShuffle === "function" ? getSavedShuffle() : true);
      startTest({ filter, immediate, shuffle });
    });
  });

  $$("[data-start-bloque]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const filterKey = btn.dataset.startBloque;
      startBloque(filterKey);
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
}
