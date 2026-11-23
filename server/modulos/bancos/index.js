import { configuracion } from "../../configuracion.js";
import {
  normalizarTexto,
  crearClaveBanco,
  crearClaveBancoAnterior,
  nombreCarpetaBanco,
  resolverArchivoBanco,
  obtenerRutasBanco,
  migrarNombreArchivo,
  calcularHuellaPregunta,
  leerArchivoBanco,
  escribirAtomicamente,
  normalizarTemasBanco,
  leerBancoConMigracion,
  combinarBancos,
  leerBancoPreguntasLocal,
  anadirBancoIndividualLocal,
  anadirPreguntasAlBancoLocal,
  listarBancosPreguntasLocal,
} from "./almacenamiento-local.js";
import {
  leerBancoGitHub,
  guardarBancoGitHub,
  listarBancosGitHub,
} from "./almacenamiento-github.js";
import {
  guardarConSincronizacion,
  sincronizarPendientesGitHub,
  leerColaSync,
} from "./sincronizacion.js";

export async function leerBancoPreguntas(seleccion, opciones = {}) {
  const bancoLocal = await leerBancoPreguntasLocal(seleccion, opciones);
  if (bancoLocal) return bancoLocal;

  // Si no está en local y la fuente es GitHub o auto, intentar leer de GitHub
  const fuente = (opciones.fuente || configuracion.fuenteAsignaturas || "local").trim().toLowerCase();
  if (fuente === "github" || fuente === "auto") {
    try {
      const clave = crearClaveBanco(
        seleccion.asignatura,
        seleccion.tema,
        seleccion.apartado,
        seleccion.temas ?? [],
      );
      const bancoGit = await leerBancoGitHub(seleccion.asignatura, `${clave}.json`) ||
                       await leerBancoGitHub(seleccion.asignatura, "preguntas.json");
      if (bancoGit) {
        // Cachear en disco local
        const archivoLocal = resolverArchivoBanco(clave, opciones.raiz || configuracion.raizBancos, seleccion.asignatura);
        await escribirAtomicamente(archivoLocal, bancoGit).catch(() => {});
        return bancoGit;
      }
    } catch (_) {}
  }

  return null;
}

export async function anadirPreguntasAlBanco(solicitud, opciones = {}) {
  const resultado = await anadirPreguntasAlBancoLocal(solicitud, opciones);

  // Solo sincronizar con GitHub si no es una raiz temporal de pruebas
  const esTestLocal = Boolean(opciones.raiz);
  if (!esTestLocal && configuracion.fuenteAsignaturas === "github" && resultado?.clave) {
    const nombreArchivo = `${resultado.clave}.json`;
    guardarConSincronizacion(solicitud.asignatura, nombreArchivo, resultado).catch((err) => {
      console.warn(`[bancos] Error en sincronización con GitHub para ${solicitud.asignatura}:`, err.message);
    });
  }

  return resultado;
}

export async function listarBancosPreguntas(opciones = {}) {
  const bancosLocales = await listarBancosPreguntasLocal(opciones);

  if (configuracion.fuenteAsignaturas === "github") {
    sincronizarPendientesGitHub().catch(() => {});
  }

  return bancosLocales;
}

export {
  normalizarTexto,
  crearClaveBanco,
  crearClaveBancoAnterior,
  nombreCarpetaBanco,
  resolverArchivoBanco,
  obtenerRutasBanco,
  migrarNombreArchivo,
  calcularHuellaPregunta,
  leerArchivoBanco,
  escribirAtomicamente,
  normalizarTemasBanco,
  leerBancoConMigracion,
  combinarBancos,
  leerBancoPreguntasLocal,
  anadirBancoIndividualLocal,
  anadirPreguntasAlBancoLocal,
  listarBancosPreguntasLocal,
  leerBancoGitHub,
  guardarBancoGitHub,
  listarBancosGitHub,
  guardarConSincronizacion,
  sincronizarPendientesGitHub,
  leerColaSync,
};
