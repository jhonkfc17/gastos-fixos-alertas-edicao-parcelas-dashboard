import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Tooltip,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { clampDay, expenseMonthInfo, moneyBRL, nextDueDate, styles } from "./ui";
import { CHART_COLORS, DarkTooltip, axisLine, axisTick, gridStroke } from "./chartTheme.jsx";

export default function Dashboard({ items, paidExpenseIds }) {
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth() + 1;

  const { totalActive, activeCount, allCount, byCategory, topUpcoming, alerts } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const today = new Date(y, now.getMonth(), now.getDate());
    const tomorrow = new Date(y, now.getMonth(), now.getDate() + 1);
    const paidSet = new Set(paidExpenseIds ?? []);

    const active = (items ?? [])
      .filter((i) => i.active)
      .filter((i) => expenseMonthInfo(i, y, m).applicable);
    const totalActive = active.reduce((acc, i) => acc + Number(i.amount || 0), 0);

    const byCategory = Object.values(
      active.reduce((acc, item) => {
        const key = item.category || "Outros";
        if (!acc[key]) acc[key] = { name: key, value: 0 };
        acc[key].value += Number(item.amount || 0);
        return acc;
      }, {})
    ).sort((a, b) => b.value - a.value);

    const topUpcoming = [...active]
      .map((i) => ({ ...i, nextDue: nextDueDate(i.due_day) }))
      .sort((a, b) => a.nextDue - b.nextDue)
      .slice(0, 6);

    // Alert cards: somente itens não pagos (mês atual)
    let overdueCount = 0;
    let overdueTotal = 0;
    let todayCount = 0;
    let todayTotal = 0;
    let tomorrowCount = 0;
    let tomorrowTotal = 0;

    for (const exp of active) {
      if (paidSet.has(exp.id)) continue;

      const due = new Date(y, m - 1, clampDay(exp.due_day));
      if (due < today) {
        overdueCount += 1;
        overdueTotal += Number(exp.amount || 0);
        continue;
      }

      // hoje / amanhã (pode cair no próximo mês)
      const nextDue = nextDueDate(exp.due_day, today);
      const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      if (sameDay(nextDue, today)) {
        todayCount += 1;
        todayTotal += Number(exp.amount || 0);
      } else if (sameDay(nextDue, tomorrow)) {
        tomorrowCount += 1;
        tomorrowTotal += Number(exp.amount || 0);
      }
    }

    return {
      totalActive,
      activeCount: active.length,
      allCount: (items ?? []).length,
      byCategory,
      topUpcoming,
      alerts: {
        overdueCount,
        overdueTotal,
        todayCount,
        todayTotal,
        tomorrowCount,
        tomorrowTotal,
      },
    };
  }, [items, paidExpenseIds]);

  return (
    <div style={styles.gridAuto}>
      <Card title="Total mensal (ativos)" value={moneyBRL(totalActive)} />
      <Card title="Gastos ativos" value={String(activeCount)} />
      <Card title="Total cadastrados" value={String(allCount)} />

      <div style={{ ...styles.card, gridColumn: "1 / -1", padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>⚡ Alertas de vencimento</div>
            <div style={{ ...styles.muted, fontSize: 13 }}>Considera apenas gastos ativos e ainda não pagos no mês atual.</div>
          </div>
          <span style={styles.badge}>Hoje / Amanhã / Atrasados</span>
        </div>

        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          <AlertCard
            kind="overdue"
            title="Atrasados"
            subtitle={`${alerts.overdueCount} contas`}
            value={moneyBRL(alerts.overdueTotal)}
          />
          <AlertCard
            kind="today"
            title="Vence hoje"
            subtitle={`${alerts.todayCount} contas`}
            value={moneyBRL(alerts.todayTotal)}
          />
          <AlertCard
            kind="tomorrow"
            title="Vence amanhã"
            subtitle={`${alerts.tomorrowCount} contas`}
            value={moneyBRL(alerts.tomorrowTotal)}
          />
        </div>
      </div>

      <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Próximos vencimentos</div>
            <div style={{ ...styles.muted, fontSize: 13 }}>Baseado na data de hoje</div>
          </div>
          <span style={styles.badge}>Top 6</span>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {topUpcoming.length === 0 ? (
            <div style={{ ...styles.muted, padding: 12 }}>Nenhum gasto ativo.</div>
          ) : (
            topUpcoming.map((x) => (
              <div
                key={x.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: 10,
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--card2)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontWeight: 800 }}>
                    {(() => {
                      const info = expenseMonthInfo(x, nowY, nowM);
                      const suffix = info.installmentIndex && info.installmentTotal
                        ? ` (Parcela ${info.installmentIndex}/${info.installmentTotal})`
                        : "";
                      return `${x.name}${suffix}`;
                    })()}
                  </div>
                  <div style={{ ...styles.muted, fontSize: 13 }}>{x.category} • dia {x.due_day}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 900 }}>{moneyBRL(x.amount)}</div>
                  <div style={{ ...styles.muted, fontSize: 13 }}>{x.nextDue.toLocaleDateString("pt-BR")}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Por categoria</div>
            <div style={{ ...styles.muted, fontSize: 13 }}>Somente gastos ativos</div>
          </div>
          <span style={styles.badge}>Donut</span>
        </div>

        <div style={{ width: "100%", height: 280, marginTop: 10 }}>
          {byCategory.length === 0 ? (
            <div style={{ ...styles.muted, padding: 14 }}>Cadastre um gasto ativo para ver o gráfico.</div>
          ) : (
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={byCategory}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={95}
                  paddingAngle={2}
                  cornerRadius={10}
                  stroke="rgba(255,255,255,.10)"
                  strokeWidth={2}
                >
                  {byCategory.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip formatter={(v) => moneyBRL(v)} />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {byCategory.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {byCategory.slice(0, 8).map((c, idx) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--card2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: CHART_COLORS[idx % CHART_COLORS.length],
                      boxShadow: "0 0 0 3px rgba(255,255,255,.06)",
                      flex: "0 0 auto",
                    }}
                  />
                  <span style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.name}
                  </span>
                </div>
                <span style={{ fontWeight: 900 }}>{moneyBRL(c.value)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ ...styles.card, gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Ranking por categoria</div>
            <div style={{ ...styles.muted, fontSize: 13 }}>Total mensal (ativos)</div>
          </div>
          <span style={styles.badge}>Bar</span>
        </div>

        <div style={{ width: "100%", height: 320, marginTop: 10 }}>
          {byCategory.length === 0 ? (
            <div style={{ ...styles.muted, padding: 14 }}>Cadastre um gasto ativo para ver o gráfico.</div>
          ) : (
            <ResponsiveContainer>
              <BarChart data={byCategory} margin={{ left: 8, right: 12, top: 10, bottom: 10 }}>
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.55} />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke={gridStroke} strokeDasharray="6 10" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={axisTick}
                  axisLine={axisLine}
                  tickLine={false}
                  interval={0}
                  height={48}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={axisLine}
                  tickLine={false}
                  tickFormatter={(v) => (v ? `R$ ${Math.round(v)}` : "0")}
                  width={54}
                />
                <Tooltip content={<DarkTooltip formatter={(v) => moneyBRL(v)} />} />
                <Bar dataKey="value" name="Total" fill="url(#barGrad)" radius={[12, 12, 4, 4]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ title, value }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.muted, fontSize: 13 }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, letterSpacing: -0.2 }}>{value}</div>
    </div>
  );
}

function AlertCard({ kind, title, subtitle, value }) {
  const meta = {
    overdue: { cls: "alertCardBase alertOverdue", chip: "Urgente" },
    today: { cls: "alertCardBase alertToday", chip: "Hoje" },
    tomorrow: { cls: "alertCardBase alertTomorrow", chip: "Amanhã" },
  }[kind];

  return (
    <div
      className={meta.cls}
      style={{
        padding: 14,
        background: "linear-gradient(135deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.03) 70%)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{title}</div>
          <div style={{ ...styles.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</div>
        </div>
        <span style={styles.badge}>{meta.chip}</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 22, fontWeight: 950, letterSpacing: -0.2 }}>{value}</div>
    </div>
  );
}
