import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { expenseMonthInfo, moneyBRL, styles, ymLabel } from "./ui";
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

export default function MonthlyControl({ items, userId, year, month, onChangeYM, onStatusChange }) {
  const today = new Date();
  const [localYear, setLocalYear] = useState(year ?? today.getFullYear());
  const [localMonth, setLocalMonth] = useState(month ?? today.getMonth() + 1);

  const [status, setStatus] = useState([]);
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
  }, [userId, localYear, localMonth]);

  async function fetchStatus() {
    setLoading(true);
    const { data, error } = await supabase
      .from("monthly_expense_status")
      .select("id, expense_id, paid")
      .eq("year", localYear)
      .eq("month", localMonth);

    setLoading(false);
    if (error) return alert(error.message);
    const rows = data ?? [];
    setStatus(rows);
    onStatusChange?.(localYear, localMonth, rows);

    fetchHistory().catch(() => {});
  }

  async function fetchHistory() {
    if (!userId) return;

    const points = [];
    const now = new Date(localYear, localMonth - 1, 1);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      points.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    const years = [...new Set(points.map((p) => p.year))];
    const months = [...new Set(points.map((p) => p.month))];

    const { data, error } = await supabase
      .from("monthly_expense_status")
      .select("expense_id, year, month, paid")
      .in("year", years)
      .in("month", months);

    if (error) return;

    const active = (items ?? []).filter((i) => i.active);
    const byId = new Map(active.map((i) => [i.id, i]));

    const byKey = new Map();
    for (const p of points) byKey.set(`${p.year}-${p.month}`, 0);

    for (const row of data ?? []) {
      const key = `${row.year}-${row.month}`;
      if (!byKey.has(key)) continue;
      if (!row.paid) continue;
      const exp = byId.get(row.expense_id);
      if (!exp) continue;
      if (!expenseMonthInfo(exp, row.year, row.month).applicable) continue;
      byKey.set(key, (byKey.get(key) || 0) + Number(exp.amount || 0));
    }

    const out = points.map((p) => {
      const key = `${p.year}-${p.month}`;
      const label = new Date(p.year, p.month - 1, 1).toLocaleDateString("pt-BR", { month: "short" });
      return { label, total: byKey.get(key) || 0 };
    });

    setHistory(out);
  }

  async function togglePaid(expenseId) {
    const existing = status.find((row) => row.expense_id === expenseId);
    const nextPaid = existing ? !existing.paid : true;

    const payload = {
      user_id: userId,
      expense_id: expenseId,
      year: localYear,
      month: localMonth,
      paid: nextPaid,
    };

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) return alert(error.message);

    // Saída automática na carteira quando marcar como pago
    await syncWalletForExpense(expenseId, nextPaid);
    fetchStatus();
  }

  async function syncWalletForExpense(expenseId, isPaid) {
    try {
      const exp = (items ?? []).find((i) => i.id === expenseId);
      if (!exp) return;
      if (!expenseMonthInfo(exp, localYear, localMonth).applicable) return;

      if (isPaid) {
        const payload = {
          user_id: userId,
          kind: "expense",
          amount: -Math.abs(Number(exp.amount || 0)),
          note: exp.name,
          ref_expense_id: exp.id,
          ref_year: localYear,
          ref_month: localMonth,
        };

        await supabase
          .from("wallet_transactions")
          .upsert(payload, { onConflict: "user_id,kind,ref_expense_id,ref_year,ref_month" });
      } else {
        await supabase
          .from("wallet_transactions")
          .delete()
          .eq("user_id", userId)
          .eq("kind", "expense")
          .eq("ref_expense_id", expenseId)
          .eq("ref_year", localYear)
          .eq("ref_month", localMonth);
      }
    } catch {
      // silencioso: carteira não pode quebrar o fluxo do controle mensal
    }
  }

  async function setAllPaid(nextPaid) {
    const active = (items ?? [])
      .filter((i) => i.active)
      .filter((i) => expenseMonthInfo(i, localYear, localMonth).applicable);
    if (active.length === 0) return;

    const payload = active.map((i) => ({
      user_id: userId,
      expense_id: i.id,
      year: localYear,
      month: localMonth,
      paid: Boolean(nextPaid),
    }));

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) return alert(error.message);

    // carteira: cria/remova saídas automáticas em lote
    try {
      const ids = active.map((i) => i.id);
      if (nextPaid) {
        const w = active.map((i) => ({
          user_id: userId,
          kind: "expense",
          amount: -Math.abs(Number(i.amount || 0)),
          note: i.name,
          ref_expense_id: i.id,
          ref_year: localYear,
          ref_month: localMonth,
        }));
        await supabase
          .from("wallet_transactions")
          .upsert(w, { onConflict: "user_id,kind,ref_expense_id,ref_year,ref_month" });
      } else {
        await supabase
          .from("wallet_transactions")
          .delete()
          .eq("user_id", userId)
          .eq("kind", "expense")
          .eq("ref_year", localYear)
          .eq("ref_month", localMonth)
          .in("ref_expense_id", ids);
      }
    } catch {
      // silencioso
    }

    fetchStatus();
  }

  function prevMonth() {
    const m = localMonth - 1;
    if (m < 1) {
      const y = localYear - 1;
      setLocalYear(y);
      setLocalMonth(12);
      onChangeYM?.({ year: y, month: 12 });
    } else {
      setLocalMonth(m);
      onChangeYM?.({ year: localYear, month: m });
    }
  }

  function nextMonth() {
    const m = localMonth + 1;
    if (m > 12) {
      const y = localYear + 1;
      setLocalYear(y);
      setLocalMonth(1);
      onChangeYM?.({ year: y, month: 1 });
    } else {
      setLocalMonth(m);
      onChangeYM?.({ year: localYear, month: m });
    }
  }

  const paidIds = useMemo(() => new Set(status.filter((row) => row.paid).map((row) => row.expense_id)), [status]);

  const { totalPaid, totalPending } = useMemo(() => {
    const list = (items ?? [])
      .filter((i) => i.active)
      .filter((i) => expenseMonthInfo(i, localYear, localMonth).applicable);

    const totalPaid = list.filter((i) => paidIds.has(i.id)).reduce((acc, i) => acc + Number(i.amount || 0), 0);
    const totalPending = list.filter((i) => !paidIds.has(i.id)).reduce((acc, i) => acc + Number(i.amount || 0), 0);
    return { totalPaid, totalPending };
  }, [items, paidIds, localYear, localMonth]);

  const pieData = useMemo(() => {
    return [
      { name: "Pago", value: totalPaid },
      { name: "Pendente", value: totalPending },
    ].filter((x) => x.value > 0);
  }, [totalPaid, totalPending]);

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
          <button style={styles.btnGhost} onClick={() => setAllPaid(true)} type="button">Marcar tudo</button>
          <button style={styles.btnGhost} onClick={() => setAllPaid(false)} type="button">Limpar</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginTop: 12 }}>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ fontWeight: 800 }}>Pago x Pendente</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>Somente gastos ativos</div>

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

          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ ...styles.muted, fontSize: 12 }}>Pago</div>
              <div style={{ fontWeight: 900 }}>{moneyBRL(totalPaid)}</div>
            </div>
            <div>
              <div style={{ ...styles.muted, fontSize: 12 }}>Pendente</div>
              <div style={{ fontWeight: 900 }}>{moneyBRL(totalPending)}</div>
            </div>
          </div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ fontWeight: 800 }}>Histórico (últimos 6 meses)</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>Total pago por mês (ativos)</div>

          <div style={{ width: "100%", height: 260, marginTop: 10 }}>
            {history.length === 0 ? (
              <div style={{ padding: 12, ...styles.muted }}>Sem dados.</div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={history} margin={{ left: 8, right: 12, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_COLORS[1]} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>

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
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Pago"
                    stroke={CHART_COLORS[1]}
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Gastos do mês</div>
        <div style={{ display: "grid", gap: 8 }}>
          {(items ?? [])
            .filter((i) => i.active)
            .filter((i) => expenseMonthInfo(i, localYear, localMonth).applicable)
            .map((x) => {
              const isPaid = paidIds.has(x.id);
              return (
                <div
                  key={x.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    borderRadius: 14,
                    border: "1px solid var(--border)",
                    background: "var(--card2)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {x.name}
                    </div>
                    <div style={{ ...styles.muted, fontSize: 13 }}>{x.category} • dia {x.due_day}</div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ fontWeight: 900 }}>{moneyBRL(x.amount)}</div>
                    <button
                      style={isPaid ? styles.btn : styles.btnGhost}
                      type="button"
                      onClick={() => togglePaid(x.id)}
                      disabled={loading}
                      title="Marcar/desmarcar como pago"
                    >
                      {isPaid ? "Pago" : "Pendente"}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
