import React from "react";

export const CHART_COLORS = [
  "#7c3aed",
  "#22d3ee",
  "#60a5fa",
  "#22c55e",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#a78bfa",
];

export const gridStroke = "rgba(255,255,255,.08)";
export const axisTick = { fill: "rgba(229,231,235,.72)", fontSize: 12 };
export const axisLine = { stroke: "rgba(255,255,255,.12)" };

export function DarkTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const shownLabel = labelFormatter ? labelFormatter(label) : label;

  return (
    <div
      style={{
        background: "rgba(8,10,20,.92)",
        border: "1px solid rgba(255,255,255,.14)",
        borderRadius: 14,
        padding: "10px 12px",
        boxShadow: "0 18px 60px rgba(0,0,0,.55)",
        backdropFilter: "blur(10px)",
      }}
    >
      {shownLabel ? (
        <div style={{ fontWeight: 800, marginBottom: 6, color: "rgba(229,231,235,.9)" }}>{shownLabel}</div>
      ) : null}
      <div style={{ display: "grid", gap: 6 }}>
        {payload.map((p) => (
          <div key={`${p.dataKey}-${p.name}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: p.color || "#fff",
                boxShadow: "0 0 0 3px rgba(255,255,255,.06)",
              }}
            />
            <span style={{ color: "rgba(229,231,235,.78)", fontSize: 12 }}>{p.name ?? p.dataKey}</span>
            <span style={{ marginLeft: "auto", fontWeight: 900, color: "rgba(229,231,235,.95)" }}>
              {formatter ? formatter(p.value, p.name, p) : String(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
s
