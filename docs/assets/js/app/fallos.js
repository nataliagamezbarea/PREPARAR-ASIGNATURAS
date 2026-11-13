"use strict";

function renderWrongItem(q, position, options = {}) {
  const selected = options.selected !== undefined ? options.selected : (state.answers[q.id] || null);
  const number = options.number || q.id;
  const fails = Number(options.fails) || 0;
  const lazyTrace = Boolean(options.lazyTrace);
  const item = document.createElement("article");
  item.className = "wrong-item";

  const res = resolveApartadoForQuestion(q);
  const head = document.createElement("div");
  head.className = "wrong-head";
  head.innerHTML = `
    <span class="wrong-num">${position}</span>
    <span class="chip brand">Pregunta ${number}</span>
    <span class="chip" style="font-weight:700">Tema ${res.tema}</span>
    <span class="chip" style="font-weight:600">Apartado ${res.codigo} · ${esc(res.titulo)}</span>
    ${res.tag ? `<span class="chip ghost" style="font-size:11px">${esc(res.tag)}</span>` : ""}
    <span class="chip ${q.tipo === "codigo" ? "brand" : ""}">${q.tipo === "codigo" ? "Código" : "Teoría"}</span>
    ${fails > 1 ? `<span class="chip warn">Fallada ${fails} veces</span>` : ""}
    ${selected ? "" : '<span class="chip warn">Sin responder</span>'}
  `;
  item.append(head);

  const title = document.createElement("h3");
  title.innerHTML = formatText(q.enunciado);
  item.append(title);

  if (q.codigo) {
    const codeSlot = document.createElement("div");
    codeSlot.className = "code-slot";
    renderCodeInto(codeSlot, q.codigo, null);
    item.append(codeSlot);
  }

  const compare = document.createElement("div");
  compare.className = "answer-compare";
  const selectedText = selected ? (q.opciones?.[selected] ?? "") : "";
  compare.innerHTML = `
    <div class="line bad-line">${selected ? `Tu respuesta: ${selected}) ${formatText(selectedText)}` : "Sin responder"}</div>
    <div class="line ok-line">Correcta: ${q.correcta}) ${formatText(q.opciones?.[q.correcta] ?? "")}</div>
  `;
  item.append(compare);

  const explain = document.createElement("p");
  explain.className = "explain";
  explain.innerHTML = formatText(q.explicacion || "");
  item.append(explain);

  if (q.tipo === "codigo" && q.codigo && q.traza && q.traza.length) {
    const traceSlot = document.createElement("div");
    traceSlot.style.marginTop = "14px";
    if (lazyTrace) {
      const details = document.createElement("details");
      details.className = "trace-details";
      const summary = document.createElement("summary");
      summary.textContent = "Ver ejecución paso a paso";
      let built = false;
      details.addEventListener("toggle", () => {
        if (details.open && !built) {
          built = true;
          createTracePlayer(traceSlot, q.codigo, q.traza);
        }
      });
      details.append(summary, traceSlot);
      item.append(details);
    } else {
      createTracePlayer(traceSlot, q.codigo, q.traza);
      item.append(traceSlot);
    }
  }
  attachAiExplain(item, q, selected);

  return item;
}

function renderAllAnswers() {
  const details = document.createElement("details");
  details.className = "all-answers";
  const correct = countCorrect();
  details.innerHTML = `<summary>Ver las ${state.order.length} respuestas (${correct} aciertos)</summary>`;
  const list = document.createElement("div");
  list.className = "all-list";
  state.order.forEach((q) => {
    const selected = state.answers[q.id] || null;
    const ok = selected === q.correcta;
    const row = document.createElement("div");
    row.className = "all-item";
    row.innerHTML = `
      <div class="all-q"><i class="fa-solid ${ok ? "fa-check" : "fa-xmark"}" aria-hidden="true"></i> ${esc(q.enunciado.length > 120 ? q.enunciado.slice(0, 117) + "…" : q.enunciado)}</div>
      <div class="all-a">Tu respuesta: <b>${selected ? selected : "—"}</b> · Correcta: <b>${q.correcta}</b></div>
    `;
    list.append(row);
  });
  details.append(list);
  return details;
}

function renderWrongBook() {
  state.screen = "wrongs";
  setModeChip("Mis fallos", "bad");
  applyDynamicHeader();
  const all = wrongQuestions();
  const history = getHistory();
  const filter = state.wrongFilter || "todos";
  const counts = dataCounts();

  const matches = (q) => {
    if (filter === "todos") return true;
    if (typeof filter === "string" && filter.startsWith("tema:")) return Number(q.tema) === Number(filter.slice(5));
    if (filter === "codigo") return q.tipo === "codigo";
    if (filter === "teoria") return q.tipo === "teoria";
    return true;
  };
  const filtered = all.filter(matches);
  const themeFilters = counts.temas.map(({ tema }) => {
    const value = `tema:${tema}`;
    const active = filter === value;
    return `<button class="btn tiny ${active ? "primary" : ""}" type="button" data-wrong-filter="${value}">Tema ${tema}</button>`;
  }).join("");

  main.innerHTML = `
    <section class="test-shell">
      <div class="test-top">
        <div class="test-meta">
          <span class="chip bad">Mis fallos</span>
          <span class="chip">${all.length} guardados</span>
          <span class="chip brand">${filtered.length} en esta vista</span>
        </div>
        <button class="btn ghost tiny" type="button" id="book-home"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Inicio</button>
      </div>

      <article class="question-card" style="margin-bottom:16px">
        <div class="q-tag">Guardado automático</div>
        <h2 class="q-text" style="font-size:20px">Tus fallos se guardan solos</h2>
        <p class="muted" style="margin:6px 0 14px;font-size:13.5px">
          Cada vez que fallas una pregunta queda guardada automáticamente en este navegador. No tienes que importar
          ni vincular nada: si vuelves a fallar la misma, se actualiza; si la aciertas, desaparece de la lista.
          La copia JSON es solo un extra por si quieres llevártela.
        </p>
        <div class="test-meta" style="margin-bottom:14px">
          <span class="chip ok"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Guardado automático</span>
          <span class="chip">${Object.keys(history).length} con última respuesta guardada</span>
          <span class="chip">${all.filter((q) => q.tipo === "codigo").length} de código</span>
        </div>
        <div class="test-meta">
          <button class="btn tiny" type="button" id="book-export">Descargar copia JSON</button>
          <button class="btn tiny ghost" type="button" id="book-clear" ${all.length ? "" : "disabled"}>Borrar fallos</button>
        </div>
      </article>

      <div class="test-meta" style="margin-bottom:16px">
        <button class="btn tiny ${filter === "todos" ? "primary" : ""}" type="button" data-wrong-filter="todos">Todos (${all.length})</button>
        ${themeFilters}
        <button class="btn tiny ${filter === "codigo" ? "primary" : ""}" type="button" data-wrong-filter="codigo">Código (${all.filter((q) => q.tipo === "codigo").length})</button>
        <button class="btn tiny ${filter === "teoria" ? "primary" : ""}" type="button" data-wrong-filter="teoria">Teoría (${all.filter((q) => q.tipo === "teoria").length})</button>
      </div>

      <div class="test-actions" style="margin:0 0 18px">
        <div></div>
        <div class="right">
          <button class="btn primary" type="button" id="book-repeat" ${all.length ? "" : "disabled"}>Repetir todos los fallos (${all.length})</button>
          <button class="btn" type="button" id="book-back-test">Volver al inicio</button>
        </div>
      </div>

      <div class="wrong-list" id="wrong-book-list"></div>
    </section>
  `;

  const list = $("#wrong-book-list");
  if (!all.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <div class="emoji"><i class="fa-solid fa-folder-open" aria-hidden="true"></i></div>
      <h3>No hay fallos guardados</h3>
      <p>En cuanto falles una pregunta en un test, aparecerá aquí sola. No hay que importar nada.</p>
      <div style="margin-top:14px"><button class="btn primary" type="button" id="book-empty-start">Hacer un test</button></div>
    `;
    list.append(empty);
  } else if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div class="emoji"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></div><h3>Nada en este filtro</h3><p>Prueba con otro tema o con «Todos».</p>`;
    list.append(empty);
  } else {
    filtered.forEach((q, i) => {
      const entry = history[q.id] || {};
      list.append(renderWrongItem(q, i + 1, {
        selected: entry.selected || null,
        number: q.id,
        fails: entry.fails || 0,
        lazyTrace: true
      }));
    });
  }

  $("#book-home")?.addEventListener("click", renderStart);
  $("#book-back-test")?.addEventListener("click", renderStart);
  $("#book-empty-start")?.addEventListener("click", renderStart);
  $("#book-export")?.addEventListener("click", exportWrongsFile);
  $("#book-clear")?.addEventListener("click", () => {
    if (!confirm("¿Borrar todos los fallos guardados? Esta acción no borra tu historial de notas, solo los fallos.")) return;
    setWrongIds([]);
    setHistory({});
    writePersistenceFile();
    renderWrongBook();
    toast("Fallos borrados.");
  });
  $("#book-repeat")?.addEventListener("click", () => {
    if (!all.length) return;
    startTest({ filter: "fallos", immediate: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $$("[data-wrong-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.wrongFilter = btn.dataset.wrongFilter || "todos";
      renderWrongBook();
    });
  });
  updateFooter();
}
