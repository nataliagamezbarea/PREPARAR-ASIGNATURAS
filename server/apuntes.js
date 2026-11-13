import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { configuracion } from "./configuracion.js";

const archivosIgnorados = new Set([
  "carga.tex",
  "preambulo.tex",
  "generador-estilos.tex",
]);
const directoriosIgnorados = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "build",
  "dist",
  "target",
]);
const extensionesTexto = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".jsx",
  ".tsx",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".json",
  ".jsonc",
  ".xml",
  ".yaml",
  ".yml",
  ".toml",
  ".properties",
  ".gradle",
  ".ipynb",
  ".vue",
  ".svelte",
  ".tf",
  ".py",
  ".java",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".cs",
  ".php",
  ".sql",
  ".sh",
  ".bash",
  ".go",
  ".rs",
  ".kt",
  ".kts",
  ".dart",
]);
const patronTema = /^Tema\s*(\d+)$/i;
const patronTitulo =
  /\\(?:secciongrande|seccion|titulo|subtituloA|subtituloB|subtitulo|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{([^{}]+)\}/i;
const patronCodigo =
  /\\begin\{(lstlisting|verbatim|minted|Verbatim)(?:\[[^\]]*\])?\}([\s\S]*?)\\end\{\1\}/g;
const cacheHuellas = new Map();
const cacheCatalogo = new Map();

function esArchivoDeCompilacion(nombre) {
  return (
    archivosIgnorados.has(nombre.toLowerCase()) ||
    /^tema\d+\.tex$/i.test(nombre)
  );
}

function esFormatoTexto(extension) {
  return extension === ".tex" || extensionesTexto.has(extension);
}

function esArchivoMaterial(extension) {
  return extension === ".zip" || extension === ".pdf" || esFormatoTexto(extension);
}

async function listarArchivosMateriales(directorio) {
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

function normalizarRutaZip(nombre) {
  const conSeparadoresUnix = nombre.replace(/\\/g, "/");
  const segmentos = conSeparadoresUnix.split("/");
  if (
    conSeparadoresUnix.startsWith("/") ||
    /^[a-zA-Z]:/.test(conSeparadoresUnix) ||
    segmentos.some((segmento) => segmento === ".." || segmento.startsWith("."))
  )
    return null;
  const normalizada = path.posix.normalize(conSeparadoresUnix);
  return normalizada === "." || normalizada.startsWith("../")
    ? null
    : normalizada;
}

function leerEntradasZip(archivo, procesarEntrada) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivo,
      {
        lazyEntries: true,
        autoClose: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error) {
          reject(new Error(`No se puede leer el ZIP ${path.basename(archivo)}: ${error.message}`));
          return;
        }

        let terminado = false;
        const fallar = (fallo) => {
          if (terminado) return;
          terminado = true;
          zipFile.close();
          reject(
            new Error(`No se puede leer el ZIP ${path.basename(archivo)}: ${fallo.message}`),
          );
        };

        zipFile.on("error", fallar);
        zipFile.on("end", () => {
          if (terminado) return;
          terminado = true;
          resolve();
        });
        zipFile.on("entry", (entrada) => {
          const nombre = normalizarRutaZip(entrada.fileName);
          const extension = path.posix.extname(nombre ?? "").toLowerCase();
          if (
            !nombre ||
            entrada.fileName.endsWith("/") ||
            nombre
              .split("/")
              .some((segmento) =>
                directoriosIgnorados.has(segmento.toLowerCase()),
              ) ||
            !esFormatoTexto(extension) && extension !== ".pdf"
          ) {
            zipFile.readEntry();
            return;
          }
          zipFile.openReadStream(entrada, (fallo, stream) => {
            if (fallo) {
              fallar(fallo);
              return;
            }
            const partes = [];
            let bytesLeidos = 0;
            stream.on("data", (parte) => {
              bytesLeidos += parte.length;
              partes.push(parte);
            });
            stream.on("error", fallar);
            stream.on("end", async () => {
              if (terminado) return;
              try {
                await procesarEntrada({
                  nombre,
                  extension,
                  contenido: Buffer.concat(partes, bytesLeidos),
                });
              } catch (error) {
                fallar(error);
                return;
              }
              if (terminado) return;
              zipFile.readEntry();
            });
          });
        });
        zipFile.readEntry();
      },
    );
  });
}

async function extraerTextoPdf(contenido, nombre) {
  const tarea = getDocument({
    data: new Uint8Array(contenido),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  let documento;
  try {
    documento = await tarea.promise;
    const paginas = [];
    for (let numero = 1; numero <= documento.numPages; numero += 1) {
      const pagina = await documento.getPage(numero);
      const datos = await pagina.getTextContent();
      let textoPagina = "";
      for (const elemento of datos.items) {
        if (!("str" in elemento) || !elemento.str) continue;
        textoPagina += `${elemento.str}${elemento.hasEOL ? "\n" : " "}`;
      }
      paginas.push(textoPagina);
    }
    const texto = paginas.join("\n").trim();
    if (!texto)
      throw new Error(
        `${nombre} no contiene texto seleccionable; no se puede incluir sin OCR.`,
      );
    return texto;
  } catch (error) {
    if (error.message.includes("no contiene texto seleccionable")) throw error;
    throw new Error(`No se pudo extraer texto de ${nombre}: ${error.message}`);
  } finally {
    await tarea.destroy();
  }
}

async function extraerTextoMaterial(contenido, extension, nombre) {
  if (extension === ".pdf") return extraerTextoPdf(contenido, nombre);
  const texto = contenido.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (extension === ".tex") return quitarLatex(texto);
  if (extensionesTexto.has(extension) && extension !== ".txt" && extension !== ".md" && extension !== ".markdown") {
    const lenguaje = extension.slice(1);
    return `Ejemplo de código (${lenguaje}):\n\`\`\`${lenguaje}\n${texto}\n\`\`\``;
  }
  return texto;
}

function quitarLatex(texto) {
  const bloquesCodigo = [];
  let resultado = texto.replace(
    patronCodigo,
    (_coincidencia, _entorno, codigo) => {
      bloquesCodigo.push(codigo.trim());
      return `\nCODIGO_DE_EJEMPLO_${bloquesCodigo.length - 1}\n`;
    },
  );
  resultado = resultado
    .replace(/(?<!\\)%.*$/gm, "")
    .replace(/\\(?:input|include)\s*\{[^{}]*\}/g, " ")
    .replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, "\n")
    .replace(
      /\\(?:secciongrande|seccion|titulo|subtituloA|subtituloB|subtitulo|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/gi,
      "\n$1\n",
    )
    .replace(/\\item\s*/g, "\n• ")
    .replace(
      /\\(?:textbf|textit|emph|underline|texttt|textrm|textsf|textsc|mbox|url)\s*\{([^{}]*)\}/g,
      "$1",
    )
    .replace(/\\lstinline(?:\[[^\]]*\])?\|([^|]*)\|/g, "`$1`")
    .replace(/\\([%&_#$])/g, "$1")
    .replace(
      /\\(?:hline|toprule|midrule|bottomrule|centering|noindent|newline|par)\b/g,
      "\n",
    )
    .replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/\\\\/g, "\n")
    .replace(/[{}]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  for (const [indice, codigo] of bloquesCodigo.entries()) {
    resultado = resultado.replace(
      `CODIGO_DE_EJEMPLO_${indice}`,
      `\nCódigo de ejemplo:\n${codigo}\n`,
    );
  }
  return resultado;
}

function obtenerTitulo(contenido, predeterminado) {
  const coincidencia = contenido.match(patronTitulo);
  return coincidencia
    ? quitarLatex(coincidencia[1]).replace(/\s+/g, " ").trim() ||
        predeterminado
    : predeterminado;
}

function numeroDeApartado(nombre, tema) {
  const coincidencia = nombre.match(
    new RegExp(`^Tema\\s*${tema}\\.(\\d+)$`, "i"),
  );
  return coincidencia ? Number(coincidencia[1]) : null;
}

function numeroDeArchivo(nombre, tema) {
  const coincidencia = nombre.match(
    new RegExp(`^${tema}\\.(\\d+)(?:[.-]|$)`, "i"),
  );
  return coincidencia && !esArchivoDeCompilacion(nombre)
    ? Number(coincidencia[1])
    : null;
}

function numeroDeMaterial(nombre, tema) {
  for (const parte of nombre.replace(/!/g, "/").split("/")) {
    const nombreParte = path.posix.basename(parte);
    const numeroCarpeta = numeroDeApartado(nombreParte, tema);
    if (numeroCarpeta !== null) return numeroCarpeta;
    const numeroArchivo = numeroDeArchivo(nombreParte, tema);
    if (numeroArchivo !== null) return numeroArchivo;
  }
  return null;
}

function limpiarTituloEncabezado(tituloRaw) {
  let limpio = String(tituloRaw || "").trim();
  limpio = limpio
    .replace(/Col[·•.\s]*legi[\s\S]*$/i, "")
    .replace(/Math\..*$/i, "")
    .replace(/localStorage[\s\S]*$/i, "")
    .replace(/^[·•\s-]+/, "")
    .trim();

  const mTema = limpio.match(/Tema\s*\d+(?:\.\d+)*\s*[:·-]\s*([^·\n\r]{3,60})/i);
  if (mTema && mTema[1]) {
    limpio = mTema[1].trim();
  } else {
    limpio = limpio.replace(/^ABANS DE COMENÇAR[^·\n\r]*[·\n\r]*/i, "").trim();
    const partes = limpio.split(/[·\n\r]/).map((p) => p.trim()).filter(Boolean);
    if (partes.length > 1) {
      const candidata = partes.find(
        (p) =>
          p.length >= 4 &&
          p.length <= 60 &&
          !p.toLowerCase().includes("col") &&
          !p.toLowerCase().includes("abans") &&
          !p.toLowerCase().includes("desenvolupament web"),
      );
      if (candidata) limpio = candidata;
    }
  }

  limpio = limpio
    .replace(/^Tema\s*\d+(?:\.\d+)*\s*[:·-]?\s*/i, "")
    .replace(/^[·•\s-]+/, "")
    .replace(/[·•\s-]+$/, "")
    .trim();

  if (limpio.length > 60) {
    limpio = limpio.slice(0, 57) + "…";
  }
  return limpio || String(tituloRaw || "").trim();
}

function dividirTextoPorApartados(texto, tema) {
  const patron = new RegExp(
    `^\\s*(?:Tema\\s*)?${tema}\\.(\\d+)(?:\\.\\d+)*(?:[.)\\s:—–-]+)(.{3,})\\s*$`,
    "i",
  );
  const lineas = texto.split(/\r?\n/);
  const encabezados = [];
  for (const [indice, linea] of lineas.entries()) {
    const coincidencia = linea.match(patron);
    if (coincidencia)
      encabezados.push({
        indice,
        numero: Number(coincidencia[1]),
        titulo: limpiarTituloEncabezado(coincidencia[2]),
      });
  }
  if (!encabezados.length) return null;

  const apartados = [];
  const textoInicial = lineas.slice(0, encabezados[0].indice).join("\n").trim();
  if (textoInicial) apartados.push({ numero: null, titulo: `Tema ${tema}`, texto: textoInicial });
  for (const [indice, encabezado] of encabezados.entries()) {
    const siguiente = encabezados[indice + 1]?.indice ?? lineas.length;
    apartados.push({
      numero: encabezado.numero,
      titulo: encabezado.titulo,
      texto: lineas.slice(encabezado.indice, siguiente).join("\n").trim(),
    });
  }
  return apartados;
}

function nombreLegibleMaterial(nombre, tema, apartado) {
  const ultimaParte = nombre.split("!/").at(-1);
  const base = path.posix.basename(ultimaParte, path.posix.extname(ultimaParte));
  const titulo = base
    .replace(new RegExp(`^Tema\\s*${tema}(?:\\.\\d+)*[\\s._-]*`, "i"), "")
    .replace(new RegExp(`^${tema}(?:\\.\\d+)*[\\s._-]*`), "")
    .replace(/[_-]+/g, " ")
    .trim();
  return titulo || (apartado ? `Apartado ${tema}.${apartado}` : `Tema ${tema}`);
}

async function cargarMaterialTema(tema, raizApuntes) {
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
            tema: tema.numero,
            apartado: documento.numero,
            apartadoNombre: documento.titulo,
            titulo: documento.titulo,
            texto: documento.texto,
          })),
        );
      } else {
        documentos.push({
          archivo,
          nombre: fuente.nombre,
          tema: tema.numero,
          apartado,
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

function buscarApartados(documentos, numeroTema) {
  const apartados = new Map();
  for (const documento of documentos) {
    if (documento.apartado === null) continue;
    const grupo = apartados.get(documento.apartado) ?? [];
    grupo.push(documento);
    apartados.set(documento.apartado, grupo);
  }
  return [...apartados.entries()]
    .sort(([izquierdo], [derecho]) => izquierdo - derecho)
    .map(([numero, fuentes]) => ({
      numero,
      nombre: fuentes[0].titulo || `Apartado ${numeroTema}.${numero}`,
      archivos: [...new Set(fuentes.map((fuente) => fuente.archivo))],
    }));
}

async function listarTemas(rutaAsignatura) {
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

async function comprobarRaizApuntes(raiz) {
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

async function resolverAsignatura(raiz, nombre) {
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

async function calcularRevision(raiz, archivos) {
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

export async function leerCatalogoApuntes({ raizApuntes = configuracion.raizApuntes } = {}) {
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

export async function obtenerMaterialSeleccionado(
  { asignatura, tema, temas, apartado = 0 },
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
    }${apartado ? ` · Apartado ${numerosElegidos[0]}.${apartado}` : ""}`,
    archivos: archivos.map((archivo) =>
      path.relative(raiz, archivo).split(path.sep).join("/"),
    ),
    archivosOrigenPorTema,
    revisionesPorTema,
    documentos,
    revision: await calcularRevision(raiz, archivos),
  };
}
