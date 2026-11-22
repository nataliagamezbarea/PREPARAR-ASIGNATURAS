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
    const headers = { "Content-Type": "application/json" };
    const nvKey = localStorage.getItem("preparar_tests_nvidia_key");
    if (nvKey) headers["x-nvidia-api-key"] = nvKey;
    const res = await fetch(`${window.location.origin}${endpoint}`, {
      method: "POST",
      headers,
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

  const btnDebug = document.createElement("button");
  btnDebug.type = "button";
  btnDebug.className = "btn tiny debug-btn";
  btnDebug.innerHTML = '<i class="fa-solid fa-bug" aria-hidden="true"></i> Depurador';
  btnDebug.title = "Abrir depurador interactivo para esta pregunta";

  const hint = document.createElement("span");
  hint.className = "ai-hint";
  hint.textContent = "Otra forma de explicarlo, paso a paso y con un ejemplo.";
  actions.append(btn, btnDebug, hint);

  const slot = document.createElement("div");
  slot.className = "ai-answer hidden";

  const debugSlot = document.createElement("div");
  debugSlot.className = "debug-slot hidden";

  wrap.append(actions, slot, debugSlot);

  let loaded = false;
  let loading = false;
  let debugLoaded = false;

  btnDebug.addEventListener("click", () => {
    const isHidden = debugSlot.classList.toggle("hidden");
    btnDebug.innerHTML = isHidden
      ? '<i class="fa-solid fa-bug" aria-hidden="true"></i> Depurador'
      : '<i class="fa-solid fa-bug" aria-hidden="true"></i> Ocultar depurador';

    if (window.cv) {
      if (typeof window.cv.abrir === "function") {
        window.cv.abrir();
      } else {
        document.getElementById("cv-toggle")?.click();
      }
      window.cv.log(`[Debug Pregunta #${q.id ?? "?"}] Tema ${q.tema ?? "?"} · ${q.tag || q.apartadoNombre || "Sin apartado"}`);
      if (q.codigo) {
        window.cv.log(`Código:\n${q.codigo}`);
      }
      if (typeof window.cv.setEstado === "function") {
        window.cv.setEstado("preguntaActual", {
          id: q.id,
          tema: q.tema,
          apartado: q.apartado,
          seleccionada: selected,
          correcta: q.correcta,
          esCorrecta: selected === q.correcta
        });
      }
    }

    if (isHidden || debugLoaded) return;
    debugLoaded = true;
    if (typeof renderDebugView === "function") {
      renderDebugView(debugSlot, q, selected);
    }
  });

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
  attachAiExplain(box, q, selected);
  return box;
}

function esPreguntaAbierta(q) {
  if (!q) return false;
  const t = String(q.tipo || "").toLowerCase();
  return (
    t === "escribir_codigo" ||
    t === "escribir" ||
    t === "escriure" ||
    t === "traza_linea" ||
    t === "interpretar" ||
    t === "desarrollo" ||
    t === "abierta" ||
    t === "oberta"
  );
}

function obtenerPlaceholderAbierta(q) {
  if (q.tipo === "escribir_codigo" && q.codigo) {
    return "// Escribe aquí la función en JavaScript para sacar un 10:\nfunction miSolucion(...) {\n  // Tu código aquí\n}";
  }
  if (q.tipo === "traza_linea" || q.tipo === "interpretar") {
    return "// Explica paso a paso cada línea y la salida final:\n// Línea 1: ...\n// Línea 2: ...\n// Salida final por consola: ...";
  }
  return "Escribe aquí tu desarrollo técnico, enumeración de fases o solución detallada...";
}

function renderTest() {
  state.screen = "test";
  const q = currentQuestion();
  if (!q) {
    renderResults();
    return;
  }
  saveSession();
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
          <span class="chip ${esPreguntaAbierta(q) ? "ok" : q.tipo === "codigo" ? "brand" : ""}">${q.tipo === "escribir_codigo" ? (q.codigo ? "Escribir función" : "Desarrollo / Escrito") : (q.tipo === "traza_linea" || q.tipo === "interpretar") ? "Traza línea a línea" : esPreguntaAbierta(q) ? "Pregunta abierta / Desarrollo" : q.tipo === "codigo" ? "Código" : "Teoría"}</span>
          <span class="chip ${difTone}">${esc(q.dificultad || "media")}</span>
        </div>
        <div class="test-live" id="live-score">${liveScoreHTML()}</div>
      </div>
      <div class="progress" aria-hidden="true"><div class="progress-bar" style="width:${progress}%"></div></div>
      <article class="question-card" id="question-card">
        <div class="q-tag">${esc(limpiarPistasEnunciado(q.tag || "WEC"))}</div>
        <h2 class="q-text">${formatText(limpiarPistasEnunciado(q.enunciado))}</h2>
        ${q.codigo ? '<div class="code-slot" id="code-slot"></div>' : ""}
        ${esPreguntaAbierta(q) ? `
          <div class="open-area" id="open-area" style="margin: 16px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
              <label for="open-textarea" style="font-size:13px; font-weight:700; color:#38bdf8;">
                ${(q.tipo === "escribir_codigo" && q.codigo) ? "💻 Tu solución en código JavaScript (escribe tu función):" : (q.tipo === "traza_linea" || q.tipo === "interpretar") ? "🔍 Traza línea a línea (explica qué hace cada línea y la salida final):" : "✍️ Tu explicación técnica y respuesta:"}
              </label>
              <span style="font-size:11px; color:#94a3b8; background:#0f172a; padding:3px 8px; border-radius:999px; border:1px solid #334155;"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> Corrección IA (Nota 0-10)</span>
            </div>
            <textarea id="open-textarea" class="open-textarea" rows="10" style="width:100%; box-sizing:border-box; background:#020617; border:1px solid #334155; border-radius:10px; color:#e2e8f0; font-family:${q.tipo === 'desarrollo' || q.tipo === 'abierta' || q.tipo === 'oberta' || (!q.codigo && q.tipo === 'escribir_codigo') ? 'inherit' : 'ui-monospace, SFMono-Regular, Menlo, monospace'}; font-size:13px; padding:12px; line-height:1.5; resize:vertical;" placeholder="${esc(obtenerPlaceholderAbierta(q))}">${esc(selected || "")}</textarea>
            <div style="display:flex; gap:10px; margin-top:10px; align-items:center; flex-wrap:wrap;">
              ${(q.tipo === "escribir_codigo" && q.codigo) ? '<button type="button" class="btn tiny ghost" id="test-code-btn"><i class="fa-solid fa-play" aria-hidden="true"></i> Probar en consola</button>' : ''}
              <button type="button" class="btn primary tiny" id="submit-open-btn"><i class="fa-solid fa-robot" aria-hidden="true"></i> Enviar a la IA para corrección (Nota 0-10)</button>
              <span id="open-eval-status" style="font-size:12px; color:#94a3b8;"></span>
            </div>
            <div id="open-console-out" style="display:none; margin-top:10px; padding:10px; background:#020617; border:1px solid #334155; border-radius:8px; font-family:monospace; font-size:12px; color:#38bdf8; max-height:150px; overflow-y:auto; white-space:pre-wrap;"></div>
            <div id="open-eval-result" style="margin-top:14px; display:${q.evaluacionIA ? 'block' : 'none'};"></div>
          </div>
        ` : `
          <div class="options" id="options" role="group" aria-label="Opciones de respuesta">
            ${["A", "B", "C", "D"].map((letter) => optionHTML(q, letter, selected, practice, isAnswered)).join("")}
          </div>
        `}
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
  if (esPreguntaAbierta(q)) {
    if (q.evaluacionIA) {
      const evalSlot = $("#open-eval-result");
      if (evalSlot) {
        renderAiConversation(evalSlot, q, selected || "", { answer: q.evaluacionIA, messages: q.evaluacionMensajes || [] }, true);
      }
    }
    $("#test-code-btn")?.addEventListener("click", () => {
      const textarea = $("#open-textarea");
      const val = textarea?.value?.trim() || "";
      const consoleBox = $("#open-console-out");
      if (!consoleBox) return;
      consoleBox.style.display = "block";
      consoleBox.textContent = "▶ Probando código en consola…\n";
      const logs = [];
      const fakeConsole = {
        log: (...args) => {
          const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          logs.push(msg);
          consoleBox.textContent = logs.join("\n");
        },
        error: (...args) => {
          const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
          logs.push("❌ " + msg);
          consoleBox.textContent = logs.join("\n");
        },
      };
      try {
        const fn = new Function("console", val);
        fn(fakeConsole);
        if (!logs.length) {
          consoleBox.textContent = "✅ Código sintácticamente correcto (sin llamadas console.log directas).";
        }
      } catch (err) {
        consoleBox.textContent = `❌ Error de sintaxis o ejecución: ${err.message}`;
      }
    });

    const openTextarea = $("#open-textarea");
    openTextarea?.addEventListener("input", () => {
      state.answers[q.id] = openTextarea.value;
      saveSession();
    });

    $("#submit-open-btn")?.addEventListener("click", async () => {
      const textarea = $("#open-textarea");
      const val = textarea?.value?.trim() || "";
      if (!val) {
        toast("Escribe tu respuesta antes de enviarla.");
        textarea?.focus();
        return;
      }
      state.answers[q.id] = val;
      saveSession();
      const btn = $("#submit-open-btn");
      const status = $("#open-eval-status");
      const evalSlot = $("#open-eval-result");
      if (btn) btn.disabled = true;
      if (status) status.innerHTML = '<span class="ai-dot"></span> Evaluando con la IA para nota del 0 al 10…';
      try {
        const data = await requestAi("/api/explain", {
          pregunta: {
            ...q,
            tipo: q.tipo,
            enunciado: q.enunciado,
            codigo: q.codigo || "",
            explicacion: q.explicacion || "",
          },
          selected: val,
          esDesarrollo: true,
          subject: state.subject?.nombre || "WEC",
        });
        const text = aiExplanationText(data);
        if (!text) throw new Error("La IA no devolvió corrección.");
        q.evaluacionIA = text;
        const notaMatch = text.match(/Nota:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
        const nota = notaMatch ? parseFloat(notaMatch[1]) : null;
        if (nota !== null) {
          if (nota < 5) {
            updateWrongForAnswer(q, val, null);
          } else {
            const set = new Set(getWrongIds());
            set.delete(q.id);
            setWrongIds([...set]);
            const history = getHistory();
            if (history[q.id]) {
              history[q.id].passed = true;
              history[q.id].selected = val;
            }
            setHistory(history);
            writePersistenceFile();
          }
        }
        if (evalSlot) {
          evalSlot.style.display = "block";
          renderAiConversation(evalSlot, q, val, { answer: text, messages: [] }, true);
        }
        if (status) status.textContent = "✅ Evaluado por la IA";
        toast("Respuesta evaluada por la IA.");
      } catch {
        const feedbackLocal = `### Evaluación didáctica de referencia\n\n**Tu respuesta:**\n\`\`\`javascript\n${val}\n\`\`\`\n\n**Solución modelo y criterios para un 10:**\n${q.explicacion}\n\n*(Inicia el servidor local con Ollama para corrección automática interactiva).*`;
        q.evaluacionIA = feedbackLocal;
        if (evalSlot) {
          evalSlot.style.display = "block";
          renderAiConversation(evalSlot, q, val, { answer: feedbackLocal, messages: [] }, false);
        }
        if (status) status.textContent = "Respuesta guardada con solución de referencia.";
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  } else {
    if (practice && isAnswered) {
      $("#feedback-slot")?.append(renderFeedback(q, selected));
    }
    $$(".option").forEach((btn) => {
      btn.addEventListener("click", () => selectOption(btn.dataset.letter));
    });
  }
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
  const prev = history[q.id] || { fails: 0, correct: 0, attempts: 0 };
  const isCorrect = (selected === q.correcta);

  if (isCorrect) {
    set.delete(q.id);
    history[q.id] = {
      selected,
      at: new Date().toISOString(),
      fails: Number(prev.fails) || 0,
      correct: (Number(prev.correct) || 0) + 1,
      attempts: (Number(prev.attempts) || 0) + 1,
      passed: true
    };
  } else {
    set.add(q.id);
    history[q.id] = {
      selected,
      at: new Date().toISOString(),
      fails: (Number(prev.fails) || 0) + 1,
      correct: Number(prev.correct) || 0,
      attempts: (Number(prev.attempts) || 0) + 1,
      passed: false
    };
  }
  setWrongIds([...set]);
  setHistory(history);
  writePersistenceFile();

  if (window.SupabaseAuth && typeof window.SupabaseAuth.autoSyncProgressDebounced === "function") {
    window.SupabaseAuth.autoSyncProgressDebounced();
  }
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
