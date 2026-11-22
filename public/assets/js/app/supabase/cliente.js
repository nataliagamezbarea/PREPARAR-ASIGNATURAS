"use strict";

// ============================================================
// CONFIGURACIÓN E INICIALIZACIÓN CLIENTE SUPABASE (Grados Informáticos)
// ============================================================

window.SUPABASE_URL = window.SUPABASE_URL || "https://lztatgnlplpduiatmlrv.supabase.co";
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "sb_publishable_z_T7Y3yKqPdXLnvL3ltnQA_ZAPrXImZ";

const SupabaseConfig = (() => {
  let client = null;

  function getClient() {
    if (client) return client;
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    if (window.supabase && typeof window.supabase.createClient === "function") {
      try {
        client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
          db: { schema: "grados-informaticos" },
          auth: {
            flowType: "pkce",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        window.supabaseClient = client;
        return client;
      } catch (err) {
        console.error("Error al inicializar cliente Supabase:", err);
      }
    }
    return null;
  }

  async function seedInitialProgress() {
    const keySeeded = "wec12_seeded_8765_v2";
    if (localStorage.getItem(keySeeded) === "true") return;

    try {
      const resp = await fetch("./data/progreso-8765.json");
      if (!resp.ok) return;
      const seedData = await resp.json();
      if (!seedData || !seedData.history) return;

      const currentHistory = typeof getHistory === "function" ? getHistory() : {};
      const currentWrong = typeof getWrongIds === "function" ? getWrongIds() : [];

      const mergedHistory = { ...seedData.history, ...currentHistory };
      const mergedWrong = [...new Set([...(seedData.wrongIds || []), ...currentWrong])];

      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);

      const existingStats = typeof getStats === "function" ? getStats() : null;
      if (!existingStats || existingStats.attempts === 0) {
        if (typeof setStats === "function") setStats(seedData.stats);
        else if (typeof writeStore === "function") writeStore(LS.stats, seedData.stats);
      }

      localStorage.setItem(keySeeded, "true");
      console.log(`[Supabase] Progreso inicial cargado con éxito (${Object.keys(seedData.history).length} practicadas, ${mergedWrong.length} fallos)`);
      if (typeof toast === "function") {
        toast("✓ Se ha cargado tu progreso anterior (515 preguntas practicadas)");
      }
    } catch (e) {
      console.warn("No se pudo cargar el progreso inicial:", e);
    }
  }

  return {
    getClient,
    seedInitialProgress
  };
})();
