export const styles = {
  container: {
    padding: 18,
    maxWidth: 1200,
    margin: "0 auto",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    padding: 16,
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    background: "var(--card)",
    boxShadow: "var(--shadow)",
  },
  h1: {
    fontSize: 22,
    margin: 0,
    letterSpacing: -0.4,
    fontWeight: 900,
  },
  muted: {
    color: "var(--muted)",
  },
  gridAuto: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 14,
    alignItems: "start",
  },
  card: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow)",
    padding: 14,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    outline: "none",
    background: "var(--input)",
    color: "var(--text)",
  },
  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.10)",
    background: "linear-gradient(135deg, var(--primary) 0%, var(--primary2) 120%)",
    color: "var(--primaryText)",
    cursor: "pointer",
    fontWeight: 800,
  },
  btnGhost: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--card2)",
    color: "var(--text)",
    cursor: "pointer",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: "var(--card2)",
    fontSize: 12,
    color: "var(--muted)",
  },
};

export function setTheme(theme) {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function moneyBRL(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ymLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function clampDay(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 1;
  return Math.min(31, Math.max(1, Math.trunc(n)));
}

export function nextDueDate(day, baseDate = new Date()) {
  const dueDay = clampDay(day);
  const y = baseDate.getFullYear();
  const m = baseDate.getMonth();
  let d = new Date(y, m, dueDay);
  const today = new Date(y, m, baseDate.getDate());
  if (d < today) d = new Date(y, m + 1, dueDay);
  return d;
}

export function ymIndex(year, month) {
  return Number(year) * 12 + (Number(month) - 1);
}

export function expenseMonthInfo(expense, year, month) {
  // For installment expenses, only show during the installment window.
  if (!expense?.is_installment) {
    return { applicable: true, installmentIndex: null, installmentTotal: null };
  }

  const total = Number(expense.installment_total);
  const sy = Number(expense.installment_start_year);
  const sm = Number(expense.installment_start_month);

  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(sy) || !Number.isFinite(sm)) {
    return { applicable: true, installmentIndex: null, installmentTotal: total || null };
  }

  const diff = ymIndex(year, month) - ymIndex(sy, sm);
  const applicable = diff >= 0 && diff < total;
  return {
    applicable,
    installmentIndex: applicable ? diff + 1 : null,
    installmentTotal: total,
  };
}

export function isInstallmentCompleted(expense, refYear, refMonth) {
  if (!expense?.is_installment) return false;
  const total = Number(expense.installment_total);
  const sy = Number(expense.installment_start_year);
  const sm = Number(expense.installment_start_month);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(sy) || !Number.isFinite(sm)) return false;

  const end = ymIndex(sy, sm) + (total - 1);
  return ymIndex(refYear, refMonth) > end;
}

export function installmentEndLabel(expense) {
  if (!expense?.is_installment) return null;
  const total = Number(expense.installment_total);
  const sy = Number(expense.installment_start_year);
  const sm = Number(expense.installment_start_month);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(sy) || !Number.isFinite(sm)) return null;

  const endIndex = ymIndex(sy, sm) + (total - 1);
  // convert back to year/month
  const y = Math.floor(endIndex / 12);
  const m = (endIndex % 12) + 1;
  return `${String(m).padStart(2, "0")}/${y}`;
}
