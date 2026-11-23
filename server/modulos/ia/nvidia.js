import { configuracion } from "../../configuracion.js";

export async function consultarNvidia({
  prompt,
  controlador,
  instruccionesSistema,
  soloJson = true,
  opcionesIA = {},
  apiKey = "",
}) {
  const clave = apiKey || configuracion.nvidiaApiKey;
  if (!clave) {
    throw new Error("Falta NVIDIA_API_KEY. Configúrala en las opciones de la aplicación o en las variables de entorno.");
  }
  const modelo = configuracion.nvidiaModelo || "nvidia/nemotron-3.5-bolt-e4b";
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
