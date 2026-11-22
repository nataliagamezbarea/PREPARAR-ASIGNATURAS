"use strict";

const TOKEN_RE = /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:let|const|var|if|else|for|while|do|switch|case|break|continue|return|function|new|typeof|instanceof|true|false|null|undefined|NaN|console|parseInt|parseFloat|Number|String|Boolean|Object|Array|Math|Date|document|window|prompt|alert)\b|\b\d+(?:\.\d+)?\b)/g;

function highlightLine(line) {
  if (!line) return "";
  let out = "";
  let last = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(line)) !== null) {
    out += esc(line.slice(last, match.index));
    const token = match[0];
    let cls = "tok-key";
    if (token.startsWith("//") || token.startsWith("/*")) cls = "tok-com";
    else if (/^["'`]/.test(token)) cls = "tok-str";
    else if (/^\d/.test(token)) cls = "tok-num";
    out += `<span class="${cls}">${esc(token)}</span>`;
    last = match.index + token.length;
  }
  out += esc(line.slice(last));
  return out;
}

function renderCodeInto(container, code, activeLine = null) {
  if (!container) return null;
  container.innerHTML = "";
  const block = document.createElement("div");
  block.className = "code-block";
  const head = document.createElement("div");
  head.className = "code-head";
  head.innerHTML = "<span>JavaScript</span><span class=\"code-dots\">● ● ●</span>";
  const pre = document.createElement("pre");
  pre.className = "code-pre";
  const lines = String(code).replace(/\r/g, "").split("\n");
  lines.forEach((line, i) => {
    const row = document.createElement("div");
    row.className = "code-line" + (activeLine === i + 1 ? " active" : "");
    row.dataset.line = String(i + 1);
    const ln = document.createElement("span");
    ln.className = "ln";
    ln.textContent = String(i + 1);
    const lc = document.createElement("span");
    lc.className = "lc";
    lc.innerHTML = highlightLine(line) || "&nbsp;";
    row.append(ln, lc);
    pre.append(row);
  });
  block.append(head, pre);
  container.append(block);
  return block;
}

function varValueHTML(value) {
  if (value === "undefined") return '<span class="v-undef">undefined</span>';
  if (value === null) return '<span class="v-null">null</span>';
  if (value === "NaN") return '<span class="v-num">NaN</span>';
  if (typeof value === "string") return `<span class="v-str">"${esc(value)}"</span>`;
  if (typeof value === "number") return `<span class="v-num">${esc(value)}</span>`;
  if (typeof value === "boolean") return `<span class="v-bool">${value}</span>`;
  return esc(String(value));
}

function createTracePlayer(container, code, trace) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(trace) || !trace.length) {
    renderCodeInto(container, code, null);
    return;
  }
  const player = document.createElement("div");
  player.className = "trace-player";
  player.innerHTML = `
    <div class="trace-head">
      <div><span class="trace-kicker">Depurador</span><strong>Ejecución paso a paso</strong></div>
      <span class="trace-counter"></span>
    </div>
    <div class="trace-code"></div>
    <div class="trace-grid">
      <div class="trace-panel"><div class="panel-title">Scope · variables</div><div class="scope-vars"></div></div>
      <div class="trace-panel"><div class="panel-title">Salida · consola</div><pre class="console-out"></pre></div>
    </div>
    <div class="trace-note"></div>
    <div class="trace-controls">
      <button class="btn tiny" type="button" data-act="prev"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Anterior</button>
      <button class="btn tiny primary" type="button" data-act="next">Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button>
      <button class="btn tiny ghost" type="button" data-act="reset"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Reiniciar</button>
      <button class="btn tiny ghost" type="button" data-act="play"><i class="fa-solid fa-play" aria-hidden="true"></i> Reproducir</button>
    </div>
  `;
  const codeBox = player.querySelector(".trace-code");
  renderCodeInto(codeBox, code, trace[0].linea || 1);
  let cur = 0;
  let timer = null;
  const total = trace.length;

  function stopPlay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function update() {
    const step = trace[cur];
    player.querySelector(".trace-counter").textContent = `Paso ${cur + 1} / ${total}`;
    $$(".code-line", player).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.line) === Number(step.linea));
    });
    const varsBox = player.querySelector(".scope-vars");
    const entries = Object.entries(step.vars || {});
    varsBox.innerHTML = entries.length
      ? entries.map(([key, value]) => `<span class="var-chip"><b>${esc(key)}</b> = ${varValueHTML(value)}</span>`).join("")
      : '<span class="muted" style="font-size:12px">—</span>';
    const out = [];
    for (let i = 0; i <= cur; i++) {
      if (trace[i].salida != null) out.push(trace[i].salida);
      if (trace[i].error) out.push(`Error: ${trace[i].error}`);
    }
    player.querySelector(".console-out").textContent = out.length ? out.join("\n") : "—";
    player.querySelector(".trace-note").innerHTML = step.nota
      ? `<span class="note-icon"><i class="fa-solid fa-angle-right" aria-hidden="true"></i></span> ${formatText(step.nota)}`
      : "";
    player.querySelector('[data-act="prev"]').disabled = cur === 0;
    const nextBtn = player.querySelector('[data-act="next"]');
    if (nextBtn) {
      nextBtn.disabled = false;
      if (total <= 1) {
        nextBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Repetir';
      } else if (cur >= total - 1) {
        nextBtn.innerHTML = '<i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Repetir desde inicio';
      } else {
        nextBtn.innerHTML = 'Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
      }
    }
    const playBtn = player.querySelector('[data-act="play"]');
    playBtn.innerHTML = timer
      ? '<i class="fa-solid fa-pause" aria-hidden="true"></i> Pausa'
      : '<i class="fa-solid fa-play" aria-hidden="true"></i> Reproducir';
    playBtn.disabled = total <= 1;
  }

  function next() {
    stopPlay();
    if (cur < total - 1) {
      cur++;
    } else {
      cur = 0;
    }
    update();
  }

  function prev() {
    stopPlay();
    if (cur > 0) {
      cur--;
      update();
    }
  }

  function reset() {
    stopPlay();
    cur = 0;
    update();
  }

  function play() {
    if (timer) {
      stopPlay();
      update();
      return;
    }
    if (cur >= total - 1) cur = 0;
    update();
    timer = setInterval(() => {
      if (cur >= total - 1) {
        stopPlay();
        update();
        return;
      }
      cur++;
      update();
    }, 950);
  }

  player.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "next") next();
    else if (btn.dataset.act === "prev") prev();
    else if (btn.dataset.act === "reset") reset();
    else if (btn.dataset.act === "play") play();
  });
  update();
  container.append(player);
}

function generarTrazaFallback(q) {
  if (!q) return [];
  if (Array.isArray(q.traza) && q.traza.length) return q.traza;
  if (!q.codigo) return [];

  const lineas = String(q.codigo).replace(/\r/g, "").split("\n");
  const traza = [];

  lineas.forEach((lineaTexto, idx) => {
    const numLinea = idx + 1;
    const trim = lineaTexto.trim();
    if (!trim) return;

    let nota = `Línea ${numLinea}: ${trim}`;
    let salida = null;

    const matchLog = trim.match(/console\.log\(\s*['"`]([^'"`]+)['"`]\s*\)/);
    if (matchLog && !trim.includes("setTimeout") && !trim.includes(".then")) {
      salida = matchLog[1];
      nota = `Ejecución síncrona: imprime "${salida}"`;
    } else if (trim.includes("setTimeout")) {
      nota = "Temporizador / Macrotarea: encola callback en la cola de macrotareas.";
    } else if (trim.includes("Promise") || trim.includes(".then")) {
      nota = "Promesa / Microtarea: encola callback en la cola de microtareas (alta prioridad).";
    }

    traza.push({
      linea: numLinea,
      nota,
      salida,
      vars: {}
    });
  });

  if (/microtarea|macrotarea|event loop|asincron/i.test((q.explicacion || "") + " " + (q.tag || ""))) {
    traza.push({
      linea: lineas.length,
      nota: "Event Loop (Fase Microtareas): procesa promesas resueltas de la cola de microtareas.",
      salida: null,
      vars: { "Fase Event Loop": "Microtareas" }
    });
    traza.push({
      linea: lineas.length,
      nota: "Event Loop (Fase Macrotareas): ejecuta los temporizadores encolados (setTimeout).",
      salida: null,
      vars: { "Fase Event Loop": "Macrotareas" }
    });
  }

  return traza.length ? traza : [{ linea: 1, nota: "Inicio de ejecución", vars: {} }];
}

function renderDebugView(container, q, selected) {
  if (!container) return;
  container.innerHTML = "";
  const card = document.createElement("div");
  card.className = "debug-card";
  card.style.cssText = `
    margin-top: 12px;
    padding: 14px;
    background: #0b1120;
    border: 1px solid #1e293b;
    border-radius: 12px;
    color: #e2e8f0;
    font-size: 13px;
  `;

  const head = document.createElement("div");
  head.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1e293b;
    flex-wrap: wrap;
    gap: 8px;
  `;
  head.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="color:#38bdf8; font-weight:700; font-size:13px;"><i class="fa-solid fa-bug" aria-hidden="true"></i> Depurador de pregunta</span>
      <span style="background:#1e293b; color:#94a3b8; padding:2px 8px; border-radius:999px; font-size:11px;">#${q.id ?? "?"} · Tema ${q.tema ?? "?"}</span>
    </div>
    <span style="font-size:11px; color:#64748b;">${esc(q.tag || q.apartadoNombre || "JavaScript")}</span>
  `;
  card.append(head);

  if (q.codigo) {
    const execBox = document.createElement("div");
    execBox.style.marginBottom = "14px";

    const execBtn = document.createElement("button");
    execBtn.type = "button";
    execBtn.className = "btn tiny primary";
    execBtn.innerHTML = '<i class="fa-solid fa-play" aria-hidden="true"></i> Ejecutar código en vivo';

    const consolePre = document.createElement("pre");
    consolePre.style.cssText = `
      display: none;
      margin-top: 8px;
      padding: 10px;
      background: #020617;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #22d3ee;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
      max-height: 180px;
      overflow-y: auto;
    `;

    execBtn.addEventListener("click", () => {
      consolePre.style.display = "block";
      consolePre.textContent = "▶ Ejecutando…\n";
      const salidas = [];
      const fakeConsole = {
        log: (...args) => {
          const linea = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          salidas.push(linea);
          consolePre.textContent = salidas.join("\n");
          if (window.cv) window.cv.log(`[Ejecución #${q.id}] ${linea}`);
        },
        error: (...args) => {
          const linea = "❌ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          salidas.push(linea);
          consolePre.textContent = salidas.join("\n");
          if (window.cv) window.cv.error(`[Ejecución #${q.id}] ${linea}`);
        },
        warn: (...args) => {
          const linea = "⚠️ " + args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          salidas.push(linea);
          consolePre.textContent = salidas.join("\n");
        }
      };

      try {
        const fn = new Function("console", q.codigo);
        fn(fakeConsole);
        if (!salidas.length) {
          consolePre.textContent = "(El código se ejecutó sin imprimir en consola)";
        }
      } catch (err) {
        fakeConsole.error(err.message);
      }
    });

    execBox.append(execBtn, consolePre);
    card.append(execBox);

    const tracePlayerBox = document.createElement("div");
    const traza = generarTrazaFallback(q);
    createTracePlayer(tracePlayerBox, q.codigo, traza);
    card.append(tracePlayerBox);
  } else {
    const info = document.createElement("div");
    info.style.cssText = "line-height:1.6; color:#94a3b8; font-size:12px;";
    info.innerHTML = `
      <div><b>Enunciado:</b> ${formatText(q.enunciado || "")}</div>
      <div style="margin-top:6px;"><b>Tu respuesta:</b> ${selected ? `<b>${selected})</b> ${formatText(q.opciones?.[selected] ?? "")}` : "Sin responder"}</div>
      <div><b>Respuesta correcta:</b> <b>${q.correcta})</b> ${formatText(q.opciones?.[q.correcta] ?? "")}</div>
      <div style="margin-top:6px; color:#64748b;">(Esta es una pregunta conceptual sin bloque de código ejecutable).</div>
    `;
    card.append(info);
  }

  container.append(card);
}
