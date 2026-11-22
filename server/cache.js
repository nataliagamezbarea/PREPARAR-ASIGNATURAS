import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../cache");
const PREGUNTAS_FILE = path.join(CACHE_DIR, "preguntas.json");
const RESPUESTAS_FILE = path.join(CACHE_DIR, "respuestas.json");

async function asegurarCarpeta() {
  await mkdir(CACHE_DIR, { recursive: true });
}

async function leerJSON(archivo, valorPorDefecto = []) {
  try {
    const texto = await readFile(archivo, "utf8");
    return JSON.parse(texto);
  } catch (error) {
    if (error.code === "ENOENT") return valorPorDefecto;
    throw error;
  }
}

async function escribirJSON(archivo, datos) {
  await asegurarCarpeta();
  await writeFile(archivo, JSON.stringify(datos, null, 2), "utf8");
}

/**
 * Guarda un array de preguntas en la caché (sobrescribe).
 */
export async function guardarPreguntas(preguntas) {
  await escribirJSON(PREGUNTAS_FILE, preguntas);
  return preguntas;
}

/**
 * Lee las preguntas guardadas en caché.
 */
export async function leerPreguntas() {
  return leerJSON(PREGUNTAS_FILE, []);
}

/**
 * Guarda una respuesta de usuario asociada a una pregunta.
 * Añade (no sobrescribe) al historial de respuestas.
 */
export async function guardarRespuesta({ preguntaId, enunciado, respuestaUsuario, correcta, explicacion }) {
  const respuestas = await leerJSON(RESPUESTAS_FILE, []);
  const entrada = {
    id: respuestas.length + 1,
    preguntaId,
    enunciado,
    respuestaUsuario,
    correcta: correcta === true || correcta === "true" || correcta === 1,
    explicacion,
    fecha: new Date().toISOString(),
  };
  respuestas.push(entrada);
  await escribirJSON(RESPUESTAS_FILE, respuestas);
  return entrada;
}

/**
 * Lee todas las respuestas guardadas en caché.
 */
export async function leerRespuestas() {
  return leerJSON(RESPUESTAS_FILE, []);
}

/**
 * Devuelve estadísticas rápidas de la caché.
 */
export async function estadisticasCache() {
  const [preguntas, respuestas] = await Promise.all([
    leerPreguntas(),
    leerRespuestas(),
  ]);
  const aciertos = respuestas.filter((r) => r.correcta).length;
  const fallos = respuestas.length - aciertos;
  return {
    preguntasGuardadas: preguntas.length,
    respuestasGuardadas: respuestas.length,
    aciertos,
    fallos,
  };
}

/**
 * Vacía la caché de preguntas y respuestas.
 */
export async function limpiarCache() {
  await escribirJSON(PREGUNTAS_FILE, []);
  await escribirJSON(RESPUESTAS_FILE, []);
  return { preguntas: 0, respuestas: 0 };
}
