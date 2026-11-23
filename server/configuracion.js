import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const raizProyecto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function cargarArchivoEnv() {
  const rutaEnv = path.resolve(raizProyecto, ".env");
  try {
    if (fs.existsSync(rutaEnv)) {
      const contenido = fs.readFileSync(rutaEnv, "utf8");
      for (const linea of contenido.split("\n")) {
        const recortada = linea.trim();
        if (!recortada || recortada.startsWith("#")) continue;
        const idx = recortada.indexOf("=");
        if (idx > 0) {
          const clave = recortada.slice(0, idx).trim();
          let valor = recortada.slice(idx + 1).trim();
          if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
            valor = valor.slice(1, -1);
          }
          if (process.env[clave] === undefined || process.env[clave] === "") {
            process.env[clave] = valor;
          }
        }
      }
    }
  } catch (_) {}
}

cargarArchivoEnv();

function resolverRaizApuntes() {
  const candidatas = [
    process.env.RUTA_APUNTES,
    process.env.DIRECTORIO_APUNTES,
    "/data/apuntes",
    "/home/natalia/Escritorio/GRADOS_INFORMATICOS/apuntes_privados",
    "/home/natalia/Escritorio/GRADOS_INFORMATICOS/apuntes",
    "/home/natalia/Escritorio/apuntes-privados",
    path.resolve(raizProyecto, "apuntes_privados")
  ].filter(Boolean);

  for (const c of candidatas) {
    try {
      if (fs.existsSync(c)) return path.resolve(c);
    } catch (_) {}
  }
  return path.resolve(process.env.RUTA_APUNTES ?? process.env.DIRECTORIO_APUNTES ?? "/data/apuntes");
}

function enteroEntorno(nombre, predeterminado, minimo, maximo = Number.MAX_SAFE_INTEGER) {
  const valor = Number.parseInt(process.env[nombre] ?? "", 10);
  return Number.isSafeInteger(valor) && valor >= minimo && valor <= maximo
    ? valor
    : predeterminado;
}

function resolverGitHubToken() {
  const envToken = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  if (envToken) {
    return envToken;
  }
  try {
    const salida = execSync("gh auth token", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    if (salida) return salida;
  } catch (_) {}
  return "";
}

export const configuracion = {
  raizProyecto,
  raizPublica: path.join(raizProyecto, "public"),
  archivosPublicos: new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/assets/css/app.css", ["assets/css/app.css", "text/css; charset=utf-8"]],
    [
      "/assets/css/practicar-apuntes.css",
      ["assets/css/practicar-apuntes.css", "text/css; charset=utf-8"],
    ],
    [
      "/assets/js/app.js",
      [
        [
          "assets/js/app/persistencia-archivos.js",
          "assets/js/app/estado/utilidades.js",
          "assets/js/app/estado/almacenamiento.js",
          "assets/js/app/estado/apartados.js",
          "assets/js/app/estado/catalogo.js",
          "assets/js/app/estado/sesiones.js",
          "assets/js/app/estado.js",
          "assets/js/app/supabase/cliente.js",
          "assets/js/app/supabase/progreso.js",
          "assets/js/app/supabase/auth.js",
          "assets/js/app/supabase/ui.js",
          "assets/js/app/supabase/github-ramas.js",
          "assets/js/app/supabase.js",
          "assets/js/app/sesion/control.js",
          "assets/js/app/sesion/arbol.js",
          "assets/js/app/sesion/modalidades.js",
          "assets/js/app/sesion/desarrollo.js",
          "assets/js/app/sesion/topbar.js",
          "assets/js/app/sesion/inicio.js",
          "assets/js/app/sesion.js",
          "assets/js/app/depurador.js",
          "assets/js/app/preguntas.js",
          "assets/js/app/fallos.js",
          "assets/js/app/ia.js",
          "assets/js/app/resultados.js",
          "assets/js/app/inicio.js",
        ],
        "text/javascript; charset=utf-8",
      ],
    ],
    [
      "/assets/js/practicar-apuntes.js",
      ["assets/js/practicar-apuntes.js", "text/javascript; charset=utf-8"],
    ],
    [
      "/assets/js/app/consola-vivo.js",
      ["assets/js/app/consola-vivo.js", "text/javascript; charset=utf-8"],
    ],
    ["/data/asignaturas.json", ["data/asignaturas.json", "application/json; charset=utf-8"]],
    [
      "/data/asignaturas/wec/preguntas.json",
      ["data/asignaturas/wec/preguntas.json", "application/json; charset=utf-8"],
    ],
    ...["p1", "p2", "p3", "p4", "p5"].map((parte) => [
      `/data/asignaturas/wec/partes/${parte}.json`,
      [`data/asignaturas/wec/partes/${parte}.json`, "application/json; charset=utf-8"],
    ]),
    [
      "/data/ejemplo-fallos.json",
      ["data/ejemplo-fallos.json", "application/json; charset=utf-8"],
    ],
  ]),
  raizApuntes: resolverRaizApuntes(),
  raizBancos: path.resolve(
    raizProyecto,
    process.env.RUTA_BANCOS ?? "datos/bancos",
  ),
  puerto: enteroEntorno("PUERTO_WEB", 3000, 1, 65535),
  fuenteAsignaturas: (process.env.FUENTE_ASIGNATURAS || "local").trim().toLowerCase(),
  githubRepo: (process.env.GITHUB_REPOSITORY || "nataliagamezbarea/GRADOS_INFORMATICOS").trim(),
  githubBranch: (process.env.GITHUB_BRANCH || "master").trim(),
  githubToken: resolverGitHubToken(),
  githubTestDir: (process.env.GITHUB_TEST_DIR || "test").trim().replace(/^\/+|\/+$/g, ""),
  githubApuntesDir: (process.env.GITHUB_APUNTES_DIR || "apuntes_privados").trim().replace(/^\/+|\/+$/g, ""),
  proveedorIA: (process.env.PROVEEDOR_IA || "auto").trim().toLowerCase(),
  direccionOllama: (process.env.DIRECCION_OLLAMA ??
    "http://generador-apuntes-ollama:11434")
    .trim()
    .replace(/\/+$/, ""),
  modelo: (process.env.MODELO_IA ?? "qwen2.5vl:7b").trim(),
  nvidiaApiKey: (process.env.NVIDIA_API_KEY ?? "").trim(),
  nvidiaModelo: (process.env.NVIDIA_MODELO ?? "nvidia/nemotron-3.5-bolt-e4b").trim(),
  nvidiaBaseUrl: (process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").trim().replace(/\/+$/, ""),
  contextoModelo: enteroEntorno("NUM_CTX_IA", 24576, 4096, 131072),
  tokensRespuesta: enteroEntorno("TOKENS_MAX_IA", 2048, 256, 8192),
  tiempoMaximoMs: enteroEntorno("TIEMPO_IA", 900, 30, 3600) * 1000,
  maxCaracteresBloque: enteroEntorno(
    "MAX_CARACTERES_BLOQUE",
    10000,
    2000,
    40000,
  ),
  maxPreguntas: 7000,
  preguntasPorBloqueIA: 10,
};
