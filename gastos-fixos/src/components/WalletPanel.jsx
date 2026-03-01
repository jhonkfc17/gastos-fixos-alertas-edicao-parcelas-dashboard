import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { expenseMonthInfo, moneyBRL, styles } from "./ui";

// Carteira GLOBAL (saldo total). Mantém ref_year/ref_month apenas como referência.
export default function WalletPanel({ userId, items = [], paidExpenseIds = [], refreshKey, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [tx, setTx] = useState([]);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!userId) return;
    fetchWallet().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshKey]);

  const balance = useMemo(() => {
    return (tx ?? []).reduce((acc, r) => acc + Number(r.amount || 0), 0);
  }, [tx]);

  const paidSet = useMemo(() => new Set(paidExpenseIds ?? []), [paidExpenseIds]);

  const monthSummary = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const activeThisMonth = (items ?? [])
      .filter((i) => i.active)
      .filter((i) => expenseMonthInfo(i, year, month).applicable);

    const totalMonth = activeThisMonth.reduce((acc, i) => acc + Number(i.amount || 0), 0);
    const pending = activeThisMonth
      .filter((i) => !paidSet.has(i.id))
      .reduce((acc, i) => acc + Number(i.amount || 0), 0);

    // Total restante parcelado (aproximação: parcelas restantes * valor mensal)
    let remainingInstallmentTotal = 0;
    let remainingInstallmentCount = 0;

    const ymIndex = (y, m) => y * 12 + (m - 1);
    const curIdx = ymIndex(year, month);

    for (const i of (items ?? [])) {
      if (!i?.active || !i?.is_installment) continue;
      const total = Number(i.installment_total);
      const sy = Number(i.installment_start_year);
      const sm = Number(i.installment_start_month);
      const per = Number(i.amount || 0);
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(sy) || !Number.isFinite(sm)) continue;

      const startIdx = ymIndex(sy, sm);
      const diff = curIdx - startIdx; // 0 = mês 1
      const paidCount = Math.max(0, Math.min(total, diff)); // meses anteriores ao atual
      const remaining = Math.max(0, total - paidCount);
      if (remaining > 0) {
        remainingInstallmentCount += remaining;
        remainingInstallmentTotal += remaining * per;
      }
    }

    const freeAfterPending = Number(balance || 0) - pending;
    const commitmentPct = balance > 0 ? (pending / balance) * 100 : pending > 0 ? 100 : 0;

    return {
      year,
      month,
      totalMonth,
      pending,
      freeAfterPending,
      commitmentPct,
      remainingInstallmentTotal,
      remainingInstallmentCount,
    };
  }, [items, paidSet, balance]);

  async function fetchWallet() {
    setLoading(true);
    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("id, kind, amount, note, description, created_at, ref_expense_id, ref_year, ref_month")
      .order("created_at", { ascending: false })
      .limit(30);

    setLoading(false);
    if (error) return alert(error.message);
    setTx(data ?? []);
  }

  async function addEntry(e) {
    e?.preventDefault?.();

    const v = Number(String(amount).replace(",", "."));
    if (!Number.isFinite(v) || v === 0) return alert("Informe um valor válido. Use negativo para saída.");

    // salva com created_at na data escolhida
    const dt = date ? new Date(`${date}T12:00:00`) : new Date();

    const payload = {
      user_id: userId,
      kind: v > 0 ? "income" : "manual_expense",
      amount: Math.round(v * 100) / 100,
      description: desc?.trim() || null,
      note: desc?.trim() || null, // compatibilidade com versões antigas
      created_at: dt.toISOString(),
    };

    setLoading(true);
    const { error } = await supabase.from("wallet_transactions").insert(payload);
    setLoading(false);
    if (error) return alert(error.message);

    setAmount("");
    setDesc("");
    fetchWallet();
    onChanged?.();
  }

  async function removeTx(id) {
    if (!confirm("Remover este lançamento da carteira?")) return;
    setLoading(true);
    const { error } = await supabase.from("wallet_transactions").delete().eq("id", id);
    setLoading(false);
    if (error) return alert(error.message);
    fetchWallet();
    onChanged?.();
  }

  function kindLabel(k) {
    if (k === "income") return "Entrada";
    if (k === "expense_payment") return "Saída (pago)";
    if (k === "manual_expense") return "Saída (manual)";
    return k || "Lançamento";
  }

  return (
    <div style={{ ...styles.card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>👛 Carteira</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Saldo total • entradas manuais e saídas automáticas ao marcar despesas como pagas
          </div>
        </div>
        <span style={{ ...styles.badge, fontSize: 13 }}>{loading ? "Atualizando..." : "Global"}</span>
      </div>

      <div style={{ ...styles.gridAuto, marginTop: 12 }}>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Pendências do mês</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>{moneyBRL(monthSummary.pending)}</div>
          <div style={{ ...styles.muted, fontSize: 12, marginTop: 4 }}>Gastos ativos ainda não pagos (mês atual)</div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Saldo livre</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>{moneyBRL(monthSummary.freeAfterPending)}</div>
          <div style={{ ...styles.muted, fontSize: 12, marginTop: 4 }}>Saldo após pagar pendências do mês</div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Comprometimento</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>
            {Math.round(monthSummary.commitmentPct)}%
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,.08)", marginTop: 8, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, monthSummary.commitmentPct))}%`, background: "rgba(255,255,255,.35)" }} />
          </div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Parcelas restantes</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>{monthSummary.remainingInstallmentCount || 0}</div>
          <div style={{ ...styles.muted, fontSize: 12, marginTop: 4 }}>Total futuro: {moneyBRL(monthSummary.remainingInstallmentTotal)}</div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Saldo</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyBRL(balance)}</div>
        </div>

        <div style={{ ...styles.card, gridColumn: "1 / -1", background: "var(--card2)" }}>
          <div style={{ fontWeight: 800 }}>Adicionar entrada/saída</div>
          <form onSubmit={addEntry} style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <input
                style={styles.input}
                placeholder="Valor (ex.: 2500 ou -120)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
              <input style={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <input
              style={styles.input}
              placeholder="Descrição (opcional)"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <button style={styles.btn} type="submit" disabled={loading}>
              Lançar
            </button>
          </form>
        </div>
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div
          style={{
            padding: 12,
            background: "var(--card2)",
            fontWeight: 800,
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>Últimos 30 lançamentos</span>
          <span style={{ ...styles.muted, fontSize: 12 }}>{loading ? "…" : ""}</span>
        </div>

        {(tx ?? []).length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Sem lançamentos ainda.</div>
        ) : (
          (tx ?? []).map((r) => (
            <div
              key={r.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 10,
                padding: 12,
                borderTop: "1px solid var(--border)",
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {kindLabel(r.kind)}
                  {(r.description || r.note) ? ` • ${r.description || r.note}` : ""}
                </div>
                <div style={{ ...styles.muted, fontSize: 12 }}>{new Date(r.created_at).toLocaleString("pt-BR")}</div>
              </div>
              <div style={{ fontWeight: 900 }}>{moneyBRL(r.amount)}</div>
              <button style={styles.btnGhost} type="button" onClick={() => removeTx(r.id)}>
                Remover
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

