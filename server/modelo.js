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

async function consultarNvidia({
  prompt,
  controlador,
  instruccionesSistema,
  soloJson = true,
  opcionesIA = {},
  apiKey = "",
}) {
  const clave = apiKey || configuracion.nvidiaApiKey;
  if (!clave) throw new Error("Falta NVIDIA_API_KEY. Configúrala en las opciones de la aplicación o en las variables de entorno.");
  const modelo = configuracion.nvidiaModelo || "meta/llama-3.1-8b-instruct";
  const limite = AbortSignal.timeout(configuracion.tiempoMaximoMs);
  const senal = controlador ? AbortSignal.any([controlador.signal, limite]) : limite;

  const url = `${configuracion.nvidiaBaseUrl}/chat/completions`;
  const body = {
    model: modelo,
    messages: [
      {
        role: "system",
        content:
          instruccionesSistema ??
          "Eres un profesor que crea preguntas originales para exámenes. Usa únicamente el material de estudio del mensaje y devuelve JSON válido.",
      },
      { role: "user", content: prompt },
    ],
    temperature: opcionesIA.temperature ?? 0.25,
    max_tokens: opcionesIA.num_predict ?? configuracion.tokensRespuesta,
  };

  if (soloJson) {
    body.response_format = { type: "json_object" };
  }

  let respuesta;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${clave}`,
      },
      body: JSON.stringify(body),
      signal: senal,
    });
  } catch (error) {
    if (controlador?.signal.aborted) {
      throw Object.assign(new Error("Generación cancelada."), {
        nombre: "CancelacionSolicitada",
      });
    }
    throw new Error(`No se pudo conectar con NVIDIA NIM (${configuracion.nvidiaBaseUrl}): ${error.message}`);
  }

  if (!respuesta.ok) {
    const detalle = (await respuesta.text().catch(() => "")).slice(0, 1000);
    throw new Error(`NVIDIA NIM respondió ${respuesta.status}: ${detalle}`);
  }

  const datos = await respuesta.json();
  const contenido = datos.choices?.[0]?.message?.content;
  if (typeof contenido !== "string" || !contenido.trim()) {
    throw new Error("NVIDIA NIM no devolvió contenido.");
  }

  return {
    contenido,
    modelo: datos.model ?? modelo,
    duracionNs: 0,
    tokensEntrada: datos.usage?.prompt_tokens ?? 0,
    tokensSalida: datos.usage?.completion_tokens ?? 0,
  };
}

export async function comprobarModelo(apiKey = "") {
  const clave = apiKey || configuracion.nvidiaApiKey;
  const usarNvidia =
    configuracion.proveedorIA === "nvidia" ||
    (configuracion.proveedorIA === "auto" && Boolean(clave));

  if (usarNvidia) {
    return {
      conectado: Boolean(clave),
      modeloDisponible: Boolean(clave),
      proveedor: "nvidia",
      modelo: configuracion.nvidiaModelo,
      modelos: [
        configuracion.nvidiaModelo,
        "deepseek-ai/deepseek-r1",
        "qwen/qwen2.5-72b-instruct",
        "nvidia/llama-3.1-nemotron-70b-instruct",
      ],
    };
  }

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
      proveedor: "ollama",
      modelo: configuracion.modelo,
      modelos: modelos.map((modelo) => modelo.name ?? modelo.model).filter(Boolean),
    };
  } catch (error) {
    // Si Ollama falla pero hay NVIDIA_API_KEY configurada, fallback automático a NVIDIA NIM
    if (clave) {
      return {
        conectado: true,
        modeloDisponible: true,
        proveedor: "nvidia",
        modelo: configuracion.nvidiaModelo,
        modelos: [configuracion.nvidiaModelo],
      };
    }
    return {
      conectado: false,
      modeloDisponible: false,
      proveedor: "ollama",
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
  opcionesIA = {},
  apiKey = "",
}) {
  const claveNvidia = apiKey || configuracion.nvidiaApiKey;
  const usarNvidia =
    configuracion.proveedorIA === "nvidia" ||
    (configuracion.proveedorIA === "auto" && Boolean(claveNvidia));

  if (usarNvidia) {
    progreso?.(`Consultando NVIDIA NIM (${configuracion.nvidiaModelo})…`);
    return consultarNvidia({
      prompt,
      controlador,
      instruccionesSistema,
      soloJson,
      opcionesIA,
      apiKey: claveNvidia,
    });
  }

  progreso?.("Consultando el modelo local de Ollama…");
  try {
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
            temperature: opcionesIA.temperature ?? 0.25,
            num_ctx: opcionesIA.num_ctx ?? Math.min(8192, configuracion.contextoModelo || 8192),
            num_predict: opcionesIA.num_predict ?? configuracion.tokensRespuesta,
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
  } catch (error) {
    // Si Ollama falla y tenemos clave de NVIDIA, fallback a NVIDIA NIM
    const claveFallback = apiKey || configuracion.nvidiaApiKey;
    if (claveFallback) {
      progreso?.(`Ollama no respondió, cambiando automáticamente a NVIDIA NIM (${configuracion.nvidiaModelo})…`);
      return consultarNvidia({
        prompt,
        controlador,
        instruccionesSistema,
        soloJson,
        opcionesIA,
        apiKey: claveFallback,
      });
    }
    throw error;
  }
}
