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

export const moneyBRL = formatBRL;

function ymToIndex(year, month) {
  return Number(year) * 12 + (Number(month) - 1);
}

function installmentBounds(item) {
  const total = Number(item?.installment_total);
  const startMonth = Number(item?.installment_start_month);
  const startYear = Number(item?.installment_start_year);

  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(startMonth) || startMonth < 1 || startMonth > 12) return null;
  if (!Number.isFinite(startYear) || startYear < 1) return null;

  const start = ymToIndex(startYear, startMonth);
  const end = start + total - 1;
  return { start, end, total, startMonth, startYear };
}

export function expenseMonthInfo(item, year, month) {
  const isInstallment = Boolean(item?.is_installment);
  if (!isInstallment) {
    return {
      applicable: true,
      isInstallment: false,
      installmentNumber: null,
      installmentTotal: null,
    };
  }

  const bounds = installmentBounds(item);
  if (!bounds) {
    return {
      applicable: true,
      isInstallment: true,
      installmentNumber: null,
      installmentTotal: Number(item?.installment_total) || null,
    };
  }

  const current = ymToIndex(year, month);
  const applicable = current >= bounds.start && current <= bounds.end;
  const installmentNumber = applicable ? current - bounds.start + 1 : null;

  return {
    applicable,
    isInstallment: true,
    installmentNumber,
    installmentTotal: bounds.total,
  };
}

export function isInstallmentCompleted(item, year, month) {
  if (!item?.is_installment) return false;
  const bounds = installmentBounds(item);
  if (!bounds) return false;
  const current = ymToIndex(year, month);
  return current > bounds.end;
}

export function installmentEndLabel(item) {
  if (!item?.is_installment) return null;
  const bounds = installmentBounds(item);
  if (!bounds) return null;
  const endYear = Math.floor(bounds.end / 12);
  const endMonth = (bounds.end % 12) + 1;
  return `${String(endMonth).padStart(2, "0")}/${endYear}`;
}

export function nextDueDate(dueDay) {
  const today = new Date()
  const currentMonth = today.getMonth()
  const currentYear = today.getFullYear()

  let dueDate = new Date(currentYear, currentMonth, dueDay)

  if (today > dueDate) {
    dueDate = new Date(currentYear, currentMonth + 1, dueDay)
  }

  return dueDate.toISOString()
}
