"use strict";

// ============================================================
// INTERFAZ DE USUARIO: MODAL DE AUTENTICACIÓN Y SINCRONIZACIÓN
// ============================================================

const SupabaseUI = (() => {
  function updateAuthButton() {
    const btn = document.querySelector("#auth-btn");
    const label = document.querySelector("#auth-btn-label");
    if (!btn || !label) return;

    const user = SupabaseGestionAuth.getCurrentUser();
    if (user && user.id !== "invitado") {
      const email = user.email || "Usuario";
      label.textContent = email.split("@")[0];
      btn.classList.add("primary");
      btn.title = `Conectado como ${email} · Clic para ver perfil y sincronización`;
    } else {
      label.textContent = "Iniciar sesión";
      btn.classList.remove("primary");
      btn.title = "Iniciar sesión con Supabase para guardar tu caché y progreso";
    }
  }

  function renderAuthModal() {
    let modal = document.querySelector("#auth-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "auth-modal";
      modal.className = "modal-overlay hidden";
      modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7);
        display: flex; align-items: center; justify-content: center; z-index: 1000;
        padding: 20px; backdrop-filter: blur(4px);
      `;
      document.body.appendChild(modal);
    }

    const user = SupabaseGestionAuth.getCurrentUser();
    const email = user?.email || "";
    const historyCount = typeof getHistory === "function" ? Object.keys(getHistory()).length : 0;
    const wrongCount = typeof getWrongIds === "function" ? getWrongIds().length : 0;

    modal.innerHTML = `
      <div class="modal-card" style="
        background: var(--card); color: var(--text); border: 1px solid var(--line);
        border-radius: var(--radius); width: 100%; max-width: 440px; padding: 28px;
        box-shadow: var(--shadow); position: relative; max-height: 90vh; overflow-y: auto;
      ">
        <button type="button" id="close-auth-modal" style="
          position: absolute; top: 16px; right: 16px; background: none; border: none;
          font-size: 20px; color: var(--muted); cursor: pointer; padding: 4px;
        " aria-label="Cerrar">&times;</button>

        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <div style="width:40px; height:40px; border-radius:10px; background:var(--brand-soft); color:var(--brand); display:flex; align-items:center; justify-content:center; font-size:18px;">
            <i class="fa-solid ${user ? "fa-cloud-arrow-up" : "fa-user"}"></i>
          </div>
          <div>
            <h3 style="margin:0; font-size:18px;">${user ? "Tu cuenta de Supabase" : "Iniciar sesión en Supabase"}</h3>
            <small style="color:var(--muted);">${user ? "Grados Informáticos · Sincronización activa" : "Guarda tu caché y progreso en la nube"}</small>
          </div>
        </div>

        ${user ? `
          <div style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:16px; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Usuario</span>
              <strong style="font-size:14px;">${esc(email)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas practicadas</span>
              <strong><span class="pct-pill" style="background:var(--ok-soft); color:var(--ok); font-size:12px; padding:2px 8px; border-radius:12px;">${historyCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas falladas</span>
              <strong><span class="pct-pill" style="background:var(--bad-soft); color:var(--bad); font-size:12px; padding:2px 8px; border-radius:12px;">${wrongCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:var(--muted);">Estado de nube</span>
              <span id="sync-cloud-status" style="font-size:12px; font-weight:600; color:var(--brand);">Conectado</span>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn primary" type="button" id="btn-sync-now" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-arrows-rotate"></i> Sincronizar ahora con Supabase
            </button>
            <button class="btn ghost warn" type="button" id="btn-logout" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-right-from-bracket"></i> Cerrar sesión
            </button>
          </div>
        ` : `
          <p style="font-size:13px; color:var(--muted); line-height:1.5; margin-bottom:20px;">
            Inicia sesión para sincronizar automáticamente tu caché, respuestas y progreso entre dispositivos.
          </p>

          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
            <button class="btn" type="button" id="btn-oauth-google" style="width:100%; justify-content:center; gap:10px; border:1px solid var(--line);">
              <i class="fa-brands fa-google" style="color:#ea4335;"></i> Continuar con Google
            </button>
            <button class="btn" type="button" id="btn-oauth-github" style="width:100%; justify-content:center; gap:10px; border:1px solid var(--line);">
              <i class="fa-brands fa-github"></i> Continuar con GitHub
            </button>
          </div>

          <div style="display:flex; align-items:center; gap:10px; margin:16px 0; color:var(--muted); font-size:12px;">
            <hr style="flex:1; border:0; border-top:1px solid var(--line);">
            <span>O con correo</span>
            <hr style="flex:1; border:0; border-top:1px solid var(--line);">
          </div>

          <form id="email-auth-form" style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;" for="auth-email">Correo electrónico</label>
              <input class="control" type="email" id="auth-email" required placeholder="tu@correo.com" style="width:100%; box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;" for="auth-password">Contraseña</label>
              <input class="control" type="password" id="auth-password" required placeholder="••••••••" style="width:100%; box-sizing:border-box;">
            </div>
            <div id="auth-error-msg" class="hidden" style="color:var(--bad); font-size:12px; background:var(--bad-soft); padding:8px 12px; border-radius:8px;"></div>
            <div style="display:flex; gap:10px; margin-top:8px;">
              <button class="btn primary" type="submit" id="btn-submit-login" style="flex:1; justify-content:center;">Entrar</button>
              <button class="btn ghost" type="button" id="btn-submit-signup" style="flex:1; justify-content:center;">Registrarse</button>
            </div>
          </form>
        `}
      </div>
    `;

    modal.classList.remove("hidden");

    modal.querySelector("#close-auth-modal")?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    if (user) {
      modal.querySelector("#btn-sync-now")?.addEventListener("click", async () => {
        const btn = modal.querySelector("#btn-sync-now");
        if (btn) { btn.disabled = true; btn.textContent = "Sincronizando…"; }
        await SupabaseProgreso.syncProgressWithCloud(true);
        if (typeof toast === "function") toast("✓ Progreso sincronizado con Supabase");
        renderAuthModal();
      });

      modal.querySelector("#btn-logout")?.addEventListener("click", async () => {
        await SupabaseGestionAuth.cerrarSesionCompleta("Has cerrado sesión.");
      });
    } else {
      modal.querySelector("#btn-oauth-google")?.addEventListener("click", async () => {
        const c = SupabaseConfig.getClient();
        if (!c) return;
        await c.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.href }
        });
      });

      modal.querySelector("#btn-oauth-github")?.addEventListener("click", async () => {
        const c = SupabaseConfig.getClient();
        if (!c) return;
        await c.auth.signInWithOAuth({
          provider: "github",
          options: { redirectTo: window.location.href }
        });
      });

      const form = modal.querySelector("#email-auth-form");
      const errBox = modal.querySelector("#auth-error-msg");

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const c = SupabaseConfig.getClient();
        if (!c) return;
        const emailVal = modal.querySelector("#auth-email").value.trim();
        const passVal = modal.querySelector("#auth-password").value;
        const submitBtn = modal.querySelector("#btn-submit-login");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Entrando…"; }
        errBox.classList.add("hidden");

        const { data, error } = await c.auth.signInWithPassword({ email: emailVal, password: passVal });
        if (error) {
          errBox.textContent = error.message;
          errBox.classList.remove("hidden");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Entrar"; }
        } else {
          SupabaseGestionAuth.setCurrentUser(data.user);
          updateAuthButton();
          await SupabaseProgreso.syncProgressWithCloud();
          if (typeof toast === "function") toast(`¡Bienvenida ${emailVal}!`);
          renderAuthModal();
        }
      });
    }
  }

  return {
    renderAuthModal,
    updateAuthButton
  };
})();
