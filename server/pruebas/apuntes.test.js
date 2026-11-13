import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  leerCatalogoApuntes,
  obtenerMaterialSeleccionado,
} from "../apuntes.js";

async function crearApuntesTemporales() {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-apuntes-"));
  const primerApartado = path.join(raiz, "WEC", "Tema 4", "Tema 4.1");
  const segundoApartado = path.join(raiz, "WEC", "Tema 4", "Tema 4.2");
  await mkdir(primerApartado, { recursive: true });
  await mkdir(segundoApartado, { recursive: true });
  await writeFile(
    path.join(primerApartado, "4.1.1-funciones.tex"),
    [
      "\\seccion{Funciones}",
      "Las funciones encapsulan una operación y devuelven un resultado.",
      "\\begin{lstlisting}",
      "function suma(a, b) { return a + b; }",
      "\\end{lstlisting}",
    ].join("\n"),
  );
  await writeFile(
    path.join(primerApartado, "carga.tex"),
    "\\seccion{Este archivo no debe servir como material de práctica}",
  );
  await writeFile(
    path.join(segundoApartado, "4.2.1-arrays.tex"),
    "\\seccion{Arrays}\\nLos arrays guardan elementos ordenados y accesibles por índice.",
  );
  await writeFile(
    path.join(raiz, "WEC", "Tema 4", "tema4.tex"),
    "\\seccion{Archivo de compilación que se excluye}",
  );
  return { raiz, primerApartado, segundoApartado };
}

function crc32(contenido) {
  let crc = 0xffffffff;
  for (const byte of contenido) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crearZip(entradas) {
  const partesLocales = [];
  const partesCentrales = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of entradas) {
    const nombreBytes = Buffer.from(nombre);
    const contenido = Buffer.from(texto);
    const crc = crc32(contenido);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contenido.length, 18);
    local.writeUInt32LE(contenido.length, 22);
    local.writeUInt16LE(nombreBytes.length, 26);
    partesLocales.push(local, nombreBytes, contenido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(contenido.length, 20);
    central.writeUInt32LE(contenido.length, 24);
    central.writeUInt16LE(nombreBytes.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    partesCentrales.push(central, nombreBytes);
    desplazamiento += local.length + nombreBytes.length + contenido.length;
  }

  const directorioCentral = Buffer.concat(partesCentrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorioCentral.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...partesLocales, directorioCentral, fin]);
}

function crearPdf(textos) {
  const contenido = Buffer.from(
    `BT /F1 12 Tf 50 750 Td 14 TL\n${textos.map((texto) => `(${texto}) Tj T*`).join("\n")}\nET`,
  );
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${contenido.length} >>\nstream\n${contenido.toString()}\nendstream`,
  ];
  const partes = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let longitud = partes[0].length;
  for (const [indice, objeto] of objetos.entries()) {
    offsets.push(longitud);
    const parte = Buffer.from(`${indice + 1} 0 obj\n${objeto}\nendobj\n`);
    partes.push(parte);
    longitud += parte.length;
  }
  const inicioXref = longitud;
  const xref = [
    `xref\n0 ${objetos.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`,
  ];
  partes.push(Buffer.from(xref.join("")));
  return Buffer.concat(partes);
}

test("descubre asignaturas, temas y apartados desde la estructura real", async () => {
  const { raiz } = await crearApuntesTemporales();
  try {
    const catalogo = await leerCatalogoApuntes({ raizApuntes: raiz });
    assert.equal(catalogo.asignaturas.length, 1);
    assert.equal(catalogo.asignaturas[0].nombre, "WEC");
    assert.deepEqual(
      catalogo.asignaturas[0].temas[0].apartados.map((apartado) => apartado.numero),
      [1, 2],
    );
    assert.equal(catalogo.asignaturas[0].temas[0].apartados[0].nombre, "Funciones");
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("lee ejemplos de código dentro de ZIP y los asigna al apartado de su ruta", async () => {
  const { raiz } = await crearApuntesTemporales();
  try {
    await writeFile(
      path.join(raiz, "WEC", "Tema 4", "materiales.zip"),
      crearZip([
        [
          "Tema 4.2/4.2.2-arrays.js",
          "const valores = [3, 5];\nconsole.log(valores[0]);",
        ],
        ["Tema 4.2/lectura.txt", "Los índices de los arrays empiezan en cero."],
      ]),
    );
    const catalogo = await leerCatalogoApuntes({ raizApuntes: raiz });
    assert.deepEqual(
      catalogo.asignaturas[0].temas[0].apartados.map((apartado) => apartado.numero),
      [1, 2],
    );

    const material = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 4, apartado: 2 },
      { raizApuntes: raiz },
    );
    assert.equal(material.archivos.length, 2);
    assert.equal(material.documentos.length, 3);
    assert.ok(
      material.documentos.some((documento) =>
        /Los índices de los arrays empiezan en cero/.test(documento.texto),
      ),
    );
    assert.ok(
      material.documentos.some(
        (documento) =>
          /console\.log\(valores\[0\]\)/.test(documento.texto) &&
          /```js/.test(documento.texto),
      ),
    );
    const documentoDeArrays = material.documentos.find((documento) =>
      /console\.log\(valores\[0\]\)/.test(documento.texto),
    );
    assert.equal(documentoDeArrays.apartado, 2);
    assert.equal(documentoDeArrays.apartadoNombre, "arrays");
    assert.ok(material.archivos.some((archivo) => archivo.endsWith("materiales.zip")));
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("reconoce ZIP temaN en la raíz y lee PDF y código por apartado", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-zip-raiz-"));
  const rutaWec = path.join(raiz, "WEC");
  await mkdir(rutaWec, { recursive: true });
  await writeFile(
    path.join(rutaWec, "Tema 6.zip"),
    crearZip([
      [
        "Tema 6.1/6.1.1-material.pdf",
        crearPdf(["El PDF incluido en el ZIP explica el protocolo HTTP."]),
      ],
      ["Tema 6.2/6.2.1-ejemplo.py", "respuesta = 200\nprint(respuesta)"],
    ]),
  );
  try {
    const catalogo = await leerCatalogoApuntes({ raizApuntes: raiz });
    assert.deepEqual(
      catalogo.asignaturas[0].temas[0].apartados.map((apartado) => apartado.numero),
      [1, 2],
    );
    const material = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 6, apartado: 1 },
      { raizApuntes: raiz },
    );
    assert.equal(material.documentos.length, 1);
    assert.match(material.documentos[0].texto, /protocolo HTTP/);
    assert.ok(material.archivos[0].endsWith("Tema 6.zip"));
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("omite dependencias y carpetas generadas dentro de ZIP sin saltarse el material", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-zip-dependencias-"));
  const rutaWec = path.join(raiz, "WEC");
  await mkdir(rutaWec, { recursive: true });
  await writeFile(
    path.join(rutaWec, "Tema 7.zip"),
    crearZip([
      ["node_modules/three/build/three.js", "Código de terceros que se omite."],
      ["Tema 7.1/ejemplo.js", "const total = 2 + 3;"],
    ]),
  );
  try {
    const material = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 7 },
      { raizApuntes: raiz },
    );
    assert.equal(material.documentos.length, 1);
    assert.match(material.documentos[0].texto, /const total = 2 \+ 3/);
    assert.doesNotMatch(material.documentos[0].texto, /terceros/);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("procesa más de veinte mil archivos en un ZIP sin un tope fijo de entradas", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-zip-grande-"));
  const rutaWec = path.join(raiz, "WEC");
  await mkdir(rutaWec, { recursive: true });
  const entradas = Array.from({ length: 20001 }, (_, indice) => [
    `Tema 9.1/9.1-${indice}.txt`,
    `Contenido de ejemplo ${indice}.`,
  ]);
  await writeFile(
    path.join(rutaWec, "Tema 9.zip"),
    crearZip(entradas),
  );
  try {
    const catalogo = await leerCatalogoApuntes({ raizApuntes: raiz });
    assert.deepEqual(
      catalogo.asignaturas[0].temas[0].apartados.map((apartado) => apartado.numero),
      [1],
    );
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("lee un archivo de material de más de 32 MiB", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-material-grande-"));
  const tema = path.join(raiz, "WEC", "Tema 10");
  await mkdir(tema, { recursive: true });
  await writeFile(
    path.join(tema, "10.1-material.txt"),
    "contenido de material grande.\n".repeat(1_200_000),
  );
  try {
    const catalogo = await leerCatalogoApuntes({ raizApuntes: raiz });
    assert.equal(catalogo.asignaturas[0].temas[0].numero, 10);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("rechaza ZIP con rutas que intentan salir de su contenido", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-zip-ruta-"));
  const rutaWec = path.join(raiz, "WEC");
  await mkdir(rutaWec, { recursive: true });
  await writeFile(
    path.join(rutaWec, "Tema 7.zip"),
    crearZip([["../fuera.py", "No se debe extraer ni leer."]]),
  );
  try {
    await assert.rejects(
      leerCatalogoApuntes({ raizApuntes: raiz }),
      /invalid relative path/,
    );
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("descubre un PDF temaN en la raíz y lo divide por encabezados numerados", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-pdf-"));
  const rutaWec = path.join(raiz, "WEC");
  await mkdir(rutaWec, { recursive: true });
  await writeFile(
    path.join(rutaWec, "Tema 5.pdf"),
    crearPdf([
      "5.1 Fundamentos de la web",
      "El cliente solicita recursos al servidor.",
      "5.2 Arquitectura del navegador",
      "El navegador interpreta el documento recibido.",
    ]),
  );
  try {
    const catalogo = await leerCatalogoApuntes({ raizApuntes: raiz });
    assert.deepEqual(
      catalogo.asignaturas[0].temas[0].apartados.map((apartado) => apartado.numero),
      [1, 2],
    );
    const material = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 5, apartado: 2 },
      { raizApuntes: raiz },
    );
    assert.equal(material.documentos.length, 1);
    assert.equal(material.documentos[0].titulo, "Arquitectura del navegador");
    assert.match(material.documentos[0].texto, /navegador interpreta el documento/);
    assert.doesNotMatch(material.documentos[0].texto, /cliente solicita recursos/);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("extrae el apartado elegido, conserva el código y omite archivos de compilación", async () => {
  const { raiz } = await crearApuntesTemporales();
  try {
    const material = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 4, apartado: 1 },
      { raizApuntes: raiz },
    );
    assert.equal(material.alcance, "WEC · Tema 4 · Apartado 4.1");
    assert.equal(material.archivos.length, 1);
    assert.match(material.documentos[0].texto, /Las funciones encapsulan/);
    assert.match(material.documentos[0].texto, /function suma\(a, b\)/);
    assert.doesNotMatch(material.documentos[0].texto, /archivo de compilación/i);
    assert.match(material.revision, /^[a-f0-9]{64}$/);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("selecciona tema completo y detecta cambios reales en los .tex", async () => {
  const { raiz, segundoApartado } = await crearApuntesTemporales();
  try {
    const antes = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 4 },
      { raizApuntes: raiz },
    );
    assert.equal(antes.archivos.length, 2);
    await writeFile(
      path.join(segundoApartado, "4.2.1-arrays.tex"),
      "\\seccion{Arrays}\\nLos índices de arrays empiezan en cero y los cambios se detectan.",
    );
    const despues = await obtenerMaterialSeleccionado(
      { asignatura: "WEC", tema: 4 },
      { raizApuntes: raiz },
    );
    assert.notEqual(antes.revision, despues.revision);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("rechaza asignaturas no válidas y enlaces que salen del directorio", async () => {
  const { raiz } = await crearApuntesTemporales();
  const exterior = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-exterior-"));
  try {
    await assert.rejects(
      obtenerMaterialSeleccionado(
        { asignatura: "../WEC", tema: 4, apartado: 1 },
        { raizApuntes: raiz },
      ),
      /asignatura válida/,
    );
    await symlink(exterior, path.join(raiz, "Fuera"));
    await assert.rejects(
      obtenerMaterialSeleccionado(
        { asignatura: "Fuera", tema: 4, apartado: 1 },
        { raizApuntes: raiz },
      ),
      /fuera de la carpeta/,
    );
  } finally {
    await rm(raiz, { recursive: true, force: true });
    await rm(exterior, { recursive: true, force: true });
  }
});
