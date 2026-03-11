import { roundMoney } from "./ui.js";

const ASSET_DECIMALS = 8;
const QUOTE_DECIMALS = 8;
const KNOWN_QUOTE_ASSETS = ["USDT", "USDC", "BUSD", "USD", "BRL", "EUR"];

function roundTo(value, decimals = ASSET_DECIMALS) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

export function roundAssetQuantity(value) {
  return roundTo(value, ASSET_DECIMALS);
}

export function roundAssetPrice(value) {
  return roundTo(value, ASSET_DECIMALS);
}

export function roundQuoteValue(value) {
  return roundTo(value, QUOTE_DECIMALS);
}

export function splitTradingPairSymbol(value) {
  const symbol = normalizeAssetSymbol(value);
  for (const quoteAsset of KNOWN_QUOTE_ASSETS) {
    if (symbol.endsWith(quoteAsset) && symbol.length > quoteAsset.length) {
      return {
        symbol,
        baseAsset: symbol.slice(0, -quoteAsset.length),
        quoteAsset,
      };
    }
  }

  return {
    symbol,
    baseAsset: symbol,
    quoteAsset: "USD",
  };
}

export function getEffectiveOrderQuantity(order) {
  const storedQuantity = Number(order?.quantity || 0);
  const hasStoredQuantity = Number.isFinite(storedQuantity) && storedQuantity > 0;
  if (hasStoredQuantity) return roundAssetQuantity(storedQuantity);

  const executionPrice = Number(order?.execution_price || 0);
  const orderValue = Number(order?.order_value || 0);
  const canDeriveQuantity = Number.isFinite(executionPrice) && executionPrice > 0 && Number.isFinite(orderValue) && orderValue > 0;

  if (!canDeriveQuantity) return 0;
  return roundAssetQuantity(orderValue / executionPrice);
}

export function formatAssetQuantity(value) {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: ASSET_DECIMALS,
  });
}

export function normalizeAssetSymbol(value) {
  return String(value || "").trim().toUpperCase().replace("/", "") || "SEM_ATIVO";
}

function getNormalizedFeeCurrency(order) {
  const rawFeeCurrency = String(order?.fee_currency || "").trim().toUpperCase();
  if (rawFeeCurrency) return rawFeeCurrency;
  return splitTradingPairSymbol(order?.symbol).quoteAsset;
}

export function resolveOrderFeeCurrency(order) {
  const fee = Number(order?.fee || 0);
  const quantity = getEffectiveOrderQuantity(order);
  const side = String(order?.side || "").trim().toLowerCase();
  const { baseAsset, quoteAsset } = splitTradingPairSymbol(order?.symbol);
  const feeCurrency = getNormalizedFeeCurrency(order);

  if (feeCurrency === "USD" && quoteAsset === "USDT") {
    const looksLikeLegacyBaseFee =
      side === "buy"
      && Number.isFinite(fee)
      && fee > 0
      && Number.isFinite(quantity)
      && quantity > 0
      && (fee / quantity) <= 0.01;

    if (looksLikeLegacyBaseFee) return baseAsset;
    return quoteAsset;
  }

  return feeCurrency;
}

function isQuoteFeeCurrency(feeCurrency, quoteAsset) {
  return feeCurrency === quoteAsset || feeCurrency === "USD" || feeCurrency === "USDT";
}

export function getOrderGrossValue(order) {
  const storedOrderValue = Number(order?.order_value);
  if (Number.isFinite(storedOrderValue) && storedOrderValue > 0) {
    return roundQuoteValue(storedOrderValue);
  }

  const quantity = getEffectiveOrderQuantity(order);
  const executionPrice = Number(order?.execution_price || 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(executionPrice) || executionPrice <= 0) {
    return 0;
  }

  return roundQuoteValue(quantity * executionPrice);
}

export function getOrderQuoteFeeAmount(order) {
  const fee = Number(order?.fee || 0);
  const executionPrice = Number(order?.execution_price || 0);
  const feeCurrency = resolveOrderFeeCurrency(order);
  const { baseAsset, quoteAsset } = splitTradingPairSymbol(order?.symbol);

  if (!Number.isFinite(fee) || fee <= 0) return 0;
  if (feeCurrency === baseAsset && Number.isFinite(executionPrice) && executionPrice > 0) {
    return roundQuoteValue(fee * executionPrice);
  }
  if (isQuoteFeeCurrency(feeCurrency, quoteAsset)) {
    return roundQuoteValue(fee);
  }
  return roundQuoteValue(fee);
}

export function getNetPositionQuantity(order) {
  const quantity = getEffectiveOrderQuantity(order);
  const fee = Number(order?.fee || 0);
  const feeCurrency = resolveOrderFeeCurrency(order);
  const side = String(order?.side || "").trim().toLowerCase();
  const { baseAsset } = splitTradingPairSymbol(order?.symbol);

  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(fee) || fee <= 0 || feeCurrency !== baseAsset) return roundAssetQuantity(quantity);

  if (side === "sell") return roundAssetQuantity(quantity + fee);
  return roundAssetQuantity(Math.max(0, quantity - fee));
}

export function buildInvestmentAnalytics(orders = []) {
  const rows = new Map();
  let realizedPnl = 0;
  let totalFees = 0;
  let totalInvestedCost = 0;

  const chronologicalOrders = [...orders].sort(
    (a, b) => new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime()
  );

  for (const order of chronologicalOrders) {
    const symbol = normalizeAssetSymbol(order.symbol);
    const quantity = getEffectiveOrderQuantity(order);
    const netPositionQuantity = getNetPositionQuantity(order);
    const executionPrice = Number(order.execution_price || 0);
    const grossOrderValue = getOrderGrossValue(order);
    const quoteFee = getOrderQuoteFeeAmount(order);

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(executionPrice) || executionPrice <= 0) {
      continue;
    }

    totalFees = roundMoney(totalFees + quoteFee);
    if (!rows.has(symbol)) {
      rows.set(symbol, {
        symbol,
        quantity: 0,
        averagePrice: 0,
        totalBuy: 0,
        totalSell: 0,
        totalFees: 0,
        realizedPnl: 0,
        closedQuantity: 0,
      });
    }

    const row = rows.get(symbol);
    row.totalFees = roundMoney(row.totalFees + quoteFee);

    if (order.side === "sell") {
      row.totalSell = roundMoney(row.totalSell + grossOrderValue);

      const quantityToClose = netPositionQuantity;
      const matchedQuantity = Math.min(row.quantity, quantityToClose);
      const matchedRatio = quantityToClose > 0 ? matchedQuantity / quantityToClose : 0;
      const matchedProceeds = roundMoney((grossOrderValue - quoteFee) * matchedRatio);
      const costBasisSold = roundMoney(matchedQuantity * row.averagePrice);
      const realizedOnTrade = roundMoney(matchedProceeds - costBasisSold);

      row.realizedPnl = roundMoney(row.realizedPnl + realizedOnTrade);
      row.closedQuantity = roundAssetQuantity(row.closedQuantity + matchedQuantity);
      realizedPnl = roundMoney(realizedPnl + realizedOnTrade);

      if (matchedQuantity >= row.quantity) {
        row.quantity = 0;
        row.averagePrice = 0;
      } else {
        row.quantity = roundAssetQuantity(row.quantity - matchedQuantity);
      }

      continue;
    }

    row.totalBuy = roundMoney(row.totalBuy + grossOrderValue);
    const buyCostWithFee = roundQuoteValue(grossOrderValue + quoteFee);
    const currentCostBasis = row.quantity * row.averagePrice;
    const newQuantity = roundAssetQuantity(row.quantity + netPositionQuantity);
    const newCostBasis = currentCostBasis + buyCostWithFee;

    row.averagePrice = newQuantity > 0 ? roundAssetPrice(newCostBasis / newQuantity) : 0;
    row.quantity = newQuantity;
  }

  const bySymbol = [...rows.values()]
    .map((row) => {
      const openCostBasis = roundMoney(row.quantity * row.averagePrice);
      if (row.quantity > 0) totalInvestedCost = roundMoney(totalInvestedCost + openCostBasis);
      return {
        ...row,
        openCostBasis,
      };
    })
    .sort((a, b) => b.realizedPnl - a.realizedPnl || a.symbol.localeCompare(b.symbol));

  const openPositions = bySymbol
    .filter((row) => row.quantity > 0)
    .map((row) => ({
      symbol: row.symbol,
      quantity: row.quantity,
      averagePrice: row.averagePrice,
      costBasis: row.openCostBasis,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    bySymbol,
    openPositions,
    realizedPnl: roundMoney(realizedPnl),
    totalFees: roundMoney(totalFees),
    totalInvestedCost: roundMoney(totalInvestedCost),
  };
}
