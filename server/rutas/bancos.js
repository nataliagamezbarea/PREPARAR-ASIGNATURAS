import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { configuracion } from "../configuracion.js";
import { listarBancosPreguntas, leerBancoPreguntas } from "../bancos.js";
import { leerCatalogoApuntes, obtenerMaterialSeleccionado } from "../apuntes.js";
import { log } from "../debug.js";

export function resolverSeleccion(url) {
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

export async function consolidarBancoDinamico(idAsignatura) {
  const nombreCarpeta = idAsignatura.toLowerCase();
  const nombreBancos = idAsignatura.toUpperCase();

  const directorios = [
    path.join(configuracion.raizBancos, nombreBancos),
    path.join(configuracion.raizPublica, "data", "asignaturas", nombreCarpeta),
    path.join(configuracion.raizProyecto, "data", "asignaturas", nombreCarpeta),
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
  const archivosModulares = archivosLista.filter((f) => !path.basename(f).startsWith("preguntas"));
  const aProcesar = archivosModulares.length > 0 ? archivosModulares : archivosLista;

  const mapaPreguntas = new Map();
  let metaBase = {
    asignatura: nombreBancos,
    titulo: `${nombreBancos} · Banco Consolidado`,
    tema: 0,
    temas: [],
    apartado: 0,
    total: 0,
    version: "2.0"
  };

  for (const archivo of aProcesar) {
    try {
      const contenido = JSON.parse(await readFile(archivo, "utf8"));
      if (contenido.meta && !metaBase.asignatura) metaBase = { ...metaBase, ...contenido.meta };
      const preguntas = Array.isArray(contenido.preguntas) ? contenido.preguntas : (Array.isArray(contenido) ? contenido : []);
      for (const p of preguntas) {
        if (!p || !p.enunciado) continue;
        const clave = p.id || p.enunciado.trim();
        if (!mapaPreguntas.has(clave)) {
          mapaPreguntas.set(clave, p);
        }
      }
    } catch (_) {}
  }

  const todasPreguntas = [...mapaPreguntas.values()];
  if (!todasPreguntas.length) return null;

  const temasSet = new Set(todasPreguntas.map(p => Number(p.tema) || 1));
  metaBase.temas = [...temasSet].sort((a, b) => a - b);
  metaBase.total = todasPreguntas.length;

  return {
    formato: "preparar-tests-banco-preguntas",
    version: 1,
    clave: `${nombreBancos}-consolidado`,
    meta: metaBase,
    preguntas: todasPreguntas
  };
}

export async function manejarBancos(peticion, respuesta, url, responderJson, responderError) {
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
          temas: banco.meta.temas?.length ? banco.meta.temas : [banco.meta.tema],
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

  return false;
}
