(function () {
  const nombreBaseDatos = "preparar-tests-borradores";
  const nombreAlmacen = "borradores";
  const versionBaseDatos = 1;

  function abrirBaseDatos() {
    return new Promise((resolver, rechazar) => {
      const solicitud = indexedDB.open(nombreBaseDatos, versionBaseDatos);
      solicitud.onupgradeneeded = () => {
        solicitud.result.createObjectStore(nombreAlmacen);
      };
      solicitud.onsuccess = () => resolver(solicitud.result);
      solicitud.onerror = () =>
        rechazar(solicitud.error ?? new Error("No se pudo abrir el almacenamiento local."));
      solicitud.onblocked = () =>
        rechazar(new Error("Cierra otras pestañas de Preparar tests para guardar el borrador."));
    });
  }

  async function ejecutarTransaccion(modo, operacion) {
    const baseDatos = await abrirBaseDatos();
    try {
      return await new Promise((resolver, rechazar) => {
        const transaccion = baseDatos.transaction(nombreAlmacen, modo);
        const almacen = transaccion.objectStore(nombreAlmacen);
        let resultado;
        operacion(almacen, (valor) => {
          resultado = valor;
        });
        transaccion.oncomplete = () => resolver(resultado);
        transaccion.onerror = () =>
          rechazar(transaccion.error ?? new Error("No se pudo guardar el borrador."));
        transaccion.onabort = () =>
          rechazar(transaccion.error ?? new Error("Se canceló el guardado del borrador."));
      });
    } finally {
      baseDatos.close();
    }
  }

  async function guardarArchivosPersistidos(clave, archivos, valores = {}) {
    const archivosGuardados = await Promise.all(
      archivos.map(async (archivo) => ({
        nombre: archivo.name,
        tipo: archivo.type,
        modificado: archivo.lastModified,
        ruta: archivo.webkitRelativePath || archivo.name,
        contenido: archivo.slice(0, archivo.size, archivo.type),
      })),
    );
    await ejecutarTransaccion("readwrite", (almacen) => {
      almacen.put({ archivos: archivosGuardados, valores }, clave);
    });
  }

  async function cargarArchivosPersistidos(clave) {
    const borrador = await ejecutarTransaccion("readonly", (almacen, resolver) => {
      const solicitud = almacen.get(clave);
      solicitud.onsuccess = () => resolver(solicitud.result ?? null);
      solicitud.onerror = () =>
        resolver(Promise.reject(solicitud.error ?? new Error("No se pudo leer el borrador.")));
    });
    if (!borrador) return { archivos: [], valores: {} };
    const archivos = (borrador.archivos ?? []).map((archivo) => {
      const restaurado = new File([archivo.contenido], archivo.nombre, {
        type: archivo.tipo,
        lastModified: archivo.modificado,
      });
      if (archivo.ruta && archivo.ruta !== archivo.nombre) {
        Object.defineProperty(restaurado, "webkitRelativePath", {
          value: archivo.ruta,
        });
      }
      return restaurado;
    });
    return { archivos, valores: borrador.valores ?? {} };
  }

  async function borrarArchivosPersistidos(clave) {
    await ejecutarTransaccion("readwrite", (almacen) => almacen.delete(clave));
  }

  window.prepararTestsPersistencia = {
    borrarArchivosPersistidos,
    cargarArchivosPersistidos,
    guardarArchivosPersistidos,
  };
})();
