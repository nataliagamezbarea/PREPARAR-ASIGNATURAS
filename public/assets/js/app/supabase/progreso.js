"use strict";

// ============================================================
// SINCRONIZACIÓN DE PROGRESO CON SUPABASE Y CACHÉ LOCAL
// Guarda en el schema "grados-informaticos".progreso_tests
// y en user_metadata, con fallback en localStorage y auto-sincronización.
// ============================================================

const SupabaseProgreso = (() => {
  let isSyncing = false;
  let autoSyncTimer = null;
  let tablaProgresoDisponible = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("supabase_has_progreso_tests") === "false") ? false : null;

  function updateSyncStatusUI(text) {
    const statusEl = document.querySelector("#sync-cloud-status");
    if (statusEl) statusEl.textContent = text;
  }

  async function syncProgressWithCloud(forceUpload = false) {
    const c = SupabaseConfig.getClient();
    const currentUser = window.SupabaseAuth?.getCurrentUser?.();
    if (!c || !currentUser || isSyncing) {
      try {
        localStorage.setItem("preparar_tests_sync_pendiente", "true");
      } catch (_) {}
      return;
    }
    isSyncing = true;

    try {
      updateSyncStatusUI("Sincronizando con Supabase…");
      const localHistory = typeof getHistory === "function" ? getHistory() : {};
      const localWrong = typeof getWrongIds === "function" ? getWrongIds() : [];
      const localStats = typeof getStats === "function" ? getStats() : {};
      const localSession = typeof getSession === "function" ? getSession() : null;

      // Intentar leer de la tabla del schema "grados-informaticos" solo si está disponible
      let schemaProgress = null;
      if (tablaProgresoDisponible !== false) {
        try {
          const res = await c.schema("grados-informaticos")
            .from("progreso_tests")
            .select("*")
            .eq("usuario_id", currentUser.id);
          if (res && !res.error && Array.isArray(res.data) && res.data.length > 0) {
            schemaProgress = res.data[0];
            tablaProgresoDisponible = true;
          } else if (res?.error && (res.error.code === "PGRST205" || res.error.message?.includes("not find the table") || res.status === 404)) {
            tablaProgresoDisponible = false;
            try { sessionStorage.setItem("supabase_has_progreso_tests", "false"); } catch (_) {}
          }
        } catch (errDb) {
          tablaProgresoDisponible = false;
          try { sessionStorage.setItem("supabase_has_progreso_tests", "false"); } catch (_) {}
        }
      }

      const cloudProgress = schemaProgress?.historial
        ? {
            history: schemaProgress.historial,
            wrongIds: schemaProgress.fallos || [],
            stats: schemaProgress.estadisticas || {}
          }
        : (currentUser.user_metadata?.test_progress || null);

      let mergedHistory = { ...localHistory };
      let mergedWrong = [...new Set(localWrong)];
      let mergedStats = { ...localStats };

      if (cloudProgress && !forceUpload) {
        if (cloudProgress.history) {
          Object.entries(cloudProgress.history).forEach(([qid, item]) => {
            if (!mergedHistory[qid] || (item.at && (!mergedHistory[qid].at || item.at > mergedHistory[qid].at))) {
              mergedHistory[qid] = item;
            }
          });
        }
        if (Array.isArray(cloudProgress.wrongIds)) {
          mergedWrong = [...new Set([...mergedWrong, ...cloudProgress.wrongIds])];
        }
        if (cloudProgress.stats) {
          mergedStats.attempts = Math.max(mergedStats.attempts || 0, cloudProgress.stats.attempts || 0);
          mergedStats.bestPct = Math.max(mergedStats.bestPct || 0, cloudProgress.stats.bestPct || 0);
        }
      }

      const countPracticadas = Object.keys(mergedHistory).length;

      // 1. Guardar en tabla si está disponible
      if (tablaProgresoDisponible !== false) {
        try {
          const resUpsert = await c.schema("grados-informaticos").from("progreso_tests").upsert({
            usuario_id: currentUser.id,
            email: currentUser.email,
            asignatura_id: (window.state?.subjectId || "general"),
            historial: mergedHistory,
            fallos: mergedWrong,
            estadisticas: mergedStats,
            actualizado_en: new Date().toISOString()
          }, { onConflict: "usuario_id,asignatura_id" });

          if (resUpsert?.error && (resUpsert.error.code === "PGRST205" || resUpsert.error.message?.includes("not find the table") || resUpsert.status === 404)) {
            tablaProgresoDisponible = false;
            try { sessionStorage.setItem("supabase_has_progreso_tests", "false"); } catch (_) {}
          }
        } catch (_) {
          tablaProgresoDisponible = false;
          try { sessionStorage.setItem("supabase_has_progreso_tests", "false"); } catch (_) {}
        }
      }

      // 2. Si la tabla no está creada en Supabase, guardar resumen ligero en user_metadata (< 1KB, sin saturar JWT)
      if (tablaProgresoDisponible === false && c.auth?.updateUser) {
        try {
          const resumenLigero = {
            stats: mergedStats,
            wrongIds: mergedWrong.slice(-30),
            countPracticadas,
            updatedAt: new Date().toISOString()
          };
          const { data: updateData, error: updateErr } = await c.auth.updateUser({
            data: { test_progress: resumenLigero }
          });
          if (!updateErr && updateData?.user && window.SupabaseAuth) {
            window.SupabaseAuth.setCurrentUser(updateData.user);
          }
        } catch (_) {}
      }

      // 3. Aplicar al estado local (caché local siempre completa y persistida)
      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);
      if (typeof setStats === "function") setStats(mergedStats);

      try {
        localStorage.removeItem("preparar_tests_sync_pendiente");
        localStorage.setItem("preparar_tests_ultima_sync", new Date().toISOString());
      } catch (_) {}

      updateSyncStatusUI(`Sincronizado (${countPracticadas} preguntas)`);
    } catch (e) {
      console.warn("[SupabaseProgreso] Aviso al sincronizar:", e?.message || e);
      try {
        localStorage.setItem("preparar_tests_sync_pendiente", "true");
      } catch (_) {}
      updateSyncStatusUI("Guardado en caché (local)");
    } finally {
      isSyncing = false;
    }
  }

  function autoSyncProgressDebounced() {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      syncProgressWithCloud(false).catch((e) => console.warn("Auto-sync error:", e));
    }, 1000);
  }

  return {
    syncProgressWithCloud,
    autoSyncProgressDebounced,
    updateSyncStatusUI
  };
})();
