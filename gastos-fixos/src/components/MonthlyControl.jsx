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
      .select("id, expense_id, paid, paid_amount")
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
      .select("expense_id, year, month, paid, paid_amount")
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
      const paidValue = Number(row.paid_amount ?? exp.amount ?? 0);
      byKey.set(key, (byKey.get(key) || 0) + paidValue);
    }

    const out = points.map((p) => {
      const key = `${p.year}-${p.month}`;
      const label = new Date(p.year, p.month - 1, 1).toLocaleDateString("pt-BR", { month: "short" });
      return { label, total: byKey.get(key) || 0 };
    });

    setHistory(out);
  }

  async function togglePaid(expenseId) {
    const exp = (items ?? []).find((i) => i.id === expenseId);
    if (!exp) return;

    const existing = status.find((s) => s.expense_id === expenseId);
    const nextPaid = existing ? !existing.paid : true;

    let paidAmount = null;
    let paidAt = null;

    if (nextPaid) {
      const suggested = Number(exp.amount || 0);
      const raw = prompt("Valor pago (pode ser parcial):", String(suggested).replace(".", ","));
      if (raw === null) return; // cancelou
      const v = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) return alert("Informe um valor pago válido.");
      paidAmount = Math.round(v * 100) / 100;
      paidAt = new Date().toISOString();
    }

    const payload = {
      user_id: userId,
      expense_id: expenseId,
      year: localYear,
      month: localMonth,
      paid: nextPaid,
      paid_amount: paidAmount,
      paid_at: paidAt,
    };

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) return alert(error.message);

    // Saída automática na carteira (GLOBAL) quando marcar como pago
    await syncWalletForExpense(exp, nextPaid, paidAmount);

    fetchStatus();
  }

  async function syncWalletForExpense(exp, isPaid, paidAmount) {
    try {
      const info = expenseMonthInfo(exp, localYear, localMonth);
      if (!info.applicable) return;

      const value = Math.round(Number(paidAmount ?? exp.amount ?? 0) * 100) / 100;
      const amount = -Math.abs(value);

      // Sem depender de unique constraint: remove qualquer registro anterior desse gasto/mês e insere novamente.
      const baseWhere = (q) =>
        q
          .eq("user_id", userId)
          .eq("kind", "expense_payment")
          .eq("ref_expense_id", exp.id)
          .eq("ref_year", localYear)
          .eq("ref_month", localMonth);

      if (isPaid) {
        // remove possíveis duplicados
        await baseWhere(supabase.from("wallet_transactions").delete());

        const label = `${exp.name} • ${ymLabel(localYear, localMonth)}`;
        const { error } = await supabase.from("wallet_transactions").insert({
          user_id: userId,
          kind: "expense_payment",
          amount,
          description: label,
          note: label, // compatibilidade
          ref_expense_id: exp.id,
          ref_year: localYear,
          ref_month: localMonth,
          created_at: new Date().toISOString(),
        });
        if (error) console.error?.("[wallet] insert error", error);
      } else {
        const { error } = await baseWhere(supabase.from("wallet_transactions").delete());
        if (error) console.error?.("[wallet] delete error", error);
      }
    } catch (e) {
      console.error?.("[wallet] sync error", e);
    }
  }

  async function setAllPaid(nextPaid) {
    const active = (items ?? []).filter((i) => i.active);
    if (active.length === 0) return;

    if (nextPaid) {
      if (!confirm("Marcar todos os gastos ativos como pagos? (Será registrada saída automática na carteira)") ) return;
    }

    // aplica somente aos gastos aplicáveis no mês
    const applicable = active.filter((i) => expenseMonthInfo(i, localYear, localMonth).applicable);

    const payload = applicable.map((i) => ({
      user_id: userId,
      expense_id: i.id,
      year: localYear,
      month: localMonth,
      paid: Boolean(nextPaid),
      paid_amount: nextPaid ? Math.round(Number(i.amount || 0) * 100) / 100 : null,
      paid_at: nextPaid ? new Date().toISOString() : null,
    }));

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) return alert(error.message);

    // sincroniza carteira (em lote)
    if (nextPaid) {
      for (const exp of applicable) {
        // eslint-disable-next-line no-await-in-loop
        await syncWalletForExpense(exp, true, Math.round(Number(exp.amount || 0) * 100) / 100);
      }
    } else {
      for (const exp of applicable) {
        // eslint-disable-next-line no-await-in-loop
        await syncWalletForExpense(exp, false, null);
      }
    }

    fetchStatus();
  }

  function prevMonth() {
    const d = new Date(localYear, localMonth - 2, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    setLocalYear(y);
    setLocalMonth(m);
    onChangeYM?.(y, m);
  }

  function nextMonth() {
    const d = new Date(localYear, localMonth, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    setLocalYear(y);
    setLocalMonth(m);
    onChangeYM?.(y, m);
  }

  const applicableItems = useMemo(() => {
    return (items ?? []).filter((i) => i.active && expenseMonthInfo(i, localYear, localMonth).applicable);
  }, [items, localYear, localMonth]);

  const paidSet = useMemo(() => {
    const set = new Set();
    for (const s of status ?? []) if (s.paid) set.add(s.expense_id);
    return set;
  }, [status]);

  const totalMonth = useMemo(() => {
    return applicableItems.reduce((acc, i) => acc + Number(i.amount || 0), 0);
  }, [applicableItems]);

  const paidMonth = useMemo(() => {
    let sum = 0;
    for (const s of status ?? []) {
      if (!s.paid) continue;
      const exp = applicableItems.find((i) => i.id === s.expense_id);
      if (!exp) continue;
      sum += Number(s.paid_amount ?? exp.amount ?? 0);
    }
    return sum;
  }, [status, applicableItems]);

  const pieData = useMemo(() => {
    const paid = Math.max(0, paidMonth);
    const pending = Math.max(0, totalMonth - paid);
    return [
      { name: "Pago", value: paid },
      { name: "Pendente", value: pending },
    ].filter((d) => d.value > 0);
  }, [paidMonth, totalMonth]);

  return (
    <div style={{ ...styles.card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Controle mensal</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>{ymLabel(localYear, localMonth)} • somente gastos ativos aplicáveis</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={styles.btnGhost} onClick={prevMonth} type="button">◀</button>
          <button style={styles.btnGhost} onClick={nextMonth} type="button">▶</button>
          <button style={styles.btnGhost} onClick={() => setAllPaid(true)} type="button" title="Marca todos os ativos como pagos">
            Marcar tudo
          </button>
          <button style={styles.btnGhost} onClick={() => setAllPaid(false)} type="button" title="Desmarca todos os ativos">
            Limpar
          </button>
        </div>
      </div>

      <div style={{ ...styles.gridAuto, marginTop: 12 }}>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Total do mês</div>
          <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>{moneyBRL(totalMonth)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Pago</div>
          <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>{moneyBRL(paidMonth)}</div>
        </div>
      </div>

      <div style={{ ...styles.gridAuto, marginTop: 12 }}>
        <div style={{ ...styles.card, background: "var(--card2)", gridColumn: "1 / -1" }}>
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
        </div>

        <div style={{ ...styles.card, background: "var(--card2)", gridColumn: "1 / -1" }}>
          <div style={{ fontWeight: 800 }}>Histórico (últimos 6 meses)</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>Total pago por mês</div>
          <div style={{ width: "100%", height: 260, marginTop: 10 }}>
            {history.length === 0 ? (
              <div style={{ padding: 12, ...styles.muted }}>Sem dados suficientes.</div>
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

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "var(--card2)", fontWeight: 800, borderBottom: "1px solid var(--border)" }}>
          Marcar como pago
        </div>
        {applicableItems.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Nenhum gasto aplicável no mês.</div>
        ) : (
          applicableItems.map((exp) => {
            const paid = paidSet.has(exp.id);
            const badge = paid ? "Pago" : "Pendente";
            return (
              <div
                key={exp.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{exp.name}</div>
                  <div style={{ ...styles.muted, fontSize: 12 }}>{moneyBRL(exp.amount)} • vence dia {exp.due_day}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ ...styles.badge, background: paid ? "rgba(34,197,94,.16)" : "rgba(245,158,11,.14)" }}>
                    {badge}
                  </span>
                  <button style={paid ? styles.btnGhost : styles.btn} type="button" onClick={() => togglePaid(exp.id)}>
                    {paid ? "Desfazer" : "Marcar"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
