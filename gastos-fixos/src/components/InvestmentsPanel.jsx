import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { parseMoneyInput, roundMoney, styles } from "./ui";

function moneyUSD(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

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

function getLatestBankBalance(orders = [], balanceEntries = []) {
  const latestOrder = (orders ?? [])[0];
  const latestBalanceEntry = (balanceEntries ?? [])[0];

  if (!latestOrder && !latestBalanceEntry) return 0;
  if (!latestOrder) return Number(latestBalanceEntry?.amount || 0);
  if (!latestBalanceEntry) return Number(latestOrder?.bank_balance || 0);

  const orderTs = new Date(latestOrder.executed_at).getTime();
  const balanceTs = new Date(latestBalanceEntry.recorded_at).getTime();
  return orderTs >= balanceTs
    ? Number(latestOrder?.bank_balance || 0)
    : Number(latestBalanceEntry?.amount || 0);
}

export default function InvestmentsPanel({ userId }) {
  const [loading, setLoading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [orders, setOrders] = useState([]);
  const [balanceEntries, setBalanceEntries] = useState([]);

  const [form, setForm] = useState({
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "",
    executionPrice: "",
    executedAt: toInputDateTimeLocal(new Date()),
    note: "",
  });

  const [balanceForm, setBalanceForm] = useState({
    amount: "",
    entryType: "deposit",
    recordedAt: toInputDateTimeLocal(new Date()),
    note: "",
  });

  useEffect(() => {
    if (!userId) return;
    fetchAll().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function isMissingTableError(error) {
    const msg = String(error?.message || "").toLowerCase();
    const missing = msg.includes("does not exist") || msg.includes("could not find");
    return missing && (msg.includes("crypto_orders") || msg.includes("bank_balance_entries"));
  }

  async function fetchAll() {
    setLoading(true);

    const [ordersRes, balanceRes] = await Promise.all([
      supabase
        .from("crypto_orders")
        .select("id, symbol, side, quantity, execution_price, bank_balance, order_value, note, executed_at, created_at")
        .eq("user_id", userId)
        .order("executed_at", { ascending: false })
        .limit(300),
      supabase
        .from("bank_balance_entries")
        .select("id, amount, entry_type, note, recorded_at, created_at")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .limit(100),
    ]);

    setLoading(false);

    if (ordersRes.error || balanceRes.error) {
      const err = ordersRes.error || balanceRes.error;
      if (isMissingTableError(err)) {
        setSchemaMissing(true);
        setOrders([]);
        setBalanceEntries([]);
        return;
      }
      return alert(err.message);
    }

    setSchemaMissing(false);
    setOrders(ordersRes.data ?? []);
    setBalanceEntries(balanceRes.data ?? []);
  }

  async function addOrder(e) {
    e.preventDefault();
    if (!userId) return;

    const symbol = String(form.symbol || "").trim().toUpperCase().replace("/", "");
    const side = form.side === "sell" ? "sell" : "buy";
    const quantity = parseQuantity(form.quantity);
    const executionPrice = parseMoneyInput(form.executionPrice);

    if (!symbol) return alert("Informe o ativo (ex.: BTCUSDT).");
    if (!Number.isFinite(quantity) || quantity <= 0) return alert("Quantidade invalida.");
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) return alert("Preco de execucao invalido.");

    const orderValue = roundMoney(quantity * executionPrice);
    const executedAt = form.executedAt ? new Date(form.executedAt) : new Date();
    if (Number.isNaN(executedAt.getTime())) return alert("Data/hora invalida.");
    const latestBalance = getLatestBankBalance(orders, balanceEntries);
    const bankBalance = roundMoney(side === "buy" ? latestBalance - orderValue : latestBalance + orderValue);

    setSavingOrder(true);
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
    setSavingOrder(false);

    if (error) {
      if (isMissingTableError(error)) {
        setSchemaMissing(true);
        return alert("Tabela de investimentos ausente. Execute o SQL de schema.");
      }
      return alert(error.message);
    }

    setForm((p) => ({
      ...p,
      quantity: "",
      executionPrice: "",
      note: "",
      executedAt: toInputDateTimeLocal(new Date()),
    }));
    fetchAll().catch(() => {});
  }

  async function addBalanceEntry(e) {
    e.preventDefault();
    if (!userId) return;

    const amount = parseMoneyInput(balanceForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return alert("Informe um valor valido para saldo.");

    const recordedAt = balanceForm.recordedAt ? new Date(balanceForm.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) return alert("Data/hora invalida.");

    const entryType = balanceForm.entryType === "withdraw" ? "withdraw" : balanceForm.entryType === "adjustment" ? "adjustment" : "deposit";

    setSavingBalance(true);
    const { error } = await supabase.from("bank_balance_entries").insert({
      user_id: userId,
      amount: roundMoney(amount),
      entry_type: entryType,
      recorded_at: recordedAt.toISOString(),
      note: String(balanceForm.note || "").trim() || null,
    });
    setSavingBalance(false);

    if (error) {
      if (isMissingTableError(error)) {
        setSchemaMissing(true);
        return alert("Tabela de saldo da banca ausente. Execute o SQL de schema.");
      }
      return alert(error.message);
    }

    setBalanceForm({
      amount: "",
      entryType: "deposit",
      recordedAt: toInputDateTimeLocal(new Date()),
      note: "",
    });
    fetchAll().catch(() => {});
  }

  async function removeOrder(id) {
    if (!confirm("Remover esta ordem?")) return;
    const { error } = await supabase.from("crypto_orders").delete().eq("id", id).eq("user_id", userId);
    if (error) return alert(error.message);
    fetchAll().catch(() => {});
  }

  const summary = useMemo(() => {
    const count = orders.length;
    const totalBuy = orders
      .filter((o) => o.side === "buy")
      .reduce((acc, o) => acc + Math.abs(Number(o.order_value || 0)), 0);
    const totalSell = orders
      .filter((o) => o.side === "sell")
      .reduce((acc, o) => acc + Math.abs(Number(o.order_value || 0)), 0);
    const lastBalance = getLatestBankBalance(orders, balanceEntries);
    const pnl = roundMoney(totalSell - totalBuy);
    return { count, totalBuy, totalSell, lastBalance, pnl };
  }, [orders, balanceEntries]);

  const orderPreview = useMemo(() => {
    const quantity = parseQuantity(form.quantity);
    const executionPrice = parseMoneyInput(form.executionPrice);
    const orderValue =
      Number.isFinite(quantity) && Number.isFinite(executionPrice) && quantity > 0 && executionPrice > 0
        ? roundMoney(quantity * executionPrice)
        : 0;
    const latestBalance = getLatestBankBalance(orders, balanceEntries);
    const projectedBalance = form.side === "sell"
      ? roundMoney(latestBalance + orderValue)
      : roundMoney(latestBalance - orderValue);
    return { latestBalance, orderValue, projectedBalance };
  }, [form.quantity, form.executionPrice, form.side, balanceEntries, orders]);

  const pnlBySymbol = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const key = String(o.symbol || "").toUpperCase() || "SEM_ATIVO";
      if (!map.has(key)) map.set(key, { symbol: key, buy: 0, sell: 0, pnl: 0 });
      const row = map.get(key);
      const v = Math.abs(Number(o.order_value || 0));
      if (o.side === "sell") row.sell += v;
      else row.buy += v;
      row.pnl = roundMoney(row.sell - row.buy);
    }
    return [...map.values()].sort((a, b) => b.pnl - a.pnl);
  }, [orders]);

  const averagePositionBySymbol = useMemo(() => {
    const map = new Map();
    const chronologicalOrders = [...orders].sort((a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime());

    for (const o of chronologicalOrders) {
      const symbol = String(o.symbol || "").toUpperCase() || "SEM_ATIVO";
      const quantity = Number(o.quantity || 0);
      const executionPrice = Number(o.execution_price || 0);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(executionPrice) || executionPrice <= 0) continue;

      if (!map.has(symbol)) map.set(symbol, { symbol, quantity: 0, averagePrice: 0 });
      const row = map.get(symbol);

      if (o.side === "sell") {
        if (quantity >= row.quantity) {
          row.quantity = 0;
          row.averagePrice = 0;
        } else {
          row.quantity = roundMoney(row.quantity - quantity);
        }
        continue;
      }

      const newQuantity = row.quantity + quantity;
      row.averagePrice = roundMoney(((row.quantity * row.averagePrice) + (quantity * executionPrice)) / newQuantity);
      row.quantity = roundMoney(newQuantity);
    }

    return [...map.values()]
      .filter((row) => row.quantity > 0)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [orders]);

  return (
    <div style={{ ...styles.card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Investimentos</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Registre ordens de cripto e ajuste o saldo atual da banca.
          </div>
        </div>
        <button style={styles.btnGhost} type="button" onClick={() => fetchAll()} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {schemaMissing ? (
        <div style={{ ...styles.card, marginTop: 12, background: "rgba(245,158,11,.12)", borderColor: "rgba(245,158,11,.35)" }}>
          <div style={{ fontWeight: 800 }}>Schema ausente para investimentos</div>
          <div style={{ ...styles.muted, marginTop: 6, fontSize: 13 }}>
            Execute o SQL atualizado em <code>supabase/schema.sql</code> para criar <code>crypto_orders</code> e <code>bank_balance_entries</code>.
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
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(summary.totalBuy)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Total vendido</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(summary.totalSell)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Ultimo saldo da banca</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(summary.lastBalance)}</div>
        </div>
        <div
          style={{
            ...styles.card,
            background: "var(--card2)",
            borderColor: summary.pnl >= 0 ? "rgba(16,185,129,.55)" : "rgba(244,63,94,.55)",
          }}
        >
          <div style={{ ...styles.muted, fontSize: 12 }}>Lucro / Prejuizo</div>
          <div
            style={{
              marginTop: 6,
              fontSize: 22,
              fontWeight: 900,
              color: summary.pnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)",
            }}
          >
            {summary.pnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(summary.pnl))}
          </div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Preco medio por ativo (posicao atual)</div>
          {averagePositionBySymbol.length === 0 ? (
            <div style={{ marginTop: 6, fontSize: 13, ...styles.muted }}>Sem posicao aberta.</div>
          ) : (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {averagePositionBySymbol.map((row) => (
                <div key={row.symbol} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                  <span style={{ fontWeight: 800 }}>{row.symbol}</span>
                  <span style={{ ...styles.muted }}>
                    Qtd: {row.quantity} | PM: <b style={{ color: "var(--text)" }}>{moneyUSD(row.averagePrice)}</b>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontWeight: 800 }}>Adicionar saldo na carteira da banca</div>
        <form onSubmit={addBalanceEntry} style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div className="investFormGrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <input
              style={styles.input}
              placeholder="Saldo atual da banca (USD)"
              value={balanceForm.amount}
              onChange={(e) => setBalanceForm((p) => ({ ...p, amount: e.target.value }))}
              inputMode="decimal"
            />
            <select
              style={styles.input}
              value={balanceForm.entryType}
              onChange={(e) => setBalanceForm((p) => ({ ...p, entryType: e.target.value }))}
            >
              <option value="deposit">Deposito / Aporte</option>
              <option value="withdraw">Saque</option>
              <option value="adjustment">Ajuste manual</option>
            </select>
            <input
              style={styles.input}
              type="datetime-local"
              value={balanceForm.recordedAt}
              onChange={(e) => setBalanceForm((p) => ({ ...p, recordedAt: e.target.value }))}
            />
          </div>
          <input
            style={styles.input}
            placeholder="Observacoes do ajuste (opcional)"
            value={balanceForm.note}
            onChange={(e) => setBalanceForm((p) => ({ ...p, note: e.target.value }))}
          />
          <button style={styles.btn} type="submit" disabled={savingBalance}>
            {savingBalance ? "Salvando..." : "Salvar saldo da banca"}
          </button>
        </form>
      </div>

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontWeight: 800 }}>Nova ordem</div>
        <form onSubmit={addOrder} style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div className="investFormGrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <select
              style={styles.input}
              value={form.symbol}
              onChange={(e) => setForm((p) => ({ ...p, symbol: e.target.value }))}
            >
              <option value="BTC/USDT">BTC/USDT</option>
              <option value="SOL/USDT">SOL/USDT</option>
            </select>
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
              placeholder="Preco de execucao (USD)"
              value={form.executionPrice}
              onChange={(e) => setForm((p) => ({ ...p, executionPrice: e.target.value }))}
              inputMode="decimal"
            />
            <input
              style={styles.input}
              type="datetime-local"
              value={form.executedAt}
              onChange={(e) => setForm((p) => ({ ...p, executedAt: e.target.value }))}
            />
          </div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Saldo atual da banca: <b>{moneyUSD(orderPreview.latestBalance)}</b> | Valor da ordem: <b>{moneyUSD(orderPreview.orderValue)}</b> | Saldo apos execucao: <b>{moneyUSD(orderPreview.projectedBalance)}</b>
          </div>
          <input
            style={styles.input}
            placeholder="Observacoes (opcional)"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />
          <button style={styles.btn} type="submit" disabled={savingOrder}>
            {savingOrder ? "Salvando..." : "Registrar ordem"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
          Resultado por ativo
        </div>
        {pnlBySymbol.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Sem dados para calcular lucro/prejuizo.</div>
        ) : (
          pnlBySymbol.map((p) => (
            <div
              key={p.symbol}
              className="investOrderRow"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto auto",
                gap: 10,
                alignItems: "center",
                padding: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ fontWeight: 900 }}>{p.symbol}</div>
              <div style={{ ...styles.muted, fontSize: 13 }}>Comprado: {moneyUSD(p.buy)}</div>
              <div style={{ ...styles.muted, fontSize: 13 }}>Vendido: {moneyUSD(p.sell)}</div>
              <div style={{ fontWeight: 900, color: p.pnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)" }}>
                {p.pnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(p.pnl))}
              </div>
            </div>
          ))
        )}
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
                  Qtd: {Number(o.quantity || 0)} | Preco: {moneyUSD(o.execution_price)} | Saldo banca: {moneyUSD(o.bank_balance)}
                </div>
                <div style={{ ...styles.muted, fontSize: 12 }}>
                  {new Date(o.executed_at).toLocaleString("pt-BR")}
                  {o.note ? ` - ${o.note}` : ""}
                </div>
              </div>
              <div style={{ fontWeight: 900 }}>{moneyUSD(o.order_value)}</div>
              <button style={styles.btnGhost} type="button" onClick={() => removeOrder(o.id)}>
                Remover
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
          Ultimos ajustes de saldo
        </div>
        {balanceEntries.length === 0 ? (
          <div style={{ padding: 12, ...styles.muted }}>Nenhum ajuste de saldo registrado.</div>
        ) : (
          balanceEntries.slice(0, 20).map((b) => (
            <div
              key={b.id}
              className="investOrderRow"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                alignItems: "center",
                padding: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900 }}>
                  {b.entry_type === "withdraw" ? "Saque" : b.entry_type === "adjustment" ? "Ajuste" : "Deposito"}
                </div>
                <div style={{ ...styles.muted, fontSize: 12 }}>{new Date(b.recorded_at).toLocaleString("pt-BR")}</div>
                {b.note ? <div style={{ ...styles.muted, fontSize: 12 }}>{b.note}</div> : null}
              </div>
              <div style={{ fontWeight: 900 }}>{moneyUSD(b.amount)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
