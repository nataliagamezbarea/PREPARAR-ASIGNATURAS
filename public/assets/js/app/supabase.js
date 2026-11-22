"use strict";

// ============================================================
// FACHADA UNIFICADA SUPABASE AUTH & PROGRESO
// ============================================================

const SupabaseAuth = {
  getClient: () => SupabaseConfig.getClient(),
  getCurrentUser: () => SupabaseGestionAuth.getCurrentUser(),
  setCurrentUser: (u) => SupabaseGestionAuth.setCurrentUser(u),
  seedInitialProgress: () => SupabaseConfig.seedInitialProgress(),
  syncProgressWithCloud: (force) => SupabaseProgreso.syncProgressWithCloud(force),
  autoSyncProgressDebounced: () => SupabaseProgreso.autoSyncProgressDebounced(),
  renderAuthModal: () => SupabaseUI.renderAuthModal(),
  cerrarSesion: (msg) => SupabaseGestionAuth.cerrarSesionCompleta(msg),
  purgarSesion: () => SupabaseGestionAuth.purgarSesionYCookies(),
  init: async () => {
    try {
      const res = await fetch("/api/configuracion");
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.supabaseUrl) window.SUPABASE_URL = cfg.supabaseUrl;
        if (cfg.supabaseAnonKey) window.SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        if (cfg.githubRepo) localStorage.setItem("gh_repo", cfg.githubRepo);
        if (cfg.githubBranch) localStorage.setItem("selected_test_branch", cfg.githubBranch);
        if (cfg.githubToken) localStorage.setItem("cache_gh_token", cfg.githubToken);
      }
    } catch (_) {}

    await SupabaseConfig.seedInitialProgress();
    await SupabaseGestionAuth.autenticarConGate();

    const c = SupabaseConfig.getClient();
    if (c) {
      c.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN") {
          await SupabaseGestionAuth.autenticarConGate();
        } else if (event === "SIGNED_OUT") {
          SupabaseGestionAuth.setCurrentUser(null);
          SupabaseUI.updateAuthButton();
          SupabaseGestionAuth.mostrarLoginGate();
        }
      });
    }

    // Gate OAuth buttons
    document.getElementById("gate-btn-github")?.addEventListener("click", async () => {
      const cl = SupabaseConfig.getClient();
      if (!cl) return;
      await cl.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });

    document.getElementById("gate-btn-google")?.addEventListener("click", async () => {
      const cl = SupabaseConfig.getClient();
      if (!cl) return;
      await cl.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });

    document.querySelector("#auth-btn")?.addEventListener("click", () => {
      SupabaseUI.renderAuthModal();
    });

    SupabaseUI.updateAuthButton();

    // Sincronizar automáticamente si había cambios en caché pendientes
    if (localStorage.getItem("preparar_tests_sync_pendiente") === "true") {
      SupabaseProgreso.syncProgressWithCloud().then(() => {
        if (typeof toast === "function") toast("✓ Progreso de caché sincronizado con Supabase");
      }).catch(() => {});
    }
  }
};

window.SupabaseAuth = SupabaseAuth;
window.cerrarSesion = SupabaseAuth.cerrarSesion;
window.purgarSesion = SupabaseAuth.purgarSesion;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => SupabaseAuth.init());
} else {
  SupabaseAuth.init();
}
