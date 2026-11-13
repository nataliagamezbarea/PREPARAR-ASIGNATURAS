import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { barajarOpciones } from "../preguntas.js";

const banco = JSON.parse(
  await readFile(new URL("../../public/data/asignaturas/wec/preguntas.json", import.meta.url), "utf8"),
);

test("el banco WEC reparte la respuesta correcta entre A, B, C y D", () => {
  const cuenta = { A: 0, B: 0, C: 0, D: 0 };
  for (const pregunta of banco.preguntas) cuenta[pregunta.correcta]++;
  const total = banco.preguntas.length;
  for (const [letra, n] of Object.entries(cuenta))
    assert.ok(n / total >= 0.15 && n / total <= 0.35, `La letra ${letra} es correcta en ${n} de ${total}`);
});

test("las preguntas del banco son coherentes", () => {
  const ids = new Set();
  for (const p of banco.preguntas) {
    assert.ok(!ids.has(p.id), `id repetido ${p.id}`);
    ids.add(p.id);
    assert.ok(p.opciones[p.correcta], `correcta inválida en ${p.id}`);
    assert.equal(new Set(Object.values(p.opciones)).size, 4, `opciones repetidas en ${p.id}`);
    assert.ok(p.explicacion, `sin explicación en ${p.id}`);
  }
  assert.equal(banco.meta.total, banco.preguntas.length);
});

test("barajarOpciones conserva el texto de la respuesta correcta", () => {
  const pregunta = {
    opciones: { A: "uno", B: "dos", C: "tres", D: "cuatro" },
    correcta: "B",
  };
  for (const semilla of [0, 0.3, 0.6, 0.99]) {
    const barajada = barajarOpciones(pregunta, () => semilla);
    assert.equal(barajada.opciones[barajada.correcta], "dos");
    assert.deepEqual(Object.values(barajada.opciones).sort(), ["cuatro", "dos", "tres", "uno"]);
  }
});

test("barajarOpciones respeta opciones que dependen de la posición", () => {
  const pregunta = {
    opciones: { A: "x", B: "y", C: "z", D: "Todas las anteriores" },
    correcta: "D",
  };
  assert.equal(barajarOpciones(pregunta, () => 0.5), pregunta);
});
