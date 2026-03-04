import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { getTheme, setTheme, styles } from "./ui";

export default function TopBar({ email, onRefresh, refreshing, onExportCsv, onSignOut }) {
  const [theme, setThemeState] = useState("dark");
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme") || getTheme();
    setTheme(saved);
    setThemeState(saved);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeState(next);
    localStorage.setItem("theme", next);
  }

  function openPasswordModal() {
    setNewPassword("");
    setConfirmPassword("");
    setPwModalOpen(true);
  }

  async function changePassword() {
    const pwd = String(newPassword || "");
    const confirm = String(confirmPassword || "");
    if (pwd.length < 6) return alert("A nova senha deve ter ao menos 6 caracteres.");
    if (pwd !== confirm) return alert("As senhas nao conferem.");

    setUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setUpdatingPassword(false);

    if (error) return alert(error.message);
    setPwModalOpen(false);
    alert("Senha alterada com sucesso.");
  }

  return (
    <>
      <div style={{ ...styles.card, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontWeight: 900, letterSpacing: -0.3, fontSize: 18 }}>Gastos Fixos</div>
            <div style={{ ...styles.muted, fontSize: 13 }}>{email ? `Logado como: ${email}` : ""}</div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button style={styles.btnGhost} type="button" onClick={toggleTheme}>
              {theme === "dark" ? "Dark" : "Light"}
            </button>
            <button style={styles.btnGhost} type="button" onClick={openPasswordModal}>
              Alterar senha
            </button>
            <button style={styles.btnGhost} type="button" onClick={onExportCsv}>
              Exportar CSV
            </button>
            <button style={styles.btnGhost} type="button" onClick={onRefresh}>
              {refreshing ? "Atualizando..." : "Atualizar"}
            </button>
            <button style={styles.btn} type="button" onClick={onSignOut}>
              Sair
            </button>
          </div>
        </div>
      </div>

      {pwModalOpen ? (
        <div
          onMouseDown={(e) => e.target === e.currentTarget && !updatingPassword && setPwModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 100,
            padding: 14,
          }}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              boxShadow: "var(--shadow)",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16 }}>Alterar senha</div>
            <div style={{ ...styles.muted, marginTop: 4, fontSize: 13 }}>
              Informe e confirme sua nova senha.
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <input
                style={styles.input}
                type="password"
                placeholder="Nova senha"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                style={styles.input}
                type="password"
                placeholder="Confirmar nova senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button style={styles.btnGhost} type="button" disabled={updatingPassword} onClick={() => setPwModalOpen(false)}>
                Cancelar
              </button>
              <button style={styles.btn} type="button" disabled={updatingPassword} onClick={changePassword}>
                {updatingPassword ? "Salvando..." : "Salvar senha"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
