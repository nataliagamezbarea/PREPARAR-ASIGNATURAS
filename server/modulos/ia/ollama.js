import { configuracion } from "../../configuracion.js";

export async function consultarOllama(ruta, opciones = {}) {
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
