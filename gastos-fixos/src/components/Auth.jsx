import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { styles } from "./ui";

export default function Auth() {
  const [auth, setAuth] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: auth.email.trim(),
      password: auth.password,
    });
    setLoading(false);
    if (error) alert(error.message);
  }

  async function signUp() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: auth.email.trim(),
      password: auth.password,
    });
    setLoading(false);
    if (error) return alert(error.message);
    alert("Conta criada! Se a confirmação por email estiver habilitada, confirme para conseguir entrar.");
  }

  return (
    <div style={{ ...styles.container, maxWidth: 520 }}>
      <div style={styles.card}>
        <h1 style={styles.h1}>💰Minha Carteira</h1>
        <p style={{ ...styles.muted, marginTop: 6 }}>
          Faça login para salvar seus dados no Supabase.
        </p>

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <input
            style={styles.input}
            placeholder="Email"
            value={auth.email}
            onChange={(e) => setAuth((p) => ({ ...p, email: e.target.value }))}
          />
          <input
            style={styles.input}
            placeholder="Senha"
            type="password"
            value={auth.password}
            onChange={(e) => setAuth((p) => ({ ...p, password: e.target.value }))}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={styles.btn} onClick={signIn} disabled={loading}>
              Entrar
            </button>
            <button style={styles.btnGhost} onClick={signUp} disabled={loading}>
              Criar conta
            </button>
          </div>

          <div style={{ ...styles.muted, fontSize: 13, lineHeight: 1.4 }}>
            <div><b>Dica</b>: Em dev, adicione <code>http://localhost:5173</code> em Authentication → URL Configuration.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
