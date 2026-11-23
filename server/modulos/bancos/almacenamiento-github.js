import path from "node:path";
import { configuracion } from "../../configuracion.js";
import { obtenerArbolGitHub } from "../apuntes/catalogo-github.js";

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

export async function leerBancoGitHub(asignatura, nombreArchivo) {
  const asigUpper = asignatura.toUpperCase();
  const dirTest = configuracion.githubTestDir || "test";
  const rutaRelativa = `${dirTest}/${asigUpper}/${nombreArchivo}`;

  const url = `https://raw.githubusercontent.com/${configuracion.githubRepo}/${configuracion.githubBranch}/${rutaRelativa}`;
  const respuesta = await fetch(url, { headers: cabecerasGitHub(), signal: AbortSignal.timeout(10000) });
  if (!respuesta.ok) return null;

  try {
    return await respuesta.json();
  } catch (_) {
    return null;
  }
}

export async function obtenerShaArchivoGitHub(rutaRelativa) {
  const url = `https://api.github.com/repos/${configuracion.githubRepo}/contents/${rutaRelativa}?ref=${configuracion.githubBranch}`;
  try {
    const res = await fetch(url, { headers: cabecerasGitHub(), signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const datos = await res.json();
    return datos.sha || null;
  } catch (_) {
    return null;
  }
}

export async function guardarBancoGitHub(asignatura, nombreArchivo, contenidoBanco, mensajeCommit = "") {
  if (!configuracion.githubToken) {
    throw new Error("No hay token de GitHub configurado para subir a GRADOS_INFORMATICOS.");
  }

  const asigUpper = asignatura.toUpperCase();
  const dirTest = configuracion.githubTestDir || "test";
  const rutaRelativa = `${dirTest}/${asigUpper}/${nombreArchivo}`;

  const shaExistente = await obtenerShaArchivoGitHub(rutaRelativa);
  const jsonStr = typeof contenidoBanco === "string" ? contenidoBanco : JSON.stringify(contenidoBanco, null, 2);
  const contenidoBase64 = Buffer.from(jsonStr, "utf8").toString("base64");

  const url = `https://api.github.com/repos/${configuracion.githubRepo}/contents/${rutaRelativa}`;
  const body = {
    message: mensajeCommit || `feat(test): actualizar preguntas para ${asigUpper} (${nombreArchivo})`,
    content: contenidoBase64,
    branch: configuracion.githubBranch,
    ...(shaExistente ? { sha: shaExistente } : {}),
  };

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...cabecerasGitHub(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errorDetalle = await res.text().catch(() => "");
    throw new Error(`Error subiendo banco a GitHub (${res.status}): ${errorDetalle}`);
  }

  const resultado = await res.json();
  return { ok: true, sha: resultado.content?.sha, commit: resultado.commit?.sha };
}

export async function listarBancosGitHub() {
  const dirTest = configuracion.githubTestDir || "test";
  const arbol = await obtenerArbolGitHub();
  const prefijo = `${dirTest}/`;

  const items = arbol.filter((item) => item.path.startsWith(prefijo) && item.path.endsWith(".json") && item.type === "blob");
  const bancos = [];

  for (const item of items) {
    const rel = item.path.slice(prefijo.length);
    const partes = rel.split("/");
    if (partes.length < 2) continue; // Por ejemplo indice.json en la raiz de test/

    const asignatura = partes[0];
    const nombreArchivo = partes[1];
    bancos.push({
      asignatura,
      archivo: nombreArchivo,
      ruta: item.path,
      sha: item.sha,
    });
  }

  return bancos;
}
