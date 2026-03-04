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
  btnSmall: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.10)",
    background: "linear-gradient(135deg, var(--primary) 0%, var(--primary2) 120%)",
    color: "var(--primaryText)",
    cursor: "pointer",
    fontWeight: 700,
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

export function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function parseMoneyInput(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/[R$\s]/gi, "");
  if (!raw) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  let normalized = raw;
  if (hasComma && hasDot) {
    // Decide decimal separator by last occurrence.
    const commaLast = raw.lastIndexOf(",");
    const dotLast = raw.lastIndexOf(".");
    if (commaLast > dotLast) {
      // 1.234,56
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,234.56
      normalized = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    // 1234,56
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = raw.split(".");
    if (parts.length > 2) {
      // 1.234.567, fallback remove thousands dots
      const dec = parts.pop();
      normalized = `${parts.join("")}.${dec}`;
    } else {
      // Heuristic: if exactly 3 digits after dot in pt-BR, treat dot as thousands.
      const [intPart, fracPart] = parts;
      if (/^\d{3}$/.test(fracPart || "")) normalized = `${intPart}${fracPart}`;
      else normalized = raw;
    }
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function formatMoneyInput(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return roundMoney(n).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

  let due = new Date(y, m, dueDay);
  const today = new Date(y, m, baseDate.getDate());
  if (due < today) due = new Date(y, m + 1, dueDay);

  return due;
}

function ymIndex(year, month) {
  return Number(year) * 12 + (Number(month) - 1);
}

function installmentBounds(item) {
  const total = Number(item?.installment_total);
  const startMonth = Number(item?.installment_start_month);
  const startYear = Number(item?.installment_start_year);

  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(startMonth) || startMonth < 1 || startMonth > 12) return null;
  if (!Number.isFinite(startYear) || startYear < 1) return null;

  const start = ymIndex(startYear, startMonth);
  const end = start + total - 1;
  return { start, end, total };
}

export function expenseMonthInfo(item, year, month) {
  const isInstallment = Boolean(item?.is_installment);
  if (!isInstallment) {
    return {
      applicable: true,
      isInstallment: false,
      installmentIndex: null,
      installmentNumber: null,
      installmentTotal: null,
    };
  }

  const bounds = installmentBounds(item);
  if (!bounds) {
    return {
      applicable: true,
      isInstallment: true,
      installmentIndex: null,
      installmentNumber: null,
      installmentTotal: Number(item?.installment_total) || null,
    };
  }

  const current = ymIndex(year, month);
  const applicable = current >= bounds.start && current <= bounds.end;
  const number = applicable ? current - bounds.start + 1 : null;

  return {
    applicable,
    isInstallment: true,
    installmentIndex: number,
    installmentNumber: number,
    installmentTotal: bounds.total,
  };
}

export function isInstallmentCompleted(item, year, month) {
  if (!item?.is_installment) return false;
  const bounds = installmentBounds(item);
  if (!bounds) return false;
  return ymIndex(year, month) > bounds.end;
}

export function installmentEndLabel(item) {
  if (!item?.is_installment) return null;
  const bounds = installmentBounds(item);
  if (!bounds) return null;
  const endYear = Math.floor(bounds.end / 12);
  const endMonth = (bounds.end % 12) + 1;
  return `${String(endMonth).padStart(2, "0")}/${endYear}`;
}
