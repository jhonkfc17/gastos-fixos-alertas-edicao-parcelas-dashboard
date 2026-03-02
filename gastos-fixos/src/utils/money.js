export function parseMoneyToNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  if (!s) return null;

  // Accept formats like "1.234,56" or "1234,56" or "1234.56"
  const normalized = s
    .replace(/\s/g, '')
    .replace(/\./g, '') // remove thousand separators
    .replace(',', '.');

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function formatBRL(value) {
  const n = typeof value === 'string' ? parseMoneyToNumber(value) : value;
  const num = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(num);
}
