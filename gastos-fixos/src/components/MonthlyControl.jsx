import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { styles, formatBRL, ymLabel } from "./ui";
import { parseMoneyToNumber } from "../utils/money";
import { uploadReceiptFile } from "../utils/receipts";
import { isMissingColumnError, safeInsert } from "../utils/supabaseSafe";

function ymKey(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function MonthlyControl({ userId, onPaymentRegistered }) {
  const [selectedYm, setSelectedYm] = useState(() => ymKey());
  const [expenses, setExpenses] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [loading, setLoading] = useState(false);

  // modal
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptError, setReceiptError] = useState("");

  const [paying, setPaying] = useState(false);

  const [year, month] = selectedYm.split("-").map((x) => parseInt(x, 10));

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedYm]);

  async function fetchData() {
    if (!userId) return;
    setLoading(true);

    const { data: exp, error: expErr } = await supabase
      .from("fixed_expenses")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true)
      .order("due_day", { ascending: true });

    if (expErr) {
      setLoading(false);
      alert(expErr.message);
      return;
    }

    const { data: st, error: stErr } = await supabase
      .from("monthly_expense_status")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month);

    setLoading(false);
    if (stErr) return alert(stErr.message);

    const map = {};
    (st ?? []).forEach((r) => (map[r.fixed_expense_id] = r));
    setStatusMap(map);
    setExpenses(exp ?? []);
  }

  const rows = useMemo(() => {
    return expenses.map((e) => {
      const st = statusMap[e.id];
      const isPaid = !!st?.paid;
      const paidInstallments = st?.paid_installments ?? 0;

      const installmentNumber =
        e.is_installment && e.installment_total
          ? Math.min(paidInstallments + 1, e.installment_total)
          : null;

      return { e, st, isPaid, paidInstallments, installmentNumber };
    });
  }, [expenses, statusMap]);

  function openPayModal(row) {
    setSelected(row);
    setPayAmount(String(row.e.amount ?? ""));
    setPaymentMethod(row.e.payment_method || "PIX");
    setReceiptFile(null);
    setReceiptError("");
    setOpen(true);
  }

  function handleReceiptChange(file) {
    setReceiptError("");
    if (!file) {
      setReceiptFile(null);
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setReceiptFile(null);
      setReceiptError("Arquivo muito grande. Limite de 10MB.");
      return;
    }

    setReceiptFile(file);
  }

  async function markPaid(row, { receiptUrl = null } = {}) {
    const now = new Date();
    const amount = parseMoneyToNumber(payAmount) ?? parseMoneyToNumber(row.e.amount) ?? 0;

    // 1) Upsert monthly status
    const newPaidInstallments =
      row.e.is_installment && row.e.installment_total
        ? Math.min((row.paidInstallments ?? 0) + 1, row.e.installment_total)
        : null;

    const isNowPaid =
      row.e.is_installment && row.e.installment_total
        ? newPaidInstallments >= row.e.installment_total
        : true;

    const statusRow = {
      user_id: userId,
      fixed_expense_id: row.e.id,
      year,
      month,
      paid: isNowPaid,
      paid_at: now.toISOString(),
      paid_installments: row.e.is_installment ? newPaidInstallments : null,
    };

    // Some schemas might not have paid_installments yet — retry without.
    const statusFallback = { ...statusRow };
    delete statusFallback.paid_installments;

    const { error: upsertErr } = await supabase
      .from("monthly_expense_status")
      .upsert(statusRow, { onConflict: "user_id,fixed_expense_id,year,month" });

    if (upsertErr && isMissingColumnError(upsertErr, "paid_installments")) {
      const { error: upsertErr2 } = await supabase
        .from("monthly_expense_status")
        .upsert(statusFallback, { onConflict: "user_id,fixed_expense_id,year,month" });
      if (upsertErr2) throw upsertErr2;
    } else if (upsertErr) {
      throw upsertErr;
    }

    // 2) Insert wallet transaction (safe if optional columns don't exist)
    const baseTx = {
      user_id: userId,
      type: "expense",
      amount,
      category: row.e.category,
      description: row.e.name,
      created_at: now.toISOString(),
    };

    const txWithReceipt = {
      ...baseTx,
      receipt_url: receiptUrl,
      fixed_expense_id: row.e.id,
      installment_number: row.installmentNumber,
      installment_total: row.e.installment_total || null,
      installment_label:
        row.installmentNumber && row.e.installment_total
          ? `${row.installmentNumber}/${row.e.installment_total}`
          : null,
    };

    const fallbackTx = { ...baseTx };

    const { error: txErr } = await safeInsert(
      supabase,
      "wallet_transactions",
      txWithReceipt,
      fallbackTx
    );
    if (txErr) throw txErr;
  }

  async function handleConfirmPay() {
    if (!selected) return;
    setPaying(true);
    try {
      let receiptUrl = null;

      if (receiptFile) {
        const { publicUrl, error } = await uploadReceiptFile({ supabase, file: receiptFile, userId });
        if (error) {
          throw new Error(`Falha ao enviar comprovante: ${error.message}`);
        }
        receiptUrl = publicUrl;
      }

      await markPaid(selected, { receiptUrl });
      setOpen(false);
      await fetchData();
      onPaymentRegistered && onPaymentRegistered();
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setPaying(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={styles.h2}>Gastos do mês</div>
          <div style={styles.muted}>Marque como pago (comprovante opcional) e atualize sua carteira automaticamente.</div>
        </div>

        <select value={selectedYm} onChange={(e) => setSelectedYm(e.target.value)} style={styles.input}>
          {Array.from({ length: 24 }).map((_, i) => {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const v = ymKey(d);
            const [yy, mm] = v.split("-").map((x) => parseInt(x, 10));
            return (
              <option key={v} value={v}>
                {ymLabel(yy, mm)}
              </option>
            );
          })}
        </select>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div style={styles.muted}>Carregando...</div>
        ) : rows.length === 0 ? (
          <div style={styles.muted}>Nenhum gasto fixo ativo.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Gasto</th>
                  <th style={styles.th}>Categoria</th>
                  <th style={{ ...styles.th, textAlign: "right" }}>Valor</th>
                  <th style={styles.th}>Venc.</th>
                  <th style={styles.th}>Parcela</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.e.id}>
                    <td style={styles.td}>{r.e.name}</td>
                    <td style={styles.td}>{r.e.category}</td>
                    <td style={{ ...styles.td, textAlign: "right" }}>{formatBRL(r.e.amount)}</td>
                    <td style={styles.td}>{r.e.due_day}</td>
                    <td style={styles.td}>
                      {r.e.is_installment && r.e.installment_total
                        ? `${Math.min((r.paidInstallments ?? 0) + 1, r.e.installment_total)}/${r.e.installment_total}`
                        : "-"}
                    </td>
                    <td style={styles.td}>{r.isPaid ? "Pago" : "Pendente"}</td>
                    <td style={styles.td}>
                      <button
                        style={styles.btn}
                        onClick={() => openPayModal(r)}
                        disabled={r.isPaid}
                        title={r.isPaid ? "Já pago neste mês" : "Marcar como pago"}
                      >
                        Marcar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && selected && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => !paying && setOpen(false)}
        >
          <div
            style={{ ...styles.card, width: "min(720px, 100%)", marginBottom: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={styles.h2}>Registrar pagamento</div>
                <div style={styles.muted}>
                  {selected.e.name} • {formatBRL(selected.e.amount)} • vence dia {selected.e.due_day}
                  {selected.e.is_installment && selected.e.installment_total ? (
                    <> • parcela {selected.installmentNumber}/{selected.e.installment_total}</>
                  ) : null}
                </div>
              </div>
              <button style={styles.btnGhost} onClick={() => !paying && setOpen(false)}>
                Fechar
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={styles.muted}>Valor pago</div>
                <input
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="Ex: 934,15"
                  style={styles.input}
                />
              </div>

              <div>
                <div style={styles.muted}>Método</div>
                <input
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="PIX, Cartão, Dinheiro..."
                  style={styles.input}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={styles.muted}>Comprovante (opcional)</div>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => handleReceiptChange(e.target.files?.[0] || null)}
                  style={styles.input}
                />
                {receiptFile ? (
                  <div style={{ ...styles.muted, fontSize: 12, marginTop: 6 }}>
                    Arquivo selecionado: {receiptFile.name}
                  </div>
                ) : null}
                {receiptError ? (
                  <div style={{ color: "#ff8b8b", fontSize: 12, marginTop: 6 }}>{receiptError}</div>
                ) : null}
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={styles.btnGhost} onClick={() => !paying && setOpen(false)} disabled={paying}>
                Cancelar
              </button>
              <button style={styles.btn} onClick={handleConfirmPay} disabled={paying}>
                {paying ? "Salvando..." : "Confirmar pagamento"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
