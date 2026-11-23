import path from "node:path";
import yauzl from "yauzl";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const archivosIgnorados = new Set([
  "carga.tex",
  "preambulo.tex",
  "generador-estilos.tex",
]);

export const directoriosIgnorados = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "build",
  "dist",
  "target",
]);

export const extensionesTexto = new Set([
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

export const patronTema = /^Tema\s*(\d+)$/i;
export const patronTitulo =
  /\\(?:secciongrande|seccion|titulo|subtituloA|subtituloB|subtitulo|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{([^{}]+)\}/i;
export const patronCodigo =
  /\\begin\{(lstlisting|verbatim|minted|Verbatim)(?:\[[^\]]*\])?\}([\s\S]*?)\\end\{\1\}/g;

export function esArchivoDeCompilacion(nombre) {
  return (
    archivosIgnorados.has(nombre.toLowerCase()) ||
    /^tema\d+\.tex$/i.test(nombre)
  );
}

export function esFormatoTexto(extension) {
  return extension === ".tex" || extensionesTexto.has(extension);
}

export function esArchivoMaterial(extension) {
  return extension === ".zip" || extension === ".pdf" || esFormatoTexto(extension);
}

export function normalizarRutaZip(nombre) {
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

export function leerEntradasZip(archivo, procesarEntrada) {
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

export async function extraerTextoPdf(contenido, nombre) {
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

export function quitarLatex(texto) {
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

export async function extraerTextoMaterial(contenido, extension, nombre) {
  if (extension === ".pdf") return extraerTextoPdf(contenido, nombre);
  const texto = contenido.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (extension === ".tex") return quitarLatex(texto);
  if (extensionesTexto.has(extension) && extension !== ".txt" && extension !== ".md" && extension !== ".markdown") {
    const lenguaje = extension.slice(1);
    return `Ejemplo de código (${lenguaje}):\n\`\`\`${lenguaje}\n${texto}\n\`\`\``;
  }
  return texto;
}

export function obtenerTitulo(contenido, predeterminado) {
  const coincidencia = contenido.match(patronTitulo);
  return coincidencia
    ? quitarLatex(coincidencia[1]).replace(/\s+/g, " ").trim() ||
        predeterminado
    : predeterminado;
}

export function limpiarTituloEncabezado(tituloRaw) {
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

export function dividirTextoPorApartados(texto, tema) {
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
