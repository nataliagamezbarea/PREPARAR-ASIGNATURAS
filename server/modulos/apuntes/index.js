import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

  // Enriquecer con todas las asignaturas oficiales del grado desde asignaturas.json
  try {
    const candidatas = [
      path.join(configuracion.raizBancos, "asignaturas.json"),
      path.join(configuracion.raizPublica, "data", "asignaturas.json"),
      path.join(configuracion.raizProyecto, "data", "asignaturas.json"),
    ];
    for (const c of candidatas) {
      if (fs.existsSync(c)) {
        const contenido = await readFile(c, "utf8");
        const json = JSON.parse(contenido);
        if (Array.isArray(json.asignaturas)) {
          for (const asig of json.asignaturas) {
            const clave = (asig.nombre || asig.id || "").trim().toLowerCase();
            if (clave && !mapa.has(clave)) {
              mapa.set(clave, {
                nombre: asig.nombre || asig.id,
                id: asig.id,
                grado: asig.grado,
                temas: (asig.temas || []).map(t => ({
                  numero: t.numero,
                  nombre: t.nombre || `Tema ${t.numero}`,
                  apartados: t.apartados || []
                }))
              });
            }
          }
        }
      }
    }
  } catch (_) {}

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
