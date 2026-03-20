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
import { expenseMonthInfo, moneyBRL, nextDueDate, styles } from "./ui";
import { CHART_COLORS, DarkTooltip, axisLine, axisTick, gridStroke } from "./chartTheme";

export default function Dashboard({
  items,
  paidExpenseIds = [],
  variableSpentMonth = 0,
  variableByCategory = [],
  vehicleAlerts = [],
  onOpenCategory,
  onOpenVehicles,
  onSnoozeVehicleAlert,
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const nextMonthDate = new Date(year, month, 1);
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = nextMonthDate.getMonth() + 1;
  const nextMonthLabel = nextMonthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const paidSet = useMemo(() => new Set(paidExpenseIds), [paidExpenseIds]);

  const activeThisMonth = useMemo(() => {
    return (items ?? [])
      .filter((i) => i.active)
      .filter((i) => expenseMonthInfo(i, year, month).applicable);
  }, [items, year, month]);

  const totalActive = useMemo(() => {
    const fixed = activeThisMonth.reduce((acc, i) => acc + Number(i.amount || 0), 0);
    return fixed + Number(variableSpentMonth || 0);
  }, [activeThisMonth, variableSpentMonth]);

  const projectedNextMonth = useMemo(() => {
    return (items ?? [])
      .filter((i) => i.active)
      .filter((i) => expenseMonthInfo(i, nextYear, nextMonth).applicable)
      .reduce((acc, i) => acc + Number(i.amount || 0), 0);
  }, [items, nextMonth, nextYear]);

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const i of activeThisMonth) map.set(i.category, (map.get(i.category) || 0) + Number(i.amount || 0));
    for (const c of variableByCategory ?? []) map.set(c.name, (map.get(c.name) || 0) + Number(c.value || 0));
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [activeThisMonth, variableByCategory]);

  const nextDue = useMemo(() => {
    return [...activeThisMonth]
      .filter((i) => !paidSet.has(i.id))
      .map((i) => {
        const due = nextDueDate(i.due_day);
        return { ...i, _due: due };
      })
      .sort((a, b) => a._due - b._due)
      .slice(0, 8);
  }, [activeThisMonth, paidSet]);

  return (
    <div className="dashboardGrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      {vehicleAlerts.length > 0 ? (
        <div
          className="mobileCardTight alertToday"
          style={{ ...styles.card, gridColumn: "1 / -1", borderColor: "rgba(245,158,11,.40)", background: "rgba(245,158,11,.10)" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Atualize o KM atual do seu veiculo para manter as revisoes em dia.</div>
              <div style={{ ...styles.muted, fontSize: 13, marginTop: 4 }}>
                {vehicleAlerts.map((vehicle) => `${vehicle.name} (${vehicle.reminderLabel})`).join(" | ")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={styles.btn} type="button" onClick={() => onOpenVehicles?.()}>
                Atualizar agora
              </button>
              <button
                style={styles.btnGhost}
                type="button"
                onClick={() => vehicleAlerts.forEach((vehicle) => onSnoozeVehicleAlert?.(vehicle.id))}
              >
                Lembrar depois
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mobileCardTight" style={styles.card}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Resumo do mes</div>
        <div style={{ ...styles.muted, fontSize: 13 }}>Fixos ativos + saidas variaveis do mes</div>
        <div style={{ marginTop: 8, fontSize: 26, fontWeight: 950 }}>{moneyBRL(totalActive)}</div>
      </div>

      <div className="mobileCardTight" style={styles.card}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Previsto para o proximo mes</div>
        <div style={{ ...styles.muted, fontSize: 13 }}>{nextMonthLabel} | fixos e parcelas aplicaveis</div>
        <div style={{ marginTop: 8, fontSize: 26, fontWeight: 950 }}>{moneyBRL(projectedNextMonth)}</div>
      </div>

      <div className="mobileCardTight" style={{ ...styles.card, gridColumn: "1 / -1" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Ranking por categoria</div>
        <div style={{ ...styles.muted, fontSize: 13 }}>Total mensal (ativos)</div>
        {byCategory.length > 0 ? (
          <div style={{ ...styles.muted, fontSize: 12, marginTop: 4 }}>
            Toque em uma categoria para abrir os gastos relacionados.
          </div>
        ) : null}

        <div className="dashboardChartBox" style={{ width: "100%", height: 300, marginTop: 10 }}>
          {byCategory.length === 0 ? (
            <div style={{ ...styles.muted, padding: 14 }}>Cadastre um gasto ativo para ver o grafico.</div>
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
                <XAxis dataKey="name" tick={axisTick} axisLine={axisLine} tickLine={false} interval={0} height={48} />
                <YAxis
                  tick={axisTick}
                  axisLine={axisLine}
                  tickLine={false}
                  tickFormatter={(v) => (v ? `R$ ${Math.round(v)}` : "0")}
                  width={54}
                />
                <Tooltip content={<DarkTooltip formatter={(v) => moneyBRL(v)} />} />
                <Bar dataKey="value" name="Total" fill="url(#barGrad)" radius={[12, 12, 4, 4]}>
                  {byCategory.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill="url(#barGrad)"
                      cursor={onOpenCategory ? "pointer" : "default"}
                      onClick={() => onOpenCategory?.(entry.name)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {byCategory.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {byCategory.slice(0, 8).map((c, idx) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onOpenCategory?.(c.name)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--card2)",
                  color: "inherit",
                  font: "inherit",
                  cursor: onOpenCategory ? "pointer" : "default",
                  textAlign: "left",
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
                  <span style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                </div>
                <span style={{ fontWeight: 900 }}>{moneyBRL(c.value)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mobileCardTight" style={styles.card}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Proximos vencimentos</div>
        <div style={{ ...styles.muted, fontSize: 13 }}>Somente pendentes do mes atual</div>

        {nextDue.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Sem pendencias no momento.</div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {nextDue.map((x) => (
              <div
                key={x.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--card2)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div>
                  <div style={{ ...styles.muted, fontSize: 13 }}>{x.category} | dia {x.due_day}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 900 }}>{moneyBRL(x.amount)}</div>
                  <div style={{ ...styles.muted, fontSize: 12 }}>{x._due.toLocaleDateString("pt-BR")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mobileCardTight" style={styles.card}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Categorias (donut)</div>
        <div style={{ ...styles.muted, fontSize: 13 }}>Distribuicao do total mensal</div>

        <div className="dashboardChartBox" style={{ width: "100%", height: 280, marginTop: 10 }}>
          {byCategory.length === 0 ? (
            <div style={{ ...styles.muted, padding: 14 }}>Cadastre um gasto ativo para ver o grafico.</div>
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
                    <Cell
                      key={idx}
                      fill={CHART_COLORS[idx % CHART_COLORS.length]}
                      cursor={onOpenCategory ? "pointer" : "default"}
                      onClick={() => onOpenCategory?.(byCategory[idx]?.name)}
                    />
                  ))}
                </Pie>
                <Tooltip content={<DarkTooltip formatter={(v) => moneyBRL(v)} />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
