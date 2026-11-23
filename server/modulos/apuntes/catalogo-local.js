import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { configuracion } from "../../configuracion.js";
import {
  esArchivoMaterial,
  esArchivoDeCompilacion,
  patronTema,
  directoriosIgnorados,
  leerEntradasZip,
  extraerTextoMaterial,
  obtenerTitulo,
  dividirTextoPorApartados,
} from "./extractor.js";

const cacheHuellas = new Map();
const cacheCatalogo = new Map();

export async function comprobarRaizApuntes(raiz) {
  try {
    return await realpath(raiz);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "No existe la carpeta de apuntes. Elige la carpeta correcta con el acceso directo de Preparar tests.",
      );
    }
    throw error;
  }
}

export async function listarArchivosMateriales(directorio) {
  let entradas;
  try {
    entradas = await readdir(directorio, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const archivos = [];
  const nombres = new Set(
    entradas.filter((entrada) => entrada.isFile()).map((entrada) => entrada.name.toLowerCase()),
  );
  for (const entrada of entradas.sort((a, b) =>
    a.name.localeCompare(b.name, "es"),
  )) {
    if (entrada.name.startsWith(".") || entrada.name === ".git") continue;
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory() && !directoriosIgnorados.has(entrada.name.toLowerCase())) {
      archivos.push(...(await listarArchivosMateriales(ruta)));
    } else if (
      entrada.isFile() &&
      esArchivoMaterial(path.extname(entrada.name).toLowerCase()) &&
      !esArchivoDeCompilacion(entrada.name) &&
      !(
        path.extname(entrada.name).toLowerCase() === ".pdf" &&
        nombres.has(`${path.basename(entrada.name, path.extname(entrada.name)).toLowerCase()}.tex`)
      )
    ) {
      archivos.push(ruta);
    }
  }
  return archivos;
}

export function numeroDeApartado(nombre, tema) {
  const coincidencia = nombre.match(
    new RegExp(`^Tema\\s*${tema}\\.(\\d+)`, "i"),
  );
  return coincidencia ? Number(coincidencia[1]) : null;
}

export function numeroDeArchivo(nombre, tema) {
  const coincidencia = nombre.match(
    new RegExp(`^${tema}\\.(\\d+)(?:[.-]|$)`, "i"),
  );
  return coincidencia && !esArchivoDeCompilacion(nombre)
    ? Number(coincidencia[1])
    : null;
}

export function numeroDeMaterial(nombre, tema) {
  for (const parte of nombre.replace(/!/g, "/").split("/")) {
    const nombreParte = path.posix.basename(parte);
    const numeroCarpeta = numeroDeApartado(nombreParte, tema);
    if (numeroCarpeta !== null) return numeroCarpeta;
    const numeroArchivo = numeroDeArchivo(nombreParte, tema);
    if (numeroArchivo !== null) return numeroArchivo;
  }
  return null;
}

export function detectarSubapartadoYFichero(nombre, tema, apartado) {
  const partes = nombre.replace(/!/g, "/").split("/");
  const fichero = path.posix.basename(partes.at(-1) || "");
  let subapartado = null;
  let subapartadoNombre = "";

  const matchSubTriple = fichero.match(new RegExp(`^(?:Tema\\s*)?${tema}\\.${apartado}\\.(\\d+)(?:[.-](.*))?`, "i"));
  if (matchSubTriple) {
    subapartado = Number(matchSubTriple[1]);
    subapartadoNombre = (matchSubTriple[2] || "").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[_-]+/g, " ").trim();
  } else {
    const matchSimpleNum = fichero.match(/^(\d+)[.-](.*)/);
    if (matchSimpleNum && !esArchivoDeCompilacion(fichero)) {
      subapartado = Number(matchSimpleNum[1]);
      subapartadoNombre = (matchSimpleNum[2] || "").replace(/\.[a-zA-Z0-9]+$/, "").replace(/[_-]+/g, " ").trim();
    }
  }

  return { fichero, subapartado, subapartadoNombre };
}

export function nombreLegibleMaterial(nombre, tema, apartado) {
  const ultimaParte = nombre.split("!/").at(-1);
  const base = path.posix.basename(ultimaParte, path.posix.extname(ultimaParte));
  const titulo = base
    .replace(new RegExp(`^Tema\\s*${tema}(?:\\.\\d+)*[\\s._-]*`, "i"), "")
    .replace(new RegExp(`^${tema}(?:\\.\\d+)*[\\s._-]*`), "")
    .replace(/[_-]+/g, " ")
    .trim();
  return titulo || (apartado ? `Apartado ${tema}.${apartado}` : `Tema ${tema}`);
}

export async function cargarMaterialTema(tema, raizApuntes) {
  const archivos = [
    ...(await listarArchivosMateriales(tema.ruta)),
    ...tema.archivosExtra,
  ].sort((a, b) => a.localeCompare(b, "es"));
  const documentos = [];
  for (const archivo of [...new Set(archivos)]) {
    const rutaReal = await realpath(archivo);
    if (!rutaReal.startsWith(`${raizApuntes}${path.sep}`))
      throw new Error("Se encontró un enlace fuera de la carpeta de apuntes.");
    const extension = path.extname(archivo).toLowerCase();
    const relativo = path.relative(raizApuntes, archivo).split(path.sep).join("/");
    const procesarFuente = async (fuente) => {
      const texto = await extraerTextoMaterial(
        fuente.contenido,
        fuente.extension,
        fuente.nombre,
      );
      if (!texto) return;
      const apartado = numeroDeMaterial(fuente.nombre, tema.numero);
      const { fichero, subapartado, subapartadoNombre } = detectarSubapartadoYFichero(fuente.nombre, tema.numero, apartado);
      const titulo = fuente.extension === ".tex"
        ? obtenerTitulo(
            fuente.contenido.toString("utf8"),
            nombreLegibleMaterial(fuente.nombre, tema.numero, apartado),
          )
        : nombreLegibleMaterial(fuente.nombre, tema.numero, apartado);
      const documentosDivididos =
        fuente.extension === ".pdf" && apartado === null
          ? dividirTextoPorApartados(texto, tema.numero)
          : null;
      if (documentosDivididos) {
        documentos.push(
          ...documentosDivididos.map((documento) => ({
            archivo,
            nombre: fuente.nombre,
            fichero,
            tema: tema.numero,
            apartado: documento.numero,
            subapartado: null,
            subapartadoNombre: "",
            apartadoNombre: documento.titulo,
            titulo: documento.titulo,
            texto: documento.texto,
          })),
        );
      } else {
        documentos.push({
          archivo,
          nombre: fuente.nombre,
          fichero,
          tema: tema.numero,
          apartado,
          subapartado,
          subapartadoNombre: subapartadoNombre || titulo,
          apartadoNombre: apartado === null ? "" : titulo,
          titulo,
          texto,
        });
      }
    };

    if (extension === ".zip") {
      await leerEntradasZip(archivo, (entrada) =>
        procesarFuente({
          ...entrada,
          nombre: `${relativo}!/${entrada.nombre}`,
        }),
      );
    } else {
      await procesarFuente({
        nombre: relativo,
        extension,
        contenido: await readFile(rutaReal),
      });
    }
  }
  return { archivos: [...new Set(archivos)], documentos };
}

export function buscarApartados(documentos, numeroTema) {
  const apartados = new Map();
  for (const documento of documentos) {
    if (documento.apartado === null) continue;
    const grupo = apartados.get(documento.apartado) ?? [];
    grupo.push(documento);
    apartados.set(documento.apartado, grupo);
  }
  return [...apartados.entries()]
    .sort(([izquierdo], [derecho]) => izquierdo - derecho)
    .map(([numero, fuentes]) => {
      const ficheros = [...new Set(fuentes.map((f) => f.fichero || path.basename(f.archivo || f.nombre)))];
      const subapartadosMap = new Map();
      for (const f of fuentes) {
        if (f.subapartado != null) {
          subapartadosMap.set(f.subapartado, {
            numero: f.subapartado,
            nombre: f.subapartadoNombre || f.titulo || `Subapartado ${f.subapartado}`,
            fichero: f.fichero || path.basename(f.archivo || f.nombre)
          });
        }
      }
      return {
        numero,
        nombre: fuentes[0].titulo || `Apartado ${numeroTema}.${numero}`,
        archivos: [...new Set(fuentes.map((fuente) => fuente.archivo))],
        ficheros,
        subapartados: [...subapartadosMap.values()].sort((a, b) => a.numero - b.numero),
      };
    });
}

export async function listarTemas(rutaAsignatura) {
  const entradas = await readdir(rutaAsignatura, { withFileTypes: true });
  const temas = new Map();
  for (const entrada of entradas) {
    if (entrada.name.startsWith(".")) continue;
    const directorio = entrada.isDirectory();
    const archivo = entrada.isFile() &&
      esArchivoMaterial(path.extname(entrada.name).toLowerCase());
    if (!directorio && !archivo) continue;
    const coincidencia = directorio
      ? entrada.name.match(patronTema)
      : entrada.name.match(/^Tema\s*(\d+)(?:[.\s_-]|$)/i);
    if (!coincidencia) continue;
    const numero = Number(coincidencia[1]);
    const tema = temas.get(numero) ?? {
      numero,
      nombre: `Tema ${numero}`,
      ruta: path.join(rutaAsignatura, `Tema ${numero}`),
      archivosExtra: [],
    };
    if (directorio) {
      tema.nombre = entrada.name;
      tema.ruta = path.join(rutaAsignatura, entrada.name);
    } else {
      tema.archivosExtra.push(path.join(rutaAsignatura, entrada.name));
    }
    temas.set(numero, tema);
  }
  return [...temas.values()].sort((a, b) => a.numero - b.numero);
}

export async function resolverAsignatura(raiz, nombre) {
  const asignatura = String(nombre ?? "").trim();
  if (
    !asignatura ||
    asignatura === "." ||
    asignatura === ".." ||
    path.basename(asignatura) !== asignatura ||
    asignatura.includes("/") ||
    asignatura.includes("\\")
  ) {
    throw new Error("Selecciona una asignatura válida.");
  }
  let ruta;
  try {
    ruta = await realpath(path.join(raiz, asignatura));
  } catch (error) {
    if (error.code === "ENOENT")
      throw new Error(`No se encuentra la asignatura «${asignatura}» en los apuntes.`);
    throw error;
  }
  if (!ruta.startsWith(`${raiz}${path.sep}`))
    throw new Error("La asignatura indicada está fuera de la carpeta de apuntes.");
  return ruta;
}

export async function calcularRevision(raiz, archivos) {
  const huella = createHash("sha256");
  for (const archivo of [...new Set(archivos)].sort()) {
    const rutaReal = await realpath(archivo);
    if (!rutaReal.startsWith(`${raiz}${path.sep}`))
      throw new Error("Se encontró un enlace fuera de la carpeta de apuntes.");
    const informacion = await stat(rutaReal);
    const clave = path.relative(raiz, rutaReal).split(path.sep).join("/");
    const cacheada = cacheHuellas.get(rutaReal);
    let archivoHash;
    if (
      cacheada &&
      cacheada.tamano === informacion.size &&
      cacheada.modificado === informacion.mtimeMs
    ) {
      archivoHash = cacheada.huella;
    } else {
      const hash = createHash("sha256");
      for await (const parte of createReadStream(rutaReal)) hash.update(parte);
      archivoHash = hash.digest("hex");
      cacheHuellas.set(rutaReal, {
        tamano: informacion.size,
        modificado: informacion.mtimeMs,
        huella: archivoHash,
      });
    }
    huella.update(clave);
    huella.update("\0");
    huella.update(archivoHash);
    huella.update("\0");
  }
  return huella.digest("hex");
}

export async function leerCatalogoApuntesLocal({ raizApuntes = configuracion.raizApuntes } = {}) {
  const raiz = await comprobarRaizApuntes(raizApuntes);
  const cacheado = cacheCatalogo.get(raiz);
  if (cacheado && Date.now() - cacheado.fecha < 20000)
    return cacheado.catalogo;
  const entradas = await readdir(raiz, { withFileTypes: true });
  const asignaturas = [];
  for (const entrada of entradas
    .filter((elemento) => elemento.isDirectory() && !elemento.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name, "es"))) {
    const rutaAsignatura = path.join(raiz, entrada.name);
    const temas = [];
    for (const tema of await listarTemas(rutaAsignatura)) {
      const material = await cargarMaterialTema(tema, raiz);
      if (!material.documentos.length) continue;
      const apartados = buscarApartados(material.documentos, tema.numero);
      temas.push({
        numero: tema.numero,
        nombre: tema.nombre,
        revision: await calcularRevision(raiz, material.archivos),
        apartados: await Promise.all(
          apartados.map(async (apartado) => ({
            numero: apartado.numero,
            nombre: apartado.nombre,
            revision: await calcularRevision(raiz, apartado.archivos),
            ficheros: apartado.ficheros,
            subapartados: apartado.subapartados,
          })),
        ),
      });
    }
    if (temas.length) asignaturas.push({ nombre: entrada.name, temas });
  }
  const catalogo = { asignaturas };
  cacheCatalogo.set(raiz, { fecha: Date.now(), catalogo });
  return catalogo;
}

export async function obtenerMaterialSeleccionadoLocal(
  { asignatura, tema, temas, apartado = 0, subapartado = 0, fichero = "" },
  { raizApuntes = configuracion.raizApuntes } = {},
) {
  const temasSeleccionados =
    temas === "todos"
      ? "todos"
      : Array.isArray(temas)
        ? [...new Set(temas.map(Number))]
        : [Number(tema)];
  if (
    temasSeleccionados !== "todos" &&
    (!temasSeleccionados.length ||
      temasSeleccionados.some(
        (numero) => !Number.isSafeInteger(numero) || numero < 1,
      ))
  )
    throw new Error("Selecciona uno o varios temas válidos.");
  if (!Number.isSafeInteger(apartado) || apartado < 0)
    throw new Error("Selecciona un apartado válido.");
  if (apartado && temasSeleccionados !== "todos" && temasSeleccionados.length !== 1)
    throw new Error("Selecciona un solo tema cuando quieras elegir un apartado.");
  if (apartado && temasSeleccionados === "todos")
    throw new Error("Selecciona un tema concreto para practicar un apartado.");
  const raiz = await comprobarRaizApuntes(raizApuntes);
  const rutaAsignatura = await resolverAsignatura(raiz, asignatura);
  const temasDisponibles = await listarTemas(rutaAsignatura);
  const numerosElegidos =
    temasSeleccionados === "todos"
      ? temasDisponibles.map((elemento) => elemento.numero)
      : temasSeleccionados;
  const temasNoEncontrados = numerosElegidos.filter(
    (numero) => !temasDisponibles.some((elemento) => elemento.numero === numero),
  );
  if (temasNoEncontrados.length)
    throw new Error(`No se encuentran los temas seleccionados: ${temasNoEncontrados.join(", ")}.`);
  const grupos = [];
  const archivosPorTema = new Map();
  for (const numeroTema of numerosElegidos) {
    const temaSeleccionado = temasDisponibles.find(
      (elemento) => elemento.numero === numeroTema,
    );
    const material = await cargarMaterialTema(temaSeleccionado, raiz);
    const apartados = buscarApartados(material.documentos, numeroTema);
    let documentosTema = material.documentos;
    if (apartado) {
      const seccion = apartados.find((elemento) => elemento.numero === apartado);
      if (!seccion)
        throw new Error(`No se encuentra el apartado ${numeroTema}.${apartado}.`);
      documentosTema = material.documentos.filter(
        (documento) => documento.apartado === apartado,
      );
      if (subapartado) {
        const filtradosSub = documentosTema.filter((doc) => doc.subapartado === subapartado);
        if (filtradosSub.length) documentosTema = filtradosSub;
      }
      if (fichero) {
        const filtradosFich = documentosTema.filter((doc) => doc.fichero === fichero);
        if (filtradosFich.length) documentosTema = filtradosFich;
      }
    }
    grupos.push(...documentosTema);
    archivosPorTema.set(
      numeroTema,
      [...new Set(documentosTema.map((documento) => documento.archivo))],
    );
  }
  const archivos = [...new Set(grupos.map((elemento) => elemento.archivo))];
  if (!archivos.length)
    throw new Error(
      "La selección no contiene apuntes compatibles. Se admiten LaTeX, PDF con texto seleccionable, ZIP con apuntes y archivos de texto/código.",
    );
  const documentos = grupos.map((documento) => ({
    nombre: documento.nombre,
    titulo: documento.titulo,
    tema: documento.tema,
    apartado: documento.apartado ?? 0,
    apartadoNombre: documento.apartadoNombre ?? "",
    subapartado: documento.subapartado ?? null,
    subapartadoNombre: documento.subapartadoNombre ?? "",
    fichero: documento.fichero ?? "",
    texto: documento.texto,
  }));
  if (!documentos.length)
    throw new Error("No se pudo extraer texto de los archivos seleccionados.");
  const archivosOrigenPorTema = {};
  const revisionesPorTema = {};
  for (const [numeroTema, archivosTema] of archivosPorTema) {
    archivosOrigenPorTema[numeroTema] = archivosTema.map((archivo) =>
      path.relative(raiz, archivo).split(path.sep).join("/"),
    );
    revisionesPorTema[numeroTema] = await calcularRevision(raiz, archivosTema);
  }

  return {
    asignatura: String(asignatura).trim(),
    tema: numerosElegidos.length === 1 ? numerosElegidos[0] : 0,
    temas: numerosElegidos,
    apartado,
    subapartado,
    fichero,
    titulo: apartado
      ? grupos[0].nombre
      : numerosElegidos.length === 1
        ? `Tema ${numerosElegidos[0]} · ${asignatura}`
        : `${asignatura} · ${numerosElegidos.length === temasDisponibles.length ? "todos los temas" : `Temas ${numerosElegidos.join(", ")}`}`,
    alcance: `${asignatura} · ${
      numerosElegidos.length > 1 &&
      numerosElegidos.length === temasDisponibles.length &&
      numerosElegidos.every((numero, indice) => numero === temasDisponibles[indice].numero)
        ? "todos los temas"
        : numerosElegidos.length === 1
          ? `Tema ${numerosElegidos[0]}`
          : `Temas ${numerosElegidos.join(", ")}`
    }${apartado ? ` · Apartado ${numerosElegidos[0]}.${apartado}` : ""}${subapartado ? `.${subapartado}` : ""}`,
    archivos: archivos.map((archivo) =>
      path.relative(raiz, archivo).split(path.sep).join("/"),
    ),
    archivosOrigenPorTema,
    revisionesPorTema,
    documentos,
    revision: await calcularRevision(raiz, archivos),
  };
}
