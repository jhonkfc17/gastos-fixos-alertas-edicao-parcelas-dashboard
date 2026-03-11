import React, { useEffect, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import Auth from "./components/Auth";
import TopBar from "./components/TopBar";
import Dashboard from "./components/Dashboard";
import ExpenseForm from "./components/ExpenseForm";
import ExpenseList from "./components/ExpenseList";
import MonthlyControl from "./components/MonthlyControl";
import WalletPanel from "./components/WalletPanel";
import PaymentHistory from "./components/PaymentHistory";
import InvestmentsPanel from "./components/InvestmentsPanel";
import VehiclesPanel from "./components/VehiclesPanel";
import { expenseMonthInfo, formatMoneyInput, parseMoneyInput, roundMoney, styles, ymLabel } from "./components/ui";
import { downloadTextFile, toCSV } from "./lib/csv";
import { getVehicleReminderLabel, needsKmReminder } from "./components/vehicleMaintenance";

export default function App() {
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [walletRefresh, setWalletRefresh] = useState(0);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [paidExpenseIds, setPaidExpenseIds] = useState([]);
  const [monthPaidExpenseIds, setMonthPaidExpenseIds] = useState([]);
  const [variableSpentMonth, setVariableSpentMonth] = useState(0);
  const [variableByCategory, setVariableByCategory] = useState([]);
  const [payDialog, setPayDialog] = useState({ open: false, expenseName: "", amount: "", file: null });
  const payDialogResolver = useRef(null);
  const [activeTab, setActiveTab] = useState("painel");
  const [vehicleRefresh, setVehicleRefresh] = useState(0);
  const [vehicleAlerts, setVehicleAlerts] = useState([]);
  const [snoozedVehicleAlerts, setSnoozedVehicleAlerts] = useState([]);

  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    return () => {
      if (payDialogResolver.current) {
        payDialogResolver.current(null);
        payDialogResolver.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchCurrentMonthVariable().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, walletRefresh]);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchVehicleAlerts().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, vehicleRefresh, snoozedVehicleAlerts]);

  async function fetchItems() {
    setLoading(true);
    const { data, error } = await supabase.from("fixed_expenses").select("*").order("created_at", { ascending: false });
    setLoading(false);
    if (error) return alert(error.message);
    setItems(data ?? []);
  }

  function isMissingColumnError(error, column) {
    const msg = String(error?.message || "").toLowerCase();
    const col = String(column).toLowerCase();
    const mentionsTableAndColumn =
      msg.includes("wallet_transactions") && (msg.includes(col) || msg.includes(`'${col}'`));
    return mentionsTableAndColumn && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"));
  }

  function openPayDialog({ expenseName, suggestedAmount }) {
    return new Promise((resolve) => {
      payDialogResolver.current = resolve;
      setPayDialog({
        open: true,
        expenseName: expenseName || "",
        amount: Number.isFinite(Number(suggestedAmount)) ? formatMoneyInput(suggestedAmount) : "",
        file: null,
      });
    });
  }

  function closePayDialog(result) {
    setPayDialog((p) => ({ ...p, open: false }));
    if (payDialogResolver.current) {
      payDialogResolver.current(result);
      payDialogResolver.current = null;
    }
  }

  async function uploadReceiptFile(file, userId, refDate = new Date()) {
    if (!file || !userId) return { receiptPath: null, receiptUrl: null, error: null };
    const ext = file.name.split(".").pop();
    const y = refDate.getFullYear();
    const mo = String(refDate.getMonth() + 1).padStart(2, "0");
    const fileName = `${userId}/${y}/${mo}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error: uploadError } = await supabase.storage.from("receipts").upload(fileName, file);
    if (uploadError) return { receiptPath: null, receiptUrl: null, error: uploadError };

    const { data } = supabase.storage.from("receipts").getPublicUrl(fileName);
    return { receiptPath: fileName, receiptUrl: data?.publicUrl || null, error: null };
  }

  function parseVariableCategory(row) {
    const text = String(row?.description || row?.note || "").trim();
    const m = text.match(/^\[(.+?)\]/);
    if (m?.[1]) return m[1];
    return "Variaveis";
  }

  async function fetchCurrentMonthVariable() {
    const userId = session?.user?.id;
    if (!userId) return;

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

    const { data, error } = await supabase
      .from("wallet_transactions")
      .select("amount, description, note, created_at")
      .eq("user_id", userId)
      .eq("kind", "manual_expense")
      .gte("created_at", start)
      .lte("created_at", end);

    if (error) return;

    const rows = data ?? [];
    const total = rows.reduce((acc, r) => acc + Math.abs(Number(r.amount || 0)), 0);
    const byCat = new Map();
    for (const r of rows) {
      const cat = parseVariableCategory(r);
      byCat.set(cat, (byCat.get(cat) || 0) + Math.abs(Number(r.amount || 0)));
    }

    setVariableSpentMonth(total);
    setVariableByCategory(
      [...byCat.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
    );
  }

  function isMissingTableError(error, tableName) {
    const msg = String(error?.message || "").toLowerCase();
    return (
      msg.includes(String(tableName).toLowerCase())
      && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("schema cache"))
    );
  }

  async function fetchVehicleAlerts() {
    const userId = session?.user?.id;
    if (!userId) return;

    const { data, error } = await supabase
      .from("vehicles")
      .select("id, name, brand, model, odometer_km, last_km_update_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingTableError(error, "vehicles")) {
        setVehicleAlerts([]);
        return;
      }
      return;
    }

    const nextAlerts = (data ?? [])
      .filter((vehicle) => needsKmReminder(vehicle))
      .filter((vehicle) => !snoozedVehicleAlerts.includes(vehicle.id))
      .map((vehicle) => ({
        ...vehicle,
        reminderLabel: getVehicleReminderLabel(vehicle),
      }));

    setVehicleAlerts(nextAlerts);
  }

  function handleStatusChange(y, m, rows) {
    if (y === ym.year && m === ym.month) {
      const paidForSelectedMonth = (rows ?? []).filter((r) => r.paid).map((r) => r.expense_id);
      setMonthPaidExpenseIds(paidForSelectedMonth);
    }

    const now = new Date();
    if (y === now.getFullYear() && m === now.getMonth() + 1) {
      const paidForCurrentMonth = (rows ?? []).filter((r) => r.paid).map((r) => r.expense_id);
      setPaidExpenseIds(paidForCurrentMonth);
    }
  }

  async function addExpense(form) {
    const userId = session?.user?.id;
    const baseAmount = parseMoneyInput(form.amount);
    const totalAmount = parseMoneyInput(form.totalAmount);
    const installmentCount = Number(form.installments);

    const payload = {
      user_id: userId,
      name: String(form.name || "").trim(),
      category: form.category,
      amount: form.isInstallment
        ? roundMoney((totalAmount ?? 0) / (installmentCount || 1))
        : roundMoney(baseAmount ?? 0),
      due_day: Number(form.dueDay),
      payment_method: form.payment,
      active: !!form.active,
      is_installment: !!form.isInstallment,
      installment_total_amount: form.isInstallment ? roundMoney(totalAmount ?? 0) : null,
      installment_total: form.isInstallment ? installmentCount : null,
      installment_start_month: form.isInstallment ? Number(form.startMonth) : null,
      installment_start_year: form.isInstallment ? Number(form.startYear) : null,
    };

    if (!payload.user_id) return alert("Sessao invalida: usuario nao encontrado.");
    if (!payload.name) return alert("Informe o nome do gasto.");
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) return alert("Valor invalido.");
    if (!Number.isFinite(payload.due_day) || payload.due_day < 1 || payload.due_day > 31) {
      return alert("Dia invalido (1-31).");
    }

    if (payload.is_installment) {
      if (!Number.isFinite(payload.installment_total) || payload.installment_total < 2) {
        return alert("Qtd. de parcelas invalida (minimo 2).");
      }
      if (!Number.isFinite(payload.installment_start_month) || payload.installment_start_month < 1 || payload.installment_start_month > 12) {
        return alert("Mes inicial invalido (1-12).");
      }
      if (!Number.isFinite(payload.installment_start_year) || payload.installment_start_year < 2000 || payload.installment_start_year > 2100) {
        return alert("Ano inicial invalido.");
      }
    }

    setSaving(true);
    const { error } = await supabase.from("fixed_expenses").insert(payload);
    setSaving(false);

    if (error) return alert(error.message);
    await fetchItems();
    return true;
  }

  async function updateExpense(id, fields) {
    const patch = { ...fields };

    if (Object.prototype.hasOwnProperty.call(patch, "amount")) {
      const n = parseMoneyInput(patch.amount);
      if (!Number.isFinite(n) || n <= 0) {
        alert("Valor invalido.");
        return;
      }
      patch.amount = roundMoney(n);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "due_day")) {
      const d = Number(patch.due_day);
      if (!Number.isFinite(d) || d < 1 || d > 31) {
        alert("Dia invalido (1-31).");
        return;
      }
      patch.due_day = d;
    }

    const { error } = await supabase.from("fixed_expenses").update(patch).eq("id", id);
    if (error) return alert(error.message);
    fetchItems();
  }

  async function toggleActive(id, nextActive) {
    const { error } = await supabase.from("fixed_expenses").update({ active: nextActive }).eq("id", id);
    if (error) return alert(error.message);
    fetchItems();
  }

  async function removeExpense(id) {
    if (!confirm("Remover este gasto?")) return;
    const { error } = await supabase.from("fixed_expenses").delete().eq("id", id);
    if (error) return alert(error.message);
    fetchItems();
  }

  async function syncWalletForExpense(exp, year, month, isPaid, paidAmount, receipt = {}) {
    try {
      const userId = session?.user?.id;
      const info = expenseMonthInfo(exp, year, month);
      if (!userId || !info.applicable) return;

      const value = roundMoney(paidAmount ?? exp.amount ?? 0);
      const amount = -Math.abs(value);

      const baseWhere = (q) =>
        q
          .eq("user_id", userId)
          .eq("kind", "expense_payment")
          .eq("ref_expense_id", exp.id)
          .eq("ref_year", year)
          .eq("ref_month", month);

      if (isPaid) {
        await baseWhere(supabase.from("wallet_transactions").delete());

        const installmentSuffix =
          exp?.is_installment && info?.installmentIndex && info?.installmentTotal
            ? ` - Parcela ${info.installmentIndex}/${info.installmentTotal}`
            : "";

        const label = `${exp.name}${installmentSuffix} - ${ymLabel(year, month)}`;
        const txPayload = {
          user_id: userId,
          kind: "expense_payment",
          amount,
          description: label,
          note: label,
          ref_expense_id: exp.id,
          ref_year: year,
          ref_month: month,
          created_at: new Date().toISOString(),
          ...(receipt?.receiptPath ? { receipt_path: receipt.receiptPath } : {}),
          ...(receipt?.receiptUrl ? { receipt_url: receipt.receiptUrl } : {}),
        };

        let { error } = await supabase.from("wallet_transactions").insert(txPayload);
        if (error && (isMissingColumnError(error, "receipt_path") || isMissingColumnError(error, "receipt_url"))) {
          const { receipt_path, receipt_url, ...fallbackPayload } = txPayload;
          const fallback = await supabase.from("wallet_transactions").insert(fallbackPayload);
          error = fallback.error || null;
          if (!error && (receipt_path || receipt_url)) {
            alert("Pagamento registrado sem anexo (coluna de comprovante ausente no banco).");
          }
        }

        if (error) {
          console.error?.("[wallet] insert error", error);
          alert(`Pagamento marcado, mas falhou na carteira: ${error.message}`);
        }
      } else {
        const { error } = await baseWhere(supabase.from("wallet_transactions").delete());
        if (error) {
          console.error?.("[wallet] delete error", error);
          alert(`Status desmarcado, mas falhou ao limpar carteira: ${error.message}`);
        }
      }
    } catch (e) {
      console.error?.("[wallet] sync error", e);
    }
  }

  async function setPaidState(expenseId, options = {}) {
    const { year = ym.year, month = ym.month, nextPaid, paidAmount, askAmount = true } = options;

    const userId = session?.user?.id;
    const exp = (items ?? []).find((i) => i.id === expenseId);
    if (!userId || !exp) return false;

    const info = expenseMonthInfo(exp, year, month);
    if (!info.applicable && (nextPaid ?? true)) {
      alert("Este gasto nao se aplica ao mes selecionado.");
      return false;
    }

    let resolvedNextPaid = nextPaid;
    if (typeof resolvedNextPaid !== "boolean") {
      const { data: existingRows, error: existingError } = await supabase
        .from("monthly_expense_status")
        .select("paid")
        .eq("user_id", userId)
        .eq("expense_id", expenseId)
        .eq("year", year)
        .eq("month", month)
        .limit(1);

      if (existingError) {
        alert(existingError.message);
        return false;
      }

      resolvedNextPaid = !(existingRows?.[0]?.paid ?? false);
    }

    let resolvedPaidAmount = null;
    let receipt = { receiptPath: null, receiptUrl: null };
    let paidAt = null;

    if (resolvedNextPaid) {
      if (typeof paidAmount === "number" && Number.isFinite(paidAmount) && paidAmount > 0) {
        resolvedPaidAmount = roundMoney(paidAmount);
      } else if (askAmount) {
        const suggested = Number(exp.amount || 0);
        const result = await openPayDialog({ expenseName: exp.name, suggestedAmount: suggested });
        if (!result) return false;
        const parsed = parseMoneyInput(result.amount);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          alert("Informe um valor pago valido.");
          return false;
        }
        resolvedPaidAmount = roundMoney(parsed);
        if (result.file) {
          const uploaded = await uploadReceiptFile(result.file, userId, new Date());
          if (uploaded.error) {
            alert(`Falha ao enviar comprovante: ${uploaded.error.message}`);
            return false;
          }
          receipt = { receiptPath: uploaded.receiptPath, receiptUrl: uploaded.receiptUrl };
        }
      } else {
        resolvedPaidAmount = roundMoney(exp.amount || 0);
      }
      paidAt = new Date().toISOString();
    }

    const payload = {
      user_id: userId,
      expense_id: expenseId,
      year,
      month,
      paid: resolvedNextPaid,
      paid_amount: resolvedNextPaid ? resolvedPaidAmount : null,
      paid_at: resolvedNextPaid ? paidAt : null,
    };

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) {
      alert(error.message);
      return false;
    }

    await syncWalletForExpense(exp, year, month, resolvedNextPaid, resolvedPaidAmount, receipt);
    return true;
  }

  async function togglePaidForMonth(expenseId, options = {}) {
    const ok = await setPaidState(expenseId, { ...options, askAmount: true });
    if (!ok) return false;

    setWalletRefresh((v) => v + 1);
    setStatusRefreshKey((v) => v + 1);
    return true;
  }

  async function setManyPaidForMonth(expenseIds = [], { year = ym.year, month = ym.month, nextPaid } = {}) {
    const ids = Array.isArray(expenseIds) ? expenseIds : [];
    if (ids.length === 0) return;

    for (const expenseId of ids) {
      const exp = (items ?? []).find((i) => i.id === expenseId);
      const defaultAmount = Number(exp?.amount || 0);
      // eslint-disable-next-line no-await-in-loop
      await setPaidState(expenseId, {
        year,
        month,
        nextPaid,
        askAmount: false,
        paidAmount: defaultAmount > 0 ? defaultAmount : null,
      });
    }

    setWalletRefresh((v) => v + 1);
    setStatusRefreshKey((v) => v + 1);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  function exportCsv() {
    const rows = (items ?? []).map((x) => ({
      name: x.name,
      category: x.category,
      amount: x.amount,
      due_day: x.due_day,
      payment_method: x.payment_method ?? "",
      active: x.active ? "sim" : "nao",
      is_installment: x.is_installment ? "sim" : "nao",
      installment_total_amount: x.installment_total_amount ?? "",
      installment_total: x.installment_total ?? "",
      installment_start_month: x.installment_start_month ?? "",
      installment_start_year: x.installment_start_year ?? "",
      created_at: x.created_at,
    }));

    const csv = toCSV(rows, [
      { key: "name", label: "nome" },
      { key: "category", label: "categoria" },
      { key: "amount", label: "valor_mensal" },
      { key: "due_day", label: "dia_venc" },
      { key: "payment_method", label: "pagamento" },
      { key: "active", label: "ativo" },
      { key: "is_installment", label: "parcelado" },
      { key: "installment_total_amount", label: "total_parcelado" },
      { key: "installment_total", label: "qtd_parcelas" },
      { key: "installment_start_month", label: "inicio_mes" },
      { key: "installment_start_year", label: "inicio_ano" },
      { key: "created_at", label: "criado_em" },
    ]);

    const label = ymLabel(ym.year, ym.month)
      .replaceAll(" ", "_")
      .replaceAll("/", "-")
      .normalize("NFD")
      .replace(/[^a-zA-Z0-9_\-]/g, "");

    downloadTextFile(`gastos_fixos_${label}.csv`, csv, "text/csv;charset=utf-8");
  }

  if (!session) return <Auth />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <div className="appRootContainer" style={styles.container}>
        <TopBar
          email={session.user.email}
          onRefresh={fetchItems}
          refreshing={loading}
          onExportCsv={exportCsv}
          onSignOut={signOut}
        />

        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            style={activeTab === "painel" ? styles.btn : styles.btnGhost}
            onClick={() => setActiveTab("painel")}
          >
            Painel financeiro
          </button>
          <button
            type="button"
            style={activeTab === "investimentos" ? styles.btn : styles.btnGhost}
            onClick={() => setActiveTab("investimentos")}
          >
            Investimentos
          </button>
          <button
            type="button"
            style={activeTab === "veiculos" ? styles.btn : styles.btnGhost}
            onClick={() => setActiveTab("veiculos")}
          >
            Meus Veiculos
          </button>
        </div>

        {activeTab === "painel" ? (
          <>
            <div style={{ marginTop: 14 }}>
              <Dashboard
                items={items}
                paidExpenseIds={paidExpenseIds}
                variableSpentMonth={variableSpentMonth}
                variableByCategory={variableByCategory}
                vehicleAlerts={vehicleAlerts}
                onOpenVehicles={() => setActiveTab("veiculos")}
                onSnoozeVehicleAlert={(vehicleId) => setSnoozedVehicleAlerts((prev) => [...new Set([...prev, vehicleId])])}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <WalletPanel
                userId={session.user.id}
                items={items}
                paidExpenseIds={paidExpenseIds}
                refreshKey={walletRefresh}
                onChanged={() => setWalletRefresh((v) => v + 1)}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <ExpenseForm loading={saving} onAdd={addExpense} />
            </div>

            <div style={{ marginTop: 14 }}>
              <ExpenseList
                items={items}
                paidExpenseIds={monthPaidExpenseIds}
                selectedYM={ym}
                onTogglePaid={(id) => togglePaidForMonth(id, ym)}
                onToggleActive={(id, nextActive) => toggleActive(id, nextActive)}
                onRemove={(id) => removeExpense(id)}
                onUpdateAmount={(id, amount) => updateExpense(id, { amount })}
                onUpdateFields={(id, fields) => updateExpense(id, fields)}
              />
            </div>

            <div style={{ marginTop: 14 }}>
              <MonthlyControl
                items={items}
                userId={session.user.id}
                year={ym.year}
                month={ym.month}
                refreshKey={statusRefreshKey}
                onChangeYM={setYm}
                onStatusChange={handleStatusChange}
                onTogglePaid={togglePaidForMonth}
                onSetAllPaid={setManyPaidForMonth}
                onWalletChanged={() => setWalletRefresh((v) => v + 1)}
              />
              <div style={{ ...styles.muted, fontSize: 13, marginTop: 10, lineHeight: 1.35 }}>
                <b>Carteira:</b> entradas manuais + saidas automaticas ao marcar pagamentos do mes (suporta pagamento parcial).
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <PaymentHistory userId={session.user.id} defaultYear={ym.year} defaultMonth={ym.month} onChanged={() => setWalletRefresh((v) => v + 1)} />
            </div>
          </>
        ) : activeTab === "investimentos" ? (
          <div style={{ marginTop: 14 }}>
            <InvestmentsPanel userId={session.user.id} />
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <VehiclesPanel
              userId={session.user.id}
              onChanged={() => {
                setVehicleRefresh((v) => v + 1);
                setSnoozedVehicleAlerts([]);
              }}
            />
          </div>
        )}
      </div>

      {payDialog.open ? (
        <div
          onMouseDown={(e) => e.target === e.currentTarget && closePayDialog(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "grid",
            placeItems: "center",
            zIndex: 80,
            padding: 14,
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              boxShadow: "var(--shadow)",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16 }}>Registrar pagamento</div>
            <div style={{ ...styles.muted, marginTop: 4, fontSize: 13 }}>
              {payDialog.expenseName || "Conta"} - valor pago e comprovante opcional
            </div>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <input
                style={styles.input}
                placeholder="Valor pago (ex.: 934,15)"
                value={payDialog.amount}
                onChange={(e) => setPayDialog((p) => ({ ...p, amount: e.target.value }))}
                onBlur={(e) => {
                  const parsed = parseMoneyInput(e.target.value);
                  if (Number.isFinite(parsed)) setPayDialog((p) => ({ ...p, amount: formatMoneyInput(parsed) }));
                }}
                inputMode="decimal"
              />
              <input
                style={styles.input}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setPayDialog((p) => ({ ...p, file: e.target.files?.[0] || null }))}
              />
              {payDialog.file ? (
                <div style={{ ...styles.muted, fontSize: 12 }}>Arquivo: {payDialog.file.name}</div>
              ) : null}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
              <button style={styles.btnGhost} type="button" onClick={() => closePayDialog(null)}>
                Cancelar
              </button>
              <button
                style={styles.btn}
                type="button"
                onClick={() => closePayDialog({ amount: payDialog.amount, file: payDialog.file })}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
