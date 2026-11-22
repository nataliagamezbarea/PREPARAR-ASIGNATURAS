"use strict";

/**
 * Consola en vivo flotante para debugging dentro de la página web.
 * Captura logs, errores, peticiones fetch y variables de estado.
 * Se abre con el botón "🐛 Debug" en la esquina inferior derecha.
 */

const MAX_ENTRADAS = 300;
const entradas = [];
let panelAbierto = false;
let interceptoFetchActivo = false;
let variablesEstado = {};

// Utilidades
function ahora() {
  const now = new Date();
  return now.toLocaleTimeString("es-ES", { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0");
}

function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function valorHTML(valor, profundidad = 0) {
  if (profundidad > 3) return "<span class=" + '"' + "cv-tipo" + '"' + ">(…)</span>";
  if (valor === undefined) return '<span class="cv-undef">undefined</span>';
  if (valor === null) return '<span class="cv-null">null</span>';
  if (typeof valor === "string") return '<span class="cv-str">"' + esc(valor) + '"</span>';
  if (typeof valor === "number") return '<span class="cv-num">' + esc(valor) + "</span>";
  if (typeof valor === "boolean") return '<span class="cv-bool">' + valor + "</span>";
  if (Array.isArray(valor)) {
    const items = valor.slice(0, 5).map((v) => valorHTML(v, profundidad + 1)).join(", ");
    return '<span class="cv-tipo">Array</span>[ ' + items + (valor.length > 5 ? " …" : "") + " ]";
  }
  if (typeof valor === "object") {
    const claves = Object.keys(valor).slice(0, 5);
    const pares = claves.map((k) => "<b>" + esc(k) + "</b>:" + valorHTML(valor[k], profundidad + 1)).join(", ");
    return '<span class="cv-tipo">Object</span>{ ' + pares + (Object.keys(valor).length > 5 ? " …" : "") + " }";
  }
  return '<span class="cv-tipo">' + typeof valor + "</span>";
}

function añadirEntrada(tipo, mensaje, detalle) {
  const entrada = {
    id: Date.now() + Math.random(),
    tiempo: ahora(),
    tipo, // log, error, warn, fetch, estado
    mensaje: esc(String(mensaje ?? "")),
    detalle: detalle ? valorHTML(detalle) : "",
  };
  entradas.push(entrada);
  if (entradas.length > MAX_ENTRADAS) entradas.shift();
  if (panelAbierto) renderizar();
  return entrada;
}

// Sobrescribir consola
const consoleOriginalLog = console.log;
const consoleOriginalError = console.error;
const consoleOriginalWarn = console.warn;

console.log = function (...args) {
  consoleOriginalLog.apply(console, args);
  añadirEntrada("log", args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "), args.length === 1 ? args[0] : args);
};
console.error = function (...args) {
  consoleOriginalError.apply(console, args);
  añadirEntrada("error", args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "), args.length === 1 ? args[0] : args);
};
console.warn = function (...args) {
  consoleOriginalWarn.apply(console, args);
  añadirEntrada("warn", args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "), args.length === 1 ? args[0] : args);
};

// Capturar errores globales
window.addEventListener("error", (evento) => {
  añadirEntrada("error", "Error global: " + esc(evento.message), { archivo: evento.filename, linea: evento.lineno, columna: evento.colno });
});

window.addEventListener("unhandledrejection", (evento) => {
  añadirEntrada("error", "Promesa rechazada: " + esc(String(evento.reason ?? evento)), { reason: evento.reason });
});

// Interceptar fetch para mostrar peticiones API
const fetchOriginal = window.fetch;
window.fetch = async function (...args) {
  const url = String(args[0]);
  const opciones = args[1] || {};
  const inicio = performance.now();
  const metodo = (opciones.method || "GET").toUpperCase();

  añadirEntrada("fetch", metodo + " " + esc(url), { metodo, url, opciones: opciones.body ? "con cuerpo" : "sin cuerpo" });

  try {
    const respuesta = await fetchOriginal.apply(this, args);
    const duracion = Math.round(performance.now() - inicio);
    añadirEntrada("fetch", metodo + " " + esc(url) + " → " + respuesta.status, { metodo, url, status: respuesta.status, duracion: duracion + " ms" });
    return respuesta;
  } catch (error) {
    const duracion = Math.round(performance.now() - inicio);
    añadirEntrada("error", "Fetch falló: " + esc(url), { error: error?.message ?? String(error), duracion: duracion + " ms" });
    throw error;
  }
};

// API pública para registrar variables de estado
window.cv = {
  setEstado: (clave, valor) => {
    variablesEstado[clave] = valor;
    if (panelAbierto) renderizarEstado();
  },
  log: (...args) => {
    añadirEntrada("log", args.map((a) => String(a)).join(" "));
  },
  error: (...args) => {
    añadirEntrada("error", args.map((a) => String(a)).join(" "));
  },
  limpiar: () => {
    entradas.length = 0;
    if (panelAbierto) renderizar();
  },
  obtenerEntradas: () => [...entradas],
  toggle: () => {
    panelAbierto = !panelAbierto;
    const panel = document.getElementById("cv-panel");
    if (panel) panel.style.display = panelAbierto ? "flex" : "none";
    if (panelAbierto) renderizar();
    return panelAbierto;
  },
  abrir: () => {
    panelAbierto = true;
    const panel = document.getElementById("cv-panel");
    if (panel) panel.style.display = "flex";
    renderizar();
  },
  cerrar: () => {
    panelAbierto = false;
    const panel = document.getElementById("cv-panel");
    if (panel) panel.style.display = "none";
  },
};

// Crear panel flotante
function crearPanel() {
  if (document.getElementById("cv-panel")) return;

  const overlay = document.createElement("div");
  overlay.id = "cv-overlay";
  overlay.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 999999;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  `;

  const btnToggle = document.createElement("button");
  btnToggle.id = "cv-toggle";
  btnToggle.type = "button";
  btnToggle.innerHTML = "🐛 Debug";
  btnToggle.style.cssText = `
    display: none;
  `;

  const panel = document.createElement("div");
  panel.id = "cv-panel";
  panel.style.cssText = `
    display: none;
    position: fixed;
    bottom: 50px;
    right: 10px;
    width: 420px;
    max-height: 520px;
    background: #0f172a;
    color: #e2e8f0;
    border: 1px solid #334155;
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    flex-direction: column;
    overflow: hidden;
    z-index: 1000000;
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = `
    background: #1e293b;
    padding: 8px 12px;
    border-bottom: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  header.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px;">
      <span style="color:#22d3ee; font-weight:700;">🐛 Consola en vivo</span>
      <span id="cv-contador" style="background:#334155; padding:2px 6px; border-radius:8px; font-size:10px;">0</span>
    </div>
    <div style="display:flex; gap:6px;">
      <button id="cv-reiniciar" type="button" style="background:#166534; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;">🔄 Reiniciar log</button>
      <button id="cv-reiniciar-app" type="button" style="background:#14532d; color:#fff; border:none; border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;">🗑️ Reiniciar app</button>
      <button id="cv-limpiar" type="button" style="background:transparent; color:#94a3b8; border:1px solid #334155; border-radius:6px; padding:4px 8px; cursor:pointer; font-size:11px;">Limpiar</button>
      <button id="cv-cerrar" type="button" style="background:#dc2626; color:#fff; border:none; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:11px;">✕</button>
    </div>
  `;

  // Contenido con pestañas
  const contenido = document.createElement("div");
  contenido.style.cssText = `
    display: flex;
    flex-direction: column;
    height: calc(100% - 42px);
    overflow: hidden;
  `;

  const pestañas = document.createElement("div");
  pestañas.style.cssText = `
    display: flex;
    border-bottom: 1px solid #334155;
  `;
  pestañas.innerHTML = `
    <button id="cv-tab-logs" type="button" class="cv-tab active" data-tab="logs" style="flex:1; background:transparent; color:#94a3b8; border:none; border-bottom:2px solid #22d3ee; padding:8px; cursor:pointer; font-size:11px;">Logs</button>
    <button id="cv-tab-estado" type="button" class="cv-tab" data-tab="estado" style="flex:1; background:transparent; color:#94a3b8; border:none; padding:8px; cursor:pointer; font-size:11px;">Estado</button>
  `;

  const areaLogs = document.createElement("div");
  areaLogs.id = "cv-area-logs";
  areaLogs.style.cssText = `
    flex:1;
    overflow-y: auto;
    padding: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.4;
    background: #020617;
  `;

  const areaEstado = document.createElement("div");
  areaEstado.id = "cv-area-estado";
  areaEstado.style.cssText = `
    display: none;
    flex:1;
    overflow-y: auto;
    padding: 10px;
    background: #020617;
  `;

  contenido.append(pestañas, areaLogs, areaEstado);
  panel.append(header, contenido);
  overlay.append(btnToggle, panel);
  document.body.append(overlay);

  // Eventos
  btnToggle.addEventListener("click", () => {
    panelAbierto = !panelAbierto;
    panel.style.display = panelAbierto ? "flex" : "none";
    if (panelAbierto) renderizar();
  });

  document.getElementById("cv-cerrar").addEventListener("click", () => {
    panelAbierto = false;
    panel.style.display = "none";
  });

  document.getElementById("cv-reiniciar").addEventListener("click", () => {
    entradas.length = 0;
    variablesEstado = {};
    renderizar();
    renderizarEstado();
    if (window.cv) window.cv.log("Panel de debug reiniciado (entradas y estado borrados)");
  });

  // Botón Reiniciar Preparar Tests: borra todo el estado del navegador y recarga
  document.getElementById("cv-reiniciar-app").addEventListener("click", () => {
    if (confirm("¿Reiniciar Preparar Tests? Esto borrará TODO el progreso guardado (fallos, historial, sesiones) y recargará la página.\n\n¡No se podrá recuperar!")) {
      // Borrar todas las claves de localStorage relacionadas con la app
      const clavesApp = [
        "wec12_session_v1", "wec12_wrong_v1", "wec12_history_v1", "wec12_stats_v1", "wec12_theme_v1",
        "preparar-tests.explicaciones-ia", "preparar-tests.borradores",
        "preparar-tests.persistency", "preparar-tests.block-pointers"
      ];
      clavesApp.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      // También borrar sessionStorage y cualquier otra cosa
      try { sessionStorage.clear(); } catch (e) {}
      try { localStorage.clear(); } catch (e) {}
      window.location.reload();
    }
  });

  document.getElementById("cv-limpiar").addEventListener("click", () => {
    entradas.length = 0;
    renderizar();
  });

  document.querySelectorAll(".cv-tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".cv-tab").forEach((x) => {
        x.classList.remove("active");
        x.style.color = "#94a3b8";
        x.style.borderBottom = "none";
      });
      t.classList.add("active");
      t.style.color = "#22d3ee";
      t.style.borderBottom = "2px solid #22d3ee";
      const tab = t.dataset.tab;
      areaLogs.style.display = tab === "logs" ? "block" : "none";
      areaEstado.style.display = tab === "estado" ? "block" : "none";
      if (tab === "logs") renderizar();
      else renderizarEstado();
    });
  });
}

function claseTipo(tipo) {
  switch (tipo) {
    case "error": return "cv-err";
    case "warn": return "cv-warn";
    case "fetch": return "cv-fetch";
    default: return "cv-log";
  }
}

function iconoTipo(tipo) {
  switch (tipo) {
    case "error": return "❌";
    case "warn": return "⚠️";
    case "fetch": return "🌐";
    default: return "📝";
  }
}

function renderizar() {
  const area = document.getElementById("cv-area-logs");
  const contador = document.getElementById("cv-contador");
  if (!area) return;
  contador.textContent = entradas.length;
  area.innerHTML = entradas.map((e) => `
    <div style="margin-bottom:8px; border-left:3px solid ${e.tipo === "error" ? "#ef4444" : e.tipo === "warn" ? "#f59e0b" : e.tipo === "fetch" ? "#22d3ee" : "#94a3b8"}; padding:6px 8px; background:#0f172a; border-radius:6px;">
      <div style="display:flex; justify-content:space-between; gap:8px; font-size:10px; color:#64748b; margin-bottom:2px;">
        <span>${e.tiempo}</span>
        <span class="${claseTipo(e.tipo)}">${iconoTipo(e.tipo)} ${e.tipo.toUpperCase()}</span>
      </div>
      <div style="color:#e2e8f0; word-break: break-all;">${e.mensaje}</div>
      ${e.detalle ? `<div style="margin-top:4px; font-size:10px; color:#94a3b8;">${e.detalle}</div>` : ""}
    </div>
  `).join("");
  area.scrollTop = area.scrollHeight;
}

function renderizarEstado() {
  const area = document.getElementById("cv-area-estado");
  if (!area) return;
  const claves = Object.keys(variablesEstado);
  area.innerHTML = claves.length
    ? claves.map((clave) => `
      <div style="margin-bottom:8px; padding:6px 8px; background:#0f172a; border-radius:6px; border-left:3px solid #22d3ee;">
        <div style="font-size:10px; color:#64748b; margin-bottom:2px;">${esc(clave)}</div>
        <div style="color:#e2e8f0; word-break: break-all;">${valorHTML(variablesEstado[clave])}</div>
      </div>
    `).join("")
    : '<div style="padding:10px; color:#64748b; font-size:11px;">No hay variables de estado registradas. Usa window.cv.setEstado("nombre", valor) desde tu código.</div>';
}

// Inicializar cuando el DOM esté listo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", crearPanel);
} else {
  crearPanel();
}
