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
import { expenseMonthInfo, parseMoneyInput, roundMoney, styles, ymLabel } from "./components/ui";
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
  const [variableSpentMonth, setVariableSpentMonth] = useState(0);
  const [variableByCategory, setVariableByCategory] = useState([]);

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
    if (!session?.user?.id) return;
    fetchCurrentMonthVariable().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, walletRefresh]);

  async function fetchItems() {
    setLoading(true);
    const { data, error } = await supabase.from("fixed_expenses").select("*").order("created_at", { ascending: false });
    setLoading(false);
    if (error) return alert(error.message);
    setItems(data ?? []);
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

  async function syncWalletForExpense(exp, year, month, isPaid, paidAmount) {
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
    let paidAt = null;

    if (resolvedNextPaid) {
      if (typeof paidAmount === "number" && Number.isFinite(paidAmount) && paidAmount > 0) {
        resolvedPaidAmount = roundMoney(paidAmount);
      } else if (askAmount) {
        const suggested = Number(exp.amount || 0);
        const raw = prompt("Valor pago (pode ser parcial):", String(suggested).replace(".", ","));
        if (raw === null) return false;
        const parsed = parseMoneyInput(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          alert("Informe um valor pago valido.");
          return false;
        }
        resolvedPaidAmount = roundMoney(parsed);
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

    await syncWalletForExpense(exp, year, month, resolvedNextPaid, resolvedPaidAmount);
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
      <div style={styles.container}>
        <TopBar
          email={session.user.email}
          onRefresh={fetchItems}
          refreshing={loading}
          onExportCsv={exportCsv}
          onSignOut={signOut}
        />

        <div style={{ marginTop: 14 }}>
          <Dashboard
            items={items}
            paidExpenseIds={paidExpenseIds}
            variableSpentMonth={variableSpentMonth}
            variableByCategory={variableByCategory}
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
          <PaymentHistory userId={session.user.id} defaultYear={ym.year} defaultMonth={ym.month} />
        </div>
      </div>
    </div>
  );
}
