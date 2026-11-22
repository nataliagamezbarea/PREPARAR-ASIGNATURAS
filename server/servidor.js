import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { inspect as utilInspect } from "node:util";
import { configuracion } from "./configuracion.js";
import { comprobarModelo } from "./modelo.js";
import { leerCatalogoApuntes } from "./apuntes.js";
import { log, error as debugError } from "./debug.js";

import { manejarAsignaturas, leerCatalogoAsignaturas } from "./rutas/asignaturas.js";
import { manejarExplain } from "./rutas/explain.js";
import { manejarBancos, consolidarBancoDinamico } from "./rutas/bancos.js";
import { manejarGenerar } from "./rutas/generar.js";

log("servidor", "iniciando servidor modular de Preparar tests");

const mimeTipos = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

export function responderJson(respuesta, estado, contenido) {
  const cuerpo = JSON.stringify(contenido);
  respuesta.writeHead(estado, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(cuerpo),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  respuesta.end(cuerpo);
  return true;
}

export function responderError(respuesta, estado, mensaje) {
  return responderJson(respuesta, estado, { error: mensaje });
}

export async function leerJson(peticion) {
  let cuerpo = "";
  for await (const parte of peticion) {
    cuerpo += parte;
    if (Buffer.byteLength(cuerpo) > 50 * 1024 * 1024) {
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

async function servirArchivo(peticion, respuesta, ruta) {
  if (configuracion.archivosPublicos.has(ruta)) {
    const [rutaRelativa, tipo] = configuracion.archivosPublicos.get(ruta);
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
      path.join(configuracion.raizBancos, rutaLimpia),
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

async function procesarApi(peticion, respuesta, url) {
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
    } catch (_) {}
  }

  log("api", `${peticion.method} ${url.pathname}`, "query:", utilInspect(url.searchParams, { depth: 2 }));

  if (url.pathname === "/favicon.ico") {
    respuesta.writeHead(204, { "content-type": "image/x-icon", "cache-control": "public, max-age=86400" });
    respuesta.end();
    return;
  }

  // 1. Configuración y salud
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
      const catalogo = await leerCatalogoApuntes();
      try {
        const catalogoBancos = await leerCatalogoAsignaturas();
        for (const b of (catalogoBancos.asignaturas || [])) {
          const nombre = b.nombre || b.id;
          const existe = catalogo.asignaturas.find(a => a.nombre.toLowerCase() === nombre.toLowerCase());
          if (!existe) {
            catalogo.asignaturas.push({
              nombre,
              id: b.id,
              temas: (b.temas || []).map(t => ({
                numero: t.numero,
                nombre: t.nombre || `Tema ${t.numero}`,
                revision: "banco-oficial",
                apartados: (t.apartados || []).map(ap => ({
                  numero: ap.numero,
                  nombre: ap.nombre || `Apartado ${t.numero}.${ap.numero}`,
                  revision: "banco-oficial"
                }))
              }))
            });
          }
        }
      } catch (_) {}
      return responderJson(respuesta, 200, catalogo);
    } catch (err) {
      debugError("api", err, { ruta: "/api/apuntes" });
      return responderError(respuesta, 503, err.message);
    }
  }

  // 2. Rutas delegadas a submódulos organizados
  if (await manejarAsignaturas(peticion, respuesta, url, responderJson, responderError, leerJson)) return;
  if (await manejarBancos(peticion, respuesta, url, responderJson, responderError)) return;
  if (await manejarExplain(peticion, respuesta, url, responderJson, responderError, leerJson)) return;
  if (await manejarGenerar(peticion, respuesta, url, responderJson, responderError, leerJson)) return;

  return false;
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
