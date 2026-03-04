import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { moneyBRL, styles, ymLabel } from "./ui";

export default function PaymentHistory({ userId, defaultYear, defaultMonth }) {
  const now = new Date();
  const [year, setYear] = useState(defaultYear ?? now.getFullYear());
  const [month, setMonth] = useState(defaultMonth ?? now.getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [receiptLoading, setReceiptLoading] = useState({});

  function isMissingColumnError(error, column) {
    const msg = String(error?.message || "").toLowerCase();
    const col = String(column).toLowerCase();
    const mentionsTableAndColumn =
      msg.includes("wallet_transactions") && (msg.includes(col) || msg.includes(`'${col}'`));
    return mentionsTableAndColumn && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"));
  }

  useEffect(() => {
    if (defaultYear) setYear(defaultYear);
    if (defaultMonth) setMonth(defaultMonth);
  }, [defaultYear, defaultMonth]);

  useEffect(() => {
    if (!userId) return;
    fetchPayments().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, year, month, kindFilter]);

  async function fetchPayments() {
    setLoading(true);
    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 0, 23, 59, 59, 999).toISOString();

    const baseSelect = "id, kind, amount, description, note, created_at, ref_year, ref_month, ref_expense_id";
    let query = supabase
      .from("wallet_transactions")
      .select(`${baseSelect}, receipt_path, receipt_url`)
      .eq("user_id", userId)
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false })
      .limit(500);

    if (kindFilter === "all") query = query.in("kind", ["expense_payment", "manual_expense"]);
    if (kindFilter === "fixed") query = query.eq("kind", "expense_payment");
    if (kindFilter === "variable") query = query.eq("kind", "manual_expense");

    let { data, error } = await query;
    if (isMissingColumnError(error, "receipt_path") || isMissingColumnError(error, "receipt_url")) {
      const fallback = await supabase
        .from("wallet_transactions")
        .select(baseSelect)
        .eq("user_id", userId)
        .gte("created_at", start)
        .lte("created_at", end)
        .order("created_at", { ascending: false })
        .limit(500);
      data = fallback.data;
      error = fallback.error;
    }

    setLoading(false);
    if (error) return alert(error.message);
    setRows(data ?? []);
  }

  async function openReceipt(row) {
    if (!row?.receipt_path && !row?.receipt_url) return;
    const key = row.id;
    setReceiptLoading((s) => ({ ...s, [key]: true }));
    try {
      if (row.receipt_url) {
        window.open(row.receipt_url, "_blank", "noopener,noreferrer");
        return;
      }

      const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(row.receipt_path, 60 * 10);
      if (error) return alert(error.message);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } finally {
      setReceiptLoading((s) => ({ ...s, [key]: false }));
    }
  }

  const filtered = useMemo(() => {
    const needle = (q || "").trim().toLowerCase();
    if (!needle) return rows;
    return (rows ?? []).filter((r) => {
      const text = `${r.description || ""} ${r.note || ""}`.toLowerCase();
      return text.includes(needle);
    });
  }, [rows, q]);

  const total = useMemo(() => {
    return (filtered ?? []).reduce((acc, r) => acc + Math.abs(Number(r.amount || 0)), 0);
  }, [filtered]);

  const monthTitle = useMemo(() => ymLabel(year, month), [year, month]);

  return (
    <div style={{ ...styles.card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Historico de pagamentos</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Pagamentos de fixos + saidas variaveis da carteira
          </div>
        </div>
        <span style={{ ...styles.badge, fontSize: 13 }}>{loading ? "Carregando..." : monthTitle}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 12 }}>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Total pago no mes</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyBRL(total)}</div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 13 }}>Registros</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{filtered.length}</div>
        </div>

        <div style={{ ...styles.card, background: "var(--card2)", gridColumn: "1 / -1" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Ano</div>
              <input
                style={styles.input}
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
              />
            </div>
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Mes</div>
              <select style={styles.input} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Tipo</div>
              <select style={styles.input} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                <option value="all">Fixos + variaveis</option>
                <option value="fixed">Somente fixos</option>
                <option value="variable">Somente variaveis</option>
              </select>
            </div>
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Buscar</div>
              <input style={styles.input} placeholder="Ex.: aluguel, parcela 2/10..." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
              <button style={styles.btnSmall} type="button" onClick={() => fetchPayments()} disabled={loading}>
                Atualizar
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", fontWeight: 900, background: "var(--card2)" }}>Pagamentos</div>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Nenhum pagamento registrado para {monthTitle}.</div>
        ) : (
          <div>
            {filtered.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "10px 12px",
                  borderTop: "1px solid var(--border)",
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 10,
                  alignItems: "start",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 850, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(r.kind === "manual_expense" ? "[Variavel] " : "") + (r.description || r.note || "(sem descricao)")}
                  </div>
                  <div style={{ ...styles.muted, fontSize: 12, marginTop: 2 }}>{new Date(r.created_at).toLocaleString()}</div>
                </div>
                <div style={{ fontWeight: 950 }}>{moneyBRL(Math.abs(Number(r.amount || 0)))}</div>
                <button
                  style={styles.btnGhost}
                  type="button"
                  disabled={receiptLoading[r.id] || (!r.receipt_path && !r.receipt_url)}
                  onClick={() => openReceipt(r)}
                  title={r.receipt_path || r.receipt_url ? "Abrir comprovante" : "Sem comprovante"}
                >
                  {receiptLoading[r.id] ? "Abrindo..." : "Comprovante"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
