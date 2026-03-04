import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Auth from "./components/Auth";
import TopBar from "./components/TopBar";
import Dashboard from "./components/Dashboard";
import ExpenseForm from "./components/ExpenseForm";
import ExpenseList from "./components/ExpenseList";
import MonthlyControl from "./components/MonthlyControl";
import WalletPanel from "./components/WalletPanel";
import PaymentHistory from "./components/PaymentHistory";
import { expenseMonthInfo, styles, ymLabel } from "./components/ui";
import { downloadTextFile, toCSV } from "./lib/csv";

export default function App() {
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [walletRefresh, setWalletRefresh] = useState(0);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [paidExpenseIds, setPaidExpenseIds] = useState([]);
  const [monthPaidExpenseIds, setMonthPaidExpenseIds] = useState([]);

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

  async function fetchItems() {
    setLoading(true);
    const { data, error } = await supabase.from("fixed_expenses").select("*").order("created_at", { ascending: false });
    setLoading(false);
    if (error) return alert(error.message);
    setItems(data ?? []);
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
    const parseMoney = (v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim().replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    const userId = session?.user?.id;
    const payload = {
      user_id: userId,
      name: form.name?.trim(),
      category: form.category,
      amount: form.isInstallment
        ? parseMoney(form.totalAmount) / Number(form.installments)
        : parseMoney(form.amount),
      due_day: Number(form.dueDay),
      payment_method: form.payment,
      active: !!form.active,
      is_installment: !!form.isInstallment,
      installment_total_amount: form.isInstallment ? parseMoney(form.totalAmount) : null,
      installment_total: form.isInstallment ? Number(form.installments) : null,
      installment_start_month: form.isInstallment ? Number(form.startMonth) : null,
      installment_start_year: form.isInstallment ? Number(form.startYear) : null,
    };

    if (!payload.user_id) return alert("Sessao invalida: usuario nao encontrado.");
    if (!payload.name) return alert("Informe o nome do gasto.");
    if (!Number.isFinite(payload.amount)) return alert("Valor invalido.");
    if (!Number.isFinite(payload.due_day) || payload.due_day < 1 || payload.due_day > 31) {
      return alert("Dia invalido (1-31).");
    }

    setSaving(true);
    const { error } = await supabase.from("fixed_expenses").insert(payload);
    setSaving(false);

    if (error) return alert(error.message);
    fetchItems();
  }

  async function updateExpense(id, fields) {
    const { error } = await supabase.from("fixed_expenses").update(fields).eq("id", id);
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

  async function syncWalletForExpense(exp, year, month, isPaid, paidAmount) {
    try {
      const userId = session?.user?.id;
      const info = expenseMonthInfo(exp, year, month);
      if (!userId || !info.applicable) return;

      const value = Math.round(Number(paidAmount ?? exp.amount ?? 0) * 100) / 100;
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
        const { error } = await supabase.from("wallet_transactions").insert({
          user_id: userId,
          kind: "expense_payment",
          amount,
          description: label,
          note: label,
          ref_expense_id: exp.id,
          ref_year: year,
          ref_month: month,
          created_at: new Date().toISOString(),
        });
        if (error) console.error?.("[wallet] insert error", error);
      } else {
        const { error } = await baseWhere(supabase.from("wallet_transactions").delete());
        if (error) console.error?.("[wallet] delete error", error);
      }
    } catch (e) {
      console.error?.("[wallet] sync error", e);
    }
  }

  async function togglePaidForMonth(expenseId, { year = ym.year, month = ym.month } = {}) {
    const userId = session?.user?.id;
    const exp = (items ?? []).find((i) => i.id === expenseId);
    if (!userId || !exp) return;

    const { data: existingRows, error: existingError } = await supabase
      .from("monthly_expense_status")
      .select("paid")
      .eq("user_id", userId)
      .eq("expense_id", expenseId)
      .eq("year", year)
      .eq("month", month)
      .limit(1);

    if (existingError) return alert(existingError.message);

    const existing = existingRows?.[0] ?? null;
    const nextPaid = existing ? !existing.paid : true;

    let paidAmount = null;
    let paidAt = null;

    if (nextPaid) {
      const suggested = Number(exp.amount || 0);
      const raw = prompt("Valor pago (pode ser parcial):", String(suggested).replace(".", ","));
      if (raw === null) return;
      const v = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) return alert("Informe um valor pago valido.");
      paidAmount = Math.round(v * 100) / 100;
      paidAt = new Date().toISOString();
    }

    const payload = {
      user_id: userId,
      expense_id: expenseId,
      year,
      month,
      paid: nextPaid,
      paid_amount: paidAmount,
      paid_at: paidAt,
    };

    const { error } = await supabase
      .from("monthly_expense_status")
      .upsert(payload, { onConflict: "user_id,expense_id,year,month" });

    if (error) return alert(error.message);

    await syncWalletForExpense(exp, year, month, nextPaid, paidAmount);
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
      <div style={styles.container}>
        <TopBar
          email={session.user.email}
          onRefresh={fetchItems}
          refreshing={loading}
          onExportCsv={exportCsv}
          onSignOut={signOut}
        />

        <div style={{ marginTop: 14 }}>
          <Dashboard items={items} paidExpenseIds={paidExpenseIds} />
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
            onToggleActive={(id, active) => toggleActive(id, !active)}
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
            onWalletChanged={() => setWalletRefresh((v) => v + 1)}
          />
          <div style={{ ...styles.muted, fontSize: 13, marginTop: 10, lineHeight: 1.35 }}>
            <b>Carteira:</b> entradas manuais + saidas automaticas ao marcar pagamentos do mes (suporta pagamento parcial).
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <PaymentHistory userId={session.user.id} defaultYear={ym.year} defaultMonth={ym.month} />
        </div>
      </div>
    </div>
  );
}
