import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { supabase } from "../lib/supabase";
import { parseMoneyInput, roundMoney, styles } from "./ui";
import { DarkTooltip, axisLine, axisTick, gridStroke } from "./chartTheme";
import {
  buildInvestmentAnalytics,
  formatAssetQuantity,
  getEffectiveOrderQuantity,
  getNetPositionQuantity,
  getOrderQuoteFeeAmount,
  normalizeAssetSymbol,
  roundAssetPrice,
  roundAssetQuantity,
  roundQuoteValue,
  splitTradingPairSymbol,
  resolveOrderFeeCurrency,
} from "./investmentsAnalytics";

const PRICE_REFRESH_MS = 15000;
const BINANCE_PRICE_SYMBOLS = ["BTCUSDT", "SOLUSDT"];

function moneyUSD(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function moneyUSDShort(value) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
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

function getFeeCurrencyOptions(symbol) {
  const { baseAsset, quoteAsset } = splitTradingPairSymbol(symbol);
  return [quoteAsset, baseAsset];
}

function formatFeeLabel(order) {
  const fee = Number(order?.fee || 0);
  if (!Number.isFinite(fee) || fee <= 0) return moneyUSD(0);

  const feeCurrency = resolveOrderFeeCurrency(order);
  const { quoteAsset } = splitTradingPairSymbol(order?.symbol);
  if (feeCurrency === quoteAsset || feeCurrency === "USD" || feeCurrency === "USDT") {
    return moneyUSD(fee);
  }

  return `${formatAssetQuantity(fee)} ${feeCurrency}`;
}

function formatDateTimeLabel(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "--";
  return dt.toLocaleString("pt-BR");
}

function isMissingColumnError(error, tableName, columnName) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes(String(tableName).toLowerCase())
    && msg.includes(String(columnName).toLowerCase())
    && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"))
  );
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

function ymKeyFromDate(value = new Date()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabelFromKey(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "--";
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function startOfMonthFromKey(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

function endOfMonthFromKey(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return new Date(year, month, 0, 23, 59, 59, 999);
}

function isCurrentMonthKey(key) {
  return key === ymKeyFromDate(new Date());
}

function clampProgress(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export default function InvestmentsPanel({ userId }) {
  const [loading, setLoading] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [orders, setOrders] = useState([]);
  const [balanceEntries, setBalanceEntries] = useState([]);
  const [currentPrices, setCurrentPrices] = useState({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState("");
  const [quotesUpdatedAt, setQuotesUpdatedAt] = useState(null);
  const [supportsOrderFee, setSupportsOrderFee] = useState(true);
  const [patrimonyMode, setPatrimonyMode] = useState("estimated");
  const [goalBaseType, setGoalBaseType] = useState("bankBalance");
  const [selectedGoalMonth, setSelectedGoalMonth] = useState(() => ymKeyFromDate(new Date()));

  const [form, setForm] = useState({
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "",
    executionPrice: "",
    fee: "",
    feeCurrency: "USDT",
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
        .select("id, symbol, side, quantity, execution_price, fee, fee_currency, bank_balance, order_value, note, executed_at, created_at")
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

    let finalOrdersRes = ordersRes;
    if (ordersRes.error && (isMissingColumnError(ordersRes.error, "crypto_orders", "fee") || isMissingColumnError(ordersRes.error, "crypto_orders", "fee_currency"))) {
      setSupportsOrderFee(false);
      finalOrdersRes = await supabase
        .from("crypto_orders")
        .select("id, symbol, side, quantity, execution_price, bank_balance, order_value, note, executed_at, created_at")
        .eq("user_id", userId)
        .order("executed_at", { ascending: false })
        .limit(300);
    } else {
      setSupportsOrderFee(true);
    }

    if (finalOrdersRes.error || balanceRes.error) {
      const err = finalOrdersRes.error || balanceRes.error;
      if (isMissingTableError(err)) {
        setSchemaMissing(true);
        setOrders([]);
        setBalanceEntries([]);
        return;
      }
      return alert(err.message);
    }

    setSchemaMissing(false);
    setOrders((finalOrdersRes.data ?? []).map((o) => ({ ...o, fee: Number(o.fee || 0), fee_currency: o.fee_currency || "USD" })));
    setBalanceEntries(balanceRes.data ?? []);
  }

  async function addOrder(e) {
    e.preventDefault();
    if (!userId) return;

    const symbol = normalizeAssetSymbol(form.symbol);
    const { baseAsset, quoteAsset } = splitTradingPairSymbol(symbol);
    const side = form.side === "sell" ? "sell" : "buy";
    const quantity = parseQuantity(form.quantity);
    const executionPrice = parseMoneyInput(form.executionPrice);
    const fee = parseMoneyInput(form.fee) ?? 0;
    const feeCurrency = String(form.feeCurrency || quoteAsset).trim().toUpperCase() || quoteAsset;

    if (!symbol) return alert("Informe o ativo (ex.: BTCUSDT).");
    if (!Number.isFinite(quantity) || quantity <= 0) return alert("Quantidade invalida.");
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) return alert("Preco de execucao invalido.");
    if (!Number.isFinite(fee) || fee < 0) return alert("Taxa invalida.");
    if (![quoteAsset, baseAsset].includes(feeCurrency)) return alert("Moeda da taxa invalida.");

    const orderValue = roundQuoteValue(quantity * executionPrice);
    const executedAt = form.executedAt ? new Date(form.executedAt) : new Date();
    if (Number.isNaN(executedAt.getTime())) return alert("Data/hora invalida.");
    const latestBalance = getLatestBankBalance(orders, balanceEntries);
    const quoteFee = feeCurrency === baseAsset ? 0 : roundMoney(fee);
    const bankBalance = roundMoney(side === "buy" ? latestBalance - orderValue - quoteFee : latestBalance + orderValue - quoteFee);

    setSavingOrder(true);
    let { error } = await supabase.from("crypto_orders").insert({
      user_id: userId,
      symbol,
      side,
      quantity: roundAssetQuantity(quantity),
      execution_price: roundAssetPrice(executionPrice),
      fee: roundAssetPrice(fee),
      fee_currency: feeCurrency,
      order_value: orderValue,
      bank_balance: roundMoney(bankBalance),
      executed_at: executedAt.toISOString(),
      note: String(form.note || "").trim() || null,
    });

    if (error && (isMissingColumnError(error, "crypto_orders", "fee") || isMissingColumnError(error, "crypto_orders", "fee_currency"))) {
      setSupportsOrderFee(false);
      const fallback = await supabase.from("crypto_orders").insert({
        user_id: userId,
        symbol,
        side,
        quantity: roundAssetQuantity(quantity),
        execution_price: roundAssetPrice(executionPrice),
        order_value: orderValue,
        bank_balance: roundMoney(bankBalance),
        executed_at: executedAt.toISOString(),
        note: String(form.note || "").trim() || null,
      });
      error = fallback.error || null;
      if (!error && fee > 0) {
        alert("Ordem salva sem taxa. Atualize o schema SQL para habilitar coluna de fee.");
      }
    }
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
      fee: "",
      feeCurrency: quoteAsset,
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

  const orderPreview = useMemo(() => {
    const { baseAsset, quoteAsset } = splitTradingPairSymbol(form.symbol);
    const quantity = parseQuantity(form.quantity);
    const executionPrice = parseMoneyInput(form.executionPrice);
    const fee = parseMoneyInput(form.fee) ?? 0;
    const feeCurrency = String(form.feeCurrency || quoteAsset).trim().toUpperCase() || quoteAsset;
    const orderValue =
      Number.isFinite(quantity) && Number.isFinite(executionPrice) && quantity > 0 && executionPrice > 0
        ? roundQuoteValue(quantity * executionPrice)
        : 0;
    const quoteFee =
      Number.isFinite(fee) && fee > 0 && feeCurrency !== baseAsset
        ? roundMoney(fee)
        : 0;
    const latestBalance = getLatestBankBalance(orders, balanceEntries);
    const projectedBalance = form.side === "sell"
      ? roundMoney(latestBalance + orderValue - quoteFee)
      : roundMoney(latestBalance - orderValue - quoteFee);
    return { latestBalance, orderValue, fee, feeCurrency, projectedBalance };
  }, [form.symbol, form.quantity, form.executionPrice, form.fee, form.feeCurrency, form.side, balanceEntries, orders]);

  const analytics = useMemo(() => {
    return buildInvestmentAnalytics(orders);
  }, [orders]);

  const summary = useMemo(() => {
    const count = orders.length;
    const totalBuy = analytics.totalBuy;
    const totalSell = analytics.totalSell;
    const lastBalance = getLatestBankBalance(orders, balanceEntries);
    const totalFees = analytics.totalFees;
    const pnl = roundMoney(totalSell - totalBuy - totalFees);
    return { count, totalBuy, totalSell, totalFees, lastBalance, pnl };
  }, [analytics.totalBuy, analytics.totalSell, analytics.totalFees, orders, balanceEntries]);

  const historyCoverage = useMemo(() => {
    if (orders.length === 0) {
      return {
        firstOrderAt: null,
        lastOrderAt: null,
        bySymbol: [],
      };
    }

    const chronological = [...orders].sort(
      (a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
    );
    const bySymbolMap = new Map();

    for (const order of chronological) {
      const symbol = normalizeAssetSymbol(order.symbol);
      if (!bySymbolMap.has(symbol)) {
        bySymbolMap.set(symbol, { symbol, firstOrderAt: order.executed_at, count: 0 });
      }
      bySymbolMap.get(symbol).count += 1;
    }

    return {
      firstOrderAt: chronological[0]?.executed_at ?? null,
      lastOrderAt: chronological[chronological.length - 1]?.executed_at ?? null,
      bySymbol: [...bySymbolMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    };
  }, [orders]);

  const pnlBySymbol = useMemo(() => analytics.bySymbol, [analytics]);

  const averagePositionBySymbol = useMemo(() => analytics.openPositions, [analytics]);

  useEffect(() => {
    setCurrentPrices((prev) => {
      const next = {};
      for (const row of averagePositionBySymbol) {
        next[row.symbol] = prev[row.symbol] ?? "";
      }
      return next;
    });
  }, [averagePositionBySymbol]);

  useEffect(() => {
    if (averagePositionBySymbol.length === 0) {
      setQuotesLoading(false);
      setQuotesError("");
      setQuotesUpdatedAt(null);
      return;
    }

    let active = true;
    let intervalId;

    async function fetchQuotes() {
      setQuotesLoading(true);
      try {
        const supportedRows = averagePositionBySymbol.filter((row) => BINANCE_PRICE_SYMBOLS.includes(row.symbol));
        if (supportedRows.length === 0) {
          throw new Error("Nenhum ativo atual possui cotacao automatica configurada na Binance.");
        }

        const symbols = [...new Set(supportedRows.map((row) => row.symbol))];
        const response = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
        );
        if (!response.ok) throw new Error(`Falha ao buscar cotacoes da Binance (${response.status}).`);

        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("Resposta invalida da API da Binance.");
        const bySymbol = new Map(
          data
            .filter((item) => item?.symbol && Number.isFinite(Number(item?.price)))
            .map((item) => [String(item.symbol).toUpperCase(), Number(item.price)])
        );

        if (!active) return;

        setCurrentPrices((prev) => {
          const next = { ...prev };
          for (const row of supportedRows) {
            const price = bySymbol.get(row.symbol);
            if (Number.isFinite(price)) next[row.symbol] = String(price);
          }
          return next;
        });
        setQuotesError("");
        setQuotesUpdatedAt(new Date());
      } catch (error) {
        if (!active) return;
        setQuotesError(String(error?.message || "Nao foi possivel atualizar as cotacoes."));
      } finally {
        if (active) setQuotesLoading(false);
      }
    }

    fetchQuotes().catch(() => {});
    intervalId = window.setInterval(() => {
      fetchQuotes().catch(() => {});
    }, PRICE_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [averagePositionBySymbol]);

  const markToMarketBySymbol = useMemo(() => {
    return averagePositionBySymbol.map((row) => {
      const currentPrice = parseMoneyInput(currentPrices[row.symbol]);
      const hasCurrentPrice = Number.isFinite(currentPrice) && currentPrice > 0;
      const currentValue = hasCurrentPrice ? roundMoney(row.quantity * currentPrice) : null;
      const costBasis = roundMoney(row.quantity * row.averagePrice);
      const unrealizedPnl = hasCurrentPrice ? roundMoney(currentValue - costBasis) : null;
      return {
        ...row,
        costBasis,
        currentPrice: hasCurrentPrice ? currentPrice : null,
        currentValue,
        unrealizedPnl,
      };
    });
  }, [averagePositionBySymbol, currentPrices]);

  const equitySummary = useMemo(() => {
    const marketValue = roundMoney(
      markToMarketBySymbol.reduce((acc, row) => acc + (Number.isFinite(row.currentValue) ? Number(row.currentValue) : 0), 0)
    );
    const quotedCostBasis = roundMoney(
      markToMarketBySymbol.reduce((acc, row) => acc + (Number.isFinite(row.currentPrice) ? Number(row.costBasis || 0) : 0), 0)
    );
    const unrealizedPnl = roundMoney(marketValue - quotedCostBasis);
    const totalPnl = roundMoney(analytics.realizedPnl + unrealizedPnl);
    const patrimony = roundMoney(summary.lastBalance + marketValue);
    return { marketValue, unrealizedPnl, totalPnl, patrimony };
  }, [analytics.realizedPnl, markToMarketBySymbol, summary.lastBalance]);

  const balanceTimeline = useMemo(() => {
    const events = [];
    for (const o of orders) {
      const ts = new Date(o.executed_at);
      if (Number.isNaN(ts.getTime())) continue;
      events.push({ ts, bankBalance: Number(o.bank_balance || 0), source: "order" });
    }
    for (const b of balanceEntries) {
      const ts = new Date(b.recorded_at);
      if (Number.isNaN(ts.getTime())) continue;
      events.push({ ts, bankBalance: Number(b.amount || 0), source: "balance" });
    }

    return events
      .sort((a, b) => a.ts.getTime() - b.ts.getTime())
      .map((item) => ({
        ...item,
        iso: item.ts.toISOString(),
        tsMs: item.ts.getTime(),
        label: item.ts.toLocaleDateString("pt-BR"),
        fullLabel: item.ts.toLocaleString("pt-BR"),
      }));
  }, [orders, balanceEntries]);

  const patrimonyTimeline = useMemo(() => {
    const events = [];
    for (const o of orders) {
      const ts = new Date(o.executed_at);
      if (Number.isNaN(ts.getTime())) continue;
      events.push({ ts, type: "order", payload: o });
    }
    for (const b of balanceEntries) {
      const ts = new Date(b.recorded_at);
      if (Number.isNaN(ts.getTime())) continue;
      events.push({ ts, type: "balance", payload: b });
    }
    events.sort((a, b) => a.ts.getTime() - b.ts.getTime());

    const positions = new Map();
    let bankBalance = 0;
    const points = [];

    for (const event of events) {
      if (event.type === "balance") {
        bankBalance = roundMoney(Number(event.payload.amount || 0));
      } else {
        const o = event.payload;
        const symbol = normalizeAssetSymbol(o.symbol);
        const quantity = getNetPositionQuantity(o);
        const executionPrice = Number(o.execution_price || 0);
        const quoteFee = getOrderQuoteFeeAmount(o);

        if (!positions.has(symbol)) positions.set(symbol, { quantity: 0, averagePrice: 0, openCostBasisQuote: 0 });
        const row = positions.get(symbol);

        if (o.side === "sell") {
          const matchedQuantity = Math.min(row.quantity, quantity);
          const avgPriceBeforeSell = row.quantity > 0 ? row.openCostBasisQuote / row.quantity : 0;
          const costBasisSold = roundQuoteValue(matchedQuantity * avgPriceBeforeSell);
          if (matchedQuantity >= row.quantity) {
            row.quantity = 0;
            row.averagePrice = 0;
            row.openCostBasisQuote = 0;
          } else {
            row.quantity = roundAssetQuantity(row.quantity - matchedQuantity);
            row.openCostBasisQuote = roundQuoteValue(Math.max(0, row.openCostBasisQuote - costBasisSold));
            row.averagePrice = row.quantity > 0 ? roundAssetPrice(row.openCostBasisQuote / row.quantity) : 0;
          }
        } else if (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(executionPrice) && executionPrice > 0) {
          const newQty = roundAssetQuantity(row.quantity + quantity);
          const costAdded = roundQuoteValue(Number(o.order_value || (getEffectiveOrderQuantity(o) * executionPrice)) + quoteFee);
          row.openCostBasisQuote = roundQuoteValue(row.openCostBasisQuote + costAdded);
          row.averagePrice = newQty > 0
            ? roundAssetPrice(row.openCostBasisQuote / newQty)
            : 0;
          row.quantity = newQty;
        }

        bankBalance = roundMoney(Number(o.bank_balance || bankBalance || 0));
      }

      let positionsValue = 0;
      for (const [symbol, row] of positions.entries()) {
        if (!row || row.quantity <= 0) continue;
        const quoted = parseMoneyInput(currentPrices[symbol]);
        const unitPrice = patrimonyMode === "estimated"
          ? (Number.isFinite(quoted) && quoted > 0 ? quoted : Number(row.averagePrice || 0))
          : Number(row.averagePrice || 0);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;
        positionsValue += roundMoney(row.quantity * unitPrice);
      }

      const patrimony = roundMoney(bankBalance + positionsValue);
      points.push({
        iso: event.ts.toISOString(),
        tsMs: event.ts.getTime(),
        label: event.ts.toLocaleDateString("pt-BR"),
        fullLabel: event.ts.toLocaleString("pt-BR"),
        bankBalance,
        positionsValue: roundMoney(positionsValue),
        patrimony,
      });
    }

    return points;
  }, [orders, balanceEntries, currentPrices, patrimonyMode]);

  const goalSeries = useMemo(() => {
    const source = goalBaseType === "patrimony" ? patrimonyTimeline : balanceTimeline;
    return source
      .map((row) => ({
        ts: new Date(row.iso || row.fullLabel),
        value: Number(goalBaseType === "patrimony" ? row.patrimony : row.bankBalance || 0),
      }))
      .filter((row) => !Number.isNaN(row.ts.getTime()) && Number.isFinite(row.value))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }, [goalBaseType, patrimonyTimeline, balanceTimeline]);

  const goalMonthOptions = useMemo(() => {
    const keys = new Set(goalSeries.map((row) => ymKeyFromDate(row.ts)));
    const currentKey = ymKeyFromDate(new Date());
    if (currentKey) keys.add(currentKey);
    return [...keys]
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({ key, label: monthLabelFromKey(key) }));
  }, [goalSeries]);

  useEffect(() => {
    if (goalMonthOptions.length === 0) return;
    if (!goalMonthOptions.some((option) => option.key === selectedGoalMonth)) {
      setSelectedGoalMonth(goalMonthOptions[0].key);
    }
  }, [goalMonthOptions, selectedGoalMonth]);

  const monthlyGoal = useMemo(() => {
    const currentBaseValue = roundMoney(goalBaseType === "patrimony" ? equitySummary.patrimony : summary.lastBalance);
    const currentTargetAmount = roundMoney(currentBaseValue * 0.1);
    const targetValue = roundMoney(currentBaseValue + currentTargetAmount);
    const monthKey = selectedGoalMonth || ymKeyFromDate(new Date());
    const start = startOfMonthFromKey(monthKey);
    const end = endOfMonthFromKey(monthKey);
    const currentMonth = isCurrentMonthKey(monthKey);

    const beforeStart = start ? goalSeries.filter((row) => row.ts < start) : [];
    const inMonth = start && end ? goalSeries.filter((row) => row.ts >= start && row.ts <= end) : goalSeries;

    const openingPoint = beforeStart[beforeStart.length - 1] || inMonth[0] || null;
    const closingPoint = inMonth[inMonth.length - 1] || openingPoint;
    const openingValue = Number(openingPoint?.value || 0);
    const currentValue = Number(closingPoint?.value || openingValue || 0);
    const monthTargetAmount = openingValue > 0 ? roundMoney(openingValue * 0.1) : 0;
    const achievedAmount = roundMoney(currentValue - openingValue);
    const remainingAmount = roundMoney(monthTargetAmount - achievedAmount);
    const progressPct = monthTargetAmount > 0 ? achievedAmount / monthTargetAmount : 0;
    const growthPct = openingValue > 0 ? achievedAmount / openingValue : 0;

    const totalDays = end ? end.getDate() : 0;
    const elapsedDays = totalDays === 0
      ? 0
      : currentMonth
        ? Math.max(1, Math.min(totalDays, new Date().getDate()))
        : totalDays;
    const remainingDays = totalDays === 0 ? 0 : Math.max(0, totalDays - elapsedDays);
    const dailyNeeded = remainingAmount > 0
      ? roundMoney(remainingAmount / Math.max(1, remainingDays || 1))
      : 0;

    return {
      baseLabel: goalBaseType === "patrimony" ? "Patrimonio total" : "Saldo da banca",
      currentBaseValue,
      currentTargetAmount,
      targetValue,
      monthKey,
      monthLabel: monthLabelFromKey(monthKey),
      trackingReady: Boolean(openingPoint),
      openingValue,
      currentValue,
      monthTargetAmount,
      achievedAmount,
      remainingAmount,
      progressPct,
      progressPctClamped: clampProgress(progressPct),
      growthPct,
      totalDays,
      elapsedDays,
      remainingDays,
      dailyNeeded,
      currentMonth,
    };
  }, [goalBaseType, goalSeries, selectedGoalMonth, equitySummary.patrimony, summary.lastBalance]);

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

      {orders.length > 0 ? (
        <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Historico carregado no painel</div>
          <div style={{ ...styles.muted, marginTop: 6, fontSize: 12 }}>
            Periodo local: <b style={{ color: "var(--text)" }}>{formatDateTimeLabel(historyCoverage.firstOrderAt)}</b> ate{" "}
            <b style={{ color: "var(--text)" }}>{formatDateTimeLabel(historyCoverage.lastOrderAt)}</b>
          </div>
          <div style={{ ...styles.muted, marginTop: 4, fontSize: 12 }}>
            {historyCoverage.bySymbol.map((row) => `${row.symbol}: ${row.count} ordem(ns), primeira em ${formatDateTimeLabel(row.firstOrderAt)}`).join(" | ")}
          </div>
          <div style={{ ...styles.muted, marginTop: 6, fontSize: 11 }}>
            Quantidade, PM e PnL do painel dependem exclusivamente desse historico salvo no banco. Se houver ordens na Binance fora desse intervalo, a conciliacao nao vai fechar.
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
            borderColor: equitySummary.totalPnl >= 0 ? "rgba(16,185,129,.55)" : "rgba(244,63,94,.55)",
          }}
        >
          <div style={{ ...styles.muted, fontSize: 12 }}>Resultado total</div>
          <div
            style={{
              marginTop: 6,
              fontSize: 22,
              fontWeight: 900,
              color: equitySummary.totalPnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)",
            }}
          >
            {equitySummary.totalPnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(equitySummary.totalPnl))}
          </div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>PnL realizado</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: analytics.realizedPnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)" }}>
            {analytics.realizedPnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(analytics.realizedPnl))}
          </div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>PnL nao realizado</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: equitySummary.unrealizedPnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)" }}>
            {equitySummary.unrealizedPnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(equitySummary.unrealizedPnl))}
          </div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Patrimonio total</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(equitySummary.patrimony)}</div>
          <div style={{ ...styles.muted, fontSize: 11, marginTop: 3 }}>
            Saldo banca + valor de mercado
          </div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Taxas pagas</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(analytics.totalFees)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Valor de mercado (posicoes)</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(equitySummary.marketValue)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Custo em aberto</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(analytics.totalInvestedCost)}</div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Fluxo liquido das ordens</div>
          <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: summary.pnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)" }}>
            {summary.pnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(summary.pnl))}
          </div>
          <div style={{ ...styles.muted, fontSize: 11, marginTop: 3 }}>
            Vendas - compras - taxas. Mede o caixa liquido das ordens, nao o PnL da carteira aberta.
          </div>
        </div>
        <div style={{ ...styles.card, background: "var(--card2)" }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>Preco medio atual da operacao aberta</div>
          {averagePositionBySymbol.length === 0 ? (
            <div style={{ marginTop: 6, fontSize: 13, ...styles.muted }}>Sem posicao aberta.</div>
          ) : (
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {averagePositionBySymbol.map((row) => (
                <div key={row.symbol} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                  <span style={{ fontWeight: 800 }}>{row.symbol}</span>
                  <span style={{ ...styles.muted }}>
                    Qtd aberta: {formatAssetQuantity(row.quantity)} | PM atual: <b style={{ color: "var(--text)" }}>{moneyUSD(row.averagePrice)}</b>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...styles.muted, fontSize: 11, marginTop: 6 }}>
            Calculado pela quantidade remanescente apos compras, vendas e taxas.
          </div>
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800 }}>Meta mensal de 10%</div>
            <div style={{ ...styles.muted, marginTop: 4, fontSize: 12 }}>
              Calcula 10% sobre o saldo atual e acompanha o mes selecionado com base no historico salvo.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={goalBaseType === "bankBalance" ? styles.btn : styles.btnGhost}
              onClick={() => setGoalBaseType("bankBalance")}
            >
              Saldo da banca
            </button>
            <button
              type="button"
              style={goalBaseType === "patrimony" ? styles.btn : styles.btnGhost}
              onClick={() => setGoalBaseType("patrimony")}
            >
              Patrimonio total
            </button>
          </div>
        </div>

        <div style={{ ...styles.gridAuto, marginTop: 12 }}>
          <div style={{ ...styles.card, background: "rgba(255,255,255,.03)" }}>
            <div style={{ ...styles.muted, fontSize: 12 }}>Base atual considerada</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(monthlyGoal.currentBaseValue)}</div>
            <div style={{ ...styles.muted, fontSize: 11, marginTop: 4 }}>{monthlyGoal.baseLabel}</div>
          </div>
          <div style={{ ...styles.card, background: "rgba(255,255,255,.03)" }}>
            <div style={{ ...styles.muted, fontSize: 12 }}>Meta de 10% sobre a base atual</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(monthlyGoal.currentTargetAmount)}</div>
            <div style={{ ...styles.muted, fontSize: 11, marginTop: 4 }}>Objetivo do mes na base atual</div>
          </div>
          <div style={{ ...styles.card, background: "rgba(255,255,255,.03)" }}>
            <div style={{ ...styles.muted, fontSize: 12 }}>Saldo alvo</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>{moneyUSD(monthlyGoal.targetValue)}</div>
            <div style={{ ...styles.muted, fontSize: 11, marginTop: 4 }}>Base atual + 10%</div>
          </div>
          <div
            style={{
              ...styles.card,
              background: "rgba(255,255,255,.03)",
              borderColor: monthlyGoal.achievedAmount >= 0 ? "rgba(16,185,129,.35)" : "rgba(244,63,94,.35)",
            }}
          >
            <div style={{ ...styles.muted, fontSize: 12 }}>Resultado no mes selecionado</div>
            <div
              style={{
                marginTop: 6,
                fontSize: 22,
                fontWeight: 900,
                color: monthlyGoal.achievedAmount >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)",
              }}
            >
              {monthlyGoal.achievedAmount >= 0 ? "+" : "-"}{moneyUSD(Math.abs(monthlyGoal.achievedAmount))}
            </div>
            <div style={{ ...styles.muted, fontSize: 11, marginTop: 4 }}>{monthlyGoal.monthLabel}</div>
          </div>
          <div style={{ ...styles.card, background: "rgba(255,255,255,.03)" }}>
            <div style={{ ...styles.muted, fontSize: 12 }}>Rentabilidade do mes</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900 }}>
              {(monthlyGoal.growthPct * 100).toFixed(2)}%
            </div>
            <div style={{ ...styles.muted, fontSize: 11, marginTop: 4 }}>
              Meta: 10,00%
            </div>
          </div>
          <div
            style={{
              ...styles.card,
              background: monthlyGoal.remainingAmount <= 0 ? "rgba(16,185,129,.10)" : "rgba(255,255,255,.03)",
              borderColor: monthlyGoal.remainingAmount <= 0 ? "rgba(16,185,129,.35)" : "var(--border)",
            }}
          >
            <div style={{ ...styles.muted, fontSize: 12 }}>
              {monthlyGoal.remainingAmount <= 0 ? "Excedente acima da meta" : "Falta para bater a meta"}
            </div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: monthlyGoal.remainingAmount <= 0 ? "rgb(16,185,129)" : "var(--text)" }}>
              {moneyUSD(Math.abs(monthlyGoal.remainingAmount))}
            </div>
            <div style={{ ...styles.muted, fontSize: 11, marginTop: 4 }}>
              {monthlyGoal.remainingAmount <= 0
                ? "Parabens, a meta do mes ja foi atingida."
                : monthlyGoal.remainingDays > 0
                  ? `${moneyUSD(monthlyGoal.dailyNeeded)} por dia restante`
                  : "Mes encerrado."}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, alignItems: "end" }} className="investGoalGrid">
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>Mes para acompanhamento</div>
              <select
                style={styles.input}
                value={selectedGoalMonth}
                onChange={(e) => setSelectedGoalMonth(e.target.value)}
              >
                {goalMonthOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ ...styles.muted, fontSize: 12, marginBottom: 6 }}>
                Progresso da meta de {moneyUSD(monthlyGoal.monthTargetAmount)}
              </div>
              <div style={{ height: 14, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.06)", border: "1px solid var(--border)" }}>
                <div
                  style={{
                    width: `${monthlyGoal.progressPctClamped * 100}%`,
                    height: "100%",
                    background: monthlyGoal.progressPct >= 1
                      ? "linear-gradient(135deg, rgb(16,185,129), rgb(34,197,94))"
                      : monthlyGoal.achievedAmount >= 0
                        ? "linear-gradient(135deg, rgb(59,130,246), rgb(16,185,129))"
                        : "linear-gradient(135deg, rgb(244,63,94), rgb(249,115,22))",
                    transition: "width .2s ease",
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <div style={{ ...styles.card, padding: 10, background: "rgba(255,255,255,.03)" }}>
              <div style={{ ...styles.muted, fontSize: 12 }}>Base no inicio do mes</div>
              <div style={{ marginTop: 4, fontWeight: 900 }}>{moneyUSD(monthlyGoal.openingValue)}</div>
            </div>
            <div style={{ ...styles.card, padding: 10, background: "rgba(255,255,255,.03)" }}>
              <div style={{ ...styles.muted, fontSize: 12 }}>Base mais recente do mes</div>
              <div style={{ marginTop: 4, fontWeight: 900 }}>{moneyUSD(monthlyGoal.currentValue)}</div>
            </div>
            <div style={{ ...styles.card, padding: 10, background: "rgba(255,255,255,.03)" }}>
              <div style={{ ...styles.muted, fontSize: 12 }}>Dias acompanhados</div>
              <div style={{ marginTop: 4, fontWeight: 900 }}>{monthlyGoal.elapsedDays}/{monthlyGoal.totalDays || 0}</div>
            </div>
          </div>

          <div style={{ ...styles.muted, fontSize: 12 }}>
            {monthlyGoal.trackingReady
              ? monthlyGoal.currentMonth
                ? `Meta do mes atual: ${moneyUSD(monthlyGoal.monthTargetAmount)}. ${monthlyGoal.remainingAmount <= 0 ? "Meta atingida no acompanhamento atual." : `Faltam ${moneyUSD(monthlyGoal.remainingAmount)} para chegar nos 10%.`}`
                : `Resumo de ${monthlyGoal.monthLabel}: alvo de ${moneyUSD(monthlyGoal.monthTargetAmount)} e resultado final de ${moneyUSD(monthlyGoal.achievedAmount)}.`
              : "Ainda nao ha historico suficiente para medir a evolucao do mes selecionado. O calculo de 10% sobre a base atual continua disponivel acima."}
          </div>
          <div style={{ ...styles.muted, fontSize: 11 }}>
            Dica: use "Patrimonio total" para uma leitura mais fiel quando houver posicoes abertas; use "Saldo da banca" se quiser mirar somente o caixa disponivel.
          </div>
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
        {!supportsOrderFee ? (
          <div style={{ ...styles.muted, marginTop: 8, fontSize: 12 }}>
            Sua base ainda nao possui colunas de taxa em <code>crypto_orders</code>. Atualize o schema para salvar fees.
          </div>
        ) : null}
        <form onSubmit={addOrder} style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div className="investFormGrid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <select
              style={styles.input}
              value={form.symbol}
              onChange={(e) => {
                const nextSymbol = e.target.value;
                const nextOptions = getFeeCurrencyOptions(nextSymbol);
                setForm((p) => ({
                  ...p,
                  symbol: nextSymbol,
                  feeCurrency: nextOptions.includes(p.feeCurrency) ? p.feeCurrency : nextOptions[0],
                }));
              }}
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
              placeholder="Taxa da ordem"
              value={form.fee}
              onChange={(e) => setForm((p) => ({ ...p, fee: e.target.value }))}
              inputMode="decimal"
            />
            <select
              style={styles.input}
              value={form.feeCurrency}
              onChange={(e) => setForm((p) => ({ ...p, feeCurrency: e.target.value }))}
            >
              {getFeeCurrencyOptions(form.symbol).map((currency) => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
            <input
              style={styles.input}
              type="datetime-local"
              value={form.executedAt}
              onChange={(e) => setForm((p) => ({ ...p, executedAt: e.target.value }))}
            />
          </div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Saldo atual da banca: <b>{moneyUSD(orderPreview.latestBalance)}</b> | Valor da ordem: <b>{moneyUSD(orderPreview.orderValue)}</b> | Taxa: <b>{Number(orderPreview.fee || 0) > 0 ? (orderPreview.feeCurrency === "USDT" || orderPreview.feeCurrency === "USD" ? moneyUSD(orderPreview.fee) : `${formatAssetQuantity(orderPreview.fee)} ${orderPreview.feeCurrency}`) : moneyUSD(0)}</b> | Saldo apos execucao: <b>{moneyUSD(orderPreview.projectedBalance)}</b>
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

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontWeight: 800 }}>Evolucao do saldo da banca</div>
        <div style={{ ...styles.muted, fontSize: 12, marginTop: 4 }}>
          Serie historica com snapshots de ordens e ajustes de saldo.
        </div>
        <div style={{ width: "100%", height: 260, marginTop: 10 }}>
          {balanceTimeline.length === 0 ? (
            <div style={{ ...styles.muted }}>Sem eventos para plotar.</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={balanceTimeline} margin={{ left: 6, right: 12, top: 10, bottom: 4 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="6 10" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={24} />
                <YAxis
                  tick={axisTick}
                  axisLine={axisLine}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v) => moneyUSDShort(v)}
                />
                <Tooltip
                  content={(
                    <DarkTooltip
                      labelFormatter={(label) => label}
                      formatter={(v) => moneyUSD(v)}
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="bankBalance"
                  name="Saldo da banca"
                  stroke="rgb(34,211,238)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ fontWeight: 800 }}>Evolucao do patrimonio total</div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <div style={{ ...styles.muted, fontSize: 12 }}>
            Patrimonio = saldo da banca + valor das posicoes.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={patrimonyMode === "estimated" ? styles.btn : styles.btnGhost}
              onClick={() => setPatrimonyMode("estimated")}
            >
              Estimado (cotacao atual)
            </button>
            <button
              type="button"
              style={patrimonyMode === "conservative" ? styles.btn : styles.btnGhost}
              onClick={() => setPatrimonyMode("conservative")}
            >
              Conservador (preco medio)
            </button>
          </div>
        </div>
        <div style={{ width: "100%", height: 280, marginTop: 10 }}>
          {patrimonyTimeline.length === 0 ? (
            <div style={{ ...styles.muted }}>Sem eventos para plotar.</div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={patrimonyTimeline} margin={{ left: 6, right: 12, top: 10, bottom: 4 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="6 10" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={axisLine} tickLine={false} minTickGap={24} />
                <YAxis
                  tick={axisTick}
                  axisLine={axisLine}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v) => moneyUSDShort(v)}
                />
                <Tooltip
                  content={(
                    <DarkTooltip
                      formatter={(v) => moneyUSD(v)}
                      labelFormatter={(label) => label}
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="patrimony"
                  name={patrimonyMode === "estimated" ? "Patrimonio estimado" : "Patrimonio conservador"}
                  stroke="rgb(16,185,129)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="bankBalance"
                  name="Saldo banca"
                  stroke="rgb(34,211,238)"
                  strokeWidth={1.8}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: 12, background: "var(--card2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 800 }}>Precificacao atual da posicao</div>
          <div style={{ ...styles.muted, fontSize: 12 }}>
            {quotesLoading
              ? "Atualizando cotacoes..."
              : quotesUpdatedAt
                ? `Atualizado em ${quotesUpdatedAt.toLocaleTimeString("pt-BR")}`
                : `Atualizacao automatica a cada ${PRICE_REFRESH_MS / 1000}s`}
          </div>
        </div>
        <div style={{ ...styles.muted, marginTop: 4, fontSize: 12 }}>
          Fonte de preco atual: Binance spot ticker.
        </div>
        {quotesError ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "rgb(244,63,94)" }}>{quotesError}</div>
        ) : null}
        {markToMarketBySymbol.length === 0 ? (
          <div style={{ marginTop: 10, ...styles.muted }}>Nenhum ativo em posicao para precificar.</div>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {markToMarketBySymbol.map((row) => (
              <div
                key={row.symbol}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 900 }}>{row.symbol}</div>
                  <div style={{ ...styles.muted, fontSize: 12 }}>Qtd: {formatAssetQuantity(row.quantity)}</div>
                </div>
                <div style={{ ...styles.card, padding: 10, background: "rgba(255,255,255,.03)" }}>
                  <div style={{ ...styles.muted, fontSize: 12 }}>Preco atual (USD)</div>
                  <div style={{ marginTop: 4, fontWeight: 900, fontSize: 18 }}>
                    {row.currentPrice === null ? "--" : moneyUSD(row.currentPrice)}
                  </div>
                </div>
                <div style={{ fontSize: 13 }}>
                  <span style={styles.muted}>PM atual: {moneyUSD(row.averagePrice)} | Custo em aberto: {moneyUSD(row.costBasis)}</span>
                  <div
                    style={{
                      marginTop: 4,
                      fontWeight: 900,
                      color:
                        row.unrealizedPnl === null
                          ? "var(--text)"
                          : row.unrealizedPnl >= 0
                            ? "rgb(16,185,129)"
                            : "rgb(244,63,94)",
                    }}
                  >
                    {row.currentPrice === null
                      ? "Aguardando cotacao automatica."
                      : `${row.unrealizedPnl >= 0 ? "Lucro" : "Prejuizo"}: ${moneyUSD(Math.abs(row.unrealizedPnl))} | Valor atual: ${moneyUSD(row.currentValue)}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
          Resultado realizado por ativo
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
                gridTemplateColumns: "minmax(220px, 1fr) auto auto auto",
                gap: 10,
                alignItems: "center",
                padding: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900 }}>{p.symbol}</div>
                <div style={{ ...styles.muted, fontSize: 12, marginTop: 2 }}>
                  Comprado: {moneyUSD(p.totalBuy)} | Vendido: {moneyUSD(p.totalSell)} | Taxas: {moneyUSD(p.totalFees)}
                </div>
                {p.quantity > 0 ? (
                  <div style={{ ...styles.muted, fontSize: 12 }}>
                    Posicao aberta: {formatAssetQuantity(p.quantity)} | PM atual: {moneyUSD(p.averagePrice)} | Custo em aberto: {moneyUSD(p.openCostBasis)}
                  </div>
                ) : null}
              </div>
              <div style={{ ...styles.muted, fontSize: 13 }}>Fechado: {formatAssetQuantity(p.closedQuantity)}</div>
              <div style={{ ...styles.muted, fontSize: 13 }}>
                {p.quantity > 0 ? `Em aberto: ${formatAssetQuantity(p.quantity)}` : "Sem posicao"}
              </div>
              <div style={{ fontWeight: 900, color: p.realizedPnl >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)" }}>
                {p.realizedPnl >= 0 ? "+" : "-"}{moneyUSD(Math.abs(p.realizedPnl))}
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
                  Qtd exec.: {formatAssetQuantity(getEffectiveOrderQuantity(o))}
                  {Math.abs(getNetPositionQuantity(o) - getEffectiveOrderQuantity(o)) > 0.00000001 ? ` | Qtd liquida: ${formatAssetQuantity(getNetPositionQuantity(o))}` : ""}
                  {" | "}Preco: {moneyUSD(o.execution_price)} | Taxa: {formatFeeLabel(o)} | Saldo banca: {moneyUSD(o.bank_balance)}
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
