export const styles = {
  container: { maxWidth: 1200, margin: "0 auto", padding: 20, color: "#fff" },

  h1: { fontSize: 22, fontWeight: 800, letterSpacing: 0.2 },
  h2: { fontSize: 18, fontWeight: 750 },

  muted: { opacity: 0.78, fontSize: 13 },

  card: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 16,
    padding: 16,
    backdropFilter: "blur(10px)",
  },

  gridAuto: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 },

  input: {
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 10,
    padding: "10px 12px",
    outline: "none",
  },

  btn: {
    background: "linear-gradient(135deg, rgba(140,90,255,1), rgba(0,210,255,1))",
    border: "none",
    color: "#0b0b0b",
    fontWeight: 800,
    borderRadius: 12,
    padding: "10px 14px",
    cursor: "pointer",
  },

  btnGhost: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#fff",
    fontWeight: 700,
    borderRadius: 12,
    padding: "10px 14px",
    cursor: "pointer",
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    fontSize: 12,
    fontWeight: 700,
  },

  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontSize: 12, opacity: 0.9, padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.12)" },
  td: { fontSize: 13, padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)", verticalAlign: "top" },
};

const THEME_KEY = "gastos_theme";

export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    return "dark";
  }
}

export function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

export function ymLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("pt-BR", { year: "numeric", month: "long" });
}

export function formatBRL(value) {
  const n = typeof value === "number" ? value : Number(value || 0);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? n : 0);
}
