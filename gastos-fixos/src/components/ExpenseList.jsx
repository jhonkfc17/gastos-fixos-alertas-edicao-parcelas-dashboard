import React, { useMemo, useState } from "react";
import { expenseMonthInfo, formatMoneyInput, installmentEndLabel, isInstallmentCompleted, moneyBRL, parseMoneyInput, styles, ymLabel } from "./ui";
import EditExpenseModal from "./EditExpenseModal";

const baseCategories = ["Moradia", "Contas", "Assinaturas", "Transporte", "Combustivel", "Saude", "Outros"];

export default function ExpenseList({
  items,
  paidExpenseIds = [],
  selectedYM,
  onTogglePaid,
  onToggleActive,
  onRemove,
  onUpdateAmount,
  onUpdateFields,
}) {
  const [filter, setFilter] = useState({ category: "Todas", status: "Ativos", q: "", sort: "created" });
  const [editing, setEditing] = useState(null);

  const paidSet = useMemo(() => new Set(paidExpenseIds ?? []), [paidExpenseIds]);
  const categories = useMemo(() => {
    const fromItems = [...new Set((items ?? []).map((i) => String(i?.category || "").trim()).filter(Boolean))];
    return ["Todas", ...new Set([...baseCategories, ...fromItems])];
  }, [items]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const q = (filter.q || "").trim().toLowerCase();
    let out = list.filter((x) => {
      const okCat = filter.category === "Todas" ? true : x.category === filter.category;
      const okStatus =
        filter.status === "Todos" ? true : filter.status === "Ativos" ? x.active : !x.active;
      const okQ = !q
        ? true
        : `${x.name ?? ""} ${x.category ?? ""} ${x.payment_method ?? ""}`.toLowerCase().includes(q);
      return okCat && okStatus && okQ;
    });

    if (filter.sort === "amount_desc") out = [...out].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    if (filter.sort === "amount_asc") out = [...out].sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    if (filter.sort === "due") out = [...out].sort((a, b) => Number(a.due_day || 0) - Number(b.due_day || 0));
    if (filter.sort === "name") out = [...out].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return out;
  }, [items, filter]);

  return (
    <div className="mobileCardTight" style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Meus gastos</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Edite valor e saia do campo para salvar. Marcar pagamento em {ymLabel(selectedYM?.year, selectedYM?.month)}.
          </div>
        </div>

        <div className="expenseFilters" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            style={{ ...styles.input, width: 220 }}
            placeholder="Buscar (nome, categoria...)"
            value={filter.q}
            onChange={(e) => setFilter((p) => ({ ...p, q: e.target.value }))}
          />

          <select
            style={{ ...styles.input, width: 170 }}
            value={filter.category}
            onChange={(e) => setFilter((p) => ({ ...p, category: e.target.value }))}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            style={{ ...styles.input, width: 140 }}
            value={filter.status}
            onChange={(e) => setFilter((p) => ({ ...p, status: e.target.value }))}
          >
            <option value="Ativos">Ativos</option>
            <option value="Inativos">Inativos</option>
            <option value="Todos">Todos</option>
          </select>

          <select
            style={{ ...styles.input, width: 170 }}
            value={filter.sort}
            onChange={(e) => setFilter((p) => ({ ...p, sort: e.target.value }))}
            title="Ordenacao"
          >
            <option value="created">Mais recentes</option>
            <option value="due">Vencimento</option>
            <option value="amount_desc">Maior valor</option>
            <option value="amount_asc">Menor valor</option>
            <option value="name">Nome (A-Z)</option>
          </select>
        </div>
      </div>

      <div className="expenseTable" style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <HeaderRow />
        {filtered.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Nada por aqui.</div>
        ) : (
          filtered.map((x) => (
            <Row
              key={x.id}
              item={x}
              paid={paidSet.has(x.id)}
              selectedYM={selectedYM}
              onTogglePaid={onTogglePaid}
              onToggleActive={onToggleActive}
              onRemove={onRemove}
              onUpdateAmount={onUpdateAmount}
              onUpdateFields={onUpdateFields}
              onEdit={() => setEditing(x)}
            />
          ))
        )}
      </div>

      <EditExpenseModal
        open={Boolean(editing)}
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(payload) => {
          onUpdateFields?.(editing.id, payload);
          setEditing(null);
        }}
      />
    </div>
  );
}

function HeaderRow() {
  return (
    <div
      className="expenseHeader"
      style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 700 }}
    >
      <div>Nome</div>
      <div>Categoria</div>
      <div>Venc.</div>
      <div>Valor</div>
      <div>Acoes</div>
    </div>
  );
}

function Row({ item, paid, selectedYM, onTogglePaid, onToggleActive, onRemove, onUpdateAmount, onUpdateFields, onEdit }) {
  const now = new Date();
  const completed = item.is_installment ? isInstallmentCompleted(item, now.getFullYear(), now.getMonth() + 1) : false;
  const endLabel = item.is_installment ? installmentEndLabel(item) : null;
  const info = expenseMonthInfo(item, selectedYM?.year ?? now.getFullYear(), selectedYM?.month ?? now.getMonth() + 1);
  const canMark = Boolean(item.active) && info.applicable;

  const categoryOptions = [...new Set([...baseCategories, String(item.category || "").trim()].filter(Boolean))];

  return (
    <div
      className="expenseRow"
      style={{
        padding: 12,
        alignItems: "center",
        borderBottom: "1px solid var(--border)",
        background: canMark && paid ? "rgba(34,197,94,.10)" : "transparent",
      }}
    >
      <div className="expenseInfo" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontWeight: 700 }}>
          {item.name}{" "}
          {!item.active && <span style={{ ...styles.muted, fontWeight: 500 }}>(inativo)</span>}
        </div>
        <div style={{ ...styles.muted, fontSize: 13 }}>
          Pagamento: {item.payment_method || "-"}
        </div>
        {item.is_installment ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={styles.badge}>Parcelado</span>
            {completed ? <span style={styles.badge}>Concluida</span> : null}
            <span style={styles.badge}>
              {item.installment_total_amount != null ? `Total ${moneyBRL(item.installment_total_amount)}` : "Total -"}
            </span>
            <span style={styles.badge}>
              {item.installment_total ? `${item.installment_total}x` : "-x"} - inicio {item.installment_start_month}/{item.installment_start_year}
            </span>
            {endLabel ? <span style={styles.badge}>fim {endLabel}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="expenseMeta">
        <div className="expenseField">
          <div className="expenseLabel">Categoria</div>
          <select
            style={styles.input}
            value={item.category || "Outros"}
            onChange={(e) => onUpdateFields?.(item.id, { category: e.target.value })}
          >
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="expenseField">
          <div className="expenseLabel">Venc.</div>
          <input
            style={styles.input}
            value={String(item.due_day ?? "")}
            onChange={(e) => onUpdateFields?.(item.id, { due_day: Number(e.target.value) || item.due_day })}
          />
        </div>

        <div className="expenseField">
          <div className="expenseLabel">Valor</div>
          <input
            style={styles.input}
            defaultValue={String(item.amount)}
            onBlur={(e) => {
              const parsed = parseMoneyInput(e.target.value);
              if (Number.isFinite(parsed)) e.target.value = formatMoneyInput(parsed);
              onUpdateAmount?.(item.id, e.target.value);
            }}
            title={`Atual: ${moneyBRL(item.amount)}`}
          />
        </div>
      </div>

      <div className="expenseActions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            ...styles.badge,
            background: !canMark
              ? "rgba(148,163,184,.14)"
              : paid
                ? "rgba(34,197,94,.16)"
                : "rgba(245,158,11,.14)",
          }}
        >
          {!canMark ? "Nao se aplica" : paid ? "Pago" : "Pendente"}
        </span>
        <button
          style={paid ? styles.btnGhost : styles.btn}
          type="button"
          disabled={!canMark}
          title={!canMark ? "Ative o gasto e selecione um mes aplicavel para marcar pagamento." : ""}
          onClick={() => canMark && onTogglePaid?.(item.id)}
        >
          {paid ? "Desfazer" : "Marcar"}
        </button>
        <button style={styles.btn} type="button" onClick={() => onToggleActive?.(item.id, !item.active)}>
          {item.active ? "Desativar" : "Ativar"}
        </button>
        <button style={styles.btnGhost} type="button" onClick={() => onEdit?.()}>
          Editar
        </button>
        <button style={styles.btnGhost} type="button" onClick={() => onRemove?.(item.id)}>
          Remover
        </button>
      </div>
    </div>
  );
}
