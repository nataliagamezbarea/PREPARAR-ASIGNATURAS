import fs from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { configuracion } from "../../configuracion.js";
import {
  extraerTextoMaterial,
  obtenerTitulo,
  esArchivoMaterial,
  esArchivoDeCompilacion,
  dividirTextoPorApartados,
} from "./extractor.js";
import { leerCatalogoApuntesLocal, obtenerMaterialSeleccionadoLocal } from "./catalogo-local.js";

const cacheMemoria = {
  arbol: null,
  fechaArbol: 0,
  catalogo: null,
  fechaCatalogo: 0,
};

function cabecerasGitHub() {
  const headers = {
    "User-Agent": "PrepararTests-App/2.0",
    Accept: "application/vnd.github.v3+json",
  };
  if (configuracion.githubToken) {
    headers.Authorization = `token ${configuracion.githubToken}`;
  }
  return headers;
}

export async function obtenerArbolGitHub(forzar = false) {
  const ahora = Date.now();
  if (!forzar && cacheMemoria.arbol && ahora - cacheMemoria.fechaArbol < 60000) {
    return cacheMemoria.arbol;
  }

  const rutaCacheDisco = path.join(configuracion.raizProyecto, "cache", "github-arbol.json");
  const ramas = Array.from(new Set([configuracion.githubBranch, "Segundo_grado_superior", "master", "main"])).filter(Boolean);

  let arbolObtenido = null;

  for (const rama of ramas) {
    try {
      const url = `https://api.github.com/repos/${configuracion.githubRepo}/git/trees/${rama}?recursive=1`;
      const respuesta = await fetch(url, { headers: cabecerasGitHub(), signal: AbortSignal.timeout(8000) });
      if (respuesta.ok) {
        const datos = await respuesta.json();
        if (Array.isArray(datos.tree) && datos.tree.length > 0) {
          arbolObtenido = datos.tree;
          break;
        }
      }
    } catch (_) {}
  }

  if (arbolObtenido) {
    cacheMemoria.arbol = arbolObtenido;
    cacheMemoria.fechaArbol = ahora;
    try {
      await mkdir(path.dirname(rutaCacheDisco), { recursive: true });
      await writeFile(rutaCacheDisco, JSON.stringify({ fecha: ahora, tree: arbolObtenido }), "utf8");
    } catch (_) {}
    return arbolObtenido;
  }

  // Fallback a caché de disco
  try {
    if (fs.existsSync(rutaCacheDisco)) {
      const guardado = JSON.parse(await readFile(rutaCacheDisco, "utf8"));
      if (guardado.tree) {
        cacheMemoria.arbol = guardado.tree;
        cacheMemoria.fechaArbol = guardado.fecha || ahora;
        return guardado.tree;
      }
    }
  } catch (_) {}

  throw new Error(`Error conectando con GitHub (${configuracion.githubRepo})`);
}

export function detectarSubapartadoGitHub(nombreFichero, tema, apartado) {
  let subapartado = null;
  let subapartadoNombre = "";

  const matchSubTriple = nombreFichero.match(new RegExp(`^(?:Tema\\s*)?${tema}\\.${apartado}\\.(\\d+)(?:[.-](.*))?`, "i"));
  if (matchSubTriple) {
    subapartado = Number(matchSubTriple[1]);
    subapartadoNombre = (matchSubTriple[2] || "").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[_-]+/g, " ").trim();
  } else {
    const matchSimpleNum = nombreFichero.match(/^(\d+)[.-](.*)/);
    if (matchSimpleNum && !esArchivoDeCompilacion(nombreFichero)) {
      subapartado = Number(matchSimpleNum[1]);
      subapartadoNombre = (matchSimpleNum[2] || "").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[_-]+/g, " ").trim();
    }
  }

  return { subapartado, subapartadoNombre };
}

export async function leerCatalogoGitHub() {
  const ahora = Date.now();
  if (cacheMemoria.catalogo && ahora - cacheMemoria.fechaCatalogo < 30000) {
    return cacheMemoria.catalogo;
  }

  const rutaCacheCat = path.join(configuracion.raizProyecto, "cache", "github-catalogo.json");

  try {
    const arbol = await obtenerArbolGitHub();
    const mapaAsignaturas = new Map();

    // 1. Intentar cargar test/asignaturas.json o data/asignaturas.json desde el árbol o raw
    const itemJson = arbol.find((it) => it.path === "test/asignaturas.json" || it.path === "data/asignaturas.json");
    if (itemJson) {
      try {
        const ramas = [configuracion.githubBranch, "Segundo_grado_superior", "master", "main"];
        for (const r of ramas) {
          const respRaw = await fetch(`https://raw.githubusercontent.com/${configuracion.githubRepo}/${r}/${itemJson.path}`, { signal: AbortSignal.timeout(5000) });
          if (respRaw.ok) {
            const dataJson = await respRaw.json();
            if (Array.isArray(dataJson.asignaturas)) {
              for (const asig of dataJson.asignaturas) {
                const k = (asig.nombre || asig.id || "").trim();
                if (k) {
                  mapaAsignaturas.set(k.toLowerCase(), {
                    nombre: asig.nombre || asig.id,
                    id: asig.id,
                    temasMap: new Map((asig.temas || []).map((t) => [
                      t.numero,
                      {
                        numero: t.numero,
                        nombre: t.nombre || `Tema ${t.numero}`,
                        archivos: [],
                        blobs: [],
                        apartadosMap: new Map((t.apartados || []).map((ap) => [
                          ap.numero,
                          {
                            numero: ap.numero,
                            nombre: ap.nombre || `Apartado ${t.numero}.${ap.numero}`,
                            archivos: [],
                            ficheros: [],
                            subapartadosMap: new Map(),
                            revision: "banco-oficial"
                          }
                        ]))
                      }
                    ]))
                  });
                }
              }
              break;
            }
          }
        }
      } catch (_) {}
    }

    // 2. Escanear carpetas apuntes/ y apuntes_privados/
    const prefijos = ["apuntes/", "apuntes_privados/"];
    const itemsApuntes = arbol.filter((item) =>
      item.type === "blob" && prefijos.some((p) => item.path.toLowerCase().startsWith(p))
    );

    for (const item of itemsApuntes) {
      const prefijoUsado = prefijos.find((p) => item.path.toLowerCase().startsWith(p));
      const relativo = item.path.slice(prefijoUsado.length);
      const partes = relativo.split("/");
      const ext = path.extname(item.path).toLowerCase();
      if (!esArchivoMaterial(ext) || esArchivoDeCompilacion(path.basename(item.path))) continue;

      let asignatura = partes[0].trim();
      let numTema = 1;
      let nombreTema = "Tema 1";

      // Si es un archivo directamente en la raíz de apuntes (p. ej. AAD_2_SQL.pdf, UD1...pdf)
      if (partes.length === 1 || /\.(pdf|zip|png|jpe?g|tex|txt|md|log)$/i.test(asignatura)) {
        const nombreArchivo = path.basename(item.path);
        if (/^AAD|^Acceso/i.test(nombreArchivo)) {
          asignatura = "AAD";
        } else if (/PMDM|M[oó]vil/i.test(nombreArchivo)) {
          asignatura = "PMDM";
        } else if (/SGE|Odoo|ERP/i.test(nombreArchivo)) {
          asignatura = "SGE";
        } else if (/Unity/i.test(nombreArchivo)) {
          asignatura = "Unity";
        } else if (/English|DAM/i.test(nombreArchivo)) {
          asignatura = "Inglés DAM";
        } else if (/Projecte|Intermodular/i.test(nombreArchivo)) {
          asignatura = "Proyecto Intermodular";
        } else {
          continue;
        }

        const mUD = nombreArchivo.match(/(?:UD|UF|Tema|AAD_)\s*0*(\d+)/i);
        if (mUD) {
          numTema = Number(mUD[1]);
          nombreTema = `Tema ${numTema}`;
        }
      } else {
        // Carpeta de asignatura
        for (const p of partes) {
          const mTema = p.match(/^Tema\s*(\d+)/i);
          if (mTema) {
            numTema = Number(mTema[1]);
            nombreTema = `Tema ${numTema}`;
            break;
          }
        }
      }

      if (!mapaAsignaturas.has(asignatura.toLowerCase())) {
        mapaAsignaturas.set(asignatura.toLowerCase(), { nombre: asignatura, temasMap: new Map() });
      }

      const asigObj = mapaAsignaturas.get(asignatura.toLowerCase());

      if (!asigObj.temasMap.has(numTema)) {
        asigObj.temasMap.set(numTema, {
          numero: numTema,
          nombre: nombreTema,
          archivos: [],
          apartadosMap: new Map(),
          blobs: [],
        });
      }

      const temaObj = asigObj.temasMap.get(numTema);
      temaObj.archivos.push(item.path);
      temaObj.blobs.push(item.sha);

      // Detectar apartado (ej: Tema 1.1 o 1.1)
      let numApartado = null;
      for (const p of partes) {
        const mAp = p.match(new RegExp(`^(?:Tema\\s*)?${numTema}\\.(\\d+)`, "i"));
        if (mAp) {
          numApartado = Number(mAp[1]);
          break;
        }
      }

      const fichero = path.basename(item.path);
      const { subapartado, subapartadoNombre } = detectarSubapartadoGitHub(fichero, numTema, numApartado || 0);

      if (numApartado !== null) {
        if (!temaObj.apartadosMap.has(numApartado)) {
          temaObj.apartadosMap.set(numApartado, {
            numero: numApartado,
            nombre: `Apartado ${numTema}.${numApartado}`,
            archivos: [],
            blobs: [],
            ficheros: [],
            subapartadosMap: new Map(),
            revision: item.sha ? item.sha.slice(0, 12) : "gh",
          });
        }
        const apObj = temaObj.apartadosMap.get(numApartado);
        apObj.archivos.push(item.path);
        apObj.blobs.push(item.sha);
        if (!apObj.ficheros.includes(fichero)) apObj.ficheros.push(fichero);

        if (subapartado != null && !apObj.subapartadosMap.has(subapartado)) {
          apObj.subapartadosMap.set(subapartado, {
            numero: subapartado,
            nombre: subapartadoNombre || `Subapartado ${subapartado}`,
            fichero,
          });
        }
      }
    }

    // Convertir mapas a array ordenado
    const asignaturas = [];
    for (const [nombreAsig, asigObj] of mapaAsignaturas) {
      const temas = [];
      for (const [numTema, temaObj] of asigObj.temasMap) {
        const apartados = [];
        for (const [numAp, apObj] of temaObj.apartadosMap) {
          apartados.push({
            numero: numAp,
            nombre: apObj.nombre,
            revision: apObj.blobs.sort().join("-").slice(0, 32),
            archivos: apObj.archivos,
            ficheros: apObj.ficheros,
            subapartados: [...apObj.subapartadosMap.values()].sort((a, b) => a.numero - b.numero),
          });
        }
        apartados.sort((a, b) => a.numero - b.numero);

        temas.push({
          numero: numTema,
          nombre: temaObj.nombre,
          revision: temaObj.blobs.sort().join("-").slice(0, 32),
          apartados,
        });
      }
      temas.sort((a, b) => a.numero - b.numero);
      if (temas.length) {
        asignaturas.push({ nombre: nombreAsig, temas });
      }
    }

    asignaturas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const catalogo = { asignaturas, fuente: "github", repositorio: configuracion.githubRepo };
    cacheMemoria.catalogo = catalogo;
    cacheMemoria.fechaCatalogo = ahora;

    try {
      await mkdir(path.dirname(rutaCacheCat), { recursive: true });
      await writeFile(rutaCacheCat, JSON.stringify(catalogo, null, 2), "utf8");
    } catch (_) {}

    return catalogo;
  } catch (error) {
    // Si GitHub falla, intentar leer la caché de disco
    try {
      if (fs.existsSync(rutaCacheCat)) {
        const catCache = JSON.parse(await readFile(rutaCacheCat, "utf8"));
        if (catCache && catCache.asignaturas?.length) {
          cacheMemoria.catalogo = catCache;
          cacheMemoria.fechaCatalogo = ahora;
          return catCache;
        }
      }
    } catch (_) {}

    // Si no hay caché de GitHub, fallback a catálogo local si existe
    try {
      return await leerCatalogoApuntesLocal();
    } catch (_) {
      throw error;
    }
  }
}

async function descargarBlobGitHub(sha, rutaRelativa) {
  const dirCacheArchivos = path.join(configuracion.raizProyecto, "cache", "github-archivos");
  const rutaArchivoCache = path.join(dirCacheArchivos, `${sha}-${path.basename(rutaRelativa)}`);

  try {
    if (fs.existsSync(rutaArchivoCache)) {
      return await readFile(rutaArchivoCache);
    }
  } catch (_) {}

  const url = `https://raw.githubusercontent.com/${configuracion.githubRepo}/${configuracion.githubBranch}/${rutaRelativa}`;
  const respuesta = await fetch(url, { headers: cabecerasGitHub(), signal: AbortSignal.timeout(15000) });
  if (!respuesta.ok) {
    throw new Error(`No se pudo descargar ${rutaRelativa} de GitHub (${respuesta.status})`);
  }

  const buffer = Buffer.from(await respuesta.arrayBuffer());
  try {
    await mkdir(dirCacheArchivos, { recursive: true });
    await writeFile(rutaArchivoCache, buffer);
  } catch (_) {}

  return buffer;
}

export async function obtenerMaterialSeleccionadoGitHub({
  asignatura,
  tema,
  temas,
  apartado = 0,
  subapartado = 0,
  fichero = "",
}) {
  const catalogo = await leerCatalogoGitHub();
  const asigObj = catalogo.asignaturas.find((a) => a.nombre.toLowerCase() === String(asignatura).toLowerCase());
  if (!asigObj) {
    // Intenta fallback a local
    return obtenerMaterialSeleccionadoLocal({ asignatura, tema, temas, apartado, subapartado, fichero });
  }

  const temasDisponibles = asigObj.temas;
  const temasSeleccionados =
    temas === "todos"
      ? temasDisponibles.map((t) => t.numero)
      : Array.isArray(temas)
        ? [...new Set(temas.map(Number))]
        : [Number(tema)];

  const arbol = await obtenerArbolGitHub();
  const mapaArbolPorRuta = new Map(arbol.map((item) => [item.path, item]));

  const documentos = [];
  const archivos = [];
  const archivosOrigenPorTema = {};
  const revisionesPorTema = {};

  for (const numTema of temasSeleccionados) {
    const temaEncontrado = temasDisponibles.find((t) => t.numero === numTema);
    if (!temaEncontrado) continue;

    const apartadosFiltrar = apartado
      ? temaEncontrado.apartados.filter((ap) => ap.numero === apartado)
      : temaEncontrado.apartados;

    const archivosTema = [];
    const shasTema = [];

    for (const ap of apartadosFiltrar) {
      let rutasArchivos = ap.archivos || [];
      if (fichero) {
        rutasArchivos = rutasArchivos.filter((r) => path.basename(r) === fichero);
      }

      for (const rutaArchivo of rutasArchivos) {
        const itemBlob = mapaArbolPorRuta.get(rutaArchivo);
        if (!itemBlob) continue;

        archivosTema.push(rutaArchivo);
        shasTema.push(itemBlob.sha);

        const buffer = await descargarBlobGitHub(itemBlob.sha, rutaArchivo);
        const ext = path.extname(rutaArchivo).toLowerCase();
        const texto = await extraerTextoMaterial(buffer, ext, path.basename(rutaArchivo));
        if (!texto) continue;

        const { subapartado: subNum, subapartadoNombre } = detectarSubapartadoGitHub(path.basename(rutaArchivo), numTema, ap.numero);
        if (subapartado && subNum !== subapartado) continue;

        const titulo = ext === ".tex"
          ? obtenerTitulo(buffer.toString("utf8"), ap.nombre)
          : ap.nombre;

        documentos.push({
          archivo: rutaArchivo,
          nombre: rutaArchivo,
          fichero: path.basename(rutaArchivo),
          tema: numTema,
          apartado: ap.numero,
          apartadoNombre: ap.nombre,
          subapartado: subNum,
          subapartadoNombre,
          titulo,
          texto,
        });
      }
    }

    archivos.push(...archivosTema);
    archivosOrigenPorTema[numTema] = archivosTema;
    revisionesPorTema[numTema] = shasTema.sort().join("-").slice(0, 32);
  }

  if (!documentos.length) {
    // Si no pudimos descargar o no había contenido de GitHub, prueba con local
    return obtenerMaterialSeleccionadoLocal({ asignatura, tema, temas, apartado, subapartado, fichero });
  }

  return {
    asignatura: asigObj.nombre,
    tema: temasSeleccionados.length === 1 ? temasSeleccionados[0] : 0,
    temas: temasSeleccionados,
    apartado,
    subapartado,
    fichero,
    titulo: apartado
      ? documentos[0].titulo
      : temasSeleccionados.length === 1
        ? `Tema ${temasSeleccionados[0]} · ${asigObj.nombre}`
        : `${asigObj.nombre} · Temas ${temasSeleccionados.join(", ")}`,
    alcance: `${asigObj.nombre} · ${
      temasSeleccionados.length === 1
        ? `Tema ${temasSeleccionados[0]}`
        : `Temas ${temasSeleccionados.join(", ")}`
    }${apartado ? ` · Apartado ${temasSeleccionados[0]}.${apartado}` : ""}`,
    archivos,
    archivosOrigenPorTema,
    revisionesPorTema,
    documentos,
    revision: Object.values(revisionesPorTema).join("-").slice(0, 32),
  };
}
