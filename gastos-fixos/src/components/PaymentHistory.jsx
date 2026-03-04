import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { styles, ymLabel } from "./ui";
import { formatBRL, parseMoneyToNumber } from "../utils/money";
import { safeSelect } from "../utils/supabaseSafe";

function monthKey(d) {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function PaymentHistory({ userId, refreshKey }) {
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");

  const ymStr = useMemo(() => `${ym.year}-${String(ym.month).padStart(2, "0")}`, [ym]);

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, ymStr, refreshKey]);

  async function fetchHistory() {
    setLoading(true);

    // Use select(*) to avoid breaking if some optional columns don't exist yet.
    const start = new Date(ym.year, ym.month - 1, 1);
    const end = new Date(ym.year, ym.month, 1);

    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false });

    setLoading(false);
    if (error) return alert(error.message);

    setRows(data ?? []);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const s = `${r.description || ""} ${r.category || ""} ${r.type || r.kind || ""}`.toLowerCase();
      return s.includes(q);
    });
  }, [rows, query]);

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={styles.h2}>Histórico de pagamentos</div>
          <div style={styles.muted}>Filtre por mês e pesquise por nome/categoria.</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={ymStr}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map((x) => parseInt(x, 10));
              setYm({ year: y, month: m });
            }}
            style={styles.input}
          >
            {Array.from({ length: 24 }).map((_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const y = d.getFullYear();
              const m = d.getMonth() + 1;
              const v = `${y}-${String(m).padStart(2, "0")}`;
              return (
                <option key={v} value={v}>
                  {ymLabel(y, m)}
                </option>
              );
            })}
          </select>

          <input
            placeholder="Buscar..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...styles.input, width: 220 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div style={styles.muted}>Carregando...</div>
        ) : filtered.length === 0 ? (
          <div style={styles.muted}>Nenhum pagamento registrado neste mês.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Data</th>
                  <th style={styles.th}>Descrição</th>
                  <th style={styles.th}>Categoria</th>
                  <th style={styles.th}>Tipo</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Valor</th>
                  <th style={styles.th}>Parcela</th>
                  <th style={styles.th}>Comprovante</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const dt = r.created_at ? new Date(r.created_at) : null;
                  const parcela =
                    r.installment_number && r.installment_total
                      ? `${r.installment_number}/${r.installment_total}`
                      : r.installment_label || "";

                  return (
                    <tr key={r.id}>
                      <td style={styles.td}>{dt ? dt.toLocaleString("pt-BR") : "-"}</td>
                      <td style={styles.td}>{r.description || "-"}</td>
                      <td style={styles.td}>{r.category || "-"}</td>
                      <td style={styles.td}>{r.type || r.kind || "-"}</td>
                      <td style={{ ...styles.td, textAlign: "right" }}>{formatBRL(r.amount)}</td>
                      <td style={styles.td}>{parcela || "-"}</td>
                      <td style={styles.td}>
                        {r.receipt_url ? (
                          <a href={r.receipt_url} target="_blank" rel="noreferrer">
                            Ver
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
