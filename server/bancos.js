import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { configuracion } from "./configuracion.js";

const formatoBanco = "preparar-tests-banco-preguntas";
const versionBanco = 1;

function normalizarTexto(texto) {
  return String(texto ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function crearClaveBanco(asignatura, tema, apartado, temas = []) {
  const nombre = String(asignatura ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const temasNormalizados = [...new Set(temas.map(Number))].sort((a, b) => a - b);
  const temaClave =
    Number(tema) > 0 ? String(Number(tema)) : temasNormalizados.join("-");
  if (!temaClave) throw new Error("El banco necesita al menos un tema.");
  const clave = `${nombre || "Asignatura"}-temas-${temaClave}-apartado-${apartado}`;
  if (clave.length > 110)
    throw new Error("La selección de temas es demasiado larga para el nombre del archivo.");
  return clave;
}

function crearClaveBancoAnterior(asignatura, tema, apartado, temas = []) {
  const resumen = createHash("sha256")
    .update(String(asignatura))
    .digest("hex")
    .slice(0, 10);
  const nombre = normalizarTexto(asignatura).replace(/\s+/g, "-").slice(0, 48);
  const temasNormalizados = [...new Set(temas.map(Number))].sort((a, b) => a - b);
  const temaClave =
    Number(tema) > 0 ? String(Number(tema)) : temasNormalizados.join("-");
  if (!temaClave) throw new Error("El banco necesita al menos un tema.");
  return `${nombre || "asignatura"}-${resumen}-t${temaClave}-a${apartado}`;
}

function nombreCarpetaBanco(asignatura) {
  const nombre = String(asignatura ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 48);
  if (!nombre || nombre === "." || nombre === "..")
    throw new Error("El nombre de la asignatura no es válido para guardar el banco.");
  return nombre;
}

function resolverArchivoBanco(clave, raiz, asignatura) {
  if (!/^[a-zA-Z0-9-]{1,110}$/.test(clave))
    throw new Error("La clave del banco de preguntas no es válida.");
  return path.join(raiz, nombreCarpetaBanco(asignatura), `${clave}.json`);
}

function obtenerRutasBanco(asignatura, tema, apartado, temas, raiz) {
  const clave = crearClaveBanco(asignatura, tema, apartado, temas);
  const anterior = crearClaveBancoAnterior(asignatura, tema, apartado, temas);
  const resumen = createHash("sha256")
    .update(String(asignatura))
    .digest("hex")
    .slice(0, 10);
  const nombreAnterior = normalizarTexto(asignatura)
    .replace(/\s+/g, "-")
    .slice(0, 48);
  const carpetaAnterior = `${nombreAnterior || "asignatura"}-${resumen}`;
  return {
    clave,
    archivo: resolverArchivoBanco(clave, raiz, asignatura),
    archivosAnteriores: [...new Set([
      path.join(raiz, carpetaAnterior, `${clave}.json`),
      path.join(raiz, carpetaAnterior, `${anterior}.json`),
      path.join(raiz, `${anterior}.json`),
      path.join(raiz, `${clave}.json`),
    ])],
  };
}

async function migrarNombreArchivo(archivo, banco, raiz) {
  const { clave, archivo: destino } = obtenerRutasBanco(
    banco.meta.asignatura,
    banco.meta.tema,
    banco.meta.apartado,
    banco.meta.temas ?? [],
    raiz,
  );
  if (archivo === destino) return destino;
  await mkdir(path.dirname(destino), { recursive: true });
  try {
    await link(archivo, destino);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const [origen, existente] = await Promise.all([
      readFile(archivo),
      readFile(destino),
    ]);
    if (!origen.equals(existente)) return archivo;
  }
  await escribirAtomicamente(destino, { ...banco, clave });
  await unlink(archivo);
  return destino;
}

export function calcularHuellaPregunta(pregunta) {
  return createHash("sha256")
    .update(normalizarTexto(pregunta.enunciado))
    .digest("hex");
}

function obtenerPalabras(pregunta) {
  return new Set(
    normalizarTexto(pregunta.enunciado)
      .split(/\s+/)
      .filter((palabra) => palabra.length > 2),
  );
}

function esPreguntaRepetida(pregunta, anteriores) {
  const palabras = obtenerPalabras(pregunta);
  if (palabras.size < 6) return false;
  for (const anterior of anteriores) {
    const palabrasAnteriores = obtenerPalabras(anterior);
    if (palabrasAnteriores.size < 6) continue;
    let comunes = 0;
    for (const palabra of palabras) {
      if (palabrasAnteriores.has(palabra)) comunes += 1;
    }
    const similitud =
      comunes /
      (palabras.size + palabrasAnteriores.size - comunes);
    if (similitud >= 0.84) return true;
  }
  return false;
}

async function leerArchivoBanco(archivo) {
  let banco;
  try {
    banco = JSON.parse(await readFile(archivo, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`No se puede leer ${path.basename(archivo)}: ${error.message}`);
  }
  if (
    !banco ||
    banco.formato !== formatoBanco ||
    banco.version !== versionBanco ||
    !banco.meta ||
    !Array.isArray(banco.preguntas) ||
    typeof banco.revision !== "string"
  ) {
    throw new Error(
      `${path.basename(archivo)} está dañado o usa un formato incompatible; no se ha sobrescrito.`,
    );
  }
  return banco;
}

async function escribirAtomicamente(archivo, valor) {
  await mkdir(path.dirname(archivo), { recursive: true });
  const temporal = `${archivo}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporal, `${JSON.stringify(valor, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporal, archivo);
  } catch (error) {
    await unlink(temporal).catch((fallo) => {
      if (fallo.code !== "ENOENT") throw fallo;
    });
    throw error;
  }
}

function normalizarTemasBanco(tema, temas) {
  return [...new Set((temas.length ? temas : tema ? [tema] : []).map(Number))]
    .filter((numero) => Number.isSafeInteger(numero) && numero > 0)
    .sort((a, b) => a - b);
}

async function leerBancoConMigracion(
  { asignatura, tema, temas = [], apartado },
  raiz,
) {
  const { clave, archivo, archivosAnteriores } = obtenerRutasBanco(
    asignatura,
    tema,
    apartado,
    temas,
    raiz,
  );
  let banco = await leerArchivoBanco(archivo);
  let ruta = archivo;
  if (!banco) {
    for (const anterior of archivosAnteriores) {
      banco = await leerArchivoBanco(anterior);
      if (banco) {
        ruta = await migrarNombreArchivo(anterior, banco, raiz);
        break;
      }
    }
  }
  return banco ? { banco: { ...banco, clave }, archivo: ruta } : null;
}

function combinarBancos(asignatura, temas, apartado, bancos, bancoAnterior) {
  const bancosOrigen = [
    ...bancos.filter(Boolean),
    ...(bancoAnterior ? [bancoAnterior] : []),
  ];
  const preguntas = [];
  const huellas = new Set();
  for (const banco of bancosOrigen) {
    for (const pregunta of banco.preguntas) {
      const huella = calcularHuellaPregunta(pregunta);
      if (huellas.has(huella)) continue;
      preguntas.push({ ...pregunta, id: preguntas.length + 1 });
      huellas.add(huella);
    }
  }
  if (!preguntas.length && !bancoAnterior) return null;

  const revisionesPorTema = Object.fromEntries(
    bancos
      .filter(Boolean)
      .map((banco) => [banco.meta.tema, banco.revision]),
  );
  const revision = bancoAnterior?.revision ??
    createHash("sha256")
      .update(JSON.stringify(Object.entries(revisionesPorTema).sort()))
      .digest("hex");
  return {
    formato: formatoBanco,
    version: versionBanco,
    clave: crearClaveBanco(asignatura, 0, apartado, temas),
    meta: {
      ...(bancoAnterior?.meta ?? bancos.find(Boolean)?.meta ?? {}),
      asignatura,
      titulo:
        bancoAnterior?.meta.titulo ??
        `${asignatura} · Temas ${temas.join(", ")}`,
      tema: 0,
      temas,
      apartado,
      revisionesPorTema: {
        ...(bancoAnterior?.meta.revisionesPorTema ?? {}),
        ...revisionesPorTema,
      },
      total: preguntas.length,
    },
    preguntas,
    revision,
    archivos_origen: [
      ...new Set(bancosOrigen.flatMap((banco) => banco.archivos_origen ?? [])),
    ].sort(),
    actualizado: bancosOrigen
      .map((banco) => banco.actualizado)
      .sort()
      .at(-1) ?? bancoAnterior?.actualizado,
  };
}

export async function leerBancoPreguntas(
  { asignatura, tema, temas = [], apartado },
  { raiz = configuracion.raizBancos } = {},
) {
  const temasNormalizados = normalizarTemasBanco(tema, temas);
  if (temasNormalizados.length <= 1) {
    const temaUnico = Number(tema) || temasNormalizados[0];
    return (
      await leerBancoConMigracion(
        { asignatura, tema: temaUnico, temas: [temaUnico], apartado },
        raiz,
      )
    )?.banco ?? null;
  }

  const seleccion = { asignatura, tema: 0, temas: temasNormalizados, apartado };
  const anterior = await leerBancoConMigracion(seleccion, raiz);
  const bancosPorTema = await Promise.all(
    temasNormalizados.map(async (temaActual) =>
      (
        await leerBancoConMigracion(
          {
            asignatura,
            tema: temaActual,
            temas: [temaActual],
            apartado,
          },
          raiz,
        )
      )?.banco ?? null,
    ),
  );
  const combinado = combinarBancos(
    asignatura,
    temasNormalizados,
    apartado,
    bancosPorTema,
    anterior?.banco,
  );
  return combinado
    ? { ...combinado, clave: crearClaveBanco(asignatura, 0, apartado, temasNormalizados) }
    : null;
}

async function anadirBancoIndividual(
  {
    asignatura,
    tema,
    temas = [],
    apartado,
    titulo,
    revision,
    archivosOrigen,
    preguntasNuevas,
  },
  { raiz = configuracion.raizBancos } = {},
) {
  const { clave, archivo, archivosAnteriores } = obtenerRutasBanco(
    asignatura,
    tema,
    apartado,
    temas,
    raiz,
  );
  let existente = await leerArchivoBanco(archivo);
  let archivoAnterior = "";
  if (!existente) {
    for (const anterior of archivosAnteriores) {
      existente = await leerArchivoBanco(anterior);
      if (existente) {
        archivoAnterior = anterior;
        break;
      }
    }
  }
  const preguntas = existente ? [...existente.preguntas] : [];
  const huellas = new Set(preguntas.map(calcularHuellaPregunta));
  let siguienteId =
    Math.max(0, ...preguntas.map((pregunta) => Number(pregunta.id) || 0)) + 1;
  let anadidas = 0;
  let repetidas = 0;

  for (const preguntaBruta of preguntasNuevas) {
    if (
      huellas.has(calcularHuellaPregunta(preguntaBruta)) ||
      esPreguntaRepetida(preguntaBruta, preguntas)
    ) {
      repetidas += 1;
      continue;
    }
    const pregunta = { ...preguntaBruta, id: siguienteId };
    if (tema) pregunta.tema = tema;
    if (apartado && !pregunta.tag)
      pregunta.tag = `Tema ${tema}.${apartado}`;
    preguntas.push(pregunta);
    huellas.add(calcularHuellaPregunta(pregunta));
    siguienteId += 1;
    anadidas += 1;
  }

  const meta = {
    ...(existente?.meta ?? {}),
    asignatura,
    titulo,
    tema,
    temas,
    apartado,
    total: preguntas.length,
    version: "1.0",
  };
  const banco = {
    formato: formatoBanco,
    version: versionBanco,
    clave,
    meta,
    preguntas,
    revision,
    archivos_origen: [...new Set(archivosOrigen)].sort(),
    actualizado: new Date().toISOString(),
  };
  await escribirAtomicamente(archivo, banco);
  if (archivoAnterior) await unlink(archivoAnterior);
  return { ...banco, anadidas, repetidas, total: preguntas.length };
}

export async function anadirPreguntasAlBanco(solicitud, opciones = {}) {
  const temas = normalizarTemasBanco(solicitud.tema, solicitud.temas ?? []);
  if (temas.length <= 1) {
    const tema = temas[0] ?? Number(solicitud.tema);
    return anadirBancoIndividual(
      { ...solicitud, tema, temas: tema ? [tema] : [] },
      opciones,
    );
  }

  const { raiz = configuracion.raizBancos } = opciones;
  const seleccion = {
    asignatura: solicitud.asignatura,
    tema: 0,
    temas,
    apartado: solicitud.apartado,
  };
  const bancoAnterior = await leerBancoConMigracion(seleccion, raiz);
  const preguntasAnteriores = bancoAnterior?.banco.preguntas ?? [];
  const obtenerTemaPregunta = (pregunta) => Number(pregunta.tema);
  for (const pregunta of [...preguntasAnteriores, ...solicitud.preguntasNuevas]) {
    if (!temas.includes(obtenerTemaPregunta(pregunta))) {
      throw new Error(
        "No se puede separar el banco por tema porque hay una pregunta sin un tema válido; se conservaron los JSON originales.",
      );
    }
  }

  for (const tema of temas) {
    const preguntasNuevas = [
      ...preguntasAnteriores.filter((pregunta) => obtenerTemaPregunta(pregunta) === tema),
      ...solicitud.preguntasNuevas.filter(
        (pregunta) => obtenerTemaPregunta(pregunta) === tema,
      ),
    ];
    if (!preguntasNuevas.length) continue;
    await anadirBancoIndividual(
      {
        ...solicitud,
        tema,
        temas: [tema],
        titulo: `Tema ${tema} · ${solicitud.asignatura}`,
        revision: solicitud.revisionesPorTema?.[tema] ?? solicitud.revision,
        archivosOrigen:
          solicitud.archivosOrigenPorTema?.[tema] ?? solicitud.archivosOrigen,
        preguntasNuevas,
      },
      opciones,
    );
  }

  if (bancoAnterior?.archivo) await unlink(bancoAnterior.archivo);
  const bancos = await Promise.all(
    temas.map(async (tema) =>
      (
        await leerBancoConMigracion(
          {
            asignatura: solicitud.asignatura,
            tema,
            temas: [tema],
            apartado: solicitud.apartado,
          },
          raiz,
        )
      )?.banco ?? null,
    ),
  );
  const combinado = combinarBancos(
    solicitud.asignatura,
    temas,
    solicitud.apartado,
    bancos,
    null,
  );
  const huellasAnteriores = new Set(
    preguntasAnteriores.map(calcularHuellaPregunta),
  );
  const huellasGuardadas = new Set(
    (combinado?.preguntas ?? []).map(calcularHuellaPregunta),
  );
  const huellasNuevas = new Set(
    solicitud.preguntasNuevas.map(calcularHuellaPregunta),
  );
  const anadidas = [...huellasNuevas].filter(
    (huella) => !huellasAnteriores.has(huella) && huellasGuardadas.has(huella),
  ).length;
  return {
    ...combinado,
    clave: crearClaveBanco(solicitud.asignatura, 0, solicitud.apartado, temas),
    anadidas,
    repetidas: solicitud.preguntasNuevas.length - anadidas,
    total: combinado?.preguntas.length ?? 0,
  };
}

export async function listarBancosPreguntas({ raiz = configuracion.raizBancos } = {}) {
  let entradas;
  try {
    entradas = await readdir(raiz, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const bancos = [];
  for (const entrada of entradas) {
    const directorio = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      const archivos = await readdir(directorio, { withFileTypes: true });
      for (const archivo of archivos.filter(
        (elemento) => elemento.isFile() && elemento.name.endsWith(".json"),
      )) {
        const ruta = path.join(directorio, archivo.name);
        const banco = await leerArchivoBanco(ruta);
        if (banco) {
          const rutaActual = await migrarNombreArchivo(ruta, banco, raiz);
          bancos.push(resumirBanco(banco, path.basename(rutaActual)));
        }
      }
    } else if (entrada.isFile() && entrada.name.endsWith(".json")) {
      const banco = await leerArchivoBanco(directorio);
      if (banco) {
        const rutaActual = await migrarNombreArchivo(directorio, banco, raiz);
        bancos.push(resumirBanco(banco, path.basename(rutaActual)));
      }
    }
  }
  return bancos.sort(
    (izquierdo, derecho) =>
      String(izquierdo.asignatura).localeCompare(
        String(derecho.asignatura),
        "es",
      ) ||
      izquierdo.tema - derecho.tema ||
      izquierdo.apartado - derecho.apartado,
  );
}

function resumirBanco(banco, nombreArchivo) {
  return {
    clave: crearClaveBanco(
      banco.meta.asignatura,
      banco.meta.tema,
      banco.meta.apartado,
      banco.meta.temas ?? [],
    ),
    asignatura: banco.meta.asignatura,
    tema: banco.meta.tema,
    temas: banco.meta.temas ?? (banco.meta.tema ? [banco.meta.tema] : []),
    apartado: banco.meta.apartado,
    titulo: banco.meta.titulo,
    total: banco.preguntas.length,
    revision: banco.revision,
    actualizado: banco.actualizado,
  };
}
