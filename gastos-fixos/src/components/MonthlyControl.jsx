import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { moneyBRL, styles, ymLabel } from "./ui";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Tooltip,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { CHART_COLORS, DarkTooltip, axisLine, axisTick, gridStroke } from "./chartTheme";

/**
 * Controle mensal com:
 * - pagamento parcial (paid_amount)
 * - registro automático na wallet_entries ao marcar/desmarcar pago
 * - histórico (6 meses) usando paid_amount quando existir
 */
export default function MonthlyControl({ items, userId, year, month, onChangeYM }) {
  const now = new Date();
  const [localYear, setLocalYear] = useState(year ?? now.getFullYear());
  const [localMonth, setLocalMonth] = useState(month ?? now.getMonth() + 1);

  const [statusRows, setStatusRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (year) setLocalYear(year);
    if (month) setLocalMonth(month);
  }, [year, month]);

  useEffect(() => {
    if (!userId) return;
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, localYear, localMonth, items?.length]);

  const activeItems = useMemo(() => (items ?? []).filter((i) => i.active), [items]);

  const byExpenseId = useMemo(() => {
    const m = new Map();
    for (const r of statusRows) m.set(r.expense_id, r);
    return m;
  }, [statusRows]);

  function getMonthlyAmount(expense) {
    // No seu modelo, parceladas já guardam valor mensal em amount
    return Number(expense?.amount || 0);
  }

  async function fetchStatus() {
    setLoading(true);
    const { data, error } = await supabase
      .from("monthly_expense_status")
      .select("id, expense_id, paid, paid_amount, paid_at")
      .eq("year", localYear)
      .eq("month", localMonth);

    setLoading(false);
    if (error) return alert(error.message);
    setStatusRows(data ?? []);
    fetchHistory().catch(() => {});
  }

  async function fetchHistory() {
    const points = [];
    const anchor = new Date(localYear, localMonth - 1, 1);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
      points.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString("pt-BR", { month: "short" }) });
    }

    const years = [...new Set(points.map((p) => p.year))];
    const months = [...new Set(points.map((p) => p.month))];

    const { data } = await supabase
      .from("monthly_expense_status")
      .select("expense_id, year, month, paid, paid_amount")
      .in("year", years)
      .in("month", months);

    const amountById = new Map(activeItems.map((i) => [i.id, getMonthlyAmount(i)]));
    const sumByKey = new Map(points.map((p) => [`${p.year}-${p.month}`, 0]));

    for (const row of data ?? []) {
      const key = `${row.year}-${row.month}`;
      if (!sumByKey.has(key) || !row.paid) continue;
      const fallback = amountById.get(row.expense_id) || 0;
      const amt = Number(row.paid_amount ?? fallback) || 0;
      sumByKey.set(key, (sumByKey.get(key) || 0) + amt);
    }

    setHistory(points.map((p) => ({ label: p.label, total: sumByKey.get(`${p.year}-${p.month}`) || 0 })));
  }

  function getExpenseName(expenseId) {
    const e = (items ?? []).find((x) => x.id === expenseId);
    return e?.name ?? "Gasto";
  }

  async function syncWallet(expenseId, nextPaid, amountToUse) {
    if (nextPaid) {
      const payload = {
        user_id: userId,
        year: localYear,
        month: localMonth,
        amount: -Math.abs(Number(amountToUse || 0)),
        description: `Pagamento: ${getExpenseName(expenseId)} (${ymLabel(localYear, localMonth)})`,
        source: "expense_payment",
        expense_id: expenseId,
      };
      const { error } = await supabase.from("wallet_entries").upsert(payload, { onConflict: "user_id,source,expense_id,year,month" });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("wallet_entries")
        .delete()
        .eq("user_id", userId)
        .eq("source", "expense_payment")
        .eq("expense_id", expenseId)
        .eq("year", localYear)
        .eq("month", localMonth);
      if (error) throw error;
    }
  }

  async function togglePaid(expense) {
    const row = byExpenseId.get(expense.id);
    const isPaid = Boolean(row?.paid);
    const nextPaid = !isPaid;

    let paidAmount = null;
    let paidAt = null;

    if (nextPaid) {
      const def = getMonthlyAmount(expense);
      const input = prompt("Valor pago (pode ser parcial):", String(def).replace(".", ","));
      if (input === null) return;
      const n = Number(String(input).replace(",", "."));
      if (!Number.isFinite(n) || n <= 0) return alert("Informe um valor válido.");
      paidAmount = n;
      paidAt = new Date().toISOString();
    }

    const payload = {
      user_id: userId,
      expense_id: expense.id,
      year: localYear,
      month: localMonth,
      paid: nextPaid,
      paid_amount: nextPaid ? paidAmount : null,
      paid_at: nextPaid ? paidAt : null,
    };

    const { error } = await supabase.from("monthly_expense_status").upsert(payload, { onConflict: "user_id,expense_id,year,month" });
    if (error) return alert(error.message);

    try {
      await syncWallet(expense.id, nextPaid, nextPaid ? paidAmount : 0);
    } catch (e) {
      alert(e.message || String(e));
    }

    fetchStatus();
  }

  async function setAll(nextPaid) {
    if (activeItems.length === 0) return;
    if (nextPaid) {
      const payload = activeItems.map((e) => ({
        user_id: userId,
        expense_id: e.id,
        year: localYear,
        month: localMonth,
        paid: true,
        paid_amount: getMonthlyAmount(e),
        paid_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("monthly_expense_status").upsert(payload, { onConflict: "user_id,expense_id,year,month" });
      if (error) return alert(error.message);
      for (const e of activeItems) await syncWallet(e.id, true, getMonthlyAmount(e));
    } else {
      const payload = activeItems.map((e) => ({
        user_id: userId,
        expense_id: e.id,
        year: localYear,
        month: localMonth,
        paid: false,
        paid_amount: null,
        paid_at: null,
      }));
      const { error } = await supabase.from("monthly_expense_status").upsert(payload, { onConflict: "user_id,expense_id,year,month" });
      if (error) return alert(error.message);
      for (const e of activeItems) await syncWallet(e.id, false, 0);
    }
    fetchStatus();
  }

  function prevMonth() {
    const m = localMonth - 1;
    const next = m < 1 ? { year: localYear - 1, month: 12 } : { year: localYear, month: m };
    setLocalYear(next.year);
    setLocalMonth(next.month);
    onChangeYM?.(next);
  }
  function nextMonth() {
    const m = localMonth + 1;
    const next = m > 12 ? { year: localYear + 1, month: 1 } : { year: localYear, month: m };
    setLocalYear(next.year);
    setLocalMonth(next.month);
    onChangeYM?.(next);
  }

  const totals = useMemo(() => {
    let paid = 0;
    let pending = 0;
    for (const e of activeItems) {
      const row = byExpenseId.get(e.id);
      const m = getMonthlyAmount(e);
      if (row?.paid) {
        const amt = Number(row.paid_amount ?? m) || 0;
        paid += amt;
        pending += Math.max(0, m - amt);
      } else {
        pending += m;
      }
    }
    return { paid, pending };
  }, [activeItems, byExpenseId]);

  const pieData = useMemo(
    () => [
      { name: "Pago", value: totals.paid },
      { name: "Pendente", value: totals.pending },
    ].filter((x) => x.value > 0),
    [totals]
  );

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Controle mensal</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>{ymLabel(localYear, localMonth)}</div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button style={styles.btnGhost} onClick={prevMonth} type="button">◀</button>
          <button style={styles.btnGhost} onClick={nextMonth} type="button">▶</button>
          <button style={styles.btnGhost} onClick={() => setAll(true)} type="button">Marcar tudo</button>
          <button style={styles.btnGhost} onClick={() => setAll(false)} type="button">Limpar</button>
        </div>
      </div>

      <div style={{ marginTop: 10, ...styles.gridAuto }}>
        <div style={styles.card}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Pago</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800 }}>{moneyBRL(totals.paid)}</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Pendente</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800 }}>{moneyBRL(totals.pending)}</div>
        </div>

        <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Pago x Pendente</div>
              <div style={{ ...styles.muted, fontSize: 13 }}>Considera pagamento parcial</div>
            </div>
            <span style={styles.badge}>Visão do mês</span>
          </div>

          <div style={{ width: "100%", height: 260, marginTop: 10 }}>
            {pieData.length === 0 ? (
              <div style={{ padding: 12, ...styles.muted }}>Sem dados para o mês selecionado.</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={56}
                    outerRadius={92}
                    paddingAngle={3}
                    cornerRadius={10}
                    stroke="rgba(255,255,255,.10)"
                    strokeWidth={2}
                  >
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<DarkTooltip formatter={(v) => moneyBRL(v)} />} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Histórico (últimos 6 meses)</div>
              <div style={{ ...styles.muted, fontSize: 13 }}>Total pago (usa valor parcial)</div>
            </div>
            <span style={styles.badge}>Auto</span>
          </div>

          <div style={{ width: "100%", height: 260, marginTop: 10 }}>
            {history.length === 0 ? (
              <div style={{ padding: 12, ...styles.muted }}>Carregando histórico...</div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={history} margin={{ left: 8, right: 12, top: 10, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} strokeDasharray="6 10" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} />
                  <YAxis
                    tick={axisTick}
                    axisLine={axisLine}
                    tickLine={false}
                    width={54}
                    tickFormatter={(v) => (v ? `R$ ${Math.round(v)}` : "0")}
                  />
                  <Tooltip content={<DarkTooltip formatter={(v) => moneyBRL(v)} />} />
                  <Line type="monotone" dataKey="total" name="Pago" stroke={CHART_COLORS[1]} strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "var(--card2)", fontWeight: 700, borderBottom: "1px solid var(--border)" }}>
          Marque como pago (somente ativos) • pagamento parcial
        </div>

        <div style={{ display: "grid", gap: 8, padding: 12 }}>
          {activeItems.length === 0 ? (
            <div style={{ ...styles.muted, padding: 8 }}>Nenhum gasto ativo.</div>
          ) : (
            activeItems.map((e) => {
              const row = byExpenseId.get(e.id);
              const isPaid = Boolean(row?.paid);
              const paidAmt = row?.paid ? Number(row.paid_amount ?? getMonthlyAmount(e)) : 0;
              return (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: 10,
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,.04)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</div>
                    <div style={{ ...styles.muted, fontSize: 12 }}>
                      {e.category} • dia {e.due_day} • {isPaid ? `pago ${moneyBRL(paidAmt)}` : "pendente"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => togglePaid(e)}
                    style={{
                      ...styles.btnGhost,
                      borderColor: isPaid ? "rgba(34,197,94,.35)" : "rgba(255,255,255,.14)",
                      background: isPaid ? "rgba(34,197,94,.12)" : "var(--card2)",
                      color: "var(--text)",
                      minWidth: 150,
                    }}
                  >
                    {isPaid ? "✅ Pago" : "Marcar pago"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {loading ? <div style={{ ...styles.muted, marginTop: 10 }}>Carregando...</div> : null}
    </div>
  );
}


