import { roundMoney } from "./ui.js";

const ASSET_DECIMALS = 8;

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

export function getEffectiveOrderQuantity(order) {
  const storedQuantity = Number(order?.quantity || 0);
  const executionPrice = Number(order?.execution_price || 0);
  const orderValue = Number(order?.order_value || 0);

  const hasStoredQuantity = Number.isFinite(storedQuantity) && storedQuantity > 0;
  const canDeriveQuantity = Number.isFinite(executionPrice) && executionPrice > 0 && Number.isFinite(orderValue) && orderValue > 0;

  if (!hasStoredQuantity && !canDeriveQuantity) return 0;
  if (!canDeriveQuantity) return roundAssetQuantity(storedQuantity);

  const derivedQuantity = roundAssetQuantity(orderValue / executionPrice);
  if (!hasStoredQuantity) return derivedQuantity;

  const storedOrderValue = roundMoney(storedQuantity * executionPrice);
  const valueMismatch = Math.abs(storedOrderValue - roundMoney(orderValue));

  if (valueMismatch > 0.02) return derivedQuantity;
  return roundAssetQuantity(storedQuantity);
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
    const executionPrice = Number(order.execution_price || 0);
    const fee = roundMoney(Number(order.fee || 0));
    const orderValue = Number(order.order_value);
    const grossOrderValue = roundMoney(
      Number.isFinite(orderValue) ? orderValue : quantity * executionPrice
    );

    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(executionPrice) || executionPrice <= 0) {
      continue;
    }

    totalFees = roundMoney(totalFees + fee);
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
    row.totalFees = roundMoney(row.totalFees + fee);

    if (order.side === "sell") {
      row.totalSell = roundMoney(row.totalSell + grossOrderValue);

      const matchedQuantity = Math.min(row.quantity, quantity);
      const matchedRatio = quantity > 0 ? matchedQuantity / quantity : 0;
      const matchedProceeds = roundMoney((grossOrderValue - fee) * matchedRatio);
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
    const buyCostWithFee = roundMoney(grossOrderValue + fee);
    const currentCostBasis = row.quantity * row.averagePrice;
    const newQuantity = roundAssetQuantity(row.quantity + quantity);
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
