"use strict";

const {
  borrarArchivosPersistidos,
  cargarArchivosPersistidos,
  guardarArchivosPersistidos,
} = window.prepararTestsPersistencia;

let aiDraftTimer;

const AI_DEFAULT_INSTRUCCIONES = "Genera preguntas originales para un examen tipo test. No copies frases ni ejemplos literales del material; parafrasea y cambia los datos, los nombres y el contexto. Usa distractores plausibles, evita «todas/ninguna de las anteriores» y asegúrate de que cada pregunta tenga una sola respuesta justificable con el material. Prioriza la comprensión, la aplicación a casos nuevos y la detección de errores. En preguntas de código, incluye una traza paso a paso coherente (línea, variables y salida). No inventes contenido para completar el número solicitado.";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function renderAiScreen() {
  state.screen = "ai";
  setModeChip("Generar con IA", "ok");
  applyDynamicHeader();

  let instruccionesPrev = sessionStorage.getItem("wec12_ai_instrucciones") || "";
  let contextoPrev = sessionStorage.getItem("wec12_ai_contexto") || "";
  sessionStorage.removeItem("wec12_ai_origen");
  sessionStorage.removeItem("wec12_ai_instrucciones");
  sessionStorage.removeItem("wec12_ai_contexto");

  const temasDelSubject = (state.subject?.temas ?? [])
    .map((t) => Number(t.numero))
    .filter((n) => Number.isInteger(n) && n > 0);
  const temaDefault = temasDelSubject.length === 1 ? temasDelSubject[0] : 0;
  const temasParam = temasDelSubject.length ? temasDelSubject.join(",") : "todos";

  const valoresBorrador = {};
  let borradorRestaurado = false;
  try {
    const borrador = cargarArchivosPersistidos("generacion-ia");
    if (borrador && borrador.valores) {
      Object.assign(valoresBorrador, borrador.valores);
      borradorRestaurado = true;
    }
  } catch { /* sin borrador guardado */ }

  const asignaturaValue = String(
    valoresBorrador.asignatura || state.subject?.nombre || "Nueva asignatura",
  ).slice(0, 80);
  const countValue = Number(valoresBorrador.count) || 10;
  const typesValue = valoresBorrador.tipos || "mixto";
  const contextoValue = contextoPrev || String(valoresBorrador.contexto || "");
  let draftInstrucciones = String(valoresBorrador.instrucciones || "");
  if (draftInstrucciones.includes("CONCEPTOS DÉBILES")) {
    draftInstrucciones = "";
  }
  let prevInstrucciones = String(instruccionesPrev || "");
  if (prevInstrucciones.includes("CONCEPTOS DÉBILES")) {
    prevInstrucciones = "";
  }
  const instruccionesValue =
    prevInstrucciones || draftInstrucciones || AI_DEFAULT_INSTRUCCIONES;

  const tiposLabel = { mixto: "Teoría y código", teoria: "Solo teoría", codigo: "Solo código" }[typesValue] || "Teoría y código";

  main.innerHTML = `
    <section class="test-shell">
      <div class="test-top">
        <div class="test-meta">
          <span class="chip ok"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar con IA</span>
          <span class="chip">Ollama local · gratis · sin límites de uso</span>
        </div>
        <button class="btn ghost tiny" type="button" id="ai-home"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Inicio</button>
      </div>

      <article class="question-card">
        <div class="ai-grid">
          <div>
            <h2 class="q-text" style="font-size:22px">Generar preguntas con tu IA local</h2>
            <p class="muted" style="margin:6px 0 16px;font-size:13.5px">
              Las preguntas las redacta tu modelo Ollama local (Docker, sin claves de API y sin límites de uso).
              El material de estudio puede ser <b>tus apuntes privados</b> de la asignatura seleccionada
              o un <b>contexto de texto libre</b> (por ejemplo, tus conceptos más débiles). La IA no copia los
              apuntes: parafrasea, añade casos prácticos y trampas de examen.
            </p>

            <div class="ai-field">
              <label for="ai-subject">Nombre de la asignatura</label>
              <input class="control" id="ai-subject" value="${esc(asignaturaValue)}" maxlength="80">
            </div>

            <div class="ai-field" style="display:flex;gap:12px;flex-wrap:wrap">
              <div style="flex:0 0 150px">
                <label for="ai-count">Nº de preguntas</label>
                <input class="control" id="ai-count" type="number" min="1" max="80" value="${countValue}" style="width:100%">
              </div>
              <div style="flex:1 1 220px">
                <label for="ai-types">Tipo</label>
                <select class="control" id="ai-types" style="width:100%">
                  <option value="mixto">Teoría + código</option>
                  <option value="teoria">Solo teoría</option>
                  <option value="codigo">Solo código</option>
                </select>
              </div>
            </div>

            <div class="ai-field">
              <label for="ai-context">Contexto de estudio (material libre)</label>
              <textarea id="ai-context" rows="4" placeholder="Ej.: diferencias entre GET y POST, errores típicos con punteros en C, cómo funciona el bucle de eventos de Node.js…">${esc(contextoValue)}</textarea>
              <p class="muted" style="font-size:12px">Deja vacío para generar a partir de los apuntes privados de la asignatura seleccionada.</p>
            </div>

            <div class="ai-field">
              <label for="ai-instrucciones">Instrucciones para la IA</label>
              <textarea id="ai-instrucciones" rows="5">${esc(instruccionesValue)}</textarea>
              <p class="muted" style="font-size:12px">Aquí va lo que la IA debe seguir obligatoriamente (estilo, nivel, «no repitas estos enunciados», conceptos débiles prioritarios…).</p>
            </div>

            <div class="test-meta" style="margin-top:16px">
              <button class="btn primary" type="button" id="ai-generate"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar preguntas</button>
              <button class="btn ghost" type="button" id="ai-clear">Limpiar</button>
              <span id="ai-tema-info" class="chip" style="font-size:12px">Temas: ${temasParam === "todos" ? "todos" : temasParam}</span>
            </div>
            <div class="ai-log" id="ai-log"></div>
          </div>

          <div>
            <h2 class="q-text" style="font-size:22px">Resultado</h2>
            <p class="muted" style="margin:6px 0 14px;font-size:13.5px">
              Revisa las preguntas generadas y practica con ellas. Se guardan como una asignatura local
              y la próxima generación evitará repetir sus enunciados.
            </p>
            <div class="test-meta" id="ai-result-actions" style="margin-bottom:12px"></div>
            <div class="ai-preview" id="ai-preview">
              <div class="empty-state">
                <div class="emoji"><i class="fa-solid fa-robot" aria-hidden="true"></i></div>
                <h3>Todavía no hay preguntas</h3>
                <p>Rellena el contexto (o usa tus apuntes) y pulsa «Generar preguntas».</p>
              </div>
            </div>
          </div>
        </div>
      </article>
    </section>
  `;

  const log = $("#ai-log");
  const logMensaje = (mensaje) => {
    if (log) log.textContent = mensaje;
  };

  const programarGuardado = () => {
    window.clearTimeout(aiDraftTimer);
    aiDraftTimer = window.setTimeout(() => {
      try {
        guardarArchivosPersistidos("generacion-ia", [], {
          asignatura: $("#ai-subject")?.value || "",
          count: $("#ai-count")?.value || "",
          tipos: $("#ai-types")?.value || "",
          contexto: $("#ai-context")?.value || "",
          instrucciones: $("#ai-instrucciones")?.value || "",
        });
      } catch { /* IndexedDB no disponible */ }
    }, 400);
  };

  for (const selector of [
    "#ai-subject", "#ai-prompt", "#ai-count", "#ai-types", "#ai-context", "#ai-instrucciones",
  ]) {
    $(selector)?.addEventListener("input", programarGuardado);
    $(selector)?.addEventListener("change", programarGuardado);
  }
  $("#ai-types")?.addEventListener("change", () => {
    const el = $("#ai-tema-info");
    // el tema no cambia con el tipo; solo refresca el borrador
    programarGuardado();
  });

  $("#ai-home")?.addEventListener("click", renderStart);

  $("#ai-clear")?.addEventListener("click", () => {
    $("#ai-subject").value = String(state.subject?.nombre || "Nueva asignatura");
    $("#ai-count").value = "10";
    $("#ai-types").value = "mixto";
    $("#ai-context").value = "";
    $("#ai-instrucciones").value = AI_DEFAULT_INSTRUCCIONES;
    $("#ai-preview").innerHTML = aiEmptyPreview();
    $("#ai-result-actions").innerHTML = "";
    logMensaje("Listo.");
    try { borrarArchivosPersistidos("generacion-ia"); } catch { /* noop */ }
  });

  async function vigilarTarea(id) {
    return new Promise((resolve, reject) => {
      let pasos = 0;
      const tick = async () => {
        if (!aiGenerating) {
          reject(new Error("Generación cancelada."));
          return;
        }
        try {
          const res = await fetch(
            `${window.location.origin}/api/generar/${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          if (!res.ok) {
            reject(new Error(`No se pudo consultar el progreso (HTTP ${res.status}).`));
            return;
          }
          const tarea = await res.json();
          const detalle = tarea.detalle ? ` · ${tarea.detalle}` : "";
          logMensaje(`${tarea.fase}: ${tarea.mensaje}${detalle}`);
          if (tarea.terminado) {
            aiGenerating = false;
            aiTaskId = null;
            if (aiPollTimer) { clearTimeout(aiPollTimer); aiPollTimer = null; }
            resolve(tarea);
            return;
          }
          pasos += 1;
          if (pasos > 400) {
            reject(new Error("La generación ha superado el tiempo de espera."));
            return;
          }
          aiPollTimer = setTimeout(tick, 1500);
        } catch (error) {
          reject(error);
        }
      };
      tick();
    });
  }

  function mostrarResultado(banco, nuevasIds) {
    const preview = $("#ai-preview");
    preview.innerHTML = "";
    banco.preguntas.forEach((q, i) => {
      preview.append(renderWrongItem(q, i + 1, { number: q.id, lazyTrace: true }));
    });
    const acciones = $("#ai-result-actions");
    const labelTipo = tiposLabel.charAt(0).toUpperCase() + tiposLabel.slice(1);
    const nuevas = nuevasIds.length;
    const textoNuevas = nuevas
      ? `${nuevas} nueva${nuevas !== 1 ? "s" : ""}`
      : "sin preguntas nuevas";
    acciones.innerHTML = `
      <button class="btn tiny primary" type="button" id="ai-practicar">
        <i class="fa-solid fa-play" aria-hidden="true"></i> Practicar este banco (${banco.preguntas.length} preguntas · ${textoNuevas})
      </button>
      <span class="chip ok">${banco.preguntas.length} preguntas guardadas como "${esc($("#ai-subject")?.value || banco.meta.asignatura)}"</span>
    `;
    $("#ai-practicar")?.addEventListener("click", () => {
      window.cargarBancoDePreguntas(banco);
    });
    logMensaje(
      `Listo: ${banco.preguntas.length} preguntas en el banco${nuevas ? ` (${nuevas} nueva${nuevas !== 1 ? "s" : ""} esta tanda)` : ""}.`,
    );
    toast(`${banco.preguntas.length} preguntas generadas.`);
  }

  $("#ai-generate")?.addEventListener("click", async () => {
    if (aiGenerating) return;
    const subjectName = ($("#ai-subject")?.value || "").trim() || "Asignatura IA";
    const count = Math.max(1, Math.min(80, Number($("#ai-count")?.value) || 10));
    const types = $("#ai-types")?.value || "mixto";
    const contexto = ($("#ai-context")?.value || "").trim();
    const instrucciones = ($("#ai-instrucciones")?.value || "").trim();

    if (!contexto && temasDelSubject.length === 0) {
      toast("Escribe un contexto de estudio o selecciona una asignatura con temas privados.");
      return;
    }

    const solicitud = {
      asignatura: subjectName,
      tema: temaDefault,
      temas: temasParam === "todos" ? "todos" : temasDelSubject,
      apartado: 0,
      cantidad: count,
      modoExamen: "personalizado",
      contextoExamen: `${tiposLabel}. Examen tipo test estándar con preguntas de aplicación y trampas frecuentes.`,
      tipoPreguntas: types,
      ...(contexto ? { context: contexto } : {}),
      ...(instrucciones ? { instrucciones } : {}),
    };

    aiGenerating = true;
    aiTaskId = null;
    const btn = $("#ai-generate");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Generando…';
    $("#ai-preview").innerHTML = '<div class="ai-loading" style="padding:20px">Contactando con tu Ollama local…</div>';
    $("#ai-result-actions").innerHTML = "";
    logMensaje("Iniciando generación con la IA local…");

    try {
      const res = await fetch(`${window.location.origin}/api/generar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(solicitud),
      });
      const raw = await res.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!res.ok) {
        const detail = data?.detail || data?.error || raw || `HTTP ${res.status}`;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      if (!data?.id) throw new Error("El servicio no inició la generación.");
      aiTaskId = data.id;
      logMensaje(`Generación iniciada (tarea ${aiTaskId}). Esperando a Ollama…`);

      const tarea = await vigilarTarea(aiTaskId);
      if (tarea.cancelado) {
        logMensaje("Generación cancelada.");
        return;
      }
      if (tarea.error) {
        throw new Error(tarea.error || "La generación terminó con error.");
      }

      const bancoTema = temaDefault || 1;
      const bancoTemas = temasDelSubject.length ? temasDelSubject : [1];
      const bancoUrl = new URL(`${window.location.origin}/api/banco`);
      bancoUrl.searchParams.set("asignatura", subjectName);
      bancoUrl.searchParams.set("tema", String(bancoTema));
      bancoUrl.searchParams.set("temas", bancoTemas.join(","));
      bancoUrl.searchParams.set("apartado", "0");
      const bancoRes = await fetch(bancoUrl, { cache: "no-store" });
      if (!bancoRes.ok) {
        throw new Error(`No se pudo leer el banco generado (HTTP ${bancoRes.status}).`);
      }
      const banco = await bancoRes.json();
      if (!banco.preguntas?.length) {
        throw new Error("El banco generado no contiene preguntas.");
      }

      const claveIA = subjectName || state.subjectId || "default";
      const previas = new Set(getAiGenerated(claveIA));
      const nuevasIds = banco.preguntas
        .filter((q) => !previas.has(q.enunciado))
        .map((q) => q.id);
      recordAiGenerated(claveIA, banco.preguntas.map((q) => q.enunciado));

      mostrarResultado(banco, nuevasIds);
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "La IA tardó demasiado. Prueba con menos preguntas o un modelo más rápido."
          : error.message;
      $("#ai-preview").innerHTML = `
        <div class="empty-state" style="background:var(--bad-soft);border-color:var(--bad)">
          <div class="emoji"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i></div>
          <h3>No se pudo generar</h3>
          <p>${esc(message)}</p>
          <p style="margin-top:8px;font-size:12px">Asegúrate de que Preparar tests y Ollama estén activos (<code>docker compose up -d</code> en esta carpeta).</p>
        </div>`;
      logMensaje(message);
    } finally {
      const current = $("#ai-generate");
      if (current) {
        aiGenerating = false;
        current.disabled = false;
        current.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Generar preguntas';
      }
    }
  });

  if (borradorRestaurado) logMensaje("Se restauró el borrador de generación con IA.");
  updateFooter();
}
