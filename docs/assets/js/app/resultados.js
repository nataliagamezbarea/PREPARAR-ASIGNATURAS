"use strict";

function renderResults() {
  state.screen = "results";
  state.finished = true;
  setModeChip("Resultados", "ok");
  const total = state.order.length;
  const correct = countCorrect();
  const answered = countAnswered();
  const failed = total - correct;
  const unanswered = total - answered;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const grade = total ? (correct / total) * 10 : 0;
  const wrongInSession = failedQuestions();
  const refuerzoSuperado = state.masteryMode && wrongInSession.length === 0;
  const themeStats = [...new Set(state.order.map((q) => Number(q.tema)))]
    .sort((a, b) => a - b)
    .map((tema) => {
      const list = state.order.filter((q) => Number(q.tema) === tema);
      return { tema, total: list.length, ok: list.filter((q) => state.answers[q.id] === q.correcta).length };
    });
  const subStatsMap = new Map();
  state.order.forEach((q) => {
    const isOk = state.answers[q.id] === q.correcta;
    const res = resolveApartadoForQuestion(q);
    const key = `t${res.tema}-ap${res.apartado || res.titulo}`;
    const cur = subStatsMap.get(key) || {
      tema: res.tema,
      apartado: res.apartado,
      codigo: res.codigo,
      titulo: res.titulo,
      tag: res.tag,
      total: 0,
      ok: 0,
      fails: 0,
      ids: [],
    };
    cur.total += 1;
    if (isOk) cur.ok += 1;
    else {
      cur.fails += 1;
      cur.ids.push(q.id);
    }
    subStatsMap.set(key, cur);
  });

  const subStats = [...subStatsMap.values()]
    .filter((s) => s.fails > 0)
    .map((s) => {
      const failPct = s.total ? Math.round((s.fails / s.total) * 100) : 100;
      return { ...s, failPct };
    })
    .sort((a, b) => b.failPct - a.failPct || b.fails - a.fails);
  const codeQs = state.order.filter((q) => q.tipo === "codigo");
  const okCode = codeQs.filter((q) => state.answers[q.id] === q.correcta).length;

  main.innerHTML = `
    <section class="results">
      <div class="score-card">
        <div class="score-ring" style="--pct:${pct}">
          <div><b>${grade.toFixed(1)}</b><span>sobre 10</span></div>
        </div>
        <div class="score-copy">
          <h1>${refuerzoSuperado ? "¡Temario reforzado sin fallos!" : esc(gradeMessage(pct, total))}</h1>
          <p>Has acertado <b>${correct}</b> de <b>${total}</b> preguntas (${pct}%). ${unanswered ? `Te quedaron ${unanswered} sin responder.` : "Contestaste todas."}</p>
          ${state.masteryMode ? `<p class="section-sub">Ronda ${state.masteryRound} de refuerzo. ${refuerzoSuperado ? "Has completado una ronda perfecta de todo el banco disponible." : "Revisa las explicaciones y repite el banco completo hasta completar una ronda sin fallos."}</p>` : ""}
          <div class="score-chips">
            <span class="chip">Aciertos ${correct}</span>
            <span class="chip">Fallos ${failed}</span>
            <span class="chip">Sin responder ${unanswered}</span>
          </div>
        </div>
      </div>

      <div class="breakdown">
        <div class="break-card"><b>${correct}</b><span>Aciertos (${pct}%)</span></div>
        <div class="break-card"><b>${failed}</b><span>Errores (${100 - pct}%)</span></div>
        ${themeStats.map(({ tema, total: t, ok }) => {
          const tFailPct = t ? Math.round(((t - ok) / t) * 100) : 0;
          return `<div class="break-card"><b>${ok}/${t}</b><span>Tema ${tema} · ${tFailPct}% fallos</span></div>`;
        }).join("")}
      </div>

      ${subStats.length ? `
      <div class="weak-topics">
        <h2><i class="fa-solid fa-triangle-exclamation"></i> Qué repasar primero</h2>
        <p class="section-sub">Los apartados y temas donde más has fallado en este test con sus porcentajes de error. Vuelve a sus apuntes antes de repetir.</p>
        <div class="results-weak-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:12px; margin-top:14px;">
          ${subStats.map((item) => `
            <div class="result-weak-card" style="background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                  <span class="chip" style="font-weight:700; background:rgba(59,130,246,0.18); color:var(--brand); border-radius:6px; font-size:12px; padding:2px 8px;">Tema ${item.tema}</span>
                  <span class="tree-chip bank-chip" style="font-weight:700">${item.codigo}</span>
                  ${item.tag ? `<span class="chip ghost" style="font-size:11px">${esc(item.tag)}</span>` : ""}
                </div>
                <span style="font-weight:800; font-size:12.5px; color:var(--bad); background:rgba(239,68,68,0.14); padding:3px 8px; border-radius:8px;">
                  ${item.failPct}% fallos
                </span>
              </div>
              <div style="font-size:14px; font-weight:600; color:var(--text);">
                ${esc(item.titulo)}
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; opacity:.85; margin-top:4px;">
                <span>Has fallado <b>${item.fails}</b> de ${item.total} preg. (${item.ok} aciertos)</span>
                <button class="btn tiny warn" type="button" data-repeat-sub="${item.ids.join(",")}" title="Repetir solo los fallos de este subapartado">Repetir ${item.fails} fallo${item.fails !== 1 ? "s" : ""}</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>` : ""}

      <div class="results-actions">
        <button class="btn primary" type="button" id="repeat-wrong" ${wrongInSession.length ? "" : "disabled"}>Repetir solo fallos (${wrongInSession.length})</button>
        ${state.masteryMode && !refuerzoSuperado ? `<button class="btn ok" type="button" id="mastery-next-round">Repetir todo el temario · ronda ${state.masteryRound + 1}</button>` : ""}
        <button class="btn" type="button" id="open-wrong-book">Ver todos mis fallos</button>
        <button class="btn ok" type="button" id="gen-ia-mas"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar más preguntas con IA</button>
        <button class="btn" type="button" id="repeat-test">Repetir este test</button>
        <button class="btn" type="button" id="new-test">Elegir otro test</button>
        <button class="btn ghost" type="button" id="print-results">Imprimir</button>
      </div>

      <h2>${wrongInSession.length ? "Qué has fallado y por qué" : "Sin fallos: ¡enhorabuena!"}</h2>
      <p class="section-sub">${wrongInSession.length
        ? "Cada error lleva su explicación. En las preguntas de código, el depurador muestra línea a línea qué hace el programa."
        : "No hay errores que revisar en este test. Puedes repetirlo o subir de dificultad con el test completo."}</p>
      <div class="wrong-list" id="wrong-list"></div>
      ${codeQs.length ? `<p class="section-sub" style="margin-top:14px">Interpretación de código: <b>${okCode}/${codeQs.length}</b> correctas.</p>` : ""}
      <div id="all-answers-slot" style="margin-top:18px"></div>
    </section>
  `;

  const wrongList = $("#wrong-list");
  if (wrongInSession.length) {
    wrongInSession.forEach((q, i) => wrongList.append(renderWrongItem(q, i + 1)));
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="emoji"><i class="fa-solid fa-party-horn" aria-hidden="true"></i></div><h3>Ningún fallo</h3><p>Has acertado las ${total} preguntas de este test.</p>`;
    wrongList.append(empty);
  }

  $("#all-answers-slot")?.append(renderAllAnswers());

  $("#repeat-wrong")?.addEventListener("click", () => {
    const ids = wrongInSession.map((q) => q.id);
    if (!ids.length) return;
    startTest({ filter: "fallos", ids, immediate: true, shuffle: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#repeat-test")?.addEventListener("click", () => {
    const ids = state.order.map((q) => q.id);
    const filter = state.selectedFilter === "fallos" ? "fallos" : state.selectedFilter || "all";
    startTest({
      filter,
      ids,
      immediate: state.immediate,
      shuffle: false,
      mastery: state.masteryMode,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#mastery-next-round")?.addEventListener("click", () => {
    startTest({
      filter: "all",
      immediate: true,
      shuffle: true,
      mastery: true,
      continueMastery: true,
    });
  });
  $("#new-test")?.addEventListener("click", renderStart);
  $("#open-wrong-book")?.addEventListener("click", renderWrongBook);
  $$("[data-repeat-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ids = (btn.dataset.repeatSub || "").split(",").map(Number).filter(Boolean);
      if (ids.length) {
        const immediate = $("#immediate-toggle")?.checked !== false;
        startTest({ ids, immediate, shuffle: true });
      }
    });
  });
  $("#gen-ia-mas")?.addEventListener("click", () => {
    sessionStorage.setItem("wec12_ai_origen", "resultados");
    sessionStorage.setItem("wec12_ai_instrucciones", "");
    sessionStorage.setItem("wec12_ai_contexto", "");
    renderAiScreen();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#print-results")?.addEventListener("click", () => window.print());
  updateFooter();
}
