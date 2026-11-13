const claveSeleccionGuardada = "preparar-tests.seleccion-apuntes";
const claveConfiguracionGuardada = "preparar-tests.configuracion-apuntes";
const claveTareaActiva = "preparar-tests.generacion-activa";
let catalogoApuntes = null;
let bancosPreguntas = [];
let tareaActual = "";
let temporizadorProgreso = 0;
let controladoresPantalla = [];
let ultimaRevision = "";
let ultimaAsignaturaConfigurada = "";

function actualizarNotificacionGeneracion(activa) {
  const boton = document.querySelector("#generation-notification");
  if (!boton) return;
  boton.classList.toggle("hidden", !activa);
  boton.setAttribute(
    "aria-label",
    activa
      ? "Hay una generación en curso; ver progreso"
      : "No hay ninguna generación en curso",
  );
}

document
  .querySelector("#generation-notification")
  ?.addEventListener("click", () => {
    if (!tareaActual) return;
    window.abrirPracticaDesdeApuntes?.();
    window.requestAnimationFrame(() =>
      document.querySelector("#apuntes-progreso")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }),
    );
  });

window.addEventListener("storage", (evento) => {
  if (evento.key === claveTareaActiva && evento.newValue) {
    void recuperarGeneracion(evento.newValue);
  } else if (evento.key === claveTareaActiva && !evento.newValue && !tareaActual) {
    actualizarNotificacionGeneracion(false);
  }
});

function escaparHTML(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function consultarAPI(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    cache: "no-store",
    ...opciones,
    headers: {
      ...(opciones.body ? { "content-type": "application/json" } : {}),
      ...opciones.headers,
    },
  });
  let datos;
  try {
    datos = await respuesta.json();
  } catch {
    throw new Error(`El servidor devolvió una respuesta no válida (${respuesta.status}).`);
  }
  if (!respuesta.ok)
    throw Object.assign(
      new Error(datos.error || `La operación falló (${respuesta.status}).`),
      { status: respuesta.status },
    );
  return datos;
}

function leerSeleccionGuardada() {
  try {
    const seleccion = JSON.parse(localStorage.getItem(claveSeleccionGuardada) || "null");
    return seleccion && typeof seleccion === "object" ? seleccion : {};
  } catch {
    return {};
  }
}

function leerSeleccionPorAsignatura(asignatura) {
  try {
    const selecciones = JSON.parse(
      localStorage.getItem("preparar-tests.selecciones-por-asignatura") || "{}",
    );
    return selecciones[asignatura] ?? {};
  } catch {
    return {};
  }
}

async function exportarBancoGuardado() {
  const temas = obtenerTemasSeleccionados();
  const todos = document.querySelector("#seleccionar-todos-temas")?.checked;
  const parametroTemas = todos ? "todos" : temas.join(",");
  try {
    const banco = await consultarAPI(
      `/api/banco?asignatura=${encodeURIComponent(valorSeleccionado("#apuntes-asignatura"))}&tema=${temas.length === 1 ? temas[0] : 0}&temas=${encodeURIComponent(parametroTemas)}&apartado=${Number(valorSeleccionado("#apuntes-apartado") || 0)}`,
    );
    const archivo = new Blob([`${JSON.stringify(banco, null, 2)}\n`], {
      type: "application/json",
    });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = `${banco.meta.asignatura}-temas-${(banco.meta.temas ?? []).join("-")}-preguntas.json`
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  } catch (error) {
    mostrarMensaje(error.message, "error");
  }
}

function leerConfiguracionesGuardadas() {
  try {
    const configuraciones = JSON.parse(
      localStorage.getItem(claveConfiguracionGuardada) || "{}",
    );
    return configuraciones && typeof configuraciones === "object"
      ? configuraciones
      : {};
  } catch {
    return {};
  }
}

function guardarConfiguracion() {
  const asignatura = valorSeleccionado("#apuntes-asignatura");
  if (!asignatura) return;
  const configuraciones = leerConfiguracionesGuardadas();
  configuraciones[asignatura] = {
    cantidad: Number(valorSeleccionado("#cantidad-apuntes-tests")) || 10,
    simultaneos: Math.max(1, Math.min(10, Number(valorSeleccionado("#simultaneos-apuntes-tests")) || 1)),
    modoExamen:
      valorSeleccionado('input[name="modo-examen-apuntes"]:checked') ||
      "predeterminado",
    contextoExamen: valorSeleccionado("#contexto-examen-apuntes"),
    tipoPreguntas: valorSeleccionado("#tipo-apuntes-tests") || "mixto",
    desgloseActivo: Boolean(document.querySelector("#activar-desglose-tipos")?.checked),
    cantTest: Number(valorSeleccionado("#cant-test-estandar")) || 6,
    cantEscribir: Number(valorSeleccionado("#cant-escribir-codigo")) || 4,
    buscarInternet: Boolean(document.querySelector("#activar-busqueda-internet")?.checked),
  };
  try {
    localStorage.setItem(
      claveConfiguracionGuardada,
      JSON.stringify(configuraciones),
    );
  } catch {
    mostrarMensaje("No se pudo guardar la configuración en este navegador.", "aviso");
  }
}

function restaurarConfiguracion(asignatura) {
  const configuracionGuardada = leerConfiguracionesGuardadas()[asignatura];
  if (!configuracionGuardada) {
    const campo = document.querySelector("#campo-contexto-examen");
    if (campo) {
      campo.setAttribute("hidden", "");
      campo.style.setProperty("display", "none", "important");
    }
    const panelDes = document.querySelector("#panel-desglose");
    if (panelDes) {
      panelDes.setAttribute("hidden", "");
      panelDes.style.setProperty("display", "none", "important");
    }
    return;
  }
  const cantidad = document.querySelector("#cantidad-apuntes-tests");
  if (cantidad) {
    cantidad.value = String(
      Math.min(7000, Math.max(1, Number(configuracionGuardada.cantidad) || 10)),
    );
  }
  const inputSim = document.querySelector("#simultaneos-apuntes-tests");
  if (inputSim && configuracionGuardada.simultaneos) {
    inputSim.value = String(Math.max(1, Math.min(10, Number(configuracionGuardada.simultaneos) || 1)));
  }
  const modo = [...document.querySelectorAll('input[name="modo-examen-apuntes"]')]
    .find((opcion) => opcion.value === configuracionGuardada.modoExamen);
  if (modo) modo.checked = true;
  const textarea = document.querySelector("#contexto-examen-apuntes");
  if (textarea) textarea.value = configuracionGuardada.contextoExamen || "";
  const tipo = document.querySelector("#tipo-apuntes-tests");
  if (tipo) tipo.value = configuracionGuardada.tipoPreguntas || "mixto";

  const esPersonalizado = configuracionGuardada.modoExamen === "personalizado";
  const campoContexto = document.querySelector("#campo-contexto-examen");
  if (campoContexto) {
    if (esPersonalizado) {
      campoContexto.removeAttribute("hidden");
      campoContexto.style.setProperty("display", "grid", "important");
    } else {
      campoContexto.setAttribute("hidden", "");
      campoContexto.style.setProperty("display", "none", "important");
    }
  }
  const panelDesglose = document.querySelector("#panel-desglose");
  if (panelDesglose) {
    if (esPersonalizado) {
      panelDesglose.removeAttribute("hidden");
      panelDesglose.style.setProperty("display", "block", "important");
    } else {
      panelDesglose.setAttribute("hidden", "");
      panelDesglose.style.setProperty("display", "none", "important");
    }
  }

  const contador = document.querySelector("#contador-caracteres");
  if (contador && textarea) {
    const len = textarea.value.trim().length;
    contador.textContent = `${len} / 10 mín.`;
    contador.classList.toggle("valido", len >= 10);
  }

  const checkDesglose = document.querySelector("#activar-desglose-tipos");
  const camposDesglose = document.querySelector("#campos-desglose");
  const inputTest = document.querySelector("#cant-test-estandar");
  const inputEscribir = document.querySelector("#cant-escribir-codigo");
  const chipTotal = document.querySelector("#desglose-suma-total");
  if (checkDesglose) {
    checkDesglose.checked = Boolean(configuracionGuardada.desgloseActivo !== false);
    if (camposDesglose) camposDesglose.hidden = !checkDesglose.checked;
    if (inputTest && configuracionGuardada.cantTest !== undefined) {
      inputTest.value = String(configuracionGuardada.cantTest);
    }
    if (inputEscribir && configuracionGuardada.cantEscribir !== undefined) {
      inputEscribir.value = String(configuracionGuardada.cantEscribir);
    }
    if (chipTotal) {
      const sum = (Number(inputTest?.value) || 0) + (Number(inputEscribir?.value) || 0);
      chipTotal.textContent = checkDesglose.checked ? `Total: ${sum}` : `Total: ${cantidad?.value || 10}`;
    }
  }

  const checkInternet = document.querySelector("#activar-busqueda-internet");
  if (checkInternet) {
    checkInternet.checked = Boolean(configuracionGuardada.buscarInternet);
  }
}

function obtenerTemasSeleccionados() {
  return [...document.querySelectorAll(".tema-seleccionado:checked")].map(
    (control) => Number(control.value),
  );
}

function guardarSeleccion() {
  const temas = obtenerTemasSeleccionados();
  const seleccion = {
    asignatura: document.querySelector("#apuntes-asignatura")?.value || "",
    tema: temas.length === 1 ? String(temas[0]) : "",
    temas,
    apartado: document.querySelector("#apuntes-apartado")?.value || "0",
  };
  try {
    localStorage.setItem(claveSeleccionGuardada, JSON.stringify(seleccion));
    const selecciones = JSON.parse(
      localStorage.getItem("preparar-tests.selecciones-por-asignatura") || "{}",
    );
    selecciones[seleccion.asignatura] = seleccion;
    localStorage.setItem(
      "preparar-tests.selecciones-por-asignatura",
      JSON.stringify(selecciones),
    );
  } catch {
    mostrarMensaje("No se pudo guardar la selección en este navegador.", "aviso");
  }
}

function obtenerTemaSeleccionado() {
  const temasSeleccionados = obtenerTemasSeleccionados();
  if (temasSeleccionados.length !== 1) return null;
  return catalogoApuntes?.asignaturas
    .find((asignatura) => asignatura.nombre === valorSeleccionado("#apuntes-asignatura"))
    ?.temas.find((tema) => tema.numero === temasSeleccionados[0]);
}

function valorSeleccionado(selector) {
  return document.querySelector(selector)?.value || "";
}

function obtenerBancoSeleccionado() {
  const asignatura = valorSeleccionado("#apuntes-asignatura");
  const temas = obtenerTemasSeleccionados().sort((a, b) => a - b);
  const apartado = Number(valorSeleccionado("#apuntes-apartado") || 0);
  return bancosPreguntas.find(
    (banco) =>
      banco.asignatura === asignatura &&
      JSON.stringify([...(banco.temas ?? (banco.tema ? [banco.tema] : []))].sort((a, b) => a - b)) ===
        JSON.stringify(temas) &&
      banco.apartado === apartado,
  );
}

function actualizarCabeceraAsignatura(asignatura) {
  if (!asignatura) return;
  const nombre = asignatura.nombre;
  const titulo = document.querySelector("#brand-title");
  if (titulo) titulo.textContent = nombre;
  const logo = document.querySelector("#brand-logo");
  if (logo) {
    logo.textContent =
      nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((parte) => parte[0]).join("").toUpperCase() ||
      "T";
  }
  const subtitulo = document.querySelector("#brand-sub");
  if (subtitulo)
    subtitulo.textContent = `${asignatura.temas.length} temas · Tests desde apuntes`;
  document.title = `${nombre} · Tests desde apuntes`;
}

function actualizarResumenSeleccion() {
  const temasSeleccionados = obtenerTemasSeleccionados();
  const asignatura = catalogoApuntes?.asignaturas.find(
    (elemento) => elemento.nombre === valorSeleccionado("#apuntes-asignatura"),
  );
  actualizarCabeceraAsignatura(asignatura);
  const temas = asignatura?.temas.filter((tema) =>
    temasSeleccionados.includes(tema.numero),
  ) ?? [];
  const resumen = document.querySelector("#apuntes-resumen");
  if (!resumen) return;
  if (!temas.length) {
    resumen.innerHTML = `
      <span class="apuntes-chip">${escaparHTML(asignatura?.nombre || "Asignatura")}</span>
      <span class="apuntes-ruta">${asignatura ? "Selecciona uno o varios temas para continuar." : "Selecciona una asignatura para ver sus temas."}</span>`;
    ultimaRevision = "";
    document.querySelector("#generar-apuntes-tests").disabled = true;
    document.querySelector("#practicar-banco-apuntes").disabled = true;
    return;
  }
  const tema = obtenerTemaSeleccionado();
  const apartado = Number(valorSeleccionado("#apuntes-apartado") || 0);
  const elemento = apartado
    ? tema?.apartados.find((item) => item.numero === apartado)
    : null;
  const revision = temas.length === 1
    ? apartado ? elemento?.revision : tema?.revision
    : temas.every((item) => item.revision) ? "seleccion-multiple" : "";
  const banco = obtenerBancoSeleccionado();
  const cambios = banco?.apuntesActualizados;
  resumen.innerHTML = `
    ${temas.map((temaElegido) => `<span class="apuntes-chip">${escaparHTML(temaElegido.nombre)}</span>`).join("")}
    ${elemento ? `<span class="apuntes-chip">${escaparHTML(elemento.nombre)}</span>` : '<span class="apuntes-chip">Tema completo</span>'}
    ${temas.length === 1 && tema?.apartados.length ? `<span class="apuntes-chip">${tema.apartados.length} apartados</span>` : ""}
    ${banco ? `<span class="apuntes-chip ${cambios ? "aviso" : "correcto"}">${banco.total} preguntas guardadas${cambios ? " · apuntes actualizados" : ""}</span>` : '<span class="apuntes-chip">Aún sin test guardado</span>'}
    <span class="apuntes-ruta">${revision ? "Selección leída de tus archivos .tex privados" : "No se encontró la revisión de los apuntes"}</span>`;
  ultimaRevision = revision || "";
  const generar = document.querySelector("#generar-apuntes-tests");
  if (generar) generar.disabled = !revision || Boolean(tareaActual);
  // Botón de practicar desactivado/oculto - solo exportar JSON
  const practicar = document.querySelector("#practicar-banco-apuntes");
  if (practicar) {
    practicar.style.display = "none";
    practicar.disabled = true;
  }
  const exportar = document.querySelector("#exportar-banco-apuntes");
  if (exportar) exportar.disabled = false;

  actualizarDashboardApartados();
}

function actualizarDashboardApartados(progreso = null) {
  const seccionDashboard = document.querySelector("#apuntes-dashboard-seccion");
  const lista = document.querySelector("#dashboard-lista-subsecciones");
  const resumenChip = document.querySelector("#dashboard-resumen-subs");
  const desc = document.querySelector("#dashboard-descripcion");
  if (!seccionDashboard || !lista) return;

  // Si hay progreso activo de generación, renderizar el estado en vivo de las subsecciones
  if (progreso && Array.isArray(progreso.subsecciones) && progreso.subsecciones.length) {
    const totalSubs = progreso.subsecciones.length;
    const completadas = progreso.subsecciones.filter((s) => s.estado === "completado").length;
    if (resumenChip) {
      resumenChip.textContent = `Generando: ${completadas} / ${totalSubs} subsecciones completadas`;
      resumenChip.className = "apuntes-chip aviso";
    }
    if (desc) {
      desc.textContent = "Progreso en tiempo real con Ollama local. Cada subsección se analiza y transforma según el temario.";
    }
    lista.innerHTML = progreso.subsecciones.map((sub, idx) => {
      const estadoClase = sub.estado === "completado" ? "completado" : (sub.estado === "en_progreso" ? "en-progreso" : "pendiente");
      const estadoTexto = sub.estado === "completado" ? "✓ Completado" : (sub.estado === "en_progreso" ? "⚡ Generando preguntas…" : "⏳ En cola");
      const pctSub = sub.totalEjemplos > 0
        ? Math.round((sub.ejemplosCubiertos / sub.totalEjemplos) * 100)
        : (sub.estado === "completado" ? 100 : (sub.generadas > 0 ? 50 : 0));
      return `
        <div class="subseccion-item ${estadoClase}">
          <div class="subseccion-header">
            <span class="subseccion-num">${sub.tema ? `T${sub.tema}.${sub.apartado || idx + 1}` : `#${idx + 1}`}</span>
            <span class="subseccion-nombre" title="${escaparHTML(sub.nombre)}">${escaparHTML(sub.nombre)}</span>
            <span class="subseccion-badge ${estadoClase}">${estadoTexto}</span>
          </div>
          <div class="subseccion-barra-wrap">
            <div class="subseccion-barra" style="width: ${pctSub}%"></div>
          </div>
          <div class="subseccion-datos">
            <span><b>${sub.generadas}</b> preg. nuevas</span>
            ${sub.totalEjemplos > 0 ? `<span><b>${sub.ejemplosCubiertos}/${sub.totalEjemplos}</b> ejemplos</span>` : `<span>Conceptos teóricos</span>`}
          </div>
        </div>`;
    }).join("");
    return;
  }

  // Al inicio / reposo: renderizar todos los apartados de los temas seleccionados
  const temasSeleccionados = obtenerTemasSeleccionados();
  const asignatura = catalogoApuntes?.asignaturas.find(
    (elemento) => elemento.nombre === valorSeleccionado("#apuntes-asignatura"),
  );
  const temas = asignatura?.temas.filter((t) => temasSeleccionados.includes(t.numero)) ?? [];
  const apartadoActivo = Number(valorSeleccionado("#apuntes-apartado") || 0);

  const todosApartados = [];
  for (const t of temas) {
    if (t.apartados && t.apartados.length) {
      for (const ap of t.apartados) {
        todosApartados.push({
          tema: t.numero,
          temaNombre: t.nombre,
          numero: ap.numero,
          nombre: ap.nombre,
          revision: ap.revision,
        });
      }
    } else {
      todosApartados.push({
        tema: t.numero,
        temaNombre: t.nombre,
        numero: 0,
        nombre: `${t.nombre} (completo)`,
        revision: t.revision,
      });
    }
  }

  if (resumenChip) {
    resumenChip.textContent = `${todosApartados.length} apartados detectados`;
    resumenChip.className = "apuntes-chip correcto";
  }
  if (desc) {
    desc.textContent = "Todos los apartados leídos de tus apuntes LaTeX. Haz clic en cualquiera para enfocar la práctica o preparar el examen.";
  }

  if (!todosApartados.length) {
    lista.innerHTML = `
      <div class="empty-state-card" style="grid-column: 1 / -1; padding: 20px; text-align: center; color: var(--muted);">
        <p>Selecciona una asignatura y al menos un tema arriba para ver sus apartados y subsecciones.</p>
      </div>`;
    return;
  }

  lista.innerHTML = todosApartados.map((item) => {
    const esSeleccionado = (temas.length === 1 && apartadoActivo === item.numero) || (apartadoActivo === 0 && todosApartados.length === 1);
    const badgeTexto = esSeleccionado ? "🎯 Seleccionado" : "📄 Apartado listo";
    const badgeClase = esSeleccionado ? "en-progreso" : "completado";
    return `
      <div class="subseccion-item ${esSeleccionado ? "seleccionado" : ""}" data-tema="${item.tema}" data-apartado="${item.numero}">
        <div class="subseccion-header">
          <span class="subseccion-num">T${item.tema}.${item.numero || 1}</span>
          <span class="subseccion-nombre" title="${escaparHTML(item.nombre)}">${escaparHTML(item.nombre)}</span>
          <span class="subseccion-badge ${badgeClase}">${badgeTexto}</span>
        </div>
        <div class="subseccion-datos">
          <span>${escaparHTML(item.temaNombre || `Tema ${item.tema}`)}</span>
          <span>LaTeX disponible</span>
        </div>
      </div>`;
  }).join("");

  for (const itemCard of lista.querySelectorAll(".subseccion-item")) {
    itemCard.addEventListener("click", () => {
      const apartadoNum = String(itemCard.getAttribute("data-apartado") || "0");
      const selectorApartado = document.querySelector("#apuntes-apartado");
      if (temasSeleccionados.length === 1 && selectorApartado) {
        selectorApartado.value = apartadoNum;
        guardarSeleccion();
        actualizarResumenSeleccion();
      }
    });
  }
}

function reconstruirApartados(valorGuardado = "") {
  const tema = obtenerTemaSeleccionado();
  const selector = document.querySelector("#apuntes-apartado");
  if (!selector) return;
  const elementos = tema?.apartados ?? [];
  selector.disabled = !tema;
  selector.innerHTML =
    '<option value="0">Tema completo</option>' +
    (elementos.length
      ? ""
      : '<option value="" disabled>Sin apartados .tex independientes</option>') +
    elementos
      .map(
        (apartado) =>
          `<option value="${apartado.numero}">Apartado ${tema.numero}.${apartado.numero} · ${escaparHTML(apartado.nombre)}</option>`,
      )
      .join("");
  selector.value = elementos.some(
    (apartado) => String(apartado.numero) === valorGuardado,
  )
    ? valorGuardado
    : "0";
}

function reconstruirTemas(temasGuardados = [], apartadoGuardado = "0") {
  const asignatura = catalogoApuntes?.asignaturas.find(
    (elemento) => elemento.nombre === valorSeleccionado("#apuntes-asignatura"),
  );
  const selector = document.querySelector("#apuntes-lista-temas");
  if (!selector) return;
  const temas = asignatura?.temas ?? [];
  const seleccionarTodosPorDefecto =
    asignatura?.nombre.trim().toLocaleUpperCase("es") === "WEC";
  const temasPrevios = Array.isArray(temasGuardados)
    ? temasGuardados.map(Number)
    : temasGuardados
      ? [Number(temasGuardados)]
      : [];
  const seleccionInicial = seleccionarTodosPorDefecto
    ? temas.map((tema) => tema.numero)
    : temasPrevios.length
      ? temasPrevios
      : temas.some((tema) => tema.numero === Number(temasGuardados))
        ? [Number(temasGuardados)]
        : [temas[0]?.numero].filter(Boolean);
  selector.innerHTML = temas.length
    ? `<label class="apuntes-tema todos"><input id="seleccionar-todos-temas" type="checkbox" ${temas.every((tema) => seleccionInicial.includes(tema.numero)) ? "checked" : ""}><span>Todos los temas</span></label>${temas
        .map(
          (tema) =>
            `<label class="apuntes-tema"><input class="tema-seleccionado" type="checkbox" value="${tema.numero}" ${seleccionInicial.includes(tema.numero) ? "checked" : ""}><span>${escaparHTML(tema.nombre)} <small>${tema.apartados.length} apartados</small></span></label>`,
        )
        .join("")}`
    : '<span class="apuntes-ruta">No se detectaron temas con archivos .tex.</span>';
  selector.setAttribute("aria-label", `Temas de ${asignatura?.nombre || "la asignatura"}`);
  const seleccionarTodos = document.querySelector("#seleccionar-todos-temas");
  seleccionarTodos?.addEventListener("change", () => {
    for (const control of selector.querySelectorAll(".tema-seleccionado"))
      control.checked = seleccionarTodos.checked;
    reconstruirApartados();
    guardarSeleccion();
    actualizarResumenSeleccion();
  });
  for (const control of selector.querySelectorAll(".tema-seleccionado")) {
    control.addEventListener("change", () => {
      const todosSeleccionados = [...selector.querySelectorAll(".tema-seleccionado")].every(
        (elemento) => elemento.checked,
      );
      seleccionarTodos.checked = todosSeleccionados;
      seleccionarTodos.indeterminate =
        !todosSeleccionados && obtenerTemasSeleccionados().length > 0;
      reconstruirApartados();
      guardarSeleccion();
      actualizarResumenSeleccion();
    });
  }
  reconstruirApartados(apartadoGuardado);
}

async function recargarDatosApuntes(conservarSeleccion = true) {
  const seleccionAnterior = conservarSeleccion
    ? leerSeleccionGuardada()
    : {};
  const [catalogo, bancos] = await Promise.all([
    consultarAPI("/api/apuntes"),
    consultarAPI("/api/bancos"),
  ]);
  catalogoApuntes = catalogo;
  bancosPreguntas = bancos.bancos;
  const selectorAsignatura = document.querySelector("#apuntes-asignatura");
  if (!selectorAsignatura) return;
  selectorAsignatura.innerHTML = catalogo.asignaturas.length
    ? catalogo.asignaturas
        .map(
          (asignatura) =>
            `<option value="${escaparHTML(asignatura.nombre)}">${escaparHTML(asignatura.nombre)} · ${asignatura.temas.length} temas</option>`,
        )
        .join("")
    : '<option value="">No se encontraron asignaturas</option>';
  selectorAsignatura.disabled = catalogo.asignaturas.length === 0;
  const asignaturaWec = catalogo.asignaturas.find(
    (asignatura) => asignatura.nombre.trim().toLocaleUpperCase("es") === "WEC",
  );
  selectorAsignatura.value =
    asignaturaWec?.nombre ??
    (catalogo.asignaturas.some(
      (asignatura) => asignatura.nombre === seleccionAnterior.asignatura,
    )
      ? seleccionAnterior.asignatura
      : catalogo.asignaturas[0]?.nombre ?? "");
  const seleccionAsignatura =
    leerSeleccionPorAsignatura(selectorAsignatura.value).asignatura ===
    selectorAsignatura.value
      ? leerSeleccionPorAsignatura(selectorAsignatura.value)
      : seleccionAnterior;
  reconstruirTemas(
    Array.isArray(seleccionAsignatura.temas) && seleccionAsignatura.temas.length
      ? seleccionAsignatura.temas
      : String(seleccionAsignatura.tema ?? ""),
    String(seleccionAsignatura.apartado ?? "0"),
  );
  if (ultimaAsignaturaConfigurada !== selectorAsignatura.value) {
    restaurarConfiguracion(selectorAsignatura.value);
    ultimaAsignaturaConfigurada = selectorAsignatura.value;
  }
  guardarSeleccion();
  actualizarResumenSeleccion();
}

function mostrarMensaje(texto, tipo = "aviso") {
  const mensaje = document.querySelector("#apuntes-mensaje");
  if (!mensaje) return;
  mensaje.textContent = texto;
  mensaje.className = `apuntes-mensaje ${tipo}`;
  mensaje.hidden = !texto;
}

function formatearTiempo(segundos) {
  if (segundos === null || segundos === undefined)
    return "Calculando el tiempo con las primeras tandas…";
  if (segundos < 60) return `Quedan unos ${segundos} s`;
  return `Quedan unos ${Math.ceil(segundos / 60)} min`;
}

function renderizarProgreso(progreso) {
  const panel = document.querySelector("#apuntes-progreso");
  if (progreso.terminado) {
    tareaActual = "";
    localStorage.removeItem(claveTareaActiva);
    actualizarNotificacionGeneracion(false);
    const generar = document.querySelector("#generar-apuntes-tests");
    if (generar) generar.disabled = false;
  } else {
    actualizarNotificacionGeneracion(true);
  }
  if (!panel) return;
  panel.hidden = false;
  const barra = document.querySelector("#apuntes-barra");
  const porcentaje = progreso.porcentaje;
  barra.value = porcentaje;
  barra.setAttribute("aria-valuenow", String(porcentaje));
  document.querySelector("#apuntes-porcentaje").textContent = `${porcentaje} %`;
  document.querySelector("#apuntes-fase").textContent = progreso.mensaje;
  document.querySelector("#apuntes-detalle").textContent = progreso.detalle;
  document.querySelector("#apuntes-tiempo").textContent =
    progreso.terminado
      ? "Proceso terminado"
      : formatearTiempo(progreso.etaSegundos);
  document.querySelector("#apuntes-conteo").textContent =
    `${progreso.generadas}/${progreso.total} preguntas nuevas · ${progreso.guardadas} en el banco`;
  document.querySelector("#detener-apuntes-tests").hidden =
    progreso.terminado || progreso.fase === "guardando";

  // Actualizar dashboard interactivo de subsecciones
  actualizarDashboardApartados(progreso);
  if (progreso.terminado) {
    document.querySelector("#detener-apuntes-tests").hidden = true;
    if (progreso.cancelado) {
      mostrarMensaje(progreso.detalle, "aviso");
    } else if (progreso.error) {
      mostrarMensaje(progreso.error, "error");
    } else if (
      progreso.mensaje.startsWith("Cobertura incompleta") ||
      progreso.mensaje.startsWith("Generación parcial")
    ) {
      mostrarMensaje(`${progreso.mensaje}. ${progreso.detalle}`, "aviso");
    } else {
      mostrarMensaje(progreso.mensaje, "correcto");
    }
    void recargarDatosApuntes().catch((error) =>
      mostrarMensaje(error.message, "error"),
    );
  }
}

function esperar(ms) {
  return new Promise((resolver) => {
    temporizadorProgreso = window.setTimeout(resolver, ms);
  });
}

async function vigilarGeneracion(id) {
  while (tareaActual === id) {
    try {
      const progreso = await consultarAPI(`/api/generar/${encodeURIComponent(id)}`);
      renderizarProgreso(progreso);
      if (progreso.terminado) return;
    } catch (error) {
      if (error.status === 404 && tareaActual === id) {
        tareaActual = "";
        if (localStorage.getItem(claveTareaActiva) === id)
          localStorage.removeItem(claveTareaActiva);
        actualizarNotificacionGeneracion(false);
        const generar = document.querySelector("#generar-apuntes-tests");
        if (generar) generar.disabled = false;
        if (document.querySelector("#apuntes-progreso"))
          mostrarMensaje("La generación ya no está disponible. Puedes iniciar una nueva tanda.", "aviso");
        return;
      }
      mostrarMensaje(`No se pudo actualizar el progreso: ${error.message}`, "aviso");
    }
    await esperar(1200);
  }
}

async function recuperarGeneracion(identificador = localStorage.getItem(claveTareaActiva)) {
  if (!identificador) return;
  if (tareaActual) {
    if (tareaActual !== identificador) return;
    actualizarNotificacionGeneracion(true);
    const panelActivo = document.querySelector("#apuntes-progreso");
    if (panelActivo) panelActivo.hidden = false;
    const generarActivo = document.querySelector("#generar-apuntes-tests");
    if (generarActivo) generarActivo.disabled = true;
    return;
  }
  tareaActual = identificador;
  actualizarNotificacionGeneracion(true);
  const generar = document.querySelector("#generar-apuntes-tests");
  if (generar) generar.disabled = true;
  const panel = document.querySelector("#apuntes-progreso");
  if (panel) panel.hidden = false;
  await vigilarGeneracion(identificador);
}

async function iniciarGeneracion() {
  mostrarMensaje("");
  const solicitud = {
    asignatura: valorSeleccionado("#apuntes-asignatura"),
    tema: obtenerTemasSeleccionados().length === 1
      ? obtenerTemasSeleccionados()[0]
      : 0,
    temas: document.querySelector("#seleccionar-todos-temas")?.checked
      ? "todos"
      : obtenerTemasSeleccionados(),
    apartado: Number(valorSeleccionado("#apuntes-apartado") || 0),
    cantidad: Number(valorSeleccionado("#cantidad-apuntes-tests")),
    modoExamen: valorSeleccionado('input[name="modo-examen-apuntes"]:checked'),
    contextoExamen: valorSeleccionado("#contexto-examen-apuntes"),
    tipoPreguntas: valorSeleccionado("#tipo-apuntes-tests"),
  };
  const desgloseActivo = document.querySelector("#activar-desglose-tipos")?.checked;
  if (desgloseActivo) {
    const nTest = Math.max(0, Number(document.querySelector("#cant-test-estandar")?.value) || 0);
    const nEscribir = Math.max(0, Number(document.querySelector("#cant-escribir-codigo")?.value) || 0);
    solicitud.desglose = { test: nTest, escribir: nEscribir };
    solicitud.cantidad = Math.max(1, nTest + nEscribir);
  }
  solicitud.buscarInternet = Boolean(document.querySelector("#activar-busqueda-internet")?.checked);
  if (!solicitud.asignatura || (Array.isArray(solicitud.temas) && !solicitud.temas.length)) {
    mostrarMensaje("Selecciona la asignatura y uno o varios temas.", "error");
    return;
  }
  if (solicitud.modoExamen === "personalizado" && solicitud.contextoExamen.trim().length < 10) {
    mostrarMensaje("Describe el formato del examen con algo más de detalle.", "error");
    return;
  }
  const boton = document.querySelector("#generar-apuntes-tests");
  boton.disabled = true;
  try {
    const respuesta = await consultarAPI("/api/generar", {
      method: "POST",
      body: JSON.stringify(solicitud),
    });
    tareaActual = respuesta.id;
    localStorage.setItem(claveTareaActiva, respuesta.id);
    actualizarNotificacionGeneracion(true);
    document.querySelector("#apuntes-barra").value = 0;
    document.querySelector("#apuntes-progreso").hidden = false;
    await vigilarGeneracion(respuesta.id);
  } catch (error) {
    mostrarMensaje(error.message, "error");
    boton.disabled = false;
    tareaActual = "";
  }
}

async function detenerGeneracion() {
  if (!tareaActual) return;
  const id = tareaActual;
  const boton = document.querySelector("#detener-apuntes-tests");
  boton.disabled = true;
  try {
    await consultarAPI(`/api/generar/${encodeURIComponent(id)}/cancelar`, {
      method: "POST",
      body: "{}",
    });
  } catch (error) {
    mostrarMensaje(error.message, "error");
    boton.disabled = false;
  }
}

async function practicarBancoGuardado() {
  const temas = obtenerTemasSeleccionados();
  const todos = document.querySelector("#seleccionar-todos-temas")?.checked;
  const seleccion = {
    asignatura: valorSeleccionado("#apuntes-asignatura"),
    tema: temas.length === 1 ? temas[0] : 0,
    temas: todos ? "todos" : temas.join(","),
    apartado: Number(valorSeleccionado("#apuntes-apartado") || 0),
  };
  try {
    const banco = await consultarAPI(
      `/api/banco?asignatura=${encodeURIComponent(seleccion.asignatura)}&tema=${seleccion.tema}&temas=${encodeURIComponent(seleccion.temas)}&apartado=${seleccion.apartado}`,
    );
    if (banco.apuntesActualizados) {
      mostrarMensaje(
        "Los apuntes cambiaron desde el último test. Puedes practicar el banco existente o generar nuevas preguntas.",
        "aviso",
      );
    }
    if (typeof window.cargarBancoDePreguntas !== "function")
      throw new Error("No se pudo abrir el motor de práctica. Recarga la página.");
    await window.cargarBancoDePreguntas(banco);
  } catch (error) {
    mostrarMensaje(error.message, "error");
  }
}

function cancelarControladoresPantalla() {
  for (const controlador of controladoresPantalla) controlador.abort();
  controladoresPantalla = [];
}

async function comprobarEstadoModelo() {
  const estado = document.querySelector("#apuntes-estado-modelo");
  try {
    const salud = await consultarAPI("/api/salud");
    estado.textContent = salud.modeloDisponible
      ? `Ollama listo · ${salud.modelo}`
      : `Ollama responde, falta el modelo ${salud.modelo}`;
    estado.className = `apuntes-chip ${salud.modeloDisponible ? "correcto" : "aviso"}`;
  } catch (error) {
    estado.textContent = "No se pudo conectar con Ollama";
    estado.className = "apuntes-chip error";
    mostrarMensaje(error.message, "error");
  }
}

function enlazarEventosPantalla() {
  cancelarControladoresPantalla();
  const controlador = new AbortController();
  controladoresPantalla.push(controlador);
  const senal = { signal: controlador.signal };
  const asignatura = document.querySelector("#apuntes-asignatura");
  const apartado = document.querySelector("#apuntes-apartado");

  asignatura.addEventListener(
    "change",
    () => {
      restaurarConfiguracion(asignatura.value);
      ultimaAsignaturaConfigurada = asignatura.value;
      const seleccion = leerSeleccionPorAsignatura(asignatura.value);
      reconstruirTemas(
        Array.isArray(seleccion.temas) && seleccion.temas.length
          ? seleccion.temas
          : String(seleccion.tema ?? ""),
        String(seleccion.apartado ?? "0"),
      );
      guardarSeleccion();
      actualizarResumenSeleccion();
    },
    senal,
  );
  apartado.addEventListener(
    "change",
    () => {
      guardarSeleccion();
      actualizarResumenSeleccion();
    },
    senal,
  );
  document
    .querySelector("#generar-apuntes-tests")
    .addEventListener("click", () => void iniciarGeneracion(), senal);
  document
    .querySelector("#detener-apuntes-tests")
    .addEventListener("click", () => void detenerGeneracion(), senal);
  document
    .querySelector("#practicar-banco-apuntes")
    .addEventListener("click", () => void practicarBancoGuardado(), senal);
  document
    .querySelector("#exportar-banco-apuntes")
    .addEventListener("click", () => void exportarBancoGuardado(), senal);
  document
    .querySelector("#refrescar-apuntes-tests")
    .addEventListener(
      "click",
      () =>
        void recargarDatosApuntes().catch((error) =>
          mostrarMensaje(error.message, "error"),
        ),
      senal,
    );
  document
    .querySelector("#volver-tests")
    .addEventListener("click", () => window.renderizarInicioTests?.(), senal);

  const modoExamen = document.querySelectorAll('input[name="modo-examen-apuntes"]');
  const campoContexto = document.querySelector("#campo-contexto-examen");
  const textareaContexto = document.querySelector("#contexto-examen-apuntes");
  const contadorChar = document.querySelector("#contador-caracteres");

  function actualizarContador() {
    if (!textareaContexto || !contadorChar) return;
    const len = textareaContexto.value.trim().length;
    contadorChar.textContent = `${len} / 10 mín.`;
    contadorChar.classList.toggle("valido", len >= 10);
  }

  function actualizarVisibilidadModo() {
    const seleccionado = valorSeleccionado('input[name="modo-examen-apuntes"]:checked');
    const esPersonalizado = seleccionado === "personalizado";
    if (campoContexto) {
      if (esPersonalizado) {
        campoContexto.removeAttribute("hidden");
        campoContexto.style.setProperty("display", "grid", "important");
        textareaContexto?.focus();
      } else {
        campoContexto.setAttribute("hidden", "");
        campoContexto.style.setProperty("display", "none", "important");
      }
    }
    const panelDesglose = document.querySelector("#panel-desglose");
    if (panelDesglose) {
      if (esPersonalizado) {
        panelDesglose.removeAttribute("hidden");
        panelDesglose.style.setProperty("display", "block", "important");
      } else {
        panelDesglose.setAttribute("hidden", "");
        panelDesglose.style.setProperty("display", "none", "important");
      }
    }
  }

  for (const opcion of modoExamen) {
    opcion.addEventListener(
      "change",
      () => {
        actualizarVisibilidadModo();
        guardarConfiguracion();
      },
      senal,
    );
    opcion.closest("label")?.addEventListener("click", () => {
      setTimeout(actualizarVisibilidadModo, 10);
    }, senal);
  }

  const checkDesglose = document.querySelector("#activar-desglose-tipos");
  const camposDesglose = document.querySelector("#campos-desglose");
  const inputTest = document.querySelector("#cant-test-estandar");
  const inputEscribir = document.querySelector("#cant-escribir-codigo");
  const chipTotalDesglose = document.querySelector("#desglose-suma-total");
  const inputCantidadGlobal = document.querySelector("#cantidad-apuntes-tests");

  function recalcularDesglose() {
    if (!checkDesglose || !camposDesglose) return;
    const activo = checkDesglose.checked;
    camposDesglose.hidden = !activo;
    if (activo) {
      const nTest = Math.max(0, Number(inputTest?.value) || 0);
      const nEscribir = Math.max(0, Number(inputEscribir?.value) || 0);
      const suma = nTest + nEscribir;
      if (inputCantidadGlobal) inputCantidadGlobal.value = String(suma || 1);
      if (chipTotalDesglose) chipTotalDesglose.textContent = `Total: ${suma} (${nTest} test + ${nEscribir} escribir)`;
    } else {
      if (chipTotalDesglose) chipTotalDesglose.textContent = `Total: ${inputCantidadGlobal?.value || 10}`;
    }
  }

  checkDesglose?.addEventListener("change", () => {
    recalcularDesglose();
    guardarConfiguracion();
  }, senal);

  inputTest?.addEventListener("input", () => {
    recalcularDesglose();
    guardarConfiguracion();
  }, senal);

  inputEscribir?.addEventListener("input", () => {
    recalcularDesglose();
    guardarConfiguracion();
  }, senal);

  inputCantidadGlobal?.addEventListener("input", () => {
    if (!checkDesglose?.checked) {
      if (chipTotalDesglose) chipTotalDesglose.textContent = `Total: ${inputCantidadGlobal.value}`;
    }
  }, senal);

  for (const btn of document.querySelectorAll(".btn-preset")) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const presetTexto = btn.getAttribute("data-preset");
      const radioPersonalizado = document.querySelector('input[name="modo-examen-apuntes"][value="personalizado"]');
      if (radioPersonalizado) {
        radioPersonalizado.checked = true;
        actualizarVisibilidadModo();
      }
      if (textareaContexto && presetTexto) {
        textareaContexto.value = presetTexto;
        actualizarContador();
      }
      if (checkDesglose) {
        checkDesglose.checked = true;
        if (presetTexto.includes("Test estándar")) {
          if (inputTest) inputTest.value = "8";
          if (inputEscribir) inputEscribir.value = "2";
        } else if (presetTexto.includes("código")) {
          if (inputTest) inputTest.value = "2";
          if (inputEscribir) inputEscribir.value = "8";
        } else {
          if (inputTest) inputTest.value = "5";
          if (inputEscribir) inputEscribir.value = "5";
        }
        recalcularDesglose();
      }
      guardarConfiguracion();
      textareaContexto?.focus();
    }, senal);
  }

  if (textareaContexto) {
    textareaContexto.addEventListener("input", actualizarContador, senal);
  }

  const btnGuardarConfig = document.querySelector("#btn-guardar-config-asignatura");
  const badgeConfig = document.querySelector("#badge-config-guardada");
  btnGuardarConfig?.addEventListener("click", () => {
    guardarConfiguracion();
    if (badgeConfig) {
      badgeConfig.style.display = "inline-flex";
      setTimeout(() => { badgeConfig.style.display = "none"; }, 3500);
    }
    mostrarMensaje("Configuración de examen guardada para esta asignatura.", "exito");
  }, senal);

  document
    .querySelector("#activar-busqueda-internet")
    ?.addEventListener("change", guardarConfiguracion, senal);

  for (const control of document.querySelectorAll(
    "#cantidad-apuntes-tests, #simultaneos-apuntes-tests, #contexto-examen-apuntes, #tipo-apuntes-tests",
  )) {
    control.addEventListener("input", guardarConfiguracion, senal);
    control.addEventListener("change", guardarConfiguracion, senal);
  }
}

async function renderizarPantallaApuntes(asignaturaPredeterminada = "", opciones = {}) {
  const principal = document.querySelector("#main");
  principal.innerHTML = `
    <section class="practica-apuntes">
      <header class="practica-cabecera">
        <div>
          <span class="apuntes-ceja">PRÁCTICA DESDE TUS APUNTES</span>
          <h1>Prepara el examen por partes</h1>
          <p>Lee el LaTeX privado en solo lectura, crea preguntas originales con tu IA local y conserva los tests aunque actualices los apuntes.</p>
        </div>
        <button id="volver-tests" class="btn ghost" type="button">Volver a mis tests</button>
      </header>

      <div class="practica-cuadricula">
        <section class="question-card">
          <div class="apuntes-seccion-titulo"><span>01</span><div><h2>Elige qué practicar</h2><p>WEC se abre con todos sus temas seleccionados; puedes desmarcar los que quieras excluir.</p></div></div>
          <div class="apuntes-campos">
            <label>Asignatura<select class="control" id="apuntes-asignatura"></select></label>
            <fieldset class="apuntes-temas"><legend>Temas · puedes elegir varios</legend><div id="apuntes-lista-temas" class="apuntes-lista-temas"></div></fieldset>
            <label>Apartado<select class="control" id="apuntes-apartado"><option value="0">Tema completo</option></select></label>
          </div>
          <div id="apuntes-resumen" class="apuntes-resumen" aria-live="polite"></div>
          <p class="apuntes-privacidad">Los archivos .tex se montan en Docker como solo lectura. Los bancos se guardan aparte en <code>datos/bancos/</code>.</p>
        </section>

        <section class="question-card">
          <div class="apuntes-seccion-titulo"><span>02</span><div><h2>Adáptalo al examen</h2><p>Elige un tipo de examen o describe cómo pregunta tu profesor. La IA transforma los ejemplos detectados y verifica que cada uno tenga una pregunta asociada.</p></div></div>
          <fieldset class="apuntes-modos">
            <legend>Contexto del examen</legend>
            <label><input type="radio" name="modo-examen-apuntes" value="predeterminado" checked><span><b>Test estándar</b><small>Conceptos, aplicación, comparaciones y trampas frecuentes.</small></span></label>
            <label><input type="radio" name="modo-examen-apuntes" value="personalizado"><span><b>Mi examen</b><small>Escribe el formato, temas prioritarios y ejemplos de preguntas.</small></span></label>
          </fieldset>
          <label id="campo-contexto-examen" class="apuntes-contexto" hidden>
            <div class="contexto-cabecera">
              <span>Escribe o describe cómo pregunta tu profesor:</span>
              <span id="contador-caracteres" class="contador-caracteres">0 / 10 mín.</span>
            </div>
            <div class="apuntes-presets">
              <button type="button" class="btn-preset" data-preset="20 preguntas tipo test, penaliza fallos, prioriza preguntas sobre diferencias conceptuales y salidas de código.">📝 Test estándar con penalización</button>
              <button type="button" class="btn-preset" data-preset="Preguntas sobre código real de los apuntes: qué imprime, errores típicos, alcance de variables y métodos de arrays.">💻 Salidas de código y trampas</button>
              <button type="button" class="btn-preset" data-preset="Preguntas conceptuales directas, definiciones clave, ventajas, desventajas y casos de uso prácticos.">💡 Teoría y conceptos clave</button>
            </div>
            <textarea class="control" id="contexto-examen-apuntes" maxlength="4000" rows="4" placeholder="Ej.: 20 preguntas, penaliza errores, pregunta mucho por diferencias entre métodos y por la salida exacta de código…"></textarea>
            <small class="contexto-ayuda">Mínimo 10 caracteres. Se pasará directamente como instrucción a la IA local.</small>
          </label>
          <div class="apuntes-opciones">
            <label>Nuevas preguntas<input class="control" id="cantidad-apuntes-tests" type="number" min="1" max="7000" value="10"></label>
            <label>Contenido<select class="control" id="tipo-apuntes-tests"><option value="mixto">Teoría + código</option><option value="teoria">Solo teoría</option><option value="codigo">Solo código</option></select></label>
            <label>Tests simultáneos / simulacros<input class="control" id="simultaneos-apuntes-tests" type="number" min="1" max="10" value="1" title="Número de exámenes o tests independientes a preparar"></label>
          </div>
          <div class="apuntes-desglose-panel" id="panel-desglose" hidden>
            <div class="desglose-cabecera">
              <label class="switch-desglose">
                <input type="checkbox" id="activar-desglose-tipos" checked>
                <span>Reparto exacto de preguntas: test vs código</span>
              </label>
              <span id="desglose-suma-total" class="apuntes-chip">Total: 10</span>
            </div>
            <div id="campos-desglose" class="campos-desglose">
              <div class="campo-desglose-fila">
                <label for="cant-test-estandar">
                  <b>📝 Tipo test estándar</b>
                  <small>Conceptos, trampas y penalización</small>
                </label>
                <input class="control input-desglose" id="cant-test-estandar" type="number" min="0" max="7000" value="6">
              </div>
              <div class="campo-desglose-fila">
                <label for="cant-escribir-codigo">
                  <b>💻 De escribir y analizar código</b>
                  <small>Salida exacta, completar o corregir</small>
                </label>
                <input class="control input-desglose" id="cant-escribir-codigo" type="number" min="0" max="7000" value="4">
              </div>
            </div>
          </div>
          <label class="switch-opcion-extra">
            <div>
              <input type="checkbox" id="activar-busqueda-internet">
              <span><i class="fa-solid fa-globe"></i> Buscar en internet / Documentación web oficial</span>
            </div>
            <small>La IA contrastará los conceptos y preguntas con la documentación web oficial actualizada (MDN Web Docs, W3C, ECMAScript).</small>
          </label>
          <p class="apuntes-privacidad">Se generará exactamente la cantidad total indicada (repartida equitativamente entre los apartados seleccionados).</p>
          <div class="apuntes-estado">
            <span id="apuntes-estado-modelo" class="apuntes-chip">Comprobando IA local…</span>
            <span class="apuntes-chip">Ollama · Docker · sin servicios externos</span>
          </div>
          <div class="apuntes-acciones">
            <button id="generar-apuntes-tests" class="btn primary" type="button" disabled>Generar preguntas nuevas</button>
            <button id="practicar-banco-apuntes" class="btn" type="button" disabled>Practicar el test guardado</button>
            <button id="exportar-banco-apuntes" class="btn" type="button" disabled>Descargar banco JSON</button>
            <button id="refrescar-apuntes-tests" class="btn ghost" type="button" aria-label="Actualizar apuntes y tests"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Actualizar</button>
          </div>
          <div class="apuntes-guardar-barra">
            <button id="btn-guardar-config-asignatura" class="btn tiny ok" type="button"><i class="fa-solid fa-floppy-disk"></i> Guardar configuración del examen</button>
            <span id="badge-config-guardada" class="apuntes-chip" style="display:none; color:var(--ok)">✓ Configuración guardada para esta asignatura</span>
          </div>
        </section>
      </div>

      <section id="apuntes-progreso" class="question-card apuntes-progreso" hidden aria-live="polite">
        <div class="apuntes-progreso-arriba"><div><span class="apuntes-ceja">GENERACIÓN INCREMENTAL</span><h2 id="apuntes-fase">Preparando material…</h2></div><b id="apuntes-porcentaje">0 %</b></div>
        <progress id="apuntes-barra" max="100" value="0" aria-label="Progreso de generación"></progress>
        <p id="apuntes-detalle"></p>
        <div class="apuntes-progreso-abajo"><span id="apuntes-tiempo">Calculando el tiempo…</span><span id="apuntes-conteo">0 preguntas nuevas</span><button id="detener-apuntes-tests" class="btn ghost" type="button">Detener</button></div>
      </section>
      <div id="apuntes-mensaje" class="apuntes-mensaje" role="status" aria-live="polite" hidden></div>
    </section>`;
  enlazarEventosPantalla();
  void recargarDatosApuntes().then(() => {
    if (
      asignaturaPredeterminada &&
      catalogoApuntes?.asignaturas.some(
        (asignatura) => asignatura.nombre === asignaturaPredeterminada,
      )
    ) {
      document.querySelector("#apuntes-asignatura").value = asignaturaPredeterminada;
      reconstruirTemas();
      if (opciones?.tema) {
        const checkboxes = document.querySelectorAll(".tema-seleccionado");
        checkboxes.forEach((cb) => {
          cb.checked = Number(cb.value) === Number(opciones.tema);
        });
      }
      reconstruirApartados();
      if (opciones?.apartado) {
        const selectAp = document.querySelector("#apuntes-apartado");
        if (selectAp) selectAp.value = String(opciones.apartado);
      }
      guardarSeleccion();
      actualizarResumenSeleccion();
    }
  }).then(() => recuperarGeneracion()).catch((error) => mostrarMensaje(error.message, "error"));
  void comprobarEstadoModelo();
}

function vigilarCambiosEnApuntes() {
  if (document.visibilityState !== "visible") return;
  if (document.querySelector("#apuntes-asignatura")) {
    void recargarDatosApuntes().catch((error) =>
      mostrarMensaje(error.message, "error"),
    );
  }
}

window.abrirPracticaDesdeApuntes = renderizarPantallaApuntes;
if (window.location.hash === "#apuntes" || window.location.search.includes("pantalla=apuntes")) {
  void renderizarPantallaApuntes().catch((error) =>
    mostrarMensaje(error.message, "error")
  );
}
window.addEventListener("beforeunload", cancelarControladoresPantalla);
window.addEventListener("preparar-tests-reload", async () => {
  void recargarDatosApuntes().catch((error) =>
    mostrarMensaje(error.message, "error")
  );
});
window.setInterval(vigilarCambiosEnApuntes, 120000);
void recuperarGeneracion();
