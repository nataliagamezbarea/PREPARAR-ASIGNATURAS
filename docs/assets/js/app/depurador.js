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
