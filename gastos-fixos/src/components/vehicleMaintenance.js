const DAY_MS = 24 * 60 * 60 * 1000;
const KM_SOON_RATIO = 0.1;
const DAYS_SOON_RATIO = 0.1;
const KM_REMINDER_INTERVAL_DAYS = 15;

export const VEHICLE_FUEL_OPTIONS = [
  "Gasolina",
  "Etanol",
  "Flex",
  "Diesel",
  "GNV",
  "Eletrico",
  "Hibrido",
  "Outro",
];

export const VEHICLE_MAINTENANCE_CATEGORIES = [
  "Motor",
  "Freios",
  "Pneus",
  "Transmissao",
  "Suspensao",
  "Eletrica",
  "Combustivel",
  "Arrefecimento",
  "Revisao Geral",
  "Outros",
];

export const VEHICLE_MAINTENANCE_TEMPLATES = [
  { name: "Oleo do motor", category: "Motor", intervalKm: 5000, intervalDays: 180 },
  { name: "Filtro de oleo", category: "Motor", intervalKm: 5000, intervalDays: 180 },
  { name: "Filtro de ar", category: "Motor", intervalKm: 10000, intervalDays: 365 },
  { name: "Vela", category: "Motor", intervalKm: 10000, intervalDays: 365 },
  { name: "Corrente", category: "Transmissao", intervalKm: 15000, intervalDays: null },
  { name: "Coroa e pinhao", category: "Transmissao", intervalKm: 15000, intervalDays: null },
  { name: "Pneus", category: "Pneus", intervalKm: 30000, intervalDays: null },
  { name: "Pastilhas de freio", category: "Freios", intervalKm: 10000, intervalDays: 365 },
  { name: "Fluido de freio", category: "Freios", intervalKm: 10000, intervalDays: 365 },
  { name: "Bateria", category: "Eletrica", intervalKm: null, intervalDays: 730 },
  { name: "Cabo de embreagem", category: "Transmissao", intervalKm: 15000, intervalDays: null },
  { name: "Limpeza de bico / TBI", category: "Combustivel", intervalKm: 10000, intervalDays: 365 },
  { name: "Rolamentos", category: "Suspensao", intervalKm: 20000, intervalDays: null },
  { name: "Amortecedores", category: "Suspensao", intervalKm: 30000, intervalDays: null },
];

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function startOfDay(value = new Date()) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function toDateInputValue(value) {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

export function addDays(value, days) {
  const dt = startOfDay(value);
  const n = asNumber(days);
  if (!dt || !Number.isFinite(n)) return null;
  dt.setDate(dt.getDate() + n);
  return dt;
}

export function diffInDays(from, to) {
  const a = startOfDay(from);
  const b = startOfDay(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

export function getNextMaintenanceKm(lastServiceKm, intervalKm) {
  const lastKm = asNumber(lastServiceKm);
  const kmInterval = asNumber(intervalKm);
  if (!Number.isFinite(lastKm) || !Number.isFinite(kmInterval) || kmInterval <= 0) return null;
  return lastKm + kmInterval;
}

export function getNextMaintenanceDate(lastServiceAt, intervalDays) {
  const days = asNumber(intervalDays);
  if (!lastServiceAt || !Number.isFinite(days) || days <= 0) return null;
  return addDays(lastServiceAt, days);
}

export function getKmRemaining(currentKm, nextKm) {
  const odometerKm = asNumber(currentKm);
  const predictedKm = asNumber(nextKm);
  if (!Number.isFinite(odometerKm) || !Number.isFinite(predictedKm)) return null;
  return predictedKm - odometerKm;
}

export function getDaysRemaining(nextDate, baseDate = new Date()) {
  if (!nextDate) return null;
  return diffInDays(baseDate, nextDate);
}

export function getMaintenanceStatus({
  currentKm,
  nextKm,
  intervalKm,
  nextDate,
  intervalDays,
  now = new Date(),
}) {
  const odometerKm = asNumber(currentKm);
  const predictedKm = asNumber(nextKm);
  const kmInterval = asNumber(intervalKm);
  const dueDate = nextDate ? startOfDay(nextDate) : null;
  const dueDays = asNumber(intervalDays);
  const today = startOfDay(now);

  let byKm = "em_dia";
  if (Number.isFinite(odometerKm) && Number.isFinite(predictedKm)) {
    const kmRemaining = predictedKm - odometerKm;
    if (odometerKm >= predictedKm) byKm = "atrasado";
    else if (Number.isFinite(kmInterval) && kmInterval > 0 && kmRemaining <= kmInterval * KM_SOON_RATIO) byKm = "proximo";
  }

  let byDate = "em_dia";
  if (dueDate && today) {
    const daysRemaining = diffInDays(today, dueDate);
    if (Number.isFinite(daysRemaining)) {
      if (daysRemaining <= 0) byDate = "atrasado";
      else if (Number.isFinite(dueDays) && dueDays > 0 && daysRemaining <= dueDays * DAYS_SOON_RATIO) byDate = "proximo";
    }
  }

  if (byKm === "atrasado" || byDate === "atrasado") return "atrasado";
  if (byKm === "proximo" || byDate === "proximo") return "proximo";
  return "em_dia";
}

export function getMaintenanceStatusLabel(status) {
  if (status === "atrasado") return "Atrasado";
  if (status === "proximo") return "Proximo da troca";
  return "Em dia";
}

export function getMaintenanceStatusTone(status) {
  if (status === "atrasado") return "rgb(244,63,94)";
  if (status === "proximo") return "rgb(245,158,11)";
  return "rgb(16,185,129)";
}

export function describeMaintenanceItem(item, vehicle, now = new Date()) {
  const currentKm = asNumber(vehicle?.odometer_km);
  const nextServiceKm = getNextMaintenanceKm(item?.last_service_km, item?.interval_km);
  const nextServiceAt = getNextMaintenanceDate(item?.last_service_at, item?.interval_days);
  const kmRemaining = getKmRemaining(currentKm, nextServiceKm);
  const daysRemaining = getDaysRemaining(nextServiceAt, now);
  const status = getMaintenanceStatus({
    currentKm,
    nextKm: nextServiceKm,
    intervalKm: item?.interval_km,
    nextDate: nextServiceAt,
    intervalDays: item?.interval_days,
    now,
  });

  return {
    ...item,
    next_service_km: nextServiceKm,
    next_service_at: nextServiceAt ? nextServiceAt.toISOString() : null,
    km_remaining: kmRemaining,
    days_remaining: daysRemaining,
    status,
    statusLabel: getMaintenanceStatusLabel(status),
    statusTone: getMaintenanceStatusTone(status),
  };
}

export function needsKmReminder(vehicle, now = new Date()) {
  const lastUpdate = vehicle?.last_km_update_at ? startOfDay(vehicle.last_km_update_at) : null;
  const today = startOfDay(now);
  if (!today) return false;
  if (!lastUpdate) return true;
  const daysElapsed = diffInDays(lastUpdate, today);
  return Number.isFinite(daysElapsed) ? daysElapsed >= KM_REMINDER_INTERVAL_DAYS : true;
}

export function getVehicleReminderLabel(vehicle, now = new Date()) {
  const lastUpdate = vehicle?.last_km_update_at ? startOfDay(vehicle.last_km_update_at) : null;
  if (!lastUpdate) return "KM ainda nao informado recentemente.";
  const daysElapsed = diffInDays(lastUpdate, startOfDay(now));
  return `Ultima atualizacao de KM ha ${Math.max(0, Number(daysElapsed || 0))} dia(s).`;
}

export function summarizeVehicleMaintenance(vehicle, items = [], now = new Date()) {
  const described = (items ?? []).map((item) => describeMaintenanceItem(item, vehicle, now));
  return {
    described,
    overdue: described.filter((item) => item.status === "atrasado").length,
    upcoming: described.filter((item) => item.status === "proximo").length,
    healthy: described.filter((item) => item.status === "em_dia").length,
  };
}
