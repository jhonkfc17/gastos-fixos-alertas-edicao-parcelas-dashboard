import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { moneyBRL, parseMoneyInput, roundMoney, styles } from "./ui";

function toInputDateTimeLocal(value = new Date()) {
  const d = new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function parseQuantity(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(",", ".");
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export default function InvestmentsPanel({ userId }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({
    symbol: "BTCUSDT",
    side: "buy",
    quantity: "",
    executionPrice: "",
    bankBalance: "",
    executedAt: toInputDateTimeLocal(new Date()),
    note: "",
  });

  useEffect(() => {
    if (!userId) return;
    fetchOrders().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function isMissingTableError(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("crypto_orders") && (msg.includes("does not exist") || msg.includes("could not find"));
  }

  async function fetchOrders() {
    setLoading(true);
    const { data, error } = await supabase
      .from("crypto_orders")
      .select("id, symbol, side, quantity, execution_price, bank_balance, order_value, note, executed_at, created_at")
      .eq("user_id", userId)
      .order("executed_at", { ascending: false })
      .limit(300);
    setLoading(false);

    if (error) {
      if (isMissingTableError(error)) {
        setSchemaMissing(true);
        setOrders([]);
        return;
      }
      return alert(error.message);
    }
    setSchemaMissing(false);
    setOrders(data ?? []);
  }

  async function addOrder(e) {
    e.preventDefault();
    if (!userId) return;

    const symbol = String(form.symbol || "").trim().toUpperCase();
    const side = form.side === "sell" ? "sell" : "buy";
    const quantity = parseQuantity(form.quantity);
    const executionPrice = parseMoneyInput(form.executionPrice);
    const bankBalance = parseMoneyInput(form.bankBalance);

    if (!symbol) return alert("Informe o ativo (ex.: BTCUSDT).");
    if (!Number.isFinite(quantity) || quantity <= 0) return alert("Quantidade invalida.");
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) return alert("Preco de execucao invalido.");
    if (!Number.isFinite(bankBalance)) return alert("Informe o saldo do banco no momento da ordem.");

    const orderValue = roundMoney(quantity * executionPrice);
    const executedAt = form.executedAt ? new Date(form.executedAt) : new Date();
    if (Number.isNaN(executedAt.getTime())) return alert("Data/hora invalida.");

    setSaving(true);
    const { error } = await supabase.from("crypto_orders").insert({
      user_id: userId,
      symbol,
      side,
      quantity: roundMoney(quantity),
      execution_price: roundMoney(executionPrice),
      order_value: orderValue,
      bank_balance: roundMoney(bankBalance),
      executed_at: executedAt.toISOString(),
      note: String(form.note || "").trim() || null,
    });
    setSaving(false);

    if (error) {
      if (isMissingTableError(error)) {
        setSchemaMissing(true);
        return alert("Tabela crypto_orders nao encontrada. Execute o SQL de schema para ativar a aba.");
      }
      return alert(error.message);
    }

    setForm((p) => ({
      ...p,
      quantity: "",
      executionPrice: "",
      bankBalance: "",
      note: "",
      executedAt: toInputDateTimeLocal(new Date()),
    }));
    fetchOrders().catch(() => {});
  }

  async function removeOrder(id) {
    if (!confirm("Remover esta ordem?")) return;
    const { error } = await supabase.from("crypto_orders").delete().eq("id", id).eq("user_id", userId);
    if (error) return alert(error.message);
    fetchOrders().catch(() => {});
  }

  const summary = useMemo(() => {
    const count = orders.length;
    const totalBuy = orders
      .filter((o) => o.side === "buy")
      .reduce((acc, o) => acc + Math.abs(Number(o.order_value || 0)), 0);
    const totalSell = orders
      .filter((o) => o.side === "sell")
      .reduce((acc, o) => acc + Math.abs(Number(o.order_value || 0)), 0);
    const lastBalance = orders.length > 0 ? Number(orders[0].bank_balance || 0) : 0;
    return { count, totalBuy, totalSell, lastBalance };
  }, [orders]);

  return (
    <div style={{ ...styles.card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Investimentos</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Registre ordens de cripto com saldo do banco, preco e data/hora da execucao.
          </div>
        </div>
        <button style={styles.btnGhost} type="button" onClick={() => fetchOrders()} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {schemaMissing ? (
        <div style={{ ...styles.card, marginTop: 12, background: "rgba(245,158,11,.12)", borderColor: "rgba(245,158,11,.35)" }}>
          <div style={{ fontWeight: 800 }}>Schema ausente para investimentos</div>
          <div style={{ ...styles.muted, marginTop: 6, fontSize: 13 }}>
            Execute o SQL atualizado em <code>supabase/schema.sql</code> para criar a tabela <code>crypto_orders</code>.
          </div>
        </div>
      ) : null}

      <div style={{ ...styles.gridAuto, marginTop: 12 }}>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Ordens registradas</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{summary.count}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Total comprado</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyBRL(summary.totalBuy)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Total vendido</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyBRL(summary.totalSell)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Ultimo saldo do banco</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyBRL(summary.lastBalance)}</div>
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontWeight: 800 }}>Nova ordem</div>
        <form onSubmit={addOrder} style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div className="investFormGrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <input
              style={styles.input}
              placeholder="Ativo (ex.: BTCUSDT)"
              value={form.symbol}
              onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))}
            />
            <select
              style={styles.input}
              value={form.side}
              onChange={(e) => setForm((p) => ({ ...p, side: e.target.value }))}
            >
              <option value="buy">Compra</option>
              <option value="sell">Venda</option>
            </select>
            <input
              style={styles.input}
              placeholder="Quantidade"
              value={form.quantity}
              onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
            />
            <input
              style={styles.input}
              placeholder="Preco de execucao"
              value={form.executionPrice}
              onChange={(e) => setForm((p) => ({ ...p, executionPrice: e.target.value }))}
              inputMode="decimal"
            />
            <input
              style={styles.input}
              placeholder="Saldo do banco (momento da ordem)"
              value={form.bankBalance}
              onChange={(e) => setForm((p) => ({ ...p, bankBalance: e.target.value }))}
              inputMode="decimal"
            />
            <input
              style={styles.input}
              type="datetime-local"
              value={form.executedAt}
              onChange={(e) => setForm((p) => ({ ...p, executedAt: e.target.value }))}
            />
          </div>
          <input
            style={styles.input}
            placeholder="Observacoes (opcional)"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
          <button style={styles.btn} type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Registrar ordem"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
          Ultimas ordens
        </div>
        {orders.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Nenhuma ordem registrada.</div>
        ) : (
          orders.map((o) => (
            <div
              key={o.id}
              className="investOrderRow"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 10,
                alignItems: "center",
                padding: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {o.symbol} - {o.side === "buy" ? "Compra" : "Venda"}
                </div>
                <div style={{ ...styles.muted, fontSize: 12, marginTop: 2 }}>
                  Qtd: {Number(o.quantity || 0)} | Preco: {moneyBRL(o.execution_price)} | Saldo banco: {moneyBRL(o.bank_balance)}
                </div>
                <div style={{ ...styles.muted, fontSize: 12 }}>
                  {new Date(o.executed_at).toLocaleString("pt-BR")}
                  {o.note ? ` - ${o.note}` : ""}
                </div>
              </div>
              <div style={{ fontWeight: 900 }}>{moneyBRL(o.order_value)}</div>
              <button style={styles.btnGhost} type="button" onClick={() => removeOrder(o.id)}>
                Remover
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
