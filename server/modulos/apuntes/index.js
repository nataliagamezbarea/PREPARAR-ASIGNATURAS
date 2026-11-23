import { configuracion } from "../../configuracion.js";
import {
  comprobarRaizApuntes,
  listarTemas,
  cargarMaterialTema,
  buscarApartados,
  resolverAsignatura,
  calcularRevision,
  listarArchivosMateriales,
  numeroDeApartado,
  numeroDeArchivo,
  numeroDeMaterial,
  nombreLegibleMaterial,
  leerCatalogoApuntesLocal,
  obtenerMaterialSeleccionadoLocal,
} from "./catalogo-local.js";
import {
  leerCatalogoGitHub,
  obtenerMaterialSeleccionadoGitHub,
  obtenerArbolGitHub,
} from "./catalogo-github.js";
import {
  quitarLatex,
  extraerTextoPdf,
  extraerTextoMaterial,
  leerEntradasZip,
  esArchivoDeCompilacion,
  esFormatoTexto,
  esArchivoMaterial,
  dividirTextoPorApartados,
  limpiarTituloEncabezado,
  obtenerTitulo,
} from "./extractor.js";

export async function leerCatalogoApuntes(opciones = {}) {
  // Si se pasa una ruta de apuntes específica (como en tests o selector manual), usar local
  if (opciones.raizApuntes) {
    return await leerCatalogoApuntesLocal(opciones);
  }

  const [localRes, githubRes] = await Promise.allSettled([
    leerCatalogoApuntesLocal(opciones),
    leerCatalogoGitHub(),
  ]);

  const catLocal = localRes.status === "fulfilled" ? localRes.value : { asignaturas: [] };
  const catGitHub = githubRes.status === "fulfilled" ? githubRes.value : { asignaturas: [] };

  const mapa = new Map();
  for (const asig of (catGitHub.asignaturas || [])) {
    if (asig && asig.nombre) mapa.set(asig.nombre.toLowerCase(), asig);
  }
  for (const asig of (catLocal.asignaturas || [])) {
    if (asig && asig.nombre) mapa.set(asig.nombre.toLowerCase(), asig);
  }

  return { asignaturas: Array.from(mapa.values()) };
}

export async function obtenerMaterialSeleccionado(seleccion, opciones = {}) {
  // Si se pasa una ruta de apuntes específica (como en tests), usar local
  if (opciones.raizApuntes) {
    return await obtenerMaterialSeleccionadoLocal(seleccion, opciones);
  }

  const fuente = (opciones.fuente || seleccion.fuente || configuracion.fuenteAsignaturas || "local").trim().toLowerCase();

  if (fuente === "github") {
    try {
      return await obtenerMaterialSeleccionadoGitHub(seleccion);
    } catch (err) {
      console.warn("[apuntes] Aviso: no se pudo obtener material de GitHub, intentando local:", err.message);
      return await obtenerMaterialSeleccionadoLocal(seleccion, opciones);
    }
  }

  if (fuente === "auto") {
    try {
      return await obtenerMaterialSeleccionadoLocal(seleccion, opciones);
    } catch (_) {
      return await obtenerMaterialSeleccionadoGitHub(seleccion);
    }
  }

  return await obtenerMaterialSeleccionadoLocal(seleccion, opciones);
}

export {
  comprobarRaizApuntes,
  listarTemas,
  cargarMaterialTema,
  buscarApartados,
  resolverAsignatura,
  calcularRevision,
  listarArchivosMateriales,
  numeroDeApartado,
  numeroDeArchivo,
  numeroDeMaterial,
  nombreLegibleMaterial,
  leerCatalogoApuntesLocal,
  obtenerMaterialSeleccionadoLocal,
  leerCatalogoGitHub,
  obtenerMaterialSeleccionadoGitHub,
  obtenerArbolGitHub,
  quitarLatex,
  extraerTextoPdf,
  extraerTextoMaterial,
  leerEntradasZip,
  esArchivoDeCompilacion,
  esFormatoTexto,
  esArchivoMaterial,
  dividirTextoPorApartados,
  limpiarTituloEncabezado,
  obtenerTitulo,
};
