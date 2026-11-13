import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  access,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leerCatalogoApuntes } from "./server/apuntes.js";

const raizProyecto = path.dirname(fileURLToPath(import.meta.url));
const archivoEntorno = path.join(raizProyecto, ".env");
const ejemploEntorno = path.join(raizProyecto, ".env.ejemplo");
const archivoCompose = path.join(raizProyecto, "docker", "compose.yaml");
const raizGenerador = path.resolve(raizProyecto, "..", "generador-apuntes");
const composeGenerador = path.join(raizGenerador, "docker", "composicion.yaml");
const entornoGenerador = path.join(raizGenerador, ".env");
const nombreContenedorOllama = "generador-apuntes-ollama";
const estado = {
  mensaje: "Preparando Preparar tests…",
  progreso: 0,
  registros: [],
  listo: false,
  direccion: "",
  error: "",
};
let servidorProgreso;

function actualizarProgreso(mensaje, porcentaje, detalle = "") {
  estado.mensaje = mensaje;
  if (porcentaje !== undefined) estado.progreso = Math.max(0, Math.min(100, porcentaje));
  if (detalle) {
    estado.registros.push(detalle);
    estado.registros = estado.registros.slice(-12);
  }
}

function limpiarSalida(texto) {
  return String(texto)
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function escaparHtml(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function interpretarProgresoDescarga(linea) {
  const coincidencia = linea.match(
    /(\d{1,3})%\s+.*?(\d+(?:\.\d+)?\s*[KMGT]?B)\s*\/\s*(\d+(?:\.\d+)?\s*[KMGT]?B)(?:\s+(\d+(?:\.\d+)?\s*[KMGT]?B\/s))?(?:\s+([\dhms]+))?/i,
  );
  if (!coincidencia) return null;
  const [, porcentaje, descargado, total, velocidad, tiempo] = coincidencia;
  return `Descarga del modelo: ${porcentaje} % · ${descargado} de ${total}${velocidad ? ` · ${velocidad}` : ""}${tiempo ? ` · restan ${tiempo}` : ""}`;
}

function abrirNavegador(direccion) {
  const navegador = spawn("firefox", [direccion], {
    detached: true,
    stdio: "ignore",
  });
  navegador.on("error", () => {
    const fallback = spawn("xdg-open", [direccion], {
      detached: true,
      stdio: "ignore",
    });
    fallback.on("error", (error) =>
      actualizarProgreso("No se pudo abrir el navegador", estado.progreso, error.message),
    );
    fallback.unref();
  });
  navegador.unref();
}

async function abrirPaginaProgreso(rutaInicial) {
  let confirmarCarpeta;
  const carpetaConfirmada = new Promise((resolver) => {
    confirmarCarpeta = resolver;
  });
  servidorProgreso = createServer(async (peticion, respuesta) => {
    const urlObjeto = new URL(peticion.url, "http://127.0.0.1");
    if (peticion.url === "/estado") {
      respuesta.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      respuesta.end(JSON.stringify(estado));
      return;
    }
    if (urlObjeto.pathname === "/abrir-selector-carpeta" && peticion.method === "POST") {
      const resultado = spawn(
        "zenity",
        [
          "--file-selection",
          "--directory",
          "--title=Selecciona la carpeta raíz apuntes-privados",
          "--filename=/home/natalia/Escritorio/",
        ],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      let rutaSeleccionada = "";
      resultado.stdout.setEncoding("utf8");
      resultado.stdout.on("data", (datos) => {
        rutaSeleccionada += datos;
      });
      resultado.once("error", (error) => {
        const cuerpo = JSON.stringify({ error: `No se pudo abrir el selector de carpetas: ${error.message}` });
        respuesta.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        respuesta.end(cuerpo);
      });
      resultado.once("close", (codigo) => {
        if (respuesta.headersSent) return;
        const ruta = rutaSeleccionada.trim();
        const cuerpo = JSON.stringify(
          codigo === 0 && ruta
            ? { ruta }
            : { cancelado: true },
        );
        respuesta.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        respuesta.end(cuerpo);
      });
      return;
    }
    if (urlObjeto.pathname === "/seleccionar-carpeta" && (peticion.method === "POST" || peticion.method === "GET")) {
      try {
        let rutaParam = urlObjeto.searchParams.get("ruta") || "";
        if (peticion.method === "POST") {
          let cuerpo = "";
          for await (const parte of peticion) {
            cuerpo += parte;
            if (Buffer.byteLength(cuerpo) > 16384)
              throw new Error("La ruta seleccionada es demasiado larga.");
          }
          if (cuerpo) {
            try {
              const datos = JSON.parse(cuerpo);
              if (datos.ruta) rutaParam = datos.ruta;
            } catch {
              // fallback rutaParam
            }
          }
        }
        const ruta = await guardarCarpetaApuntes(rutaParam);
        const resultado = JSON.stringify({ ruta });
        respuesta.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        respuesta.end(resultado);
        actualizarProgreso("Carpeta de apuntes comprobada y guardada.", 6, ruta);
        confirmarCarpeta(ruta);
      } catch (error) {
        if (!respuesta.headersSent) {
          const resultado = JSON.stringify({ error: error.message });
          respuesta.writeHead(400, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          respuesta.end(resultado);
        }
      }
      return;
    }
    if (urlObjeto.pathname !== "/" && urlObjeto.pathname !== "/index.html") {
      respuesta.writeHead(404);
      respuesta.end("No encontrado");
      return;
    }
    const rutaDesdeQuery = urlObjeto.searchParams.get("ruta") || rutaInicial;
    respuesta.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    respuesta.end(`<!doctype html>
<html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preparar tests</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1421;color:#e8eef9;font:15px system-ui,sans-serif}
main{width:min(600px,calc(100% - 32px));padding:32px;border:1px solid #29364a;border-radius:22px;background:#131e30;box-shadow:0 20px 70px #0005}
.icono{width:52px;height:52px;display:grid;place-items:center;border-radius:16px;background:#1d3766;color:#9fc1ff;font-size:26px}
h1{margin:18px 0 4px;font-size:25px}p{color:#aab8cd;line-height:1.55}label{display:block;margin:20px 0 7px;font-size:13px;font-weight:700}input{width:100%;padding:12px;border:1px solid #40516b;border-radius:10px;background:#0d1421;color:#e8eef9;font:inherit}button{margin-top:14px;padding:11px 16px;border:0;border-radius:10px;background:#477add;color:#fff;font:inherit;font-weight:750;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.secundario{border:1px solid #40516b;background:#202e43}.ruta{margin-top:8px;font-size:12px;overflow-wrap:anywhere}#mensaje{min-height:28px;color:#c5d2e6}progress{width:100%;height:13px;margin:14px 0 4px;accent-color:#70a2ff}#porcentaje{color:#91a9ca;font-size:13px}
details{margin-top:20px;color:#aab8cd}pre{max-height:180px;overflow:auto;white-space:pre-wrap;color:#b8c8dd;font-size:12px}
.error{margin-top:16px;padding:13px;border:1px solid #e76d6d;border-radius:12px;color:#ffcaca;white-space:pre-wrap}#progreso-arranque{display:none;margin-top:24px}
a{display:inline-block;margin-top:18px;color:#aaccff}#detalle{color:#8da0ba;font-size:13px}
</style>
<main><div class="icono">📝</div><h1>Preparar tests</h1>
<section id="elegir-carpeta"><p>Confirma la carpeta raíz <code>apuntes-privados</code> guardada anteriormente o elige otra. La app solo la montará en lectura; guardará los tests en otra carpeta.</p>
<form id="formulario-carpeta" action="/seleccionar-carpeta" method="POST"><label for="ruta-apuntes">Carpeta seleccionada</label><input id="ruta-apuntes" name="ruta" type="text" value="${escaparHtml(rutaDesdeQuery)}" autocomplete="off" readonly required><button class="secundario" id="elegir-carpeta-boton" type="button">📁 Elegir otra carpeta…</button><button id="continuar" type="submit" ${rutaDesdeQuery ? "" : "disabled"}>Confirmar carpeta y continuar</button></form>
<p id="ruta-guardada" class="ruta">La ruta guardada se conserva; pulsa confirmar para continuar o selecciona otra carpeta.</p><div id="error" class="error" role="alert" hidden></div></section>
<section id="progreso-arranque"><p id="mensaje" role="status" aria-live="polite">Comprobando Docker y la IA local…</p>
<progress id="barra" max="100" value="0" aria-label="Progreso de inicio"></progress><div id="porcentaje">0 %</div><p id="detalle"></p>
<details id="registros-panel" hidden><summary>Detalles de inicio</summary><pre id="registros"></pre></details>
<a id="enlace" href="#" hidden>Abrir el banco de tests</a></section></main>
<script>
const entrada=document.querySelector("#ruta-apuntes");
const continuar=document.querySelector("#continuar");
const selector=document.querySelector("#elegir-carpeta-boton");
const error=document.querySelector("#error");

selector.addEventListener("click", async () => {
  selector.disabled = true;
  error.hidden = true;
  try {
    const respuesta = await fetch("/abrir-selector-carpeta", { method: "POST" });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || "No se pudo abrir el selector.");
    if (datos.cancelado) {
      document.querySelector("#ruta-guardada").textContent = "No se seleccionó ninguna carpeta. El servicio no se iniciará.";
      return;
    }
    entrada.value = datos.ruta;
    continuar.disabled = false;
    document.querySelector("#ruta-guardada").textContent = "Comprueba que esta es la carpeta raíz correcta.";
  } catch (fallo) {
    error.textContent = fallo.message;
    error.hidden = false;
  } finally {
    selector.disabled = false;
  }
});

document.querySelector("#formulario-carpeta").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!entrada.value.trim()) return;
  continuar.disabled = true;
  selector.disabled = true;
  error.hidden = true;
  try {
    const respuesta = await fetch("/seleccionar-carpeta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ruta: entrada.value.trim() }),
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || "No se pudo usar esta carpeta.");
    document.querySelector("#elegir-carpeta").hidden = true;
    document.querySelector("#progreso-arranque").style.display = "block";
    actualizar();
  } catch (fallo) {
    error.textContent = fallo.message;
    error.hidden = false;
    continuar.disabled = false;
    selector.disabled = false;
  }
});

async function actualizar() {
  try {
    const respuesta = await fetch("/estado", { cache: "no-store" });
    const estado = await respuesta.json();
    document.querySelector("#mensaje").textContent = estado.mensaje;
    document.querySelector("#barra").value = estado.progreso;
    document.querySelector("#porcentaje").textContent = estado.progreso + " %";
    document.querySelector("#detalle").textContent = estado.detalle || "";
    if (estado.registros && estado.registros.length) {
      document.querySelector("#registros-panel").hidden = false;
      document.querySelector("#registros").textContent = estado.registros.join("\n");
    }
    if (estado.error) {
      const errorProgreso = document.createElement("div");
      errorProgreso.className = "error";
      errorProgreso.textContent = estado.error;
      document.querySelector("#progreso-arranque").append(errorProgreso);
    }
    if (estado.listo) {
      const enlace = document.querySelector("#enlace");
      enlace.href = estado.direccion;
      enlace.hidden = false;
      document.querySelector("#barra").value = 100;
      document.querySelector("#porcentaje").textContent = "100 %";
      setTimeout(() => { location.href = estado.direccion; }, 1200);
      return;
    }
  } catch {
    document.querySelector("#mensaje").textContent = "Conectando con el iniciador…";
  }
  setTimeout(actualizar, 800);
}
</script></html>`);
  });
  await new Promise((resolver, rechazar) => {
    servidorProgreso.once("error", rechazar);
    servidorProgreso.listen(0, "127.0.0.1", resolver);
  });
  const direccion = `http://127.0.0.1:${servidorProgreso.address().port}/`;
  abrirNavegador(direccion);
  return carpetaConfirmada;
}

async function guardarCarpetaApuntes(rutaElegida) {
  const ruta = path.resolve(String(rutaElegida ?? "").trim());
  if (!path.isAbsolute(ruta))
    throw new Error("Escribe una ruta absoluta a apuntes-privados.");
  if (!(await stat(ruta)).isDirectory())
    throw new Error(`La carpeta no existe o no es un directorio: ${ruta}`);
  const catalogo = await leerCatalogoApuntes({ raizApuntes: ruta });
  if (!catalogo.asignaturas.length)
    throw new Error("La carpeta no contiene asignaturas con carpetas Tema N y archivos .tex.");

  const entorno = await leerConfiguracionEntorno();
  entorno.set("DIRECTORIO_APUNTES", ruta);
  entorno.set("PUERTO_WEB", entorno.get("PUERTO_WEB") || "8124");
  entorno.set("MODELO_IA", entorno.get("MODELO_IA") || "qwen2.5vl:7b");
  entorno.set("NUM_CTX_IA", entorno.get("NUM_CTX_IA") || "24576");
  entorno.set("TOKENS_MAX_IA", entorno.get("TOKENS_MAX_IA") || "2048");
  entorno.set("TIEMPO_IA", entorno.get("TIEMPO_IA") || "900");
  entorno.set("MAX_CARACTERES_BLOQUE", entorno.get("MAX_CARACTERES_BLOQUE") || "10000");
  const contenido = [
    "# Configuración privada; la genera el acceso directo de Preparar tests.",
    ...[...entorno.entries()].map(([nombre, valor]) =>
      `${nombre}=${nombre === "DIRECTORIO_APUNTES" ? JSON.stringify(valor) : valor}`,
    ),
    "",
  ].join("\n");
  const temporal = `${archivoEntorno}.${process.pid}.tmp`;
  await writeFile(temporal, contenido, { mode: 0o600 });
  await rename(temporal, archivoEntorno);
  return ruta;
}

async function leerConfiguracionEntorno() {
  let contenido;
  try {
    contenido = await readFile(archivoEntorno, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    contenido = await readFile(ejemploEntorno, "utf8");
  }
  return new Map(
    contenido
      .split(/\r?\n/)
      .map((linea) => linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((coincidencia) => {
        const valor = coincidencia[2];
        const descomillado =
          (valor.startsWith('"') && valor.endsWith('"')) ||
          (valor.startsWith("'") && valor.endsWith("'"))
            ? valor.slice(1, -1)
            : valor;
        return [coincidencia[1], descomillado];
      }),
  );
}

function ejecutar(comando, argumentos, { carpeta = raizProyecto, progreso = () => {} } = {}) {
  return new Promise((resolver, rechazar) => {
    let salida = "";
    let errores = "";
    let pendientes = { stdout: "", stderr: "" };
    const proceso = spawn("/usr/bin/sudo", ["-n", comando, ...argumentos], {
      cwd: carpeta,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const consumir = (canal) => (datos) => {
      pendientes[canal] += datos;
      const lineas = pendientes[canal].split(/[\r\n]+/);
      pendientes[canal] = lineas.pop() ?? "";
      for (const lineaBruta of lineas) {
        const linea = limpiarSalida(lineaBruta);
        if (!linea) continue;
        if (canal === "stdout") salida += `${linea}\n`;
        else errores += `${linea}\n`;
        progreso(linea);
      }
    };
    proceso.stdout.setEncoding("utf8");
    proceso.stderr.setEncoding("utf8");
    proceso.stdout.on("data", consumir("stdout"));
    proceso.stderr.on("data", consumir("stderr"));
    proceso.once("error", rechazar);
    proceso.once("close", (codigo) => {
      for (const canal of ["stdout", "stderr"]) {
        const linea = limpiarSalida(pendientes[canal]);
        if (linea) {
          if (canal === "stdout") salida += `${linea}\n`;
          else errores += `${linea}\n`;
          progreso(linea);
        }
      }
      if (codigo === 0) resolver(salida);
      else rechazar(new Error((errores || salida).trim() || `${comando} terminó con código ${codigo}.`));
    });
  });
}

function argumentosCompose(entorno) {
  return [
    "compose",
    "--project-directory",
    raizProyecto,
    "--env-file",
    archivoEntorno,
    "-f",
    archivoCompose,
    ...entorno,
  ];
}

async function ejecutarCompose(entorno, opciones = {}) {
  return ejecutar("docker", argumentosCompose(entorno), opciones);
}

async function comprobarPuertoLibre(puerto) {
  const servidor = net.createServer();
  await new Promise((resolver, rechazar) => {
    servidor.once("error", rechazar);
    servidor.listen(puerto, "127.0.0.1", resolver);
  });
  await new Promise((resolver, rechazar) =>
    servidor.close((error) => (error ? rechazar(error) : resolver())),
  );
}

function progresoDeDocker(mensajeBase, porcentajeBase, amplitud) {
  return (linea) => {
    const detalle = interpretarProgresoDescarga(linea);
    if (detalle) {
      const porcentaje = Number(detalle.match(/\d+/)?.[0] ?? 0);
      actualizarProgreso(
        detalle,
        porcentajeBase + Math.floor((porcentaje / 100) * amplitud),
        linea,
      );
    } else if (
      /pulling|download|verifying|extracting|writing manifest/i.test(linea)
    ) {
      actualizarProgreso(mensajeBase, estado.progreso, linea);
    }
  };
}

async function esperarOllama() {
  for (let intento = 0; intento < 60; intento += 1) {
    try {
      await ejecutar("docker", ["exec", nombreContenedorOllama, "ollama", "list"]);
      return;
    } catch {
      actualizarProgreso("Esperando a que arranque Ollama…", 40);
      await new Promise((resolver) => setTimeout(resolver, 2000));
    }
  }
  throw new Error(
    "Ollama no ha arrancado. Abre el Generador de apuntes y revisa sus registros de Docker.",
  );
}

async function asegurarModelo(entorno) {
  const modelo = entorno.get("MODELO_IA") || "qwen2.5vl:7b";
  if (!/^[a-zA-Z0-9._:/-]+$/.test(modelo))
    throw new Error("MODELO_IA contiene caracteres no válidos.");
  let lista = await ejecutar("docker", [
    "exec",
    nombreContenedorOllama,
    "ollama",
    "list",
  ]);
  if (
    !lista
      .split(/\r?\n/)
      .some((linea) => linea.trim().split(/\s+/)[0] === modelo)
  ) {
    actualizarProgreso(
      `Descargando el modelo ${modelo}… La barra refleja el progreso de Ollama.`,
      55,
      "La primera descarga puede tardar varios minutos; el modelo se reutiliza después.",
    );
    await ejecutar(
      "docker",
      ["exec", nombreContenedorOllama, "ollama", "pull", modelo],
      { progreso: progresoDeDocker(`Descargando el modelo ${modelo}…`, 55, 38) },
    );
    lista = await ejecutar("docker", [
      "exec",
      nombreContenedorOllama,
      "ollama",
      "list",
    ]);
    if (
      !lista
        .split(/\r?\n/)
        .some((linea) => linea.trim().split(/\s+/)[0] === modelo)
    ) {
      throw new Error(`Ollama terminó la descarga, pero no aparece el modelo ${modelo}.`);
    }
  } else {
    actualizarProgreso(`Modelo ${modelo} ya descargado; reutilizando archivos…`, 90);
  }
}

async function esperarServicioListo(puerto, modelo) {
  for (let intento = 0; intento < 90; intento += 1) {
    actualizarProgreso("Comprobando la interfaz, los apuntes y la IA local…", 95);
    try {
      const respuesta = await fetch(`http://127.0.0.1:${puerto}/api/salud`, {
        signal: AbortSignal.timeout(3000),
      });
      const salud = await respuesta.json();
      if (
        respuesta.ok &&
        salud.conectado === true &&
        salud.modeloDisponible === true &&
        salud.modelo === modelo
      ) {
        return;
      }
    } catch {
      // Reintenta mientras termina Docker y se carga el modelo.
    }
    await new Promise((resolver) => setTimeout(resolver, 2000));
  }
  throw new Error(
    "La aplicación no informó del modelo como disponible. Revisa Ollama, la ruta de apuntes y los registros de Docker.",
  );
}

async function iniciar() {
  try {
    const entorno = await leerConfiguracionEntorno();
    const puerto = Number(entorno.get("PUERTO_WEB") || 8124);
    if (!Number.isSafeInteger(puerto) || puerto < 1 || puerto > 65535)
      throw new Error("PUERTO_WEB debe ser un puerto entre 1 y 65535.");
    const direccion = `http://127.0.0.1:${puerto}`;

    // Si el servicio ya está corriendo, abrir directo en navegador
    const saludActual = await fetch(`${direccion}/api/salud`, {
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    if (saludActual?.ok) {
      abrirNavegador(direccion);
      return;
    }

    const rutaInicial =
      entorno.get("DIRECTORIO_APUNTES") ||
      "/home/natalia/Escritorio/apuntes-privados";

    // Si la carpeta de apuntes ya existe y tiene asignaturas válidas, no pedir confirmar carpeta
    let carpetaValida = false;
    try {
      const info = await stat(rutaInicial);
      if (info.isDirectory()) {
        const catalogo = await leerCatalogoApuntes({ raizApuntes: rutaInicial });
        if (catalogo.asignaturas.length > 0) {
          carpetaValida = true;
        }
      }
    } catch {
      carpetaValida = false;
    }

    if (!carpetaValida) {
      actualizarProgreso("Elige la carpeta de apuntes en la página…", 1);
      const seleccionConfirmada = abrirPaginaProgreso(rutaInicial);
      await seleccionConfirmada;
    }

    actualizarProgreso("Comprobando los apuntes y la configuración Docker…", 6);
    const entornoActualizado = await leerConfiguracionEntorno();

    await comprobarPuertoLibre(puerto).catch(() => {
      throw new Error(
        `El puerto ${puerto} está ocupado. No se cambiará automáticamente; cambia PUERTO_WEB en ${archivoEntorno}.`,
      );
    });
    actualizarProgreso("Comprobando Docker y Compose…", 8);
    await ejecutar("docker", ["compose", "version"]);
    await ejecutar("docker", ["info"]);

    await access(composeGenerador);
    await access(entornoGenerador);
    actualizarProgreso(
      "Iniciando o reutilizando Ollama del Generador de apuntes…",
      15,
    );
    await ejecutar(
      "docker",
      [
        "compose",
        "--project-directory",
        path.join(raizGenerador, "docker"),
        "--env-file",
        entornoGenerador,
        "-f",
        composeGenerador,
        "up",
        "-d",
        "ollama",
      ],
      { carpeta: raizGenerador },
    );
    await esperarOllama();

    actualizarProgreso("Validando la configuración del contenedor de tests…", 43);
    await ejecutarCompose(["config", "--quiet"]);
    actualizarProgreso(
      "Construyendo la aplicación JavaScript e iniciando el contenedor…",
      47,
    );
    await ejecutarCompose(["up", "--build", "-d"]);
    actualizarProgreso("Comprobando el modelo de Ollama…", 54);
    await asegurarModelo(entornoActualizado);
    await esperarServicioListo(
      puerto,
      entornoActualizado.get("MODELO_IA") || "qwen2.5vl:7b",
    );

    estado.direccion = direccion;
    estado.listo = true;
    actualizarProgreso("¡Todo listo! Abriendo Preparar tests…", 100);
    abrirNavegador(direccion);
  } catch (error) {
    if (error.cancelado) {
      estado.error = "Se canceló la selección de la carpeta de apuntes.";
      actualizarProgreso("Inicio cancelado.", estado.progreso);
    } else {
      estado.error = error.message;
      actualizarProgreso("No se pudo iniciar Preparar tests.", estado.progreso);
      estado.registros.push(error.message);
    }
  } finally {
    await new Promise((resolver) => setTimeout(resolver, 2200));
    servidorProgreso?.close();
  }
}

iniciar();
