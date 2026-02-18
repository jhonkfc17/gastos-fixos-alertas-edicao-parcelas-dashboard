import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Auth from "./components/Auth";
import Dashboard from "./components/Dashboard";
import ExpenseForm from "./components/ExpenseForm";
import ExpenseList from "./components/ExpenseList";
import MonthlyControl from "./components/MonthlyControl";
import TopBar from "./components/TopBar";
import { isInstallmentCompleted, styles, ymLabel } from "./components/ui";
import { downloadTextFile, toCSV } from "./lib/csv";

export default function App() {
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = new Date();
  const [ym, setYm] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [paidExpenseIds, setPaidExpenseIds] = useState([]); // pagos no mês atual (para alertas)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) fetchItems();
    else setItems([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function fetchItems() {
    setLoading(true);
    const { data, error } = await supabase
      .from("fixed_expenses")
      .select("*")
      .order("created_at", { ascending: false });

    setLoading(false);

    if (error) return alert(error.message);

    const rows = data ?? [];

    // Auto-finaliza parcelados que já terminaram: marca como inativo.
    // Mantém no histórico para consulta.
    try {
      const now = new Date();
      const ry = now.getFullYear();
      const rm = now.getMonth() + 1;
      const toDeactivate = rows.filter((x) => x.active && x.is_installment && isInstallmentCompleted(x, ry, rm));
      if (toDeactivate.length > 0) {
        const ids = toDeactivate.map((x) => x.id);
        await supabase.from("fixed_expenses").update({ active: false }).in("id", ids);
        for (const x of rows) {
          if (ids.includes(x.id)) x.active = false;
        }
      }
    } catch {
      // silencioso
    }

    setItems(rows);

    // carrega pagos do mês atual (para alertas no dashboard)
    fetchPaidForCurrentMonth().catch(() => {});
  }

  async function fetchPaidForCurrentMonth() {
    if (!session?.user?.id) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const { data, error } = await supabase
      .from("monthly_expense_status")
      .select("expense_id, paid")
      .eq("year", y)
      .eq("month", m)
      .eq("paid", true);
    if (error) return;
    setPaidExpenseIds((data ?? []).map((r) => r.expense_id));
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
      is_installment: x.is_installment ? "sim" : "não",
      installment_total_amount: x.installment_total_amount ?? "",
      installment_total: x.installment_total ?? "",
      installment_start: x.is_installment ? `${x.installment_start_month}/${x.installment_start_year}` : "",
      active: x.active ? "ativo" : "inativo",
    }));

    const csv = toCSV(rows, [
      { key: "name", label: "Nome" },
      { key: "category", label: "Categoria" },
      { key: "amount", label: "Valor" },
      { key: "due_day", label: "Vencimento (dia)" },
      { key: "payment_method", label: "Pagamento" },
      { key: "is_installment", label: "Parcelado" },
      { key: "installment_total_amount", label: "Valor total" },
      { key: "installment_total", label: "Parcelas" },
      { key: "installment_start", label: "Início" },
      { key: "active", label: "Status" },
    ]);

    const file = `gastos-fixos_${ymLabel(ym.year, ym.month).replace(/\s+/g, "_")}.csv`;
    downloadTextFile(file, csv, "text/csv;charset=utf-8");
  }

  async function addItem(form, onDone) {
    const isInstallment = Boolean(form.isInstallment);
    const amount = Number(String(form.amount).replace(",", "."));
    const dueDay = Number(form.dueDay);

    if (!form.name?.trim()) return alert("Informe o nome.");
    let finalAmount = amount;

    let installment_total_amount = null;
    let installment_total = null;
    let installment_start_year = null;
    let installment_start_month = null;

    if (!isInstallment) {
      if (!Number.isFinite(amount) || amount <= 0) return alert("Valor inválido.");
    } else {
      const totalAmount = Number(String(form.totalAmount).replace(",", "."));
      const n = Number(form.installments);
      const sy = Number(form.startYear);
      const sm = Number(form.startMonth);

      if (!Number.isFinite(totalAmount) || totalAmount <= 0) return alert("Valor total inválido.");
      if (!Number.isFinite(n) || n < 2) return alert("Qtd. parcelas inválida (mínimo 2).");
      if (!Number.isFinite(sm) || sm < 1 || sm > 12) return alert("Mês início inválido (1-12).");
      if (!Number.isFinite(sy) || sy < 2000 || sy > 2100) return alert("Ano início inválido.");

      finalAmount = Math.round((totalAmount / n) * 100) / 100;
      installment_total_amount = totalAmount;
      installment_total = n;
      installment_start_year = sy;
      installment_start_month = sm;
    }

    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return alert("Dia inválido (1-31).");

    setSaving(true);
    const payload = {
      user_id: session.user.id,
      name: form.name.trim(),
      category: form.category,
      amount: finalAmount,
      due_day: dueDay,
      payment_method: form.payment?.trim() || null,
      active: Boolean(form.active),
      is_installment: isInstallment,
      installment_total_amount,
      installment_total,
      installment_start_year,
      installment_start_month,
    };

    const { error } = await supabase.from("fixed_expenses").insert(payload);
    setSaving(false);

    if (error) return alert(error.message);

    onDone?.();
    fetchItems();
  }

  async function toggleActive(id, current) {
    const { error } = await supabase.from("fixed_expenses").update({ active: !current }).eq("id", id);
    if (error) return alert(error.message);
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, active: !current } : x)));
  }

  async function updateAmount(id, value) {
    const amount = Number(String(value).replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) return alert("Valor inválido.");

    const { error } = await supabase.from("fixed_expenses").update({ amount }).eq("id", id);
    if (error) return alert(error.message);

    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, amount } : x)));
  }

  async function updateFields(id, fields) {
    // validações básicas
    if (fields?.due_day !== undefined) {
      const d = Number(fields.due_day);
      if (!Number.isFinite(d) || d < 1 || d > 31) return alert("Dia inválido (1-31).");
      fields = { ...fields, due_day: d };
    }

    const { error } = await supabase.from("fixed_expenses").update(fields).eq("id", id);
    if (error) return alert(error.message);

    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...fields } : x)));
  }

  async function removeItem(id) {
    if (!confirm("Remover este gasto fixo?")) return;
    const { error } = await supabase.from("fixed_expenses").delete().eq("id", id);
    if (error) return alert(error.message);
    setItems((prev) => prev.filter((x) => x.id !== id));
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

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 14,
            alignItems: "start",
          }}
        >
          <ExpenseForm onAdd={addItem} loading={saving} />
          <ExpenseList
            items={items}
            onToggleActive={toggleActive}
            onRemove={removeItem}
            onUpdateAmount={updateAmount}
            onUpdateFields={updateFields}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <MonthlyControl
            items={items}
            userId={session.user.id}
            year={ym.year}
            month={ym.month}
            onChangeYM={setYm}
            onStatusChange={(y, m, statusRows) => {
              // Atualiza alertas do dashboard somente quando for o mês atual
              const now = new Date();
              const cy = now.getFullYear();
              const cm = now.getMonth() + 1;
              if (y === cy && m === cm) {
                setPaidExpenseIds((statusRows ?? []).filter((r) => r.paid).map((r) => r.expense_id));
              }
            }}
          />
        </div>

        <div style={{ ...styles.muted, fontSize: 13, marginTop: 14, lineHeight: 1.35 }}>
          <b>Segurança:</b> RLS ativo no Supabase. Cada usuário só acessa seus próprios registros.
        </div>
      </div>
    </div>
  );
}
