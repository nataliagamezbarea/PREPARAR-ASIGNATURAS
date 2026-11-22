"use strict";

// ============================================================
// SINCRONIZACIÓN DE PROGRESO CON SUPABASE Y CACHÉ LOCAL
// Guarda en el schema "grados-informaticos".progreso_tests
// y en user_metadata, con fallback en localStorage y auto-sincronización.
// ============================================================

const SupabaseProgreso = (() => {
  let isSyncing = false;
  let autoSyncTimer = null;

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

      // Intentar leer de la tabla del schema "grados-informaticos"
      let schemaProgress = null;
      try {
        const { data: dbData } = await c.schema("grados-informaticos")
          .from("progreso_tests")
          .select("*")
          .eq("usuario_id", currentUser.id);
        if (Array.isArray(dbData) && dbData.length > 0) {
          schemaProgress = dbData[0];
        }
      } catch (_) {}

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

      const payload = {
        updatedAt: new Date().toISOString(),
        history: mergedHistory,
        wrongIds: mergedWrong,
        stats: mergedStats,
        session: localSession,
        countPracticadas: Object.keys(mergedHistory).length
      };

      // 1. Guardar en tabla del schema grados-informaticos
      try {
        await c.schema("grados-informaticos").from("progreso_tests").upsert({
          usuario_id: currentUser.id,
          email: currentUser.email,
          asignatura_id: (window.state?.subjectId || "general"),
          historial: mergedHistory,
          fallos: mergedWrong,
          estadisticas: mergedStats,
          actualizado_en: new Date().toISOString()
        }, { onConflict: "usuario_id,asignatura_id" });
      } catch (dbErr) {
        console.log("[SupabaseProgreso] Info schema:", dbErr?.message || dbErr);
      }

      // 2. Guardar en Supabase user_metadata (Auth)
      const { data: updateData, error: updateError } = await c.auth.updateUser({
        data: { test_progress: payload }
      });

      if (!updateError && updateData?.user && window.SupabaseAuth) {
        window.SupabaseAuth.setCurrentUser(updateData.user);
      }

      // 3. Aplicar al estado local (caché siempre actualizado)
      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);
      if (typeof setStats === "function") setStats(mergedStats);

      try {
        localStorage.removeItem("preparar_tests_sync_pendiente");
        localStorage.setItem("preparar_tests_ultima_sync", new Date().toISOString());
      } catch (_) {}

      updateSyncStatusUI(`Sincronizado (${payload.countPracticadas} preguntas)`);
      console.log(`[SupabaseProgreso] Sincronizado con Supabase (${payload.countPracticadas} preguntas)`);
    } catch (e) {
      console.error("[SupabaseProgreso] Error al sincronizar:", e);
      try {
        localStorage.setItem("preparar_tests_sync_pendiente", "true");
      } catch (_) {}
      updateSyncStatusUI("Guardado en caché (pendiente Supabase)");
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
