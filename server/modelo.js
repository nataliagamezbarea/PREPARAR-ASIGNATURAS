import { configuracion } from "./configuracion.js";

async function consultarOllama(ruta, opciones = {}) {
  const controlador = opciones.controlador;
  const limite = AbortSignal.timeout(configuracion.tiempoMaximoMs);
  const senal = controlador
    ? AbortSignal.any([controlador.signal, limite])
    : limite;
  let respuesta;
  try {
    respuesta = await fetch(`${configuracion.direccionOllama}${ruta}`, {
      ...opciones.solicitud,
      signal: senal,
    });
  } catch (error) {
    if (controlador?.signal.aborted)
      throw Object.assign(new Error("Generación cancelada."), {
        nombre: "CancelacionSolicitada",
      });
    if (error.name === "TimeoutError")
      throw new Error(
        `Ollama superó el límite de ${configuracion.tiempoMaximoMs / 1000} segundos.`,
      );
    throw new Error(
      `No se pudo conectar con Ollama (${configuracion.direccionOllama}). Comprueba Docker y el modelo local: ${error.message}`,
    );
  }
  if (!respuesta.ok) {
    const detalle = (await respuesta.text()).slice(0, 1000);
    throw new Error(`Ollama respondió ${respuesta.status}: ${detalle}`);
  }
  return respuesta.json();
}

export async function comprobarModelo() {
  try {
    const datos = await consultarOllama("/api/tags", {
      solicitud: { method: "GET" },
    });
    const modelos = Array.isArray(datos.models) ? datos.models : [];
    const disponible = modelos.some(
      (modelo) =>
        modelo.name === configuracion.modelo ||
        modelo.model === configuracion.modelo ||
        modelo.name?.split(":")[0] === configuracion.modelo.split(":")[0],
    );
    return {
      conectado: true,
      modeloDisponible: disponible,
      modelo: configuracion.modelo,
      modelos: modelos.map((modelo) => modelo.name ?? modelo.model).filter(Boolean),
    };
  } catch (error) {
    return {
      conectado: false,
      modeloDisponible: false,
      modelo: configuracion.modelo,
      error: error.message,
    };
  }
}

export async function generarConIA({
  prompt,
  controlador,
  progreso,
  instruccionesSistema,
  soloJson = true,
}) {
  progreso?.("Consultando el modelo local de Ollama…");
  const datos = await consultarOllama("/api/chat", {
    controlador,
    solicitud: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: configuracion.modelo,
        stream: false,
        ...(soloJson ? { format: "json" } : {}),
        messages: [
          {
            role: "system",
            content:
              instruccionesSistema ??
              "Eres un profesor que crea preguntas originales para exámenes. Usa únicamente el material de estudio del mensaje y devuelve JSON válido.",
          },
          { role: "user", content: prompt },
        ],
        options: {
          temperature: 0.25,
          num_ctx: Math.min(8192, configuracion.contextoModelo || 8192),
          num_predict: configuracion.tokensRespuesta,
          num_gpu: 99,
          num_thread: 8,
        },
      }),
    },
  });
  const contenido = datos.message?.content;
  if (typeof contenido !== "string" || !contenido.trim())
    throw new Error("Ollama no devolvió preguntas.");
  return {
    contenido,
    modelo: datos.model ?? configuracion.modelo,
    duracionNs: Number(datos.total_duration) || 0,
    tokensEntrada: Number(datos.prompt_eval_count) || 0,
    tokensSalida: Number(datos.eval_count) || 0,
  };
}
