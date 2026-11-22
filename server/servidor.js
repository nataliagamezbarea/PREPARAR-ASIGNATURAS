import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { inspect as utilInspect } from "node:util";
import { configuracion } from "./configuracion.js";
import {
  listarBancosPreguntas,
  leerBancoPreguntas,
  anadirPreguntasAlBanco,
} from "./bancos.js";
import {
  leerCatalogoApuntes,
  obtenerMaterialSeleccionado,
} from "./apuntes.js";
import {
  abortarTarea,
  actualizarTarea,
  crearTarea,
  obtenerControladorTarea,
  obtenerTarea,
  registrarLlamadaIA,
} from "./progreso.js";
import { comprobarModelo, generarConIA } from "./modelo.js";
import { log, inspectObjeto, error as debugError } from "./debug.js";

log("servidor", "iniciando servidor de Preparar tests");

import {
  analizarRespuestaIA,
  crearPromptPreguntas,
  dividirDocumentos,
  filtrarPreguntasPorEjemplos,
  INSTRUCCIONES_SISTEMA,
  validarSolicitudGeneracion,
} from "./preguntas.js";

const mimeTipos = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);
function responderJson(respuesta, estado, contenido) {
  const cuerpo = JSON.stringify(contenido);
  respuesta.writeHead(estado, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(cuerpo),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  respuesta.end(cuerpo);
}

function responderError(respuesta, estado, mensaje) {
  responderJson(respuesta, estado, { error: mensaje });
}

async function leerJson(peticion) {
  let cuerpo = "";
  for await (const parte of peticion) {
    cuerpo += parte;
    if (Buffer.byteLength(cuerpo) > 1024 * 1024) {
      throw Object.assign(new Error("La solicitud supera el tamaño permitido."), {
        estado: 413,
      });
    }
  }
  try {
    return JSON.parse(cuerpo || "{}");
  } catch {
    throw Object.assign(new Error("El cuerpo de la solicitud no es JSON válido."), {
      estado: 400,
    });
  }
}

function resolverSeleccion(url) {
  const asignatura = url.searchParams.get("asignatura") ?? "";
  const temasParametro = url.searchParams.get("temas");
  const temas =
    temasParametro === "todos"
      ? "todos"
      : temasParametro
        ? [...new Set(temasParametro.split(",").map(Number))]
        : [];
  const tema = Number(url.searchParams.get("tema") ?? (temas === "todos" ? 0 : temas[0]));
  const apartado = Number(url.searchParams.get("apartado") ?? 0);
  if (
    temas !== "todos" &&
    ((!temas.length && (!Number.isSafeInteger(tema) || tema < 1)) ||
      temas.some((numero) => !Number.isSafeInteger(numero) || numero < 1))
  )
    throw Object.assign(new Error("Selecciona uno o varios temas válidos."), { estado: 400 });
  if (!Number.isSafeInteger(apartado) || apartado < 0)
    throw Object.assign(new Error("Selecciona un apartado válido."), { estado: 400 });
  return { asignatura, tema, temas: temas.length ? temas : [tema], apartado };
}

async function ejecutarGeneracion(identificador, solicitud, material) {
  log("generacion", "iniciando", { identificador, solicitud: utilInspect(solicitud, { depth: 3 }), material: utilInspect(material, { depth: 3 }) });
  const controlador = obtenerControladorTarea(identificador);
  let banco = null;
  try {
    const seleccionBanco = {
      ...solicitud,
      tema: material.tema,
      temas: material.temas,
    };
    banco = await leerBancoPreguntas(seleccionBanco);
    let preguntasAnteriores = banco?.preguntas ?? [];
    const bloques = dividirDocumentos(material.documentos);
    if (!bloques.length) throw new Error("No se pudieron dividir los apuntes en bloques.");
    const ejemplosPorBloque = bloques.map((bloque) => ({
      bloque,
      ejemplos: [...new Map((bloque.ejemplos ?? []).map((ejemplo) => [
        ejemplo.id,
        ejemplo,
      ])).values()],
    }));
    const ejemplos = [...new Map(
      ejemplosPorBloque.flatMap(({ ejemplos: lista }) =>
        lista.map((ejemplo) => [ejemplo.id, ejemplo]),
      ),
    ).values()];
    const idsCubiertos = new Set(
      preguntasAnteriores.map((pregunta) => pregunta.ejemploId).filter(Boolean),
    );
    const pendientesIniciales = ejemplos.filter(
      (ejemplo) => !idsCubiertos.has(ejemplo.id),
    );
    const totalObjetivo = solicitud.cantidad;

    const subsecciones = bloques.map((bloque, indice) => {
      const ejemplosBloque = [...new Map((bloque.ejemplos ?? []).map((ej) => [ej.id, ej])).values()];
      const nombreSub = bloque.apartadoNombre || bloque.titulo || bloque.nombre || `Apartado ${bloque.apartado || indice + 1}`;
      const cubiertos = ejemplosBloque.filter((ej) => idsCubiertos.has(ej.id)).length;
      return {
        id: `sub-${bloque.tema ?? 0}-${bloque.apartado ?? 0}-${indice}`,
        tema: bloque.tema ?? 0,
        apartado: bloque.apartado ?? 0,
        nombre: nombreSub,
        totalEjemplos: ejemplosBloque.length,
        ejemplosCubiertos: cubiertos,
        generadas: 0,
        estado: cubiertos === ejemplosBloque.length && ejemplosBloque.length > 0 ? "completado" : "pendiente",
      };
    });

    actualizarTarea(identificador, {
      fase: "generando",
      mensaje: ejemplos.length
        ? `Se han detectado ${ejemplos.length} ejemplos para transformar`
        : "Apuntes leídos; empieza la IA local",
      detalle: `${material.archivos.length} archivos y ${bloques.length} bloques. Se verificará una pregunta vinculada por cada ejemplo detectado; las preguntas anteriores se conservan.`,
      total: totalObjetivo,
      subsecciones,
    });

    let nuevasGuardadas = 0;
    let repetidas = 0;
    let intentos = 0;

    async function solicitarPreguntas(bloque, cantidad, ejemplosObjetivo = []) {
      intentos += 1;
      const subActual = subsecciones.find(
        (s) => s.tema === (bloque.tema ?? 0) && s.apartado === (bloque.apartado ?? 0) && s.nombre === (bloque.apartadoNombre || bloque.titulo || bloque.nombre),
      ) || subsecciones.find((s) => s.tema === (bloque.tema ?? 0) && s.apartado === (bloque.apartado ?? 0)) || subsecciones[0];

      if (subActual && subActual.estado !== "completado") {
        subActual.estado = "en_progreso";
      }

      actualizarTarea(identificador, {
        fase: "generando",
        mensaje: ejemplosObjetivo.length
          ? `Transformando ${ejemplosObjetivo.length} ejemplo(s) en ${subActual?.nombre || bloque.nombre}`
          : `Generando preguntas de ${subActual?.nombre || bloque.nombre}`,
        detalle: ejemplosObjetivo.length
          ? `Intento ${intentos}: se comprobará que la IA devuelva cada ID solicitado.`
          : `Preguntas nuevas guardadas: ${nuevasGuardadas}/${totalObjetivo}.`,
        subsecciones,
      });
      const prompt = crearPromptPreguntas({
        asignatura: solicitud.asignatura,
        alcance: material.alcance,
        bloque,
        cantidad,
        modoExamen: solicitud.modoExamen,
        contextoExamen: solicitud.contextoExamen,
        tipoPreguntas: solicitud.tipoPreguntas,
        desglose: solicitud.desglose,
        buscarInternet: solicitud.buscarInternet,
        instruccionesAdicionales: solicitud.instrucciones,
        preguntasExistentes: preguntasAnteriores,
        temaDocumento: bloque.tema,
        apartadoDocumento: bloque.apartado,
        nombreApartado: bloque.apartadoNombre || bloque.titulo,
        ejemplosObjetivo,
      });
      const inicio = Date.now();
      const resultadoIA = await generarConIA({
        prompt,
        controlador,
        instruccionesSistema: INSTRUCCIONES_SISTEMA,
        progreso: (mensaje) =>
          actualizarTarea(identificador, { detalle: mensaje }),
      });
      registrarLlamadaIA(identificador, Date.now() - inicio);
      if (controlador.signal.aborted) return [];

      let generadas = analizarRespuestaIA(resultadoIA.contenido);
      if (ejemplosObjetivo.length) {
        generadas = filtrarPreguntasPorEjemplos(generadas, ejemplosObjetivo);
      } else {
        generadas = generadas.map(({ ejemploId: _ejemploId, ...pregunta }) => pregunta);
        generadas.length = Math.min(generadas.length, cantidad);
      }
      generadas = generadas.map((pregunta) => ({
        ...pregunta,
        tema: bloque.tema ?? pregunta.tema,
        apartado: bloque.apartado || pregunta.apartado,
        apartadoNombre:
          bloque.apartadoNombre || pregunta.apartadoNombre || bloque.titulo,
      }));
      if (!generadas.length) return [];

      actualizarTarea(identificador, {
        fase: "guardando",
        mensaje: "Comprobando y guardando preguntas",
        detalle: `La IA propuso ${generadas.length} preguntas verificables.`,
      });
      if (!material.fromContext) {
        const revisionActual = await obtenerMaterialSeleccionado(solicitud);
        if (revisionActual.revision !== material.revision) {
          throw new Error(
            "Los apuntes cambiaron durante la generación. No se guardará esta tanda; vuelve a actualizar y generar.",
          );
        }
      }

      const guardado = await anadirPreguntasAlBanco({
        asignatura: solicitud.asignatura,
        tema: material.tema,
        temas: material.temas,
        apartado: solicitud.apartado,
        titulo: material.titulo,
        revision: material.revision,
        revisionesPorTema: material.revisionesPorTema,
        archivosOrigen: material.archivos,
        archivosOrigenPorTema: material.archivosOrigenPorTema,
        preguntasNuevas: generadas,
      });
      preguntasAnteriores = guardado.preguntas;
      nuevasGuardadas += guardado.anadidas;
      repetidas += guardado.repetidas;
      banco = guardado;

      if (subActual) {
        subActual.generadas = (subActual.generadas || 0) + guardado.anadidas;
        const ejemplosDelBloque = bloque.ejemplos || [];
        subActual.ejemplosCubiertos = ejemplosDelBloque.filter((ej) => idsCubiertos.has(ej.id)).length;
        if (subActual.totalEjemplos > 0 && subActual.ejemplosCubiertos >= subActual.totalEjemplos) {
          subActual.estado = "completado";
        }
      }

      actualizarTarea(identificador, {
        fase: "generando",
        mensaje: `Guardadas ${nuevasGuardadas} preguntas nuevas`,
        detalle: `${guardado.total} preguntas acumuladas; ${repetidas} duplicadas descartadas.`,
        generadas: nuevasGuardadas,
        guardadas: guardado.total,
        repetidas,
        subsecciones,
      });
      return generadas;
    }

    let ejemplosSinCubrir = [];
    // Distribución equitativa (round-robin) para que todos los apartados reciban preguntas hasta alcanzar el total deseado
    const colasPorBloque = ejemplosPorBloque.map(({ bloque, ejemplos: ejemplosBloque }) => ({
      bloque,
      pendientes: ejemplosBloque.filter((ejemplo) => !idsCubiertos.has(ejemplo.id)),
    }));

    let algunPendiente = true;
    while (nuevasGuardadas < totalObjetivo && algunPendiente && !controlador.signal.aborted) {
      algunPendiente = false;
      for (const item of colasPorBloque) {
        if (nuevasGuardadas >= totalObjetivo || controlador.signal.aborted) break;
        if (!item.pendientes.length) continue;
        algunPendiente = true;
        const restantes = totalObjetivo - nuevasGuardadas;
        const tamLote = Math.min(configuracion.preguntasPorBloqueIA, item.pendientes.length, restantes);
        let lotePendiente = item.pendientes.splice(0, tamLote);
        for (let intento = 0; intento < 3 && lotePendiente.length; intento += 1) {
          const generadas = await solicitarPreguntas(
            item.bloque,
            lotePendiente.length,
            lotePendiente,
          );
          if (controlador.signal.aborted) break;
          for (const pregunta of generadas) {
            if (
              preguntasAnteriores.some(
                (anterior) => anterior.ejemploId === pregunta.ejemploId,
              )
            ) {
              idsCubiertos.add(pregunta.ejemploId);
            }
          }
          lotePendiente = lotePendiente.filter(
            (ejemplo) => !idsCubiertos.has(ejemplo.id),
          );
        }
        if (lotePendiente.length) {
          ejemplosSinCubrir.push(...lotePendiente);
        }
      }
    }

    let bloqueIndice = 0;
    let intentosGenerales = 0;
    const maxIntentosGenerales =
      Math.ceil(
        solicitud.cantidad / configuracion.preguntasPorBloqueIA,
      ) * 3;
    while (
      nuevasGuardadas < solicitud.cantidad &&
      intentosGenerales < maxIntentosGenerales &&
      !controlador.signal.aborted
    ) {
      const bloque = bloques[bloqueIndice % bloques.length];
      const cantidadTanda = Math.min(
        configuracion.preguntasPorBloqueIA,
        solicitud.cantidad - nuevasGuardadas,
      );
      bloqueIndice += 1;
      intentosGenerales += 1;
      await solicitarPreguntas(bloque, cantidadTanda);
    }

    if (controlador.signal.aborted) {
      actualizarTarea(identificador, {
        fase: "cancelado",
        mensaje: "Generación detenida",
        detalle: `${nuevasGuardadas} preguntas nuevas quedaron guardadas. Se conservó el banco anterior.`,
        generadas: nuevasGuardadas,
        guardadas: banco?.total ?? banco?.preguntas.length ?? 0,
        repetidas,
        terminado: true,
        cancelado: true,
      });
      return;
    }

    for (const sub of subsecciones) {
      if (sub.generadas > 0 || (sub.totalEjemplos > 0 && sub.ejemplosCubiertos >= sub.totalEjemplos)) {
        sub.estado = "completado";
      } else if (sub.estado === "en_progreso") {
        sub.estado = "completado";
      }
    }

    const generacionParcial =
      nuevasGuardadas < solicitud.cantidad || ejemplosSinCubrir.length > 0;
    const resumenCobertura = ejemplos.length
      ? `${ejemplos.filter((ejemplo) => idsCubiertos.has(ejemplo.id)).length} de ${ejemplos.length} ejemplos detectados tienen una pregunta vinculada.`
      : "No se detectaron ejemplos explícitos; se generaron preguntas sobre los conceptos del material.";
    actualizarTarea(identificador, {
      fase: "completado",
      mensaje: ejemplosSinCubrir.length
        ? `Cobertura incompleta: faltan ${ejemplosSinCubrir.length} ejemplo(s)`
        : generacionParcial
        ? `Generación parcial: ${nuevasGuardadas} de ${solicitud.cantidad} preguntas nuevas`
        : nuevasGuardadas
        ? `Generación terminada: ${nuevasGuardadas} preguntas nuevas`
        : "No se encontraron preguntas nuevas",
      detalle: `Banco completo: ${banco?.total ?? banco?.preguntas.length ?? 0} preguntas. ${resumenCobertura} ${ejemplosSinCubrir.length ? `Ejemplos pendientes: ${ejemplosSinCubrir.map((ejemplo) => ejemplo.id).join(", ")}.` : ""} ${nuevasGuardadas < solicitud.cantidad ? "No se encontraron más preguntas distintas que pudieran justificarse con el material seleccionado." : ""} ${repetidas ? `${repetidas} duplicadas se descartaron.` : ""}`,
      generadas: nuevasGuardadas,
      guardadas: banco?.total ?? banco?.preguntas.length ?? 0,
      repetidas,
      subsecciones,
      terminado: true,
    });
  } catch (error) {
    if (controlador.signal.aborted) {
      actualizarTarea(identificador, {
        fase: "cancelado",
        mensaje: "Generación detenida",
        detalle: "Las tandas que ya se guardaron siguen disponibles para practicar.",
        terminado: true,
        cancelado: true,
      });
      return;
    }
    console.error(`[generar:${identificador}] ${error.stack || error.message}`);
    actualizarTarea(identificador, {
      fase: "error",
      mensaje: "No se pudo completar la generación",
      detalle: error.message,
      error: error.message,
      terminado: true,
    });
  }
}

async function materialDesdeContexto(solicitud, contexto) {
  const tema = solicitud.tema > 0 ? solicitud.tema : 1;
  const temas =
    Array.isArray(solicitud.temas) && solicitud.temas.length
      ? solicitud.temas
      : [tema];
  return {
    asignatura: solicitud.asignatura,
    tema,
    temas,
    apartado: solicitud.apartado,
    titulo: `Contexto · ${solicitud.asignatura}`,
    alcance: `Contexto proporcionado · ${solicitud.asignatura}${
      temas.length === 1 ? ` · Tema ${tema}` : ` · Temas ${temas.join(", ")}`
    }`,
    archivos: [],
    archivosOrigenPorTema: {},
    revisionesPorTema: {},
    revision: `contexto-${createHash("sha256")
      .update(contexto)
      .digest("hex")
      .slice(0, 32)}`,
    fromContext: true,
    documentos: [
      {
        nombre: "Contexto proporcionado",
        titulo: "Contexto proporcionado",
        tema,
        apartado: 0,
        apartadoNombre: "",
        texto: contexto,
      },
    ],
  };
}

async function procesarApi(peticion, respuesta, url) {
  // Manejo especial para archivos JavaScript: asegurar content-type text/javascript
  if (peticion.method === "GET" && url.pathname.endsWith(".js")) {
    let filePath = `.${url.pathname}`;
    try {
      const contenido = await readFile(filePath);
      respuesta.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      respuesta.end(contenido);
      return;
    } catch (error) {
      // Si falla, continuar con el manejo normal (puede que la ruta sea diferente)
      log("archivo", "No se pudo servir " + url.pathname + " desde ruta directa,continuando con rutas API");
    }
  }

  log("api", `${peticion.method} ${url.pathname}`, "query:", utilInspect(url.searchParams, { depth: 2 }));

  if (url.pathname === "/favicon.ico") {
    respuesta.writeHead(204, { "content-type": "image/x-icon", "cache-control": "public, max-age=86400" });
    respuesta.end();
    return;
  }

  if (peticion.method === "GET" && url.pathname === "/api/configuracion") {
    responderJson(respuesta, 200, {
      supabaseUrl: process.env.SUPABASE_URL || "https://lztatgnlplpduiatmlrv.supabase.co",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "sb_publishable_z_T7Y3yKqPdXLnvL3ltnQA_ZAPrXImZ",
      githubRepo: process.env.GITHUB_REPOSITORY || "nataliagamezbarea/GRADOS_INFORMATICOS",
      githubBranch: process.env.GITHUB_BRANCH || "Segundo_grado_superior",
      githubFolder: process.env.GITHUB_FOLDER || "datos/bancos/WEC",
      proveedorIA: configuracion.proveedorIA,
      nvidiaModelo: configuracion.nvidiaModelo,
      hasNvidiaKey: Boolean(configuracion.nvidiaApiKey),
      hasGithubToken: Boolean(process.env.GH_TOKEN),
      githubToken: process.env.GH_TOKEN || ""
    });
    return;
  }

  if (peticion.method === "GET" && url.pathname === "/api/asignaturas") {
    try {
      const candidatas = [
        path.join(configuracion.raizProyecto, "data", "asignaturas.json"),
        path.join(configuracion.raizPublica, "data", "asignaturas.json")
      ];
      for (const c of candidatas) {
        try {
          const contenido = await readFile(c, "utf8");
          return responderJson(respuesta, 200, JSON.parse(contenido));
        } catch (_) {}
      }
      return responderJson(respuesta, 200, { asignaturas: [] });
    } catch (err) {
      return responderError(respuesta, 500, "No se pudo leer el catálogo de asignaturas: " + err.message);
    }
  }

  if (peticion.method === "POST" && url.pathname === "/api/asignaturas") {
    try {
      const datos = await leerJson(peticion);
      const idRaw = String(datos.id || datos.nombre || "").trim().toLowerCase();
      const id = idRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!id || id.length < 2) return responderError(respuesta, 400, "El identificador o nombre de la asignatura no es válido.");

      const nombre = String(datos.nombre || id.toUpperCase()).trim();
      const grado = String(datos.grado || "Segundo_grado_medio").trim();
      const descripcion = String(datos.descripcion || `${nombre} · Banco de preguntas`).trim();
      const temas = Array.isArray(datos.temas) && datos.temas.length > 0 ? datos.temas : [
        { numero: 1, nombre: "Tema 1 · Fundamentos y conceptos generales", apartados: [{ numero: 1, nombre: "1.1 Introducción" }] }
      ];

      // Carpetas seguras del servidor (el usuario no puede cambiarlas arbitrariamente)
      const dirPublic = path.join(configuracion.raizPublica, "data", "asignaturas", id);
      const dirBancos = path.join(configuracion.raizBancos, id.toUpperCase());
      await mkdir(dirPublic, { recursive: true });
      await mkdir(dirBancos, { recursive: true });

      const dirData = path.join(configuracion.raizProyecto, "data", "asignaturas", id);
      try { await mkdir(dirData, { recursive: true }); } catch (_) {}

      const rutaPreguntasData = path.join(dirData, "preguntas.json");
      const rutaPreguntasPub = path.join(dirPublic, "preguntas.json");
      let preguntas = [];
      if (Array.isArray(datos.preguntas) && datos.preguntas.length > 0) {
        preguntas = datos.preguntas;
      } else {
        try {
          const prev = JSON.parse(await readFile(rutaPreguntasPub, "utf8"));
          if (Array.isArray(prev.preguntas)) preguntas = prev.preguntas;
        } catch (_) {}
      }

      const bancoObj = {
        formato: "preparar-tests-banco-preguntas",
        version: 1,
        clave: `${id.toUpperCase()}-banco-oficial`,
        meta: {
          asignatura: id.toUpperCase(),
          titulo: `${nombre} · Banco de Preguntas`,
          tema: 0,
          temas: temas.map(t => Number(t.numero) || 1),
          apartado: 0,
          total: preguntas.length,
          version: "1.0",
          grado
        },
        preguntas
      };

      const jsonBanco = JSON.stringify(bancoObj, null, 2);
      await writeFile(rutaPreguntasPub, jsonBanco, "utf8");
      try { await writeFile(rutaPreguntasData, jsonBanco, "utf8"); } catch (_) {}
      await writeFile(path.join(dirBancos, `${id.toUpperCase()}-temas-todos-apartado-0.json`), jsonBanco, "utf8");

      // Actualizar catálogo general
      const rutaCatalogoPub = path.join(configuracion.raizPublica, "data", "asignaturas.json");
      const rutaCatalogo = path.join(configuracion.raizProyecto, "data", "asignaturas.json");
      let catalogo = { asignaturas: [] };
      try {
        catalogo = JSON.parse(await readFile(rutaCatalogoPub, "utf8"));
      } catch (_) {
        try { catalogo = JSON.parse(await readFile(rutaCatalogo, "utf8")); } catch (_) {}
      }
      if (!Array.isArray(catalogo.asignaturas)) catalogo.asignaturas = [];

      const nuevaEntrada = {
        id,
        nombre,
        grado,
        archivo: `./data/asignaturas/${id}/preguntas.json`,
        descripcion,
        temas,
        totalPreguntas: preguntas.length
      };

      const idxExistente = catalogo.asignaturas.findIndex(a => a.id === id);
      if (idxExistente >= 0) {
        catalogo.asignaturas[idxExistente] = { ...catalogo.asignaturas[idxExistente], ...nuevaEntrada };
      } else {
        catalogo.asignaturas.push(nuevaEntrada);
      }

      const catalogoStr = JSON.stringify(catalogo, null, 2);
      await writeFile(rutaCatalogoPub, catalogoStr, "utf8");
      try { await writeFile(rutaCatalogo, catalogoStr, "utf8"); } catch (_) {}

      return responderJson(respuesta, 201, { ok: true, asignatura: nuevaEntrada });
    } catch (err) {
      return responderError(respuesta, 500, "Error creando asignatura: " + err.message);
    }
  }

  if (peticion.method === "POST" && url.pathname === "/api/tests/subir") {
    try {
      const datos = await leerJson(peticion);
      const idRaw = String(datos.idAsignatura || datos.asignatura || datos.id || "").trim().toLowerCase();
      const id = idRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!id) return responderError(respuesta, 400, "Falta el ID o nombre de la asignatura de destino.");

      let listaPreguntas = [];
      if (Array.isArray(datos.preguntas)) {
        listaPreguntas = datos.preguntas;
      } else if (datos.preguntas && typeof datos.preguntas === "object") {
        listaPreguntas = Object.values(datos.preguntas);
      } else if (Array.isArray(datos)) {
        listaPreguntas = datos;
      }

      if (!listaPreguntas.length) {
        return responderError(respuesta, 400, "El archivo o payload no contiene un array de preguntas.");
      }

      // Normalizar preguntas
      const normalizadas = listaPreguntas.map((p, idx) => {
        const idPregunta = p.id || `${id}_q_${idx + 1}`;
        const tema = Number(p.tema) || 1;
        const apartado = Number(p.apartado) || 1;
        let opciones = { A: "", B: "", C: "", D: "" };
        if (p.opciones && typeof p.opciones === "object" && !Array.isArray(p.opciones)) {
          opciones = {
            A: String(p.opciones.A || p.opciones.a || ""),
            B: String(p.opciones.B || p.opciones.b || ""),
            C: String(p.opciones.C || p.opciones.c || ""),
            D: String(p.opciones.D || p.opciones.d || "")
          };
        } else if (Array.isArray(p.opciones || p.op)) {
          const arr = p.opciones || p.op;
          ["A", "B", "C", "D"].forEach((letra, i) => {
            if (arr[i] != null) {
              opciones[letra] = typeof arr[i] === "object" && arr[i].texto ? String(arr[i].texto) : String(arr[i]);
            }
          });
        }
        let correcta = "A";
        if (typeof p.correcta === "string" && p.correcta.trim()) {
          correcta = p.correcta.trim().toUpperCase().charAt(0);
        } else if (typeof p.respuesta_correcta === "string") {
          correcta = p.respuesta_correcta.trim().toUpperCase().charAt(0);
        } else if (typeof p.ok === "number" && p.ok >= 0 && p.ok < 4) {
          correcta = ["A", "B", "C", "D"][p.ok];
        }

        return {
          id: idPregunta,
          tema,
          apartado,
          apartadoNombre: p.apartadoNombre || p.subtema || `Apartado ${apartado}`,
          tipo: p.tipo || "teoria",
          enunciado: String(p.enunciado || p.q || p.pregunta || "").trim(),
          codigo: String(p.codigo || p.codi || "").trim(),
          opciones,
          correcta,
          explicacion: String(p.explicacion || p.exp || p.solucion || "Sin explicación.").trim()
        };
      }).filter(p => p.enunciado.length > 0);

      if (!normalizadas.length) {
        return responderError(respuesta, 400, "Ninguna pregunta tiene un enunciado válido.");
      }

      // Carpetas seguras del servidor (no se pide ruta arbitraria al usuario)
      const dirPublic = path.join(configuracion.raizPublica, "data", "asignaturas", id);
      const dirBancos = path.join(configuracion.raizBancos, id.toUpperCase());
      await mkdir(dirPublic, { recursive: true });
      await mkdir(dirBancos, { recursive: true });

      const dirData = path.join(configuracion.raizProyecto, "data", "asignaturas", id);
      try { await mkdir(dirData, { recursive: true }); } catch (_) {}

      // Detectar temas únicos
      const temasSet = new Set(normalizadas.map(p => p.tema));
      const temasNumeros = [...temasSet].sort((a, b) => a - b);

      const bancoObj = {
        formato: "preparar-tests-banco-preguntas",
        version: 1,
        clave: `${id.toUpperCase()}-banco-oficial`,
        meta: {
          asignatura: id.toUpperCase(),
          titulo: `${datos.nombre || id.toUpperCase()} · Banco de Preguntas`,
          tema: 0,
          temas: temasNumeros,
          apartado: 0,
          total: normalizadas.length,
          version: "1.0",
          grado: datos.grado || "Segundo_grado_medio"
        },
        preguntas: normalizadas
      };

      const jsonBanco = JSON.stringify(bancoObj, null, 2);
      await writeFile(path.join(dirPublic, "preguntas.json"), jsonBanco, "utf8");
      try { await writeFile(path.join(dirData, "preguntas.json"), jsonBanco, "utf8"); } catch (_) {}
      await writeFile(path.join(dirBancos, `${id.toUpperCase()}-temas-todos-apartado-0.json`), jsonBanco, "utf8");

      // Actualizar total en catalogo si ya existe la asignatura
      const rutaCatalogoPub = path.join(configuracion.raizPublica, "data", "asignaturas.json");
      const rutaCatalogo = path.join(configuracion.raizProyecto, "data", "asignaturas.json");
      try {
        const cat = JSON.parse(await readFile(rutaCatalogoPub, "utf8"));
        const itemCat = (cat.asignaturas || []).find(a => a.id === id);
        if (itemCat) {
          itemCat.totalPreguntas = normalizadas.length;
          await writeFile(rutaCatalogoPub, JSON.stringify(cat, null, 2), "utf8");
          try { await writeFile(rutaCatalogo, JSON.stringify(cat, null, 2), "utf8"); } catch (_) {}
        }
      } catch (_) {}

      return responderJson(respuesta, 200, {
        ok: true,
        id,
        totalPreguntas: normalizadas.length,
        temas: temasNumeros
      });
    } catch (err) {
      return responderError(respuesta, 500, "Error subiendo test: " + err.message);
    }
  }

  if (peticion.method === "GET" && url.pathname === "/api/salud") {
    log("api", "ruta /api/salud");
    const modelo = await comprobarModelo();
    return responderJson(respuesta, modelo.conectado ? 200 : 503, {
      servicio: "Preparar tests",
      ...modelo,
      puerto: configuracion.puerto,
    });
  }
  if (peticion.method === "GET" && url.pathname === "/api/apuntes") {
    log("api", "ruta /api/apuntes");
    try {
      return responderJson(respuesta, 200, await leerCatalogoApuntes());
    } catch (err) {
      debugError("api", err, { ruta: "/api/apuntes" });
      return responderError(respuesta, 503, err.message);
    }
  }
  if (peticion.method === "GET" && url.pathname === "/api/bancos") {
    log("api", "ruta /api/bancos");
    try {
      const bancos = await listarBancosPreguntas();
      const apuntes = await leerCatalogoApuntes();
      for (const banco of bancos) {
        if (banco.temas?.length > 1 || banco.tema === 0) {
          try {
            const material = await obtenerMaterialSeleccionado({
              asignatura: banco.asignatura,
              temas: banco.temas.length ? banco.temas : "todos",
              apartado: banco.apartado,
            });
            banco.apuntesActualizados = material.revision !== banco.revision;
          } catch {
            banco.apuntesActualizados = true;
          }
          continue;
        }
        const asignatura = apuntes.asignaturas.find(
          (elemento) => elemento.nombre === banco.asignatura,
        );
        const tema = asignatura?.temas.find(
          (elemento) => elemento.numero === banco.tema,
        );
        const apartado = banco.apartado
          ? tema?.apartados.find(
              (elemento) => elemento.numero === banco.apartado,
            )
          : null;
        const revisionActual = banco.apartado
          ? apartado?.revision
          : tema?.revision;
        banco.apuntesActualizados =
          !revisionActual || revisionActual !== banco.revision;
      }
      return responderJson(respuesta, 200, { bancos });
    } catch (error) {
      return responderError(respuesta, 500, error.message);
    }
  }
  if (peticion.method === "GET" && url.pathname === "/api/banco") {
    try {
      const seleccion = resolverSeleccion(url);
      if (seleccion.temas === "todos") {
        const catalogo = await leerCatalogoApuntes();
        const asignatura = catalogo.asignaturas.find(
          (elemento) => elemento.nombre === seleccion.asignatura,
        );
        seleccion.temas = asignatura?.temas.map((elemento) => elemento.numero) ?? [];
        if (!seleccion.temas.length)
          return responderError(respuesta, 404, "No se encontraron temas para esta asignatura.");
      }
      const banco = await leerBancoPreguntas(seleccion);
      if (!banco)
        return responderError(
          respuesta,
          404,
          "Todavía no hay preguntas para esta selección. Genera el primer test.",
        );
      let revisionActual;
      let revisionesActuales;
      try {
        const materialActual = await obtenerMaterialSeleccionado({
          asignatura: banco.meta.asignatura,
          temas: banco.meta.temas?.length
            ? banco.meta.temas
            : [banco.meta.tema],
          apartado: banco.meta.apartado,
        });
        revisionActual = materialActual.revision;
        revisionesActuales = materialActual.revisionesPorTema;
      } catch {
        revisionActual = "";
      }
      const revisionesGuardadas = banco.meta.revisionesPorTema;
      const temasBanco = banco.meta.temas ?? [];
      const temasConRevision = Object.keys(revisionesGuardadas ?? {})
        .map(Number)
        .filter((tema) => temasBanco.includes(tema));
      const apuntesActualizados =
        temasBanco.length > 1 &&
        revisionesActuales &&
        revisionesGuardadas &&
        temasConRevision.length
          ? temasConRevision.some(
              (tema) => revisionesActuales[tema] !== revisionesGuardadas[tema],
            )
          : !revisionActual || revisionActual !== banco.revision;
      return responderJson(respuesta, 200, {
        ...banco,
        apuntesActualizados,
      });
    } catch (error) {
      return responderError(respuesta, 400, error.message);
    }
  }
  if (peticion.method === "POST" && url.pathname === "/api/explain") {
    try {
      const datos = await leerJson(peticion);
      const preguntaRecibida = datos.pregunta ?? datos.question;
      if (!preguntaRecibida || typeof preguntaRecibida !== "object")
        return responderError(respuesta, 422, "Falta la pregunta que quieres aclarar.");
      const pregunta = {
        enunciado: String(preguntaRecibida.enunciado ?? "").slice(0, 3000),
        codigo: String(preguntaRecibida.codigo ?? "").slice(0, 5000),
        opciones: preguntaRecibida.opciones ?? {},
        correcta: String(preguntaRecibida.correcta ?? ""),
        explicacion: String(preguntaRecibida.explicacion ?? "").slice(0, 2000),
        tipo: String(preguntaRecibida.tipo ?? "teoria"),
      };
      if (!pregunta.enunciado)
        return responderError(respuesta, 422, "La pregunta no tiene enunciado.");
      const seguimiento = String(datos.followUp ?? "").trim();
      if (seguimiento.length > 1000)
        return responderError(
          respuesta,
          422,
          "La pregunta de seguimiento supera los 1000 caracteres.",
        );
      if (datos.followUp !== undefined && !seguimiento)
        return responderError(
          respuesta,
          422,
          "Escribe una duda antes de enviarla.",
        );
      let conversacion = [];
      if (seguimiento) {
        if (!Array.isArray(datos.conversation) || datos.conversation.length > 10)
          return responderError(
            respuesta,
            422,
            "El historial del chat no es válido.",
          );
        if (
          datos.conversation.some(
            (mensaje) =>
              !mensaje ||
              !["user", "assistant"].includes(mensaje.role) ||
              typeof mensaje.content !== "string" ||
              mensaje.content.length > 1500,
          )
        )
          return responderError(
            respuesta,
            422,
            "Un mensaje del chat no es válido.",
          );
        conversacion = datos.conversation.map(({ role, content }) => ({
          role,
          content,
        }));
      }
      const esSeguimiento = Boolean(seguimiento);
      const esCorreccionDesarrollo =
        Boolean(datos.esDesarrollo) ||
        ["escribir_codigo", "traza_linea", "desarrollo"].includes(pregunta.tipo);

      // Si el alumno deja en blanco o indica expresamente que no sabe resolverlo:
      if (esCorreccionDesarrollo && !esSeguimiento) {
        const respuestaAl = String(datos.selected ?? "").trim();
        const solucionRef = pregunta.solucion || pregunta.solucio || pregunta.explicacion || "";
        if (esRespuestaVaciaODesconocida(respuestaAl)) {
          return responderJson(respuesta, 200, {
            explanation: `**Nota: 0/10**\n\nHas indicado que no sabes resolver el ejercicio o no has aportado una respuesta válida.\n\n**Solución correcta:**\n${solucionRef}`,
            model: "evaluacion-directa",
          });
        }
      }

      let instruccionesSistema;
      if (esSeguimiento) {
        instruccionesSistema =
          "Eres una profesora experta de programación web y JavaScript. El alumno tiene una duda técnica concreta y te la formula en [PREGUNTA / DUDA DEL ALUMNO A RESPONDER AHORA].\n" +
          "1. TU OBJETIVO PRINCIPAL Y OBLIGATORIO es responder directamente a la duda del alumno de forma clara, didáctica y al grano (máximo 90 palabras).\n" +
          "2. Si pregunta qué hace un método o propiedad (por ejemplo setItem, cookies, etc.), explícale exactamente qué hace técnicamente con sencillez.\n" +
          "3. PROHIBIDO repetir la corrección anterior, prohibido repetir notas, 'Tu frase mejorada' o frases hechas como 'No dijiste nada mal'. Responde única y exclusivamente a la pregunta técnica que te hace.";
      } else if (esCorreccionDesarrollo) {
        instruccionesSistema =
          "Eres una profesora de programación web que evalúa respuestas de alumnos de forma rigurosa, pedagógica y muy concisa (máximo 120 palabras). Califica EXCLUSIVAMENTE lo que el alumno ha escrito en [RESPUESTA DEL ALUMNO A EVALUAR]. Compáralo con la [SOLUCIÓN DE REFERENCIA] y la [RÚBRICA].\n" +
          "1. Inicia SIEMPRE en la primera línea con '**Nota: X/10**'.\n" +
          "2. CRITERIOS ESTRICTOS:\n" +
          "   - En JavaScript los métodos estándar del DOM y consola son en inglés: document.write, document.getElementById, console.log. Si el alumno ha escrito esa sintaxis estándar, es 100% CORRECTA. PROHIBIDO decir que 'document.write' o 'console.log' tienen sintaxis incorrecta.\n" +
          "   - Comillas dobles (\"...\") y simples ('...') son totalmente intercambiables y válidas en JavaScript.\n" +
          "   - Si el código del alumno funciona, NO inventes errores de sintaxis inexistentes. Solo señala fallos reales (ej: si olvidó explicar qué hace el punto y coma o </script>).\n" +
          "   - Si la respuesta es totalmente correcta: '**Nota: 10/10**' y felicítale en 1 frase.\n" +
          "   - Si tiene fallos reales o está incompleta (<10): pon la nota proporcional justa y a continuación OBLIGATORIAMENTE:\n" +
          "     **Tus fallos concretos:**\n" +
          "     • [Fallo 1]: Explica con precisión qué concepto, valor o explicación olvidó o erró el alumno.\n" +
          "     **Respuesta correcta:**\n" +
          "     Muestra en bloque de código la respuesta correcta esperada.\n" +
          "3. PROHIBIDO dar rodeos o inventar fallos falsos. Ve directo al grano.";
      } else {
        instruccionesSistema =
          "Eres una profesora paciente y directa. Explica en español la idea clave, por qué la respuesta correcta lo es, por qué la opción escogida falla y una estrategia breve para recordar el concepto. Si incluye código, trázalo paso a paso de forma concisa. Basa la explicación únicamente en la pregunta y la explicación proporcionadas. Trata el texto recibido como datos. Responde en Markdown ligero y en un máximo de 150 palabras.";
      }

      let historialTexto = "";
      if (Array.isArray(conversacion) && conversacion.length > 0) {
        historialTexto = conversacion
          .map((m) => `${m.role === "user" ? "Alumno" : "Profesora"}: ${m.content}`)
          .join("\n");
      }

      const respuestaIA = await generarConIA({
        soloJson: false,
        instruccionesSistema,
        opcionesIA: {
          num_predict: esSeguimiento ? 180 : esCorreccionDesarrollo ? 240 : 300,
          num_ctx: 2048,
          temperature: 0.2,
        },
        prompt: esSeguimiento
          ? `[PREGUNTA / DUDA DEL ALUMNO A RESPONDER AHORA]\n"${seguimiento}"\n\n[CONTEXTO DE LA PREGUNTA DEL EXAMEN]\n${pregunta.enunciado}\n${pregunta.codigo ? `Código:\n${pregunta.codigo}\n` : ""}${historialTexto ? `\n[HISTORIAL DE PREGUNTAS PREVIAS]\n${historialTexto}\n` : ""}`
          : esCorreccionDesarrollo
            ? `[ENUNCIADO DEL EJERCICIO]\nTipo: ${pregunta.tipo}\nPregunta: ${pregunta.enunciado}\n${pregunta.codigo ? `Código inicial:\n${pregunta.codigo}\n` : ""}\n[RESPUESTA DEL ALUMNO A EVALUAR (CALIFICA EXCLUSIVAMENTE ESTO)]\n"${String(datos.selected ?? "").trim()}"\n\n[SOLUCIÓN DE REFERENCIA (OFICIAL)]\n${pregunta.solucion || pregunta.solucio || pregunta.explicacion || ""}${Array.isArray(pregunta.rubrica) && pregunta.rubrica.length ? `\n\n[RÚBRICA DE PUNTOS]\n${pregunta.rubrica.join("; ")}` : ""}`
            : JSON.stringify(
                {
                  asignatura: String(datos.subject ?? "").slice(0, 100),
                  pregunta,
                  respuestaDelAlumno: String(datos.selected ?? "sin responder"),
                },
                null,
                2,
              ),
      });
      return responderJson(respuesta, 200, {
        explanation: respuestaIA.contenido,
        model: respuestaIA.modelo,
      });
    } catch (error) {
      return responderError(respuesta, 502, error.message);
    }
  }
  if (peticion.method === "POST" && url.pathname === "/api/generar") {
    let datos;
    try {
      datos = await leerJson(peticion);
      const solicitud = validarSolicitudGeneracion(datos);
      const material = solicitud.context
        ? await materialDesdeContexto(solicitud, solicitud.context)
        : await obtenerMaterialSeleccionado(solicitud);
      const tarea = crearTarea({
        asignatura: solicitud.asignatura,
        tema: solicitud.tema,
        temas: solicitud.temas,
        apartado: solicitud.apartado,
        total: solicitud.cantidad,
      });
      void ejecutarGeneracion(tarea.id, solicitud, material).catch((error) => {
        console.error(`[generar:${tarea.id}] ${error.stack || error.message}`);
        actualizarTarea(tarea.id, {
          fase: "error",
          mensaje: "No se pudo completar la generación",
          detalle: error.message,
          error: error.message,
          terminado: true,
        });
      });
      return responderJson(respuesta, 202, {
        id: tarea.id,
        progreso: `/api/generar/${tarea.id}`,
        cancelar: `/api/generar/${tarea.id}/cancelar`,
      });
    } catch (error) {
      return responderError(respuesta, error.estado ?? 422, error.message);
    }
  }
  const coincidencia = url.pathname.match(
    /^\/api\/generar\/([a-f0-9-]{36})(?:\/(cancelar))?$/i,
  );
  if (coincidencia && peticion.method === "GET" && !coincidencia[2]) {
    const tarea = obtenerTarea(coincidencia[1]);
    return tarea
      ? responderJson(respuesta, 200, tarea)
      : responderError(respuesta, 404, "No se encuentra esta generación.");
  }
  if (coincidencia && peticion.method === "POST" && coincidencia[2]) {
    const resultado = abortarTarea(coincidencia[1]);
    if (!resultado)
      return responderError(respuesta, 404, "No se encuentra esta generación.");
    if (!resultado.aceptado)
      return responderError(
        respuesta,
        409,
        "La generación ya terminó o está guardando una tanda.",
      );
    return responderJson(respuesta, 200, { cancelado: true });
  }
  return false;
}

export function normalizarPreguntaDinamica(raw, idx, apartatsMap = {}) {
  const enunciado = String(raw.enunciado || raw.q || "").trim();
  const codigo = String(raw.codigo || raw.codi || "").trim();
  const explicacion = String(raw.explicacion || raw.exp || raw.solucio || raw.solucion || "Sense explicació.").trim();
  const explicacionClara = String(raw.explicacionClara || explicacion).trim();

  let tipoRaw = String(raw.tipo || raw.tipus || "teoria").toLowerCase();
  const tipoMap = {
    codi: "codigo",
    codigo: "codigo",
    código: "codigo",
    error: "teoria",
    teoria: "teoria",
    teoría: "teoria",
    escriure: "escribir_codigo",
    escribir: "escribir_codigo",
    escribir_codigo: "escribir_codigo",
    interpretar: "traza_linea",
    traza: "traza_linea",
    traza_linea: "traza_linea",
    oberta: "desarrollo",
    abierta: "desarrollo",
    desarrollo: "desarrollo",
  };
  const tipo = tipoMap[tipoRaw] || tipoRaw;

  let opciones = {};
  if (raw.opciones && typeof raw.opciones === "object" && !Array.isArray(raw.opciones)) {
    opciones = { ...raw.opciones };
  } else if (Array.isArray(raw.op || raw.opciones)) {
    const arr = raw.op || raw.opciones;
    const letras = ["A", "B", "C", "D"];
    arr.forEach((texto, i) => {
      if (i < 4) opciones[letras[i]] = String(texto);
    });
  }

  const esAbierta = tipo === "escribir_codigo" || tipo === "traza_linea" || tipo === "desarrollo";
  if (esAbierta && Object.keys(opciones).length < 4) {
    opciones = { A: opciones.A || "-", B: opciones.B || "-", C: opciones.C || "-", D: opciones.D || "-" };
  } else if (!esAbierta) {
    for (const L of ["A", "B", "C", "D"]) {
      if (!opciones[L] || typeof opciones[L] !== "string" || !opciones[L].trim()) {
        opciones[L] = opciones[L] || `Opció ${L}`;
      }
    }
  }

  let correcta = "A";
  if (typeof raw.ok === "number" && raw.ok >= 0 && raw.ok < 4) {
    correcta = ["A", "B", "C", "D"][raw.ok];
  } else if (raw.correcta) {
    correcta = String(raw.correcta).trim().toUpperCase().charAt(0);
  } else if (typeof raw.ok === "string") {
    correcta = String(raw.ok).trim().toUpperCase().charAt(0);
  }
  if (!["A", "B", "C", "D"].includes(correcta)) correcta = "A";

  let tema = Number(raw.tema || 0);
  if (!tema) {
    const matchTema = String(raw.tema || raw.id || raw.apartat || raw.apartado || "").match(/T(\d+)|tema\s*(\d+)/i);
    tema = matchTema ? Number(matchTema[1] || matchTema[2]) : 1;
  }

  const apRaw = String(raw.apartat || raw.apartado || "");
  let apartadoNombre = raw.apartadoNombre || (apartatsMap ? apartatsMap[apRaw] : "") || "";
  let apartado = Number(raw.apartado || 0);
  if (!apartado) {
    if (apRaw === "intro") {
      apartado = 1;
      if (!apartadoNombre) apartadoNombre = "Introducción";
    } else if (apRaw === "pract") {
      apartado = tema === 2 ? 10 : 8;
      if (!apartadoNombre) {
        apartadoNombre = tema === 2 ? "Demos D1-D5 y prácticas P01 y P02" : "Demos D1-D5 y práctica P00";
      }
    } else {
      const partes = apRaw.split(".");
      if (partes.length > 1 && !Number.isNaN(Number(partes[1]))) {
        apartado = Number(partes[1]);
      } else {
        apartado = 1;
      }
    }
  }

  return {
    id: raw.id || idx + 1,
    tema,
    apartado,
    apartadoNombre,
    tipo,
    tag: raw.tag || (tipoRaw === "error" ? "Detecció d'errors" : tipo === "codigo" ? "Codi" : esAbierta ? "Desenvolupament" : "Teoria"),
    dificultad: raw.dificultad || "media",
    enunciado,
    codigo,
    opciones,
    correcta,
    explicacion,
    explicacionClara,
    traza: Array.isArray(raw.traza) ? raw.traza : [],
    solucio: raw.solucio || raw.solucion || explicacion,
    rubrica: Array.isArray(raw.rubrica) ? raw.rubrica : [],
    punts: raw.punts || raw.puntos || 1,
  };
}

export async function consolidarBancoDinamico(idAsignatura) {
  const nombreCarpeta = idAsignatura.toLowerCase();
  const nombreBancos = idAsignatura.toUpperCase();

  const directorios = [
    path.join(configuracion.raizProyecto, "data", "asignaturas", nombreCarpeta),
    path.join(configuracion.raizPublica, "data", "asignaturas", nombreCarpeta),
    path.join(configuracion.raizBancos, nombreBancos),
  ];

  const archivosEncontrados = new Set();
  for (const dir of directorios) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile() && ent.name.endsWith(".json")) {
          archivosEncontrados.add(path.join(dir, ent.name));
        }
      }
    } catch {
      // Ignorar directorios inexistentes
    }
  }

  if (!archivosEncontrados.size) return null;

  const archivosLista = [...archivosEncontrados];
  // Si hay archivos modulares (como tema1.json, etc.), preferimos leer los modulares para consolidar
  const archivosModulares = archivosLista.filter((f) => !path.basename(f).startsWith("preguntas"));
  const aProcesar = archivosModulares.length > 0 ? archivosModulares : archivosLista;

  let todasPreguntas = [];
  const enunciadosVistos = new Set();
  let metaGlobal = {
    asignatura: idAsignatura.toUpperCase(),
    titulo: `${idAsignatura.toUpperCase()} · Banco de preguntas`,
    tema: 0,
    temas: [1],
    apartado: 0,
    total: 0,
    version: "1.0",
  };

  for (const rutaArchivo of aProcesar) {
    try {
      const rawText = await readFile(rutaArchivo, "utf8");
      const contenido = JSON.parse(rawText);
      if (!contenido) continue;

      if (contenido.meta && typeof contenido.meta === "object") {
        metaGlobal = { ...metaGlobal, ...contenido.meta };
      }
      if (contenido.tema && typeof contenido.tema === "string") {
        metaGlobal.titulo = contenido.tema;
      }
      const apartatsMap = contenido.apartats || {};

      const rawList = Array.isArray(contenido.preguntas)
        ? contenido.preguntas
        : Array.isArray(contenido.preguntes)
          ? contenido.preguntes
          : Array.isArray(contenido)
            ? contenido
            : [];

      for (let i = 0; i < rawList.length; i++) {
        const norm = normalizarPreguntaDinamica(rawList[i], todasPreguntas.length, apartatsMap);
        const clave = norm.id
          ? String(norm.id)
          : (norm.enunciado + (norm.codigo || "")).trim().toLowerCase().replace(/\s+/g, " ");
        if (clave && !enunciadosVistos.has(clave)) {
          enunciadosVistos.add(clave);
          todasPreguntas.push(norm);
        }
      }
    } catch (err) {
      console.warn(`[bancos-dinamicos] Aviso al procesar ${rutaArchivo}: ${err.message}`);
    }
  }

  const temasDetectados = [...new Set(todasPreguntas.map((p) => p.tema))].sort((a, b) => a - b);
  metaGlobal.temas = temasDetectados.length ? temasDetectados : [1];
  metaGlobal.tema = temasDetectados.length === 1 ? temasDetectados[0] : 0;
  metaGlobal.total = todasPreguntas.length;

  return {
    formato: "preparar-tests-banco-preguntas",
    version: 1,
    meta: metaGlobal,
    preguntas: todasPreguntas,
  };
}

async function servirArchivo(peticion, respuesta, ruta) {
  const archivoConfigurado = configuracion.archivosPublicos.get(ruta);
  if (archivoConfigurado) {
    const [rutaRelativa, tipo] = archivoConfigurado;
    try {
      const archivos = Array.isArray(rutaRelativa) ? rutaRelativa : [rutaRelativa];
      const partes = await Promise.all(
        archivos.map((archivo) =>
          readFile(path.join(configuracion.raizPublica, archivo)),
        ),
      );
      const contenido = Buffer.concat(
        partes.flatMap((parte) => [parte, Buffer.from("\n")]),
      );
      respuesta.writeHead(200, {
        "content-type": tipo ?? mimeTipos.get(path.extname(ruta)) ?? "application/octet-stream",
        "content-length": contenido.length,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      respuesta.end(peticion.method === "HEAD" ? undefined : contenido);
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      responderError(respuesta, 404, "No se encuentra el recurso solicitado.");
      return true;
    }
  }

  // Fallback dinámico para servir cualquier archivo estático de public/ o del proyecto
  const rutaLimpia = path.normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, "");
  if (!rutaLimpia.startsWith("..")) {
    const candidatas = [
      path.join(configuracion.raizPublica, rutaLimpia),
      path.join(configuracion.raizProyecto, rutaLimpia),
    ];
    for (const candidata of candidatas) {
      try {
        const st = await stat(candidata);
        if (st.isFile()) {
          const ext = path.extname(candidata).toLowerCase();
          const tipo = mimeTipos.get(ext) || "application/octet-stream";
          const contenido = await readFile(candidata);
          respuesta.writeHead(200, {
            "content-type": tipo,
            "content-length": contenido.length,
            "cache-control": "no-cache",
            "x-content-type-options": "nosniff",
          });
          respuesta.end(peticion.method === "HEAD" ? undefined : contenido);
          return true;
        }
      } catch {
        // Probar siguiente candidata
      }
    }
  }

  return false;
}

export function esRespuestaVaciaODesconocida(texto) {
  if (!texto || typeof texto !== "string") return true;
  const limpio = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:¿?¡!_'"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!limpio) return true;
  const patrones = [
    /^no\s+(lo\s+)?se(\s+(como\s+)?(hacerlo|resolverlo|hacer|responder|ponerlo))?$/,
    /^ni\s+idea$/,
    /^ns$/,
    /^no\s+tengo\s+ni\s+idea$/,
    /^no\s+me\s+sale$/,
    /^no\s+me\s+acuerdo$/,
    /^no\s+la\s+se$/,
    /^no\s+sabria\s+decir(te)?$/,
    /^no\s+puedo$/,
    /^paso$/,
    /^en\s+blanco$/,
    /^blanco$/,
    /^sin\s+respuesta$/,
  ];
  return patrones.some((patron) => patron.test(limpio));
}

export function crearServidor() {
  return createServer(async (peticion, respuesta) => {
    const url = new URL(peticion.url ?? "/", `http://${peticion.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/favicon.ico") {
        respuesta.writeHead(204, { "content-type": "image/x-icon", "cache-control": "public, max-age=86400" });
        respuesta.end();
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const atendido = await procesarApi(peticion, respuesta, url);
        if (atendido !== false) return;
        return responderError(respuesta, 404, "No se encuentra esta API.");
      }
      if (peticion.method !== "GET" && peticion.method !== "HEAD") {
        return responderError(respuesta, 405, "Método no permitido.");
      }
      const matchAsignatura = url.pathname.match(/^\/data\/asignaturas\/([a-zA-Z0-9_-]+)\/preguntas\.json$/);
      if (matchAsignatura && (peticion.method === "GET" || peticion.method === "HEAD")) {
        const idAsig = matchAsignatura[1].toLowerCase();
        const bancoConsolidado = await consolidarBancoDinamico(idAsig);
        if (bancoConsolidado && bancoConsolidado.preguntas.length > 0) {
          return responderJson(respuesta, 200, bancoConsolidado);
        }
      }
      if (await servirArchivo(peticion, respuesta, url.pathname)) return;
      return responderError(respuesta, 404, "No se encuentra este recurso.");
    } catch (error) {
      console.error(`[http] ${error.stack || error.message}`);
      if (!respuesta.headersSent)
        responderError(respuesta, error.estado ?? 500, error.message);
      else respuesta.destroy(error);
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const servidor = crearServidor();
  servidor.listen(configuracion.puerto, "0.0.0.0", () => {
    console.log(
      `Preparar tests disponible en http://127.0.0.1:${configuracion.puerto}`,
    );
    console.log(
      `Apuntes en solo lectura: ${configuracion.raizApuntes}. Ollama: ${configuracion.direccionOllama}.`,
    );
  });
}
