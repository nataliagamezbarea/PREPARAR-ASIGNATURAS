import { inspect as utilInspect } from "node:util";
import {
  abortarTarea,
  actualizarTarea,
  crearTarea,
  obtenerControladorTarea,
  obtenerTarea,
  registrarLlamadaIA,
} from "../progreso.js";
import { comprobarModelo, generarConIA } from "../modelo.js";
import { log, inspectObjeto, error as debugError } from "../debug.js";
import { leerBancoPreguntas, anadirPreguntasAlBanco } from "../bancos.js";
import { obtenerMaterialSeleccionado } from "../apuntes.js";
import {
  analizarRespuestaIA,
  crearPromptPreguntas,
  dividirDocumentos,
  filtrarPreguntasPorEjemplos,
  INSTRUCCIONES_SISTEMA,
  validarSolicitudGeneracion,
} from "../preguntas.js";

async function ejecutarGeneracion(identificador, solicitud, material) {
  log("generacion", "iniciando", { identificador, solicitud: utilInspect(solicitud, { depth: 3 }), material: utilInspect(material, { depth: 3 }) });
  const controlador = obtenerControladorTarea(identificador);
  let banco = null;
  try {
    const seleccionBanco = {
      ...solicitud,
      tema: material.tema,
      temas: material.temas,
    };
    banco = await leerBancoPreguntas(seleccionBanco);
    let preguntasAnteriores = banco?.preguntas ?? [];
    const bloques = dividirDocumentos(material.documentos);
    if (!bloques.length) throw new Error("No se pudieron dividir los apuntes en bloques.");
    const ejemplosPorBloque = bloques.map((bloque) => ({
      bloque,
      ejemplos: [...new Map((bloque.ejemplos ?? []).map((ejemplo) => [
        ejemplo.id,
        ejemplo,
      ])).values()],
    }));
    const ejemplos = [...new Map(
      ejemplosPorBloque.flatMap(({ ejemplos: lista }) =>
        lista.map((ejemplo) => [ejemplo.id, ejemplo]),
      ),
    ).values()];
    const idsCubiertos = new Set(
      preguntasAnteriores.map((pregunta) => pregunta.ejemploId).filter(Boolean),
    );
    const pendientesIniciales = ejemplos.filter(
      (ejemplo) => !idsCubiertos.has(ejemplo.id),
    );
    const totalObjetivo = solicitud.cantidad;

    const subsecciones = bloques.map((bloque, indice) => {
      const ejemplosBloque = [...new Map((bloque.ejemplos ?? []).map((ej) => [ej.id, ej])).values()];
      const nombreSub = bloque.apartadoNombre || bloque.titulo || bloque.nombre || `Apartado ${bloque.apartado || indice + 1}`;
      const cubiertos = ejemplosBloque.filter((e) => idsCubiertos.has(e.id)).length;
      return {
        id: `${bloque.tema}.${bloque.apartado || indice + 1}`,
        nombre: nombreSub,
        tema: bloque.tema,
        apartado: bloque.apartado || indice + 1,
        totalEjemplos: ejemplosBloque.length,
        cubiertos,
      };
    });

    actualizarTarea(identificador, {
      fase: "preparando",
      mensaje: `Preparando generación: ${pendientesIniciales.length} ejemplos pendientes de ${ejemplos.length} totales`,
      total: totalObjetivo,
      generadas: 0,
      totalEjemplos: ejemplos.length,
      ejemplosPendientes: pendientesIniciales.length,
      subsecciones,
    });

    const nuevasPreguntas = [];
    let tanda = 0;
    for (const { bloque, ejemplos: ejemplosDelBloque } of ejemplosPorBloque) {
      if (controlador.signal.aborted) break;
      if (nuevasPreguntas.length >= totalObjetivo) break;
      const pendientesBloque = ejemplosDelBloque.filter(
        (ejemplo) => !idsCubiertos.has(ejemplo.id),
      );
      if (!pendientesBloque.length && ejemplosDelBloque.length) continue;

      tanda += 1;
      actualizarTarea(identificador, {
        fase: "generando",
        mensaje: `Generando tanda ${tanda} para ${bloque.apartadoNombre || "apuntes"}`,
        subseccionActual: bloque.apartadoNombre,
      });

      const prompt = crearPromptPreguntas({
        bloque,
        ejemplosObjetivo: pendientesBloque.length ? pendientesBloque : ejemplosDelBloque,
        preguntasAnteriores,
        solicitud,
      });

      const inicioLlamada = Date.now();
      const resultado = await generarConIA({
        prompt,
        instruccionesSistema: INSTRUCCIONES_SISTEMA,
        signal: controlador.signal,
      });
      registrarLlamadaIA(identificador, Date.now() - inicioLlamada);

      const preguntasLeidas = analizarRespuestaIA(resultado.contenido);
      const preguntasFiltradas = filtrarPreguntasPorEjemplos({
        preguntas: preguntasLeidas,
        ejemplos: ejemplosDelBloque,
        bloque,
      });

      for (const p of preguntasFiltradas) {
        if (nuevasPreguntas.length < totalObjetivo) {
          nuevasPreguntas.push(p);
          if (p.ejemploId) idsCubiertos.add(p.ejemploId);
        }
      }

      actualizarTarea(identificador, {
        generadas: nuevasPreguntas.length,
        mensaje: `${nuevasPreguntas.length} preguntas generadas de ${totalObjetivo}`,
      });
    }

    if (nuevasPreguntas.length > 0) {
      actualizarTarea(identificador, {
        fase: "guardando",
        mensaje: `Guardando ${nuevasPreguntas.length} preguntas en el banco...`,
      });
      await anadirPreguntasAlBanco(seleccionBanco, nuevasPreguntas, material.revision);
    }

    actualizarTarea(identificador, {
      fase: "completado",
      mensaje: `Generación completada: ${nuevasPreguntas.length} preguntas añadidas.`,
      terminado: true,
      generadas: nuevasPreguntas.length,
    });
  } catch (error) {
    debugError("generar", error, { identificador });
    actualizarTarea(identificador, {
      fase: "error",
      mensaje: "No se pudo completar la generación",
      detalle: error.message,
      error: error.message,
      terminado: true,
    });
  }
}

export async function manejarGenerar(peticion, respuesta, url, responderJson, responderError, leerJson) {
  if (peticion.method === "POST" && url.pathname === "/api/generar") {
    let datos;
    try {
      datos = await leerJson(peticion);
      const solicitud = validarSolicitudGeneracion(datos);
      const material = await obtenerMaterialSeleccionado(solicitud);
      const tarea = crearTarea({
        asignatura: solicitud.asignatura,
        tema: solicitud.tema,
        temas: solicitud.temas,
        apartado: solicitud.apartado,
        total: solicitud.cantidad,
      });
      void ejecutarGeneracion(tarea.id, solicitud, material).catch((error) => {
        console.error(`[generar:${tarea.id}] ${error.stack || error.message}`);
        actualizarTarea(tarea.id, {
          fase: "error",
          mensaje: "No se pudo completar la generación",
          detalle: error.message,
          error: error.message,
          terminado: true,
        });
      });
      return responderJson(respuesta, 202, {
        id: tarea.id,
        progreso: `/api/generar/${tarea.id}`,
        cancelar: `/api/generar/${tarea.id}/cancelar`,
      });
    } catch (error) {
      return responderError(respuesta, error.estado ?? 422, error.message);
    }
  }

  const coincidencia = url.pathname.match(
    /^\/api\/generar\/([a-f0-9-]{36})(?:\/(cancelar))?$/i,
  );
  if (coincidencia && peticion.method === "GET" && !coincidencia[2]) {
    const tarea = obtenerTarea(coincidencia[1]);
    return tarea
      ? responderJson(respuesta, 200, tarea)
      : responderError(respuesta, 404, "No se encuentra esta generación.");
  }
  if (coincidencia && peticion.method === "POST" && coincidencia[2]) {
    const resultado = abortarTarea(coincidencia[1]);
    if (!resultado)
      return responderError(respuesta, 404, "No se encuentra esta generación.");
    if (!resultado.aceptado)
      return responderError(
        respuesta,
        409,
        "La generación ya terminó o está guardando una tanda.",
      );
    return responderJson(respuesta, 200, { cancelado: true });
  }

  return false;
}
