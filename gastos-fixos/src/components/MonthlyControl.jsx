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
import { CHART_COLORS, DarkTooltip, axisLine, axisTick, gridStroke } from "./chartTheme.jsx";

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
    const existing = status.find((s) => s.expense_id === expenseId);
    const payload = {
      user_id: userId,
      expense_id: expenseId,
      year: localYear,
      month: localMonth,
      paid: existing ? !existing.paid : true,
    };

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) return alert(error.message);

    // Saída automática na carteira quando marcar como pago
    await syncWalletForExpense(expenseId, payload.paid);
    fetchStatus();
  }

  
  async function syncWalletForExpense(expenseId, isPaid) {
    // Atualiza a carteira automaticamente ao marcar/desmarcar "Pago"
    // Compatível com 2 possíveis tabelas:
    // - wallet_entries (carteira por mês)
    // - wallet_transactions (carteira global com ref_year/ref_month)
    try {
      const exp = (items ?? []).find((i) => i.id === expenseId);
      if (!exp) return;
      const info = expenseMonthInfo(exp, localYear, localMonth);
      if (!info.applicable) return;

      const amount = -Math.abs(Number(exp.amount || 0));

      // Helper: tenta executar em uma tabela e retorna true se deu certo
      async function tryUpsert(table, row, onConflict) {
        const q = supabase.from(table).upsert(row, onConflict ? { onConflict } : undefined);
        const { error } = await q;
        if (error) throw error;
        return true;
      }

      async function tryDelete(table, whereFn) {
        const q = whereFn(supabase.from(table).delete());
        const { error } = await q;
        if (error) throw error;
        return true;
      }

      if (isPaid) {
        // 1) Tenta wallet_entries (por mês)
        try {
          await tryUpsert(
            "wallet_entries",
            {
              user_id: userId,
              kind: "expense",
              amount,
              note: exp.name,
              ref_expense_id: exp.id,
              year: localYear,
              month: localMonth,
              created_at: new Date().toISOString(),
            },
            "user_id,kind,ref_expense_id,year,month"
          );
          return;
        } catch (e1) {
          // segue para fallback
          console.debug?.("[wallet] wallet_entries não disponível/compatível, tentando wallet_transactions…", e1?.message);
        }

        // 2) Fallback: wallet_transactions (global)
        try {
          await tryUpsert(
            "wallet_transactions",
            {
              user_id: userId,
              kind: "expense",
              amount,
              note: exp.name,
              ref_expense_id: exp.id,
              ref_year: localYear,
              ref_month: localMonth,
            },
            "user_id,kind,ref_expense_id,ref_year,ref_month"
          );
        } catch (e2) {
          console.error?.("[wallet] Falha ao registrar saída automática na carteira:", e2?.message || e2);
        }
      } else {
        // desmarcou pago: remove saída automática
        try {
          await tryDelete("wallet_entries", (q) =>
            q
              .eq("user_id", userId)
              .eq("kind", "expense")
              .eq("ref_expense_id", expenseId)
              .eq("year", localYear)
              .eq("month", localMonth)
          );
          return;
        } catch (e1) {
          console.debug?.("[wallet] wallet_entries não disponível/compatível ao remover, tentando wallet_transactions…", e1?.message);
        }

        try {
          await tryDelete("wallet_transactions", (q) =>
            q
              .eq("user_id", userId)
              .eq("kind", "expense")
              .eq("ref_expense_id", expenseId)
              .eq("ref_year", localYear)
              .eq("ref_month", localMonth)
          );
        } catch (e2) {
          console.error?.("[wallet] Falha ao remover saída automática na carteira:", e2?.message || e2);
        }
      }
    } catch (e) {
      console.error?.("[wallet] Erro inesperado na sincronização:", e?.message || e);
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

    
    // carteira: cria/remova saídas automáticas em lote (mantém compatibilidade)
    try {
      const ids = active.map((i) => i.id);

      async function tryUpsertMany(table, rows, onConflict) {
        const { error } = await supabase.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
        if (error) throw error;
        return true;
      }

      async function tryDeleteMany(table, whereFn) {
        const { error } = await whereFn(supabase.from(table).delete());
        if (error) throw error;
        return true;
      }

      if (nextPaid) {
        // tenta wallet_entries
        try {
          const rows = active.map((i) => ({
            user_id: userId,
            kind: "expense",
            amount: -Math.abs(Number(i.amount || 0)),
            note: i.name,
            ref_expense_id: i.id,
            year: localYear,
            month: localMonth,
            created_at: new Date().toISOString(),
          }));
          await tryUpsertMany("wallet_entries", rows, "user_id,kind,ref_expense_id,year,month");
          // ok
        } catch (e1) {
          console.debug?.("[wallet] wallet_entries indisponível no lote, usando wallet_transactions…", e1?.message);

          const rows = active.map((i) => ({
            user_id: userId,
            kind: "expense",
            amount: -Math.abs(Number(i.amount || 0)),
            note: i.name,
            ref_expense_id: i.id,
            ref_year: localYear,
            ref_month: localMonth,
          }));
          await tryUpsertMany("wallet_transactions", rows, "user_id,kind,ref_expense_id,ref_year,ref_month");
        }
      } else {
        // remove em lote
        try {
          await tryDeleteMany("wallet_entries", (q) =>
            q
              .eq("user_id", userId)
              .eq("kind", "expense")
              .eq("year", localYear)
              .eq("month", localMonth)
              .in("ref_expense_id", ids)
          );
        } catch (e1) {
          console.debug?.("[wallet] wallet_entries indisponível ao remover lote, usando wallet_transactions…", e1?.message);

          await tryDeleteMany("wallet_transactions", (q) =>
            q
              .eq("user_id", userId)
              .eq("kind", "expense")
              .eq("ref_year", localYear)
              .eq("ref_month", localMonth)
              .in("ref_expense_id", ids)
          );
        }
      }
    } catch (e) {
      console.error?.("[wallet] Falha ao sincronizar carteira em lote:", e?.message || e);
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

  const paidIds = useMemo(() => new Set(status.filter((s) => s.paid).map((s) => s.expense_id)), [status]);

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
          <button style={styles.btnGhost} onClick={() => setAllPaid(true)} type="button" title="Marca todos os ativos como pagos">
            Marcar tudo
          </button>
          <button style={styles.btnGhost} onClick={() => setAllPaid(false)} type="button" title="Desmarca todos os ativos">
            Limpar
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10, ...styles.gridAuto }}>
        <div style={styles.card}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Pago</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>{moneyBRL(totalPaid)}</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Pendente</div>
          <div style={{ marginTop: 6, fontSize: 20, fontWeight: 900 }}>{moneyBRL(totalPending)}</div>
        </div>

        <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Pago x Pendente</div>
              <div style={{ ...styles.muted, fontSize: 13 }}>Somente gastos ativos</div>
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
              <div style={{ ...styles.muted, fontSize: 13 }}>Total marcado como pago</div>
            </div>
            <span style={styles.badge}>Trend</span>
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
          Marque como pago (somente ativos)
        </div>

        {loading ? (
          <div style={{ padding: 12, ...styles.muted }}>Carregando...</div>
        ) : (items ?? []).filter((i) => i.active).filter((i) => expenseMonthInfo(i, localYear, localMonth).applicable).length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Nenhum gasto ativo.</div>
        ) : (
          (items ?? [])
            .filter((i) => i.active)
            .filter((i) => expenseMonthInfo(i, localYear, localMonth).applicable)
            .map((item) => (
              <label
                key={item.id}
                style={{
                  padding: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 800 }}>{item.name}</span>
                  <span style={{ ...styles.muted, fontSize: 13 }}>
                    {(() => {
                      const info = expenseMonthInfo(item, localYear, localMonth);
                      const part = item.is_installment && info.installmentIndex && info.installmentTotal
                        ? ` • parcela ${info.installmentIndex}/${info.installmentTotal}`
                        : "";
                      return `${item.category} • vence dia ${item.due_day}${part}`;
                    })()}
                  </span>
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontWeight: 900 }}>{moneyBRL(item.amount)}</span>
                  <input type="checkbox" checked={paidIds.has(item.id)} onChange={() => togglePaid(item.id)} />
                </span>
              </label>
            ))
        )}
      </div>

      <div style={{ ...styles.muted, fontSize: 13, marginTop: 10, lineHeight: 1.35 }}>
        Observação: o “pago” é registrado por mês/ano e não altera o cadastro do gasto fixo.
      </div>
    </div>
  );
}
