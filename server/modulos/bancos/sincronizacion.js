import fs from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { configuracion } from "../../configuracion.js";
import { guardarBancoGitHub } from "./almacenamiento-github.js";

const rutaColaSync = path.join(configuracion.raizProyecto, "cache", "sync-pendientes.json");

export async function leerColaSync() {
  try {
    if (fs.existsSync(rutaColaSync)) {
      const contenido = await readFile(rutaColaSync, "utf8");
      const datos = JSON.parse(contenido);
      return Array.isArray(datos) ? datos : [];
    }
  } catch (_) {}
  return [];
}

export async function guardarColaSync(cola) {
  try {
    await mkdir(path.dirname(rutaColaSync), { recursive: true });
    await writeFile(rutaColaSync, JSON.stringify(cola, null, 2), "utf8");
  } catch (_) {}
}

export async function encolarSincronizacion(item) {
  const cola = await leerColaSync();
  const idx = cola.findIndex((p) => p.asignatura === item.asignatura && p.archivo === item.archivo);
  if (idx >= 0) {
    cola[idx] = { ...item, fecha: Date.now() };
  } else {
    cola.push({ ...item, fecha: Date.now() });
  }
  await guardarColaSync(cola);
}

export async function sincronizarPendientesGitHub() {
  if (process.env.NODE_ENV === "test" || process.execArgv.includes("--test")) {
    return { sincronizados: 0, pendientes: 0 };
  }
  if (!configuracion.githubToken) return { sincronizados: 0, pendientes: 0 };
  const cola = await leerColaSync();
  if (!cola.length) return { sincronizados: 0, pendientes: 0 };

  const pendientesNuevos = [];
  let sincronizados = 0;

  for (const item of cola) {
    try {
      await guardarBancoGitHub(item.asignatura, item.archivo, item.contenido, `sync(test): subir banco pendiente ${item.asignatura}/${item.archivo}`);
      sincronizados += 1;
    } catch (err) {
      console.warn(`[sync] No se pudo sincronizar ${item.asignatura}/${item.archivo}:`, err.message);
      pendientesNuevos.push(item);
    }
  }

  await guardarColaSync(pendientesNuevos);
  return { sincronizados, pendientes: pendientesNuevos.length };
}

export async function guardarConSincronizacion(asignatura, nombreArchivo, contenidoBanco) {
  if (process.env.NODE_ENV === "test" || process.execArgv.includes("--test")) {
    return { sincronizado: false };
  }
  const deberiaSubirAGitHub = configuracion.fuenteAsignaturas === "github";

  if (!deberiaSubirAGitHub) return { sincronizado: false };

  try {
    await guardarBancoGitHub(asignatura, nombreArchivo, contenidoBanco);
    return { sincronizado: true };
  } catch (err) {
    console.warn(`[sync] Falló subida inmediata a GitHub para ${asignatura}/${nombreArchivo}; guardando en cola offline:`, err.message);
    await encolarSincronizacion({
      asignatura,
      archivo: nombreArchivo,
      contenido: contenidoBanco,
    });
    return { sincronizado: false, encolado: true, error: err.message };
  }
}
