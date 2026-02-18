import React, { useState } from "react";
import { styles } from "./ui";

const categories = ["Moradia", "Contas", "Assinaturas", "Transporte", "Saúde", "Outros"];

export default function ExpenseForm({ onAdd, loading }) {
  const [form, setForm] = useState({
    name: "",
    category: "Contas",
    amount: "",
    isInstallment: false,
    totalAmount: "",
    installments: "",
    startMonth: String(new Date().getMonth() + 1),
    startYear: String(new Date().getFullYear()),
    dueDay: "5",
    payment: "PIX",
    active: true,
  });

  const previewMonthly = (() => {
    if (!form.isInstallment) return null;
    const total = Number(String(form.totalAmount).replace(",", "."));
    const n = Number(form.installments);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(n) || n <= 0) return null;
    const per = total / n;
    return per;
  })();

  function submit(e) {
    e.preventDefault();
    onAdd?.(form, () =>
      setForm((p) => ({
        ...p,
        name: "",
        amount: "",
        isInstallment: false,
        totalAmount: "",
        installments: "",
      }))
    );
  }

  return (
    <div style={styles.card}>
      <div style={{ fontWeight: 800, fontSize: 16 }}>Novo gasto</div>
      <form onSubmit={submit} style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <input
          style={styles.input}
          placeholder="Nome (ex.: Internet)"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
        />

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <select
            style={styles.input}
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {!form.isInstallment ? (
            <input
              style={styles.input}
              placeholder="Valor mensal (ex.: 129.90)"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
            />
          ) : (
            <input
              style={{ ...styles.input, opacity: 0.9 }}
              placeholder="Valor mensal (auto)"
              value={previewMonthly ? String(previewMonthly.toFixed(2)).replace(".", ",") : ""}
              readOnly
            />
          )}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, ...styles.muted }}>
          <input
            type="checkbox"
            checked={form.isInstallment}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                isInstallment: e.target.checked,
                // reset fields when toggling off
                totalAmount: e.target.checked ? p.totalAmount : "",
                installments: e.target.checked ? p.installments : "",
              }))
            }
          />
          Compra parcelada
        </label>

        {form.isInstallment ? (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <input
              style={styles.input}
              placeholder="Valor total (ex.: 1200,00)"
              value={form.totalAmount}
              onChange={(e) => setForm((p) => ({ ...p, totalAmount: e.target.value }))}
            />
            <input
              style={styles.input}
              placeholder="Qtd. parcelas (ex.: 10)"
              value={form.installments}
              onChange={(e) => setForm((p) => ({ ...p, installments: e.target.value }))}
            />
          </div>
        ) : null}

        {form.isInstallment ? (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <input
              style={styles.input}
              placeholder="Mês início (1-12)"
              value={form.startMonth}
              onChange={(e) => setForm((p) => ({ ...p, startMonth: e.target.value }))}
            />
            <input
              style={styles.input}
              placeholder="Ano início (ex.: 2026)"
              value={form.startYear}
              onChange={(e) => setForm((p) => ({ ...p, startYear: e.target.value }))}
            />
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <input
            style={styles.input}
            placeholder="Dia (1-31)"
            value={form.dueDay}
            onChange={(e) => setForm((p) => ({ ...p, dueDay: e.target.value }))}
          />
          <input
            style={styles.input}
            placeholder="Pagamento (ex.: PIX, cartão...)"
            value={form.payment}
            onChange={(e) => setForm((p) => ({ ...p, payment: e.target.value }))}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, ...styles.muted }}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
          />
          Ativo
        </label>

        <button style={styles.btn} type="submit" disabled={loading}>
          {loading ? "Salvando..." : "Adicionar"}
        </button>

        <div style={{ ...styles.muted, fontSize: 13, lineHeight: 1.35 }}>
          Dica: use vírgula ou ponto no valor. Ex.: <code>129,90</code>
        </div>
      </form>
    </div>
  );
}
