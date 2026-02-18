import React, { useMemo, useState } from "react";
import { moneyBRL, styles } from "./ui";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export default function EditExpenseModal({ open, item, onClose, onSave }) {
  const now = new Date();
  const defaults = useMemo(() => {
    if (!item) return null;
    return {
      name: item.name ?? "",
      category: item.category ?? "Outros",
      due_day: item.due_day ?? 1,
      payment_method: item.payment_method ?? "",
      active: Boolean(item.active),
      is_installment: Boolean(item.is_installment),
      amount: item.amount ?? 0,
      installment_total_amount: item.installment_total_amount ?? "",
      installment_total: item.installment_total ?? "",
      installment_start_month: item.installment_start_month ?? (now.getMonth() + 1),
      installment_start_year: item.installment_start_year ?? now.getFullYear(),
    };
  }, [item]);

  const [form, setForm] = useState(defaults);

  // reset when item changes
  React.useEffect(() => {
    setForm(defaults);
  }, [defaults]);

  if (!open || !item || !form) return null;

  function set(key, value) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function validateAndBuild() {
    const name = String(form.name || "").trim();
    if (!name) return { error: "Informe o nome." };

    const due = Number(form.due_day);
    if (!Number.isFinite(due) || due < 1 || due > 31) return { error: "Dia inválido (1-31)." };

    const payload = {
      name,
      category: form.category || "Outros",
      due_day: due,
      payment_method: String(form.payment_method || "").trim() || null,
      active: Boolean(form.active),
      is_installment: Boolean(form.is_installment),
    };

    if (!payload.is_installment) {
      const amount = Number(String(form.amount).replace(",", "."));
      if (!Number.isFinite(amount) || amount < 0) return { error: "Valor inválido." };
      payload.amount = round2(amount);

      // limpa campos de parcelado
      payload.installment_total_amount = null;
      payload.installment_total = null;
      payload.installment_start_month = null;
      payload.installment_start_year = null;
      return { payload };
    }

    const totalAmount = Number(String(form.installment_total_amount).replace(",", "."));
    const n = Number(form.installment_total);
    const sm = Number(form.installment_start_month);
    const sy = Number(form.installment_start_year);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return { error: "Valor total inválido." };
    if (!Number.isFinite(n) || n < 2) return { error: "Qtd. parcelas inválida (mínimo 2)." };
    if (!Number.isFinite(sm) || sm < 1 || sm > 12) return { error: "Mês início inválido (1-12)." };
    if (!Number.isFinite(sy) || sy < 2000 || sy > 2100) return { error: "Ano início inválido." };

    payload.installment_total_amount = round2(totalAmount);
    payload.installment_total = n;
    payload.installment_start_month = sm;
    payload.installment_start_year = sy;

    // valor mensal calculado
    payload.amount = round2(totalAmount / n);

    return { payload };
  }

  function handleSave() {
    const { payload, error } = validateAndBuild();
    if (error) return alert(error);
    onSave?.(payload);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        display: "grid",
        placeItems: "center",
        padding: 14,
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: "min(780px, 100%)",
          borderRadius: 18,
          border: "1px solid var(--border)",
          background: "rgba(10,12,22,.92)",
          boxShadow: "0 30px 90px rgba(0,0,0,.65)",
          backdropFilter: "blur(10px)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 14, borderBottom: "1px solid var(--border)", background: "var(--card2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
            <div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>Editar conta</div>
              <div style={{ ...styles.muted, fontSize: 13, marginTop: 2 }}>
                Atualize os campos e clique em <b>Salvar</b>.
              </div>
            </div>
            <button style={styles.btnGhost} type="button" onClick={onClose}>Fechar</button>
          </div>
        </div>

        <div style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Nome</div>
              <input style={styles.input} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>

            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Categoria</div>
              <select style={styles.input} value={form.category} onChange={(e) => set("category", e.target.value)}>
                {["Moradia", "Contas", "Assinaturas", "Transporte", "Saúde", "Outros"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Vencimento (dia)</div>
              <input
                style={styles.input}
                value={String(form.due_day ?? "")}
                onChange={(e) => set("due_day", e.target.value)}
              />
            </div>

            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Forma de pagamento</div>
              <input
                style={styles.input}
                value={form.payment_method}
                onChange={(e) => set("payment_method", e.target.value)}
                placeholder="Cartão, Pix, boleto..."
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
              <span>Ativo</span>
            </label>

            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.is_installment}
                onChange={(e) => set("is_installment", e.target.checked)}
              />
              <span>Compra parcelada</span>
            </label>
          </div>

          {!form.is_installment ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              <div>
                <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Valor mensal</div>
                <input
                  style={styles.input}
                  value={String(form.amount ?? "")}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div style={{ ...styles.card, background: "rgba(255,255,255,.04)", borderRadius: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 900 }}>Detalhes do parcelamento</div>
                  <div style={{ ...styles.muted, fontSize: 13 }}>O valor mensal será recalculado automaticamente.</div>
                </div>
                <span style={styles.badge}>
                  Mensal aprox.: {(() => {
                    const ta = Number(String(form.installment_total_amount).replace(",", "."));
                    const n = Number(form.installment_total);
                    if (!Number.isFinite(ta) || !Number.isFinite(n) || n <= 0) return "—";
                    return moneyBRL(round2(ta / n));
                  })()}
                </span>
              </div>

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div>
                  <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Valor total</div>
                  <input
                    style={styles.input}
                    value={String(form.installment_total_amount ?? "")}
                    onChange={(e) => set("installment_total_amount", e.target.value)}
                    placeholder="Ex: 1200"
                  />
                </div>

                <div>
                  <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Parcelas</div>
                  <input
                    style={styles.input}
                    value={String(form.installment_total ?? "")}
                    onChange={(e) => set("installment_total", e.target.value)}
                    placeholder="Ex: 10"
                  />
                </div>

                <div>
                  <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Mês início</div>
                  <input
                    style={styles.input}
                    value={String(form.installment_start_month ?? "")}
                    onChange={(e) => set("installment_start_month", e.target.value)}
                    placeholder="1-12"
                  />
                </div>

                <div>
                  <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Ano início</div>
                  <input
                    style={styles.input}
                    value={String(form.installment_start_year ?? "")}
                    onChange={(e) => set("installment_start_year", e.target.value)}
                    placeholder="2026"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: 14, borderTop: "1px solid var(--border)", background: "rgba(255,255,255,.03)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <button style={styles.btnGhost} type="button" onClick={onClose}>Cancelar</button>
            <button style={styles.btn} type="button" onClick={handleSave}>Salvar alterações</button>
          </div>
        </div>
      </div>
    </div>
  );
}
