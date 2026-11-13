"use strict";

function limpiarPistasEnunciado(str) {
  return String(str || "")
    .replace(/\s*\((?:Caso|Caso de estudio|Caso práctico)\s*[^)]*\)\s*:?/gi, "")
    .replace(/\s*\[(?:Caso|Caso de estudio|Caso práctico)\s*[^\]]*\]\s*:?/gi, "")
    .trim();
}

function currentQuestion() {
  return state.order[state.index] || null;
}

function optionHTML(q, letter, selected, practice, isAnswered) {
  const text = q.opciones?.[letter] ?? "";
  const classes = ["option"];
  if (selected === letter) classes.push("selected");
  if (practice && isAnswered) {
    if (letter === q.correcta) classes.push("correct");
    else if (selected === letter) classes.push("wrong");
  }
  const disabled = practice && isAnswered ? "disabled" : "";
  return `
    <button class="${classes.join(" ")}" type="button" data-letter="${letter}" ${disabled}>
      <span class="option-letter">${letter}</span>
      <span class="option-text">${formatText(text)}</span>
    </button>`;
}

function liveScoreHTML() {
  if (state.immediate) {
    const correct = countCorrect();
    const failed = countAnswered() - correct;
    return `Aciertos <b>${correct}</b> · Fallos <b>${failed}</b>`;
  }
  return `Respondidas <b>${countAnswered()}</b> / ${state.order.length}`;
}

const AI_DEFAULT_URL = window.location.origin;

function aiBaseUrl() {
  const stored = readJSON(LS.ai, "");
  return String(stored || AI_DEFAULT_URL).trim().replace(/\/+$/, "");
}

function setAiBaseUrl(url) {
  writeJSON(LS.ai, String(url || "").trim().replace(/\/+$/, ""));
}

async function requestAi(endpoint, payload, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${window.location.origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* respuesta no JSON */ }
    if (!res.ok) {
      const detail = data?.detail || data?.error || raw || `HTTP ${res.status}`;
      throw Object.assign(
        new Error(typeof detail === "string" ? detail : JSON.stringify(detail)),
        { status: res.status },
      );
    }
    if (!data) throw new Error("El servicio de IA devolvió una respuesta vacía.");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("La IA tardó demasiado. Prueba otra vez.");
    if (error instanceof TypeError) throw new Error(`No se puede conectar con la API de esta aplicación en ${window.location.origin}. ¿Está levantado Preparar tests?`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function aiExplanationText(data) {
  return String(
    data?.explanation || data?.explicacion || data?.text || data?.data?.text || data?.answer || ""
  ).trim();
}

function aiExplanationKey(question, selected) {
  return `${state.subjectId || "default"}:${question.id}:${selected || ""}`;
}

function readAiConversation(question, selected) {
  const explanations = readJSON("preparar-tests.explicaciones-ia", {});
  const saved = explanations[aiExplanationKey(question, selected)];
  if (typeof saved === "string") return { answer: saved, messages: [] };
  if (!saved || typeof saved.answer !== "string")
    return { answer: "", messages: [] };
  return {
    answer: saved.answer,
    messages: Array.isArray(saved.messages)
      ? saved.messages.filter(
          (message) =>
            message &&
            ["user", "assistant"].includes(message.role) &&
            typeof message.content === "string",
        )
      : [],
  };
}

function saveAiConversation(question, selected, conversation) {
  const explanations = readJSON("preparar-tests.explicaciones-ia", {});
  explanations[aiExplanationKey(question, selected)] = conversation;
  writeJSON("preparar-tests.explicaciones-ia", explanations);
}

function preguntaParaIA(q) {
  return {
    id: q.id,
    tema: q.tema,
    apartado: q.apartado ?? 0,
    apartadoNombre: q.apartadoNombre || "",
    tipo: q.tipo,
    tag: q.tag,
    enunciado: q.enunciado,
    codigo: q.codigo || "",
    opciones: q.opciones,
    correcta: q.correcta,
    explicacion: q.explicacion || "",
  };
}

function renderAiConversation(slot, question, selected, conversation, saved) {
  slot.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "ai-answer-head";
  heading.innerHTML = saved
    ? '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Explicación guardada · disponible sin IA'
    : '<i class="fa-solid fa-robot" aria-hidden="true"></i> Explicación de la IA · guardada automáticamente';
  const explanation = document.createElement("div");
  explanation.className = "ai-answer-body";
  explanation.innerHTML = formatText(conversation.answer);
  slot.append(heading, explanation);

  const chat = document.createElement("section");
  chat.className = "ai-chat";
  const chatHeading = document.createElement("h3");
  chatHeading.className = "ai-chat-title";
  chatHeading.textContent = "¿Te quedan dudas? Pregúntame";
  const messages = document.createElement("div");
  messages.className = "ai-chat-messages";
  messages.setAttribute("aria-live", "polite");
  for (const message of conversation.messages) {
    const bubble = document.createElement("div");
    bubble.className = `ai-chat-message ${message.role}`;
    bubble.innerHTML = formatText(message.content);
    messages.append(bubble);
  }

  const form = document.createElement("form");
  form.className = "ai-chat-form";
  const input = document.createElement("textarea");
  input.className = "ai-chat-input";
  input.rows = 2;
  input.maxLength = 1000;
  input.placeholder = "Escribe tu duda sobre esta pregunta…";
  input.setAttribute("aria-label", "Tu pregunta de seguimiento");
  input.required = true;
  const send = document.createElement("button");
  send.className = "btn tiny primary";
  send.type = "submit";
  send.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Enviar';
  const status = document.createElement("div");
  status.className = "ai-chat-status";
  status.setAttribute("role", "status");
  form.append(input, send);
  chat.append(chatHeading, messages, form, status);
  slot.append(chat);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userQuestion = input.value.trim();
    if (!userQuestion || send.disabled) return;
    const history = conversation.messages.slice(-10);
    input.disabled = true;
    send.disabled = true;
    status.textContent = "Preparando una respuesta…";
    send.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Pensando…';
    try {
      const data = await requestAi("/api/explain", {
        pregunta: preguntaParaIA(question),
        selected: selected || null,
        subject: state.subject?.nombre || "",
        followUp: userQuestion,
        initialExplanation: conversation.answer,
        conversation: history,
        language: "es",
      });
      const answer = aiExplanationText(data);
      if (!answer) throw new Error("La IA no devolvió ninguna respuesta.");
      conversation.messages.push(
        { role: "user", content: userQuestion },
        { role: "assistant", content: answer },
      );
      saveAiConversation(question, selected, conversation);
      renderAiConversation(slot, question, selected, conversation, true);
    } catch (error) {
      input.disabled = false;
      send.disabled = false;
      send.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Enviar';
      status.textContent = `No se pudo responder: ${error.message}`;
      input.focus();
    }
  });
}

function attachAiExplain(container, q, selected) {
  const wrap = document.createElement("div");
  wrap.className = "ai-explain";

  const actions = document.createElement("div");
  actions.className = "ai-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn tiny ai-btn";
  btn.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i> Explícamelo mejor';
  const hint = document.createElement("span");
  hint.className = "ai-hint";
  hint.textContent = "Otra forma de explicarlo, paso a paso y con un ejemplo.";
  actions.append(btn, hint);

  const slot = document.createElement("div");
  slot.className = "ai-answer hidden";
  wrap.append(actions, slot);

  let loaded = false;
  let loading = false;

  btn.addEventListener("click", async () => {
    if (loaded) {
      slot.classList.toggle("hidden");
      return;
    }
    if (loading) return;
    loading = true;
    btn.disabled = true;
    slot.classList.remove("hidden");
    const conversacionGuardada = readAiConversation(q, selected);
    if (conversacionGuardada.answer) {
      loaded = true;
      renderAiConversation(slot, q, selected, conversacionGuardada, true);
      btn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Ocultar explicación';
      loading = false;
      btn.disabled = false;
      return;
    }
    if (q.explicacionClara) {
      const conversation = { answer: q.explicacionClara, messages: [] };
      saveAiConversation(q, selected, conversation);
      loaded = true;
      renderAiConversation(slot, q, selected, conversation, false);
      btn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Ocultar explicación';
      loading = false;
      btn.disabled = false;
      return;
    }
    btn.innerHTML = '<i class="fa-solid fa-robot" aria-hidden="true"></i> Pensando…';
    slot.innerHTML = '<div class="ai-loading"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span> Preparando una explicación clara…</div>';
    try {
      const data = await requestAi("/api/explain", {
        pregunta: preguntaParaIA(q),
        selected: selected || null,
        subject: state.subject?.nombre || "",
        language: "es"
      });
      const text = aiExplanationText(data);
      if (!text) throw new Error("La IA no devolvió ninguna explicación.");
      const conversation = { answer: text, messages: [] };
      saveAiConversation(q, selected, conversation);
      loaded = true;
      renderAiConversation(slot, q, selected, conversation, false);
      btn.innerHTML = '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> Ocultar explicación';
    } catch (error) {
      slot.innerHTML = `
        <div class="ai-answer-head bad">${error.status ? "El servidor devolvió un error" : "No se pudo conectar con la IA"}</div>
        <div class="ai-answer-body">${esc(error.message)}</div>
        <div class="ai-answer-body" style="margin-top:6px">${error.status ? "El servidor recibió la solicitud, pero no pudo completar la explicación. Revisa el detalle y vuelve a intentarlo." : "Comprueba que Preparar tests esté activo y que Ollama tenga el modelo local."}</div>
      `;
      btn.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Reintentar';
    } finally {
      loading = false;
      btn.disabled = false;
    }
  });

  container.append(wrap);
  return wrap;
}

function renderFeedback(q, selected) {
  const correct = selected === q.correcta;
  const correctText = q.opciones?.[q.correcta] ?? "";
  const selectedText = selected ? (q.opciones?.[selected] ?? "") : "";
  const box = document.createElement("div");
  box.className = `feedback ${correct ? "ok" : "bad"}`;
  box.innerHTML = `
    <div class="feedback-head">
      <span class="feedback-icon"><i class="fa-solid ${correct ? "fa-check" : "fa-xmark"}" aria-hidden="true"></i></span>
      <span>${correct ? "Correcto" : "Incorrecto"}</span>
    </div>
    <p>${formatText(q.explicacion || "")}</p>
    <div class="answer-line">
      ${selected ? `Tu respuesta: <b>${selected})</b> ${formatText(selectedText)}` : "Sin responder"}
      ${correct ? "" : ` · Correcta: <b>${q.correcta})</b> ${formatText(correctText)}`}
    </div>
  `;
  if (q.tipo === "codigo" && q.codigo && q.traza && q.traza.length) {
    const wrap = document.createElement("div");
    wrap.className = "trace-wrap";
    if (correct) {
      const details = document.createElement("details");
      details.className = "trace-details";
      const summary = document.createElement("summary");
      summary.textContent = "Ver ejecución paso a paso";
      const slot = document.createElement("div");
      details.append(summary, slot);
      let built = false;
      details.addEventListener("toggle", () => {
        if (details.open && !built) {
          built = true;
          createTracePlayer(slot, q.codigo, q.traza);
        }
      });
      wrap.append(details);
    } else {
      createTracePlayer(wrap, q.codigo, q.traza);
    }
    box.append(wrap);
  }
  attachAiExplain(box, q, selected);
  return box;
}

function renderTest() {
  state.screen = "test";
  const q = currentQuestion();
  if (!q) {
    renderResults();
    return;
  }
  setModeChip(state.immediate ? "Práctica" : "Examen", state.immediate ? "brand" : "warn");
  const selected = state.answers[q.id] || null;
  const isAnswered = selected != null;
  const practice = state.immediate;
  const progress = Math.round((countAnswered() / state.order.length) * 100);
  const difTone = q.dificultad === "dificil" ? "warn" : "brand";

  main.innerHTML = `
    <section class="test-shell">
      <div class="test-top">
        <div class="test-meta">
          <span class="chip brand">Pregunta ${state.index + 1} / ${state.order.length}</span>
          <span class="chip">Tema ${q.tema}</span>
          ${q.apartado ? `<span class="chip">Apartado ${q.tema}.${q.apartado}${q.apartadoNombre ? ` · ${esc(q.apartadoNombre)}` : ""}</span>` : q.apartadoNombre ? `<span class="chip">Apartado: ${esc(q.apartadoNombre)}</span>` : ""}
          <span class="chip ${q.tipo === "codigo" ? "brand" : ""}">${q.tipo === "codigo" ? "Código" : "Teoría"}</span>
          <span class="chip ${difTone}">${esc(q.dificultad || "media")}</span>
        </div>
        <div class="test-live" id="live-score">${liveScoreHTML()}</div>
      </div>
      <div class="progress" aria-hidden="true"><div class="progress-bar" style="width:${progress}%"></div></div>
      <article class="question-card" id="question-card">
        <div class="q-tag">${esc(limpiarPistasEnunciado(q.tag || "WEC"))}</div>
        <h2 class="q-text">${formatText(limpiarPistasEnunciado(q.enunciado))}</h2>
        ${q.codigo ? '<div class="code-slot" id="code-slot"></div>' : ""}
        <div class="options" id="options" role="group" aria-label="Opciones de respuesta">
          ${["A", "B", "C", "D"].map((letter) => optionHTML(q, letter, selected, practice, isAnswered)).join("")}
        </div>
        <div id="feedback-slot"></div>
        <div class="test-actions">
          <div class="right">
            <button class="btn ghost" type="button" id="prev-btn" ${state.index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Anterior</button>
            <button class="btn ghost" type="button" id="exit-btn">Inicio</button>
          </div>
          <button class="btn primary" type="button" id="next-btn">${state.index === state.order.length - 1 ? "Ver resultados" : 'Siguiente <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>'}</button>
        </div>
      </article>
    </section>
  `;

  if (q.codigo) {
    renderCodeInto($("#code-slot"), q.codigo, null);
  }
  if (practice && isAnswered) {
    $("#feedback-slot")?.append(renderFeedback(q, selected));
  }
  $$(".option").forEach((btn) => {
    btn.addEventListener("click", () => selectOption(btn.dataset.letter));
  });
  $("#prev-btn")?.addEventListener("click", prevQuestion);
  $("#next-btn")?.addEventListener("click", nextQuestion);
  $("#exit-btn")?.addEventListener("click", () => {
    saveSession();
    renderStart();
    toast("Sesión guardada. Puedes continuar cuando quieras.");
  });
  updateFooter();
  document.activeElement?.blur?.();
}

function updateWrongForAnswer(q, selected, previous = null) {
  const set = new Set(getWrongIds());
  const history = getHistory();
  if (selected === q.correcta) {
    set.delete(q.id);
    delete history[q.id];
  } else {
    set.add(q.id);
    const prev = history[q.id] || {};
    history[q.id] = {
      selected,
      at: new Date().toISOString(),
      fails: previous == null ? (Number(prev.fails) || 0) + 1 : Math.max(1, Number(prev.fails) || 1)
    };
  }
  setWrongIds([...set]);
  setHistory(history);
  writePersistenceFile();
}

function selectOption(letter) {
  const q = currentQuestion();
  if (!q) return;
  if (!["A", "B", "C", "D"].includes(letter)) return;
  if (state.immediate && state.answers[q.id] != null) return;
  const previous = state.answers[q.id] ?? null;
  state.answers[q.id] = letter;
  updateWrongForAnswer(q, letter, previous);
  saveSession();
  renderTest();
}

function nextQuestion() {
  const q = currentQuestion();
  if (!q) return;
  if (state.immediate && state.answers[q.id] == null) {
    toast("Elige una opción antes de continuar.");
    return;
  }
  if (state.index >= state.order.length - 1) {
    finishTest();
    return;
  }
  state.index++;
  saveSession();
  renderTest();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function prevQuestion() {
  if (state.index <= 0) return;
  state.index--;
  saveSession();
  renderTest();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function failedQuestions() {
  return state.order.filter((q) => state.answers[q.id] !== q.correcta);
}

function gradeMessage(pct, total) {
  if (!total) return "No hay preguntas en este test.";
  if (pct >= 95) return "Nivel examen: sobresaliente. Ya casi lo tienes dominado.";
  if (pct >= 85) return "Muy buen nivel. Repasa solo los fallos y el 10 está cerca.";
  if (pct >= 70) return "Vas bien, pero hay trampas de examen que se te escapan. Insiste en los fallos.";
  if (pct >= 50) return "Base hecha. Toca repasar teoría y sobre todo el código paso a paso.";
  return "Todavía hay que trabajar el temario. Empieza por la teoría y vuelve al código después.";
}

function finishTest() {
  if (!state.order.length) return;
  state.finished = true;
  state.screen = "results";
  const total = state.order.length;
  const correct = countCorrect();
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const stats = getStats();
  stats.attempts = (Number(stats.attempts) || 0) + 1;
  stats.lastPct = pct;
  stats.lastTotal = total;
  stats.lastDate = new Date().toISOString();
  stats.bestPct = Math.max(Number(stats.bestPct) || 0, pct);
  setStats(stats);
  saveSession();
  renderResults();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
