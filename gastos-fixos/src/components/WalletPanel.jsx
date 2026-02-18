import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { moneyBRL, styles, ymLabel } from "./ui";

export default function WalletPanel({ userId, ym }) {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState([]);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [minBalance, setMinBalance] = useState(() => localStorage.getItem("wallet_min_balance") ?? "");

  useEffect(() => {
    if (!userId) return;
    fetchMonth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ym?.year, ym?.month]);

  async function fetchMonth() {
    setLoading(true);
    const { data, error } = await supabase
      .from("wallet_entries")
      .select("*")
      .eq("year", ym.year)
      .eq("month", ym.month)
      .order("created_at", { ascending: false })
      .limit(30);

    setLoading(false);
    if (error) return alert(error.message);
    setEntries(data ?? []);
  }

  const monthBalance = useMemo(() => (entries ?? []).reduce((acc, e) => acc + Number(e.amount || 0), 0), [entries]);
  const minNum = useMemo(() => {
    const n = Number(String(minBalance).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }, [minBalance]);
  const low = minNum > 0 && monthBalance < minNum;

  async function addEntry(e) {
    e.preventDefault();
    const n = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(n) || n === 0) return alert("Informe um valor válido (ex.: 1500 ou -200).");

    const payload = {
      user_id: userId,
      year: ym.year,
      month: ym.month,
      amount: n,
      description: desc?.trim() || (n > 0 ? "Entrada" : "Saída"),
      source: "manual",
    };

    const { error } = await supabase.from("wallet_entries").insert(payload);
    if (error) return alert(error.message);

    setAmount("");
    setDesc("");
    fetchMonth();
  }

  function saveMinBalance(v) {
    setMinBalance(v);
    localStorage.setItem("wallet_min_balance", v);
  }

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>👛 Carteira</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>{ymLabel(ym.year, ym.month)} • saldo do mês</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span
            style={{
              ...styles.badge,
              borderColor: low ? "rgba(239,68,68,.45)" : "var(--border)",
              boxShadow: low ? "0 0 0 4px rgba(239,68,68,.12)" : "none",
            }}
            title={low ? "Abaixo da meta" : "OK"}
          >
            {low ? "⚠️" : "✅"} Saldo: <b style={{ color: "var(--text)" }}>{moneyBRL(monthBalance)}</b>
          </span>

          <input
            style={{ ...styles.input, width: 180 }}
            placeholder="Meta mínima (ex.: 300)"
            value={minBalance}
            onChange={(e) => saveMinBalance(e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1.2fr 1.6fr", gap: 12 }}>
        <form onSubmit={addEntry} style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Adicionar entrada/saída</div>

          <div style={{ display: "grid", gap: 10 }}>
            <input
              style={styles.input}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Valor (ex.: 2500 ou -120)"
            />
            <input style={styles.input} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (opcional)" />
            <button type="submit" style={styles.btn}>
              Lançar
            </button>
            <div style={{ ...styles.muted, fontSize: 12, lineHeight: 1.35 }}>
              <b>Dica:</b> ao marcar um gasto como <b>Pago</b> no controle mensal, a saída é registrada aqui automaticamente.
            </div>
          </div>
        </form>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>Lançamentos ({ym.month}/{ym.year})</div>
            <span style={styles.badge}>{loading ? "Carregando..." : "Últimos 30"}</span>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8, maxHeight: 260, overflow: "auto", paddingRight: 4 }}>
            {entries.length === 0 ? (
              <div style={{ ...styles.muted, padding: 12 }}>Nenhum lançamento neste mês.</div>
            ) : (
              entries.map((x) => (
                <div
                  key={x.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,.04)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {x.description || "—"}
                    </div>
                    <div style={{ ...styles.muted, fontSize: 12 }}>
                      {x.source === "expense_payment" ? "Automático • pagamento" : "Manual"} •{" "}
                      {new Date(x.created_at).toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div style={{ fontWeight: 900, color: Number(x.amount) < 0 ? "rgba(239,68,68,.92)" : "rgba(34,197,94,.92)" }}>
                    {moneyBRL(x.amount)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={{ ...styles.muted, fontSize: 12, marginTop: 10 }}>
        <b>Saldo por mês:</b> este painel mostra o saldo do mês selecionado (o mesmo mês do “Controle mensal”).
      </div>
    </div>
  );
}
