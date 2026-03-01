import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Auth from "./components/Auth";
import TopBar from "./components/TopBar";
import Dashboard from "./components/Dashboard";
import ExpenseForm from "./components/ExpenseForm";
import ExpenseList from "./components/ExpenseList";
import MonthlyControl from "./components/MonthlyControl";
import WalletPanel from "./components/WalletPanel";
import { styles, ymLabel } from "./components/ui";
import { downloadTextFile, toCSV } from "./lib/csv";

export default function App() {
  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

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

  async function addExpense(form) {
    const parseMoney = (v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim()
        .replace(/\./g, "")
        .replace(",", ".");
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

    if (!payload.user_id) return alert("Sessão inválida: usuário não encontrado.");
    if (!payload.name) return alert("Informe o nome do gasto.");
    if (!Number.isFinite(payload.amount)) return alert("Valor inválido.");
    if (!Number.isFinite(payload.due_day) || payload.due_day < 1 || payload.due_day > 31)
      return alert("Dia inválido (1-31).");

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

  async function toggleActive(id, active) {
    const { error } = await supabase.from("fixed_expenses").update({ active }).eq("id", id);
    if (error) return alert(error.message);
    fetchItems();
  }

  async function removeExpense(id) {
    if (!confirm("Remover este gasto?")) return;
    const { error } = await supabase.from("fixed_expenses").delete().eq("id", id);
    if (error) return alert(error.message);
    fetchItems();
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
      active: x.active ? "sim" : "não",
      is_installment: x.is_installment ? "sim" : "não",
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
          <Dashboard items={items} />
        </div>

        <div style={{ marginTop: 14 }}>
          <WalletPanel userId={session.user.id} ym={ym} />
        </div>

        <div style={{ marginTop: 14 }}>
          <ExpenseForm loading={saving} onAdd={addExpense} />
        </div>

        <div style={{ marginTop: 14 }}>
          <ExpenseList
            items={items}
            onToggleActive={(id, nextActive) => toggleActive(id, nextActive)}
            onRemove={(id) => removeExpense(id)}
            onUpdateAmount={(id, amount) => updateExpense(id, { amount })}
            onUpdateFields={(id, fields) => updateExpense(id, fields)}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <MonthlyControl items={items} userId={session.user.id} year={ym.year} month={ym.month} onChangeYM={setYm} />
          <div style={{ ...styles.muted, fontSize: 13, marginTop: 10, lineHeight: 1.35 }}>
            <b>Carteira:</b> entradas manuais + saídas automáticas ao marcar pagamentos do mês (suporta pagamento parcial).
          </div>
        </div>
      </div>
    </div>
  );
}
