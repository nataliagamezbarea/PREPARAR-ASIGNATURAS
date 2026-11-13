import assert from "node:assert/strict";
import test from "node:test";
import { crearServidor } from "../servidor.js";

test("sirve la interfaz separada y sus recursos estáticos", async (t) => {
  const servidor = crearServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  t.after(() => new Promise((resolver) => servidor.close(resolver)));
  const origen = `http://127.0.0.1:${servidor.address().port}`;

  const pagina = await fetch(origen);
  assert.equal(pagina.status, 200);
  const codigoHTML = await pagina.text();
  assert.match(codigoHTML, /practicar-apuntes\.js/);
  assert.match(codigoHTML, /class="brand brand-link" href="\/"/);
  assert.match(codigoHTML, /id="generation-notification"/);
  assert.match(codigoHTML, /🔔/);

  const aplicacion = await fetch(`${origen}/assets/js/app.js`);
  assert.equal(aplicacion.status, 200);
  const codigoAplicacion = await aplicacion.text();
  assert.match(codigoAplicacion, /function renderStart/);
  assert.match(codigoAplicacion, /function renderAiConversation/);
  assert.match(codigoAplicacion, /window\.prepararTestsPersistencia/);
  assert.match(codigoAplicacion, /Se restauró el borrador/);
  assert.match(codigoAplicacion, /data-start="mastery"/);
  assert.match(codigoAplicacion, /continueMastery: true/);

  const practica = await fetch(`${origen}/assets/js/practicar-apuntes.js`);
  assert.equal(practica.status, 200);
  const codigoPractica = await practica.text();
  assert.match(codigoPractica, /function iniciarGeneracion/);
  assert.match(codigoPractica, /addEventListener\("storage"/);
  assert.match(codigoPractica, /actualizarNotificacionGeneracion\(true\)/);
  assert.match(codigoPractica, /banco\.meta\.asignatura}-temas-/);
  assert.match(codigoPractica, /a-zA-Z0-9\._-/);

  const preguntas = await fetch(`${origen}/data/asignaturas/wec/preguntas.json`);
  assert.equal(preguntas.status, 200);
  assert.ok((await preguntas.json()).preguntas.length >= 100);

  const ejemplo = await fetch(`${origen}/data/asignaturas/ejemplo/preguntas.json`);
  assert.equal(ejemplo.status, 404);
});

test("no expone rutas arbitrarias del sistema de archivos", async (t) => {
  const servidor = crearServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  t.after(() => new Promise((resolver) => servidor.close(resolver)));
  const origen = `http://127.0.0.1:${servidor.address().port}`;

  const respuesta = await fetch(`${origen}/../../etc/passwd`);
  assert.equal(respuesta.status, 404);
  assert.deepEqual(await respuesta.json(), {
    error: "No se encuentra este recurso.",
  });
});

test("acepta el alias question que usa la interfaz antigua al pedir una explicación", async (t) => {
  const servidor = crearServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  t.after(() => new Promise((resolver) => servidor.close(resolver)));
  const origen = `http://127.0.0.1:${servidor.address().port}`;

  const respuesta = await fetch(`${origen}/api/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: {} }),
  });

  assert.equal(respuesta.status, 422);
  assert.deepEqual(await respuesta.json(), {
    error: "La pregunta no tiene enunciado.",
  });
});

test("valida las dudas y el historial del minichat antes de consultar Ollama", async (t) => {
  const servidor = crearServidor();
  await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  t.after(() => new Promise((resolver) => servidor.close(resolver)));
  const origen = `http://127.0.0.1:${servidor.address().port}`;
  const base = {
    pregunta: { enunciado: "¿Qué imprime el código?" },
    followUp: "¿Por qué?",
  };

  const sinHistorial = await fetch(`${origen}/api/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(base),
  });
  assert.equal(sinHistorial.status, 422);
  assert.deepEqual(await sinHistorial.json(), {
    error: "El historial del chat no es válido.",
  });

  const preguntaVacia = await fetch(`${origen}/api/explain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...base, conversation: [], followUp: " " }),
  });
  assert.equal(preguntaVacia.status, 422);
  assert.deepEqual(await preguntaVacia.json(), {
    error: "Escribe una duda antes de enviarla.",
  });
});
