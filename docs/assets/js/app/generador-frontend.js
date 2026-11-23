"use strict";

// ============================================================
// GENERADOR DE TESTS 100% FRONTEND (NVIDIA NIM EN NAVEGADOR)
// ============================================================

async function generarPreguntasFrontendNvidia(solicitud, onProgreso) {
  let apiKey = (typeof localStorage !== "undefined" && localStorage.getItem("preparar_tests_nvidia_key")) || "";
  if (!apiKey) {
    const inputNv = document.querySelector("#input-nvidia-token");
    if (inputNv?.value?.trim()) {
      apiKey = inputNv.value.trim();
    }
  }
  if (!apiKey) {
    apiKey = window.prompt("Introduce tu API Key de NVIDIA NIM (nvapi-...) para generar tests en el navegador:") || "";
    if (apiKey) {
      apiKey = apiKey.trim();
      localStorage.setItem("preparar_tests_nvidia_key", apiKey);
      const inputNv = document.querySelector("#input-nvidia-token");
      if (inputNv) inputNv.value = apiKey;
    }
  }
  if (!apiKey) {
    throw new Error("Se requiere una API Key de NVIDIA NIM (guárdala en Opciones ⚙️) para generar en el navegador.");
  }

  const cantidad = Math.max(1, Math.min(30, Number(solicitud.cantidad) || 5));
  const asig = String(solicitud.asignatura || "GENERAL").trim().toUpperCase();
  const temasTexto = Array.isArray(solicitud.temas)
    ? (solicitud.temas.length ? solicitud.temas.join(", ") : "todos los temas")
    : String(solicitud.tema || "1");

  onProgreso?.({
    porcentaje: 20,
    fase: "lectura",
    mensaje: `Preparando generación en el navegador para ${asig} (Temas: ${temasTexto})…`,
    detalle: "Leyendo temario y configurando instrucciones pedagógicas",
    actual: 0,
    total: cantidad,
  });

  const promptSistema = "Eres un profesor universitario experto preparando un examen oficial tipo test. Genera preguntas técnicas rigurosas con 4 opciones (A, B, C, D), una sola opción correcta y una explicación pedagógica completa. Responde EXCLUSIVAMENTE con un array JSON válido sin texto previo ni posterior, sin markdown.";

  const promptUsuario = `Asignatura: "${asig}"
Temas a evaluar: ${temasTexto}
Apartado específico: ${solicitud.apartado ? `Apartado ${solicitud.apartado}` : "Tema completo"}
Contexto del examen: ${solicitud.contextoExamen || "Examen tipo test oficial de dificultad media-alta."}
Tipo de preguntas: ${solicitud.tipoPreguntas || "mixto (teoría técnica y casos prácticos)"}

Genera exactamente ${cantidad} preguntas originales tipo test.
Formato de salida OBLIGATORIO:
[
  {
    "id": "${asig.toLowerCase()}_q_1",
    "tema": ${Number(solicitud.tema) || 1},
    "apartado": ${Number(solicitud.apartado) || 1},
    "apartadoNombre": "Apartado ${Number(solicitud.apartado) || 1}",
    "tipo": "teoria",
    "enunciado": "¿Cuál de las siguientes afirmaciones...?",
    "opciones": {
      "A": "Texto opción A",
      "B": "Texto opción B",
      "C": "Texto opción C",
      "D": "Texto opción D"
    },
    "correcta": "A",
    "explicacion": "Justificación pedagógica de por qué la opción es la correcta."
  }
]`;

  onProgreso?.({
    porcentaje: 45,
    fase: "ia",
    mensaje: `Redactando ${cantidad} preguntas con NVIDIA NIM en el navegador…`,
    detalle: "Consultando modelo Llama 3.1 70B vía API directa de NVIDIA",
    actual: Math.floor(cantidad / 2),
    total: cantidad,
  });

  const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "meta/llama-3.1-70b-instruct",
      messages: [
        { role: "system", content: promptSistema },
        { role: "user", content: promptUsuario },
      ],
      temperature: 0.25,
      max_tokens: 3800,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Error HTTP ${res.status} en NVIDIA NIM.`);
  }

  const data = await res.json();
  const contenido = data.choices?.[0]?.message?.content || "";
  const match = contenido.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!match) {
    throw new Error("La IA no devolvió un array JSON de preguntas válido.");
  }

  const preguntas = JSON.parse(match[0]);
  if (!Array.isArray(preguntas) || !preguntas.length) {
    throw new Error("No se encontraron preguntas válidas en la respuesta de la IA.");
  }

  onProgreso?.({
    porcentaje: 85,
    fase: "guardando",
    mensaje: "Validando opciones y estructurando banco…",
    detalle: `Estructurando ${preguntas.length} preguntas recibidas`,
    actual: preguntas.length,
    total: cantidad,
  });

  const normalizadas = preguntas.map((p, idx) => {
    const id = p.id || `${asig.toLowerCase()}_q_${Date.now()}_${idx + 1}`;
    const op = p.opciones || {};
    let opciones = {
      A: String(op.A || op.a || "Opción A"),
      B: String(op.B || op.b || "Opción B"),
      C: String(op.C || op.c || "Opción C"),
      D: String(op.D || op.d || "Opción D"),
    };
    let correcta = "A";
    if (typeof p.correcta === "string" && p.correcta.trim()) {
      correcta = p.correcta.trim().toUpperCase().charAt(0);
    }
    return {
      id,
      tema: Number(p.tema) || Number(solicitud.tema) || 1,
      apartado: Number(p.apartado) || Number(solicitud.apartado) || 1,
      apartadoNombre: p.apartadoNombre || `Apartado ${p.apartado || 1}`,
      tipo: p.tipo || "teoria",
      enunciado: String(p.enunciado || "").trim(),
      codigo: String(p.codigo || "").trim(),
      opciones,
      correcta,
      explicacion: String(p.explicacion || "Sin explicación.").trim(),
    };
  }).filter((p) => p.enunciado.length > 0);

  return normalizadas;
}

if (typeof window !== "undefined") {
  window.generarPreguntasFrontendNvidia = generarPreguntasFrontendNvidia;
}
