import { randomUUID } from "node:crypto";

const tareas = new Map();
const antiguedadMaximaMs = 60 * 60 * 1000;

function limpiarTareasAntiguas() {
  const ahora = Date.now();
  for (const [identificador, tarea] of tareas) {
    if (
      tarea.terminado &&
      ahora - Date.parse(tarea.actualizado) > antiguedadMaximaMs
    ) {
      tareas.delete(identificador);
    }
  }
}

export function crearTarea({ asignatura, tema, temas, apartado, total }) {
  limpiarTareasAntiguas();
  const identificador = randomUUID();
  const tarea = {
    id: identificador,
    asignatura,
    tema,
    temas,
    apartado,
    fase: "preparando",
    mensaje: "Preparando el material de estudio…",
    detalle: "Leyendo los apuntes seleccionados y comprobando el banco anterior.",
    total,
    generadas: 0,
    guardadas: 0,
    repetidas: 0,
    subsecciones: [],
    llamadas: 0,
    promedioMs: 0,
    iniciado: new Date().toISOString(),
    actualizado: new Date().toISOString(),
    terminado: false,
    cancelado: false,
    error: "",
    controlador: new AbortController(),
  };
  tareas.set(identificador, tarea);
  return tarea;
}

export function obtenerTarea(identificador) {
  const tarea = tareas.get(identificador);
  if (!tarea) return null;
  const llamadasEstimadas = Math.ceil(
    Math.max(0, tarea.total - tarea.generadas) / 6,
  );
  return {
    id: tarea.id,
    asignatura: tarea.asignatura,
    tema: tarea.tema,
    temas: tarea.temas,
    apartado: tarea.apartado,
    fase: tarea.fase,
    mensaje: tarea.mensaje,
    detalle: tarea.detalle,
    total: tarea.total,
    generadas: tarea.generadas,
    guardadas: tarea.guardadas,
    repetidas: tarea.repetidas,
    subsecciones: (tarea.subsecciones || []).map((sub) => ({
      id: sub.id,
      tema: sub.tema,
      apartado: sub.apartado,
      nombre: sub.nombre,
      totalEjemplos: sub.totalEjemplos || 0,
      ejemplosCubiertos: sub.ejemplosCubiertos || 0,
      generadas: sub.generadas || 0,
      estado: sub.estado || "pendiente", // "pendiente" | "en_progreso" | "completado"
    })),
    llamadas: tarea.llamadas,
    porcentaje: tarea.total
      ? Math.min(100, Math.round((tarea.generadas / tarea.total) * 100))
      : 0,
    etaSegundos: tarea.promedioMs
      ? Math.max(0, Math.ceil((llamadasEstimadas * tarea.promedioMs) / 1000))
      : null,
    terminado: tarea.terminado,
    cancelado: tarea.cancelado,
    error: tarea.error,
    actualizado: tarea.actualizado,
  };
}

export function actualizarTarea(identificador, valores) {
  const tarea = tareas.get(identificador);
  if (!tarea) return;
  Object.assign(tarea, valores, { actualizado: new Date().toISOString() });
}

export function registrarLlamadaIA(identificador, duracionMs) {
  const tarea = tareas.get(identificador);
  if (!tarea) return;
  tarea.llamadas += 1;
  tarea.promedioMs =
    tarea.promedioMs === 0
      ? duracionMs
      : Math.round(tarea.promedioMs * 0.65 + duracionMs * 0.35);
  tarea.actualizado = new Date().toISOString();
}

export function abortarTarea(identificador) {
  const tarea = tareas.get(identificador);
  if (!tarea) return false;
  if (tarea.terminado || tarea.fase === "guardando")
    return { aceptado: false, tarea: obtenerTarea(identificador) };
  tarea.cancelado = true;
  tarea.controlador.abort();
  tarea.fase = "cancelando";
  tarea.mensaje = "Deteniendo la generación…";
  tarea.detalle = "Se conservarán las preguntas que ya se guardaron.";
  tarea.actualizado = new Date().toISOString();
  return { aceptado: true, tarea: obtenerTarea(identificador) };
}

export function obtenerControladorTarea(identificador) {
  return tareas.get(identificador)?.controlador ?? null;
}
