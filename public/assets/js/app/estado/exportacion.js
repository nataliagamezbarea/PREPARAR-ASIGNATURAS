"use strict";

function buildExportPayload() {
  return {
    app: "test-interactivo",
    schema: 1,
    exportedAt: new Date().toISOString(),
    asignatura: state.subject ? { id: state.subject.id, nombre: state.subject.nombre } : null,
    meta: state.meta || null,
    totalPreguntas: state.questions.length,
    wrongIds: getWrongIds(),
    history: getHistory(),
    stats: getStats()
  };
}

function isWrongEntry(value) {
  return value && typeof value === "object" && typeof value.selected === "string";
}

function applyImportedData(data) {
  if (!data || typeof data !== "object") throw new Error("El archivo no contiene un objeto JSON válido.");
  const rawIds = Array.isArray(data.wrongIds) ? data.wrongIds : Array.isArray(data.fallos) ? data.fallos : null;
  if (!rawIds) throw new Error("El archivo no tiene la lista wrongIds.");
  const incomingIds = rawIds.map((id) => getQuestion(id)?.id || id).filter((id) => hasQuestion(id));
  const incomingHistory = data.history && typeof data.history === "object" && !Array.isArray(data.history) ? data.history : {};

  const mergedWrong = new Set(getWrongIds().filter((id) => hasQuestion(id)));
  incomingIds.forEach((id) => mergedWrong.add(id));
  const mergedHistory = getHistory();
  Object.entries(incomingHistory).forEach(([key, entry]) => {
    const q = getQuestion(key);
    const resolvedId = q ? q.id : key;
    if (hasQuestion(resolvedId) && isWrongEntry(entry)) {
      mergedHistory[resolvedId] = {
        selected: String(entry.selected).charAt(0).toUpperCase(),
        at: typeof entry.at === "string" ? entry.at : new Date().toISOString(),
        fails: Math.max(1, Number(entry.fails) || 1)
      };
      if (!mergedWrong.has(resolvedId)) mergedWrong.add(resolvedId);
    }
  });
  setWrongIds([...mergedWrong]);
  setHistory(mergedHistory);

  if (data.stats && typeof data.stats === "object") {
    const current = getStats();
    const imported = data.stats;
    const importedDate = imported.lastDate ? Date.parse(imported.lastDate) : 0;
    const currentDate = current.lastDate ? Date.parse(current.lastDate) : 0;
    const merged = {
      attempts: Math.max(Number(current.attempts) || 0, Number(imported.attempts) || 0),
      bestPct: Math.max(Number(current.bestPct) || 0, Number(imported.bestPct) || 0),
      lastPct: importedDate > currentDate ? Number(imported.lastPct) || 0 : Number(current.lastPct) || 0,
      lastTotal: importedDate > currentDate ? Number(imported.lastTotal) || 0 : Number(current.lastTotal) || 0,
      lastDate: importedDate > currentDate ? imported.lastDate : current.lastDate
    };
    setStats(merged);
  }
  if (typeof writePersistenceFile === "function") writePersistenceFile();
  return incomingIds.length;
}

function exportWrongsFile() {
  const payload = buildExportPayload();
  if (!payload.wrongIds.length) {
    toast("Todavía no hay fallos que exportar.");
    return;
  }
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  const name = state.subject?.nombre || "test";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  link.download = `${slug}-fallos-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`Exportados ${payload.wrongIds.length} fallos a archivo.`);
}

function importWrongsFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      const count = applyImportedData(data);
      if (typeof renderWrongBook === "function") renderWrongBook();
      toast(`Importados ${count} fallos. Total: ${getWrongIds().length}.`);
    } catch (error) {
      toast(`Archivo no válido: ${error.message}`);
    }
  };
  reader.onerror = () => toast("No se pudo leer el archivo.");
  reader.readAsText(file);
}
