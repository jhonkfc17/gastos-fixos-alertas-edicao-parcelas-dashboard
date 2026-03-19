import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { styles } from "./ui";
import {
  VEHICLE_FUEL_OPTIONS,
  VEHICLE_MAINTENANCE_CATEGORIES,
  VEHICLE_MAINTENANCE_TEMPLATES,
  describeMaintenanceItem,
  getMaintenanceStatusLabel,
  summarizeVehicleMaintenance,
  toDateInputValue,
} from "./vehicleMaintenance";

function asInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function formatKm(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString("pt-BR")} km`;
}

function formatDateLabel(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("pt-BR");
}

function emptyVehicleForm() {
  return {
    name: "",
    brand: "",
    model: "",
    year: "",
    plate: "",
    odometerKm: "",
    fuelType: "",
  };
}

function createItemForm(currentKm = "") {
  return {
    name: "",
    category: "Motor",
    lastServiceKm: currentKm ? String(currentKm) : "",
    lastServiceAt: toDateInputValue(new Date()),
    intervalKm: "",
    intervalDays: "",
    notes: "",
  };
}

function StatCard({ label, value, tone }) {
  return (
    <div style={{ ...styles.card, background: "var(--card2)" }}>
      <div style={{ ...styles.muted, fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: tone || "var(--text)" }}>{value}</div>
    </div>
  );
}

function InfoCard({ label, value, tone }) {
  return (
    <div style={{ ...styles.card, background: "rgba(255,255,255,.03)", padding: 10 }}>
      <div style={{ ...styles.muted, fontSize: 12 }}>{label}</div>
      <div style={{ marginTop: 4, fontWeight: 900, color: tone || "var(--text)" }}>{value}</div>
    </div>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 90,
        padding: 14,
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          background: "var(--modalSurface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "var(--shadow)",
          padding: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          <button style={styles.btnGhost} type="button" onClick={onClose}>Fechar</button>
        </div>
        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export default function VehiclesPanel({ userId, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [savingInlineKm, setSavingInlineKm] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [maintenanceItems, setMaintenanceItems] = useState([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [vehicleEditingId, setVehicleEditingId] = useState(null);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm());
  const [itemEditingId, setItemEditingId] = useState(null);
  const [itemForm, setItemForm] = useState(createItemForm());
  const [inlineKmValue, setInlineKmValue] = useState("");
  const [kmModal, setKmModal] = useState({ open: false, vehicleId: null, odometerKm: "", note: "" });
  const [serviceModal, setServiceModal] = useState({
    open: false,
    itemId: null,
    name: "",
    serviceKm: "",
    serviceAt: toDateInputValue(new Date()),
    note: "",
  });

  useEffect(() => {
    if (!userId) return;
    fetchAll().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || null,
    [vehicles, selectedVehicleId]
  );

  const itemsForSelectedVehicle = useMemo(() => {
    if (!selectedVehicle) return [];
    return maintenanceItems
      .filter((item) => item.vehicle_id === selectedVehicle.id)
      .map((item) => describeMaintenanceItem(item, selectedVehicle))
      .sort((a, b) => {
        const statusWeight = { atrasado: 0, proximo: 1, em_dia: 2 };
        return (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9) || String(a.name).localeCompare(String(b.name));
      });
  }, [maintenanceItems, selectedVehicle]);

  const logsForSelectedVehicle = useMemo(() => {
    if (!selectedVehicle) return [];
    return maintenanceLogs
      .filter((log) => log.vehicle_id === selectedVehicle.id)
      .sort((a, b) => new Date(b.service_at).getTime() - new Date(a.service_at).getTime())
      .slice(0, 10);
  }, [maintenanceLogs, selectedVehicle]);

  const fleetSummary = useMemo(() => {
    const byVehicle = vehicles.map((vehicle) => ({
      vehicle,
      ...summarizeVehicleMaintenance(
        vehicle,
        maintenanceItems.filter((item) => item.vehicle_id === vehicle.id)
      ),
    }));
    return {
      vehiclesCount: vehicles.length,
      overdue: byVehicle.reduce((acc, row) => acc + row.overdue, 0),
      upcoming: byVehicle.reduce((acc, row) => acc + row.upcoming, 0),
      healthy: byVehicle.reduce((acc, row) => acc + row.healthy, 0),
    };
  }, [vehicles, maintenanceItems]);

  useEffect(() => {
    if (!selectedVehicle && vehicles.length > 0) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [selectedVehicle, vehicles]);

  useEffect(() => {
    setInlineKmValue(selectedVehicle?.odometer_km != null ? String(selectedVehicle.odometer_km) : "");
  }, [selectedVehicle?.id, selectedVehicle?.odometer_km]);

  useEffect(() => {
    if (!itemEditingId) {
      setItemForm((prev) => ({
        ...prev,
        lastServiceKm: prev.lastServiceKm || (selectedVehicle?.odometer_km != null ? String(selectedVehicle.odometer_km) : ""),
      }));
    }
  }, [selectedVehicle, itemEditingId]);

  function resetVehicleForm() {
    setVehicleEditingId(null);
    setVehicleForm(emptyVehicleForm());
  }

  function resetItemForm() {
    setItemEditingId(null);
    setItemForm(createItemForm(selectedVehicle?.odometer_km || ""));
  }

  async function fetchAll() {
    setLoading(true);
    const [vehiclesRes, itemsRes, logsRes] = await Promise.all([
      supabase.from("vehicles").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("vehicle_maintenance_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("vehicle_maintenance_logs").select("*").eq("user_id", userId).order("service_at", { ascending: false }).limit(100),
    ]);
    setLoading(false);

    const error = vehiclesRes.error || itemsRes.error || logsRes.error;
    if (error) return alert(error.message);

    const nextVehicles = vehiclesRes.data ?? [];
    setVehicles(nextVehicles);
    setMaintenanceItems(itemsRes.data ?? []);
    setMaintenanceLogs(logsRes.data ?? []);

    if (!selectedVehicleId && nextVehicles[0]) setSelectedVehicleId(nextVehicles[0].id);
    if (selectedVehicleId && !nextVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(nextVehicles[0]?.id ?? null);
    }
  }

  function validateVehiclePayload(form, currentVehicle = null) {
    const name = String(form.name || "").trim();
    const brand = String(form.brand || "").trim();
    const model = String(form.model || "").trim();
    const year = asInteger(form.year);
    const odometerKm = asInteger(form.odometerKm);

    if (!name) return { error: "Informe o nome do veiculo." };
    if (!brand) return { error: "Informe a marca." };
    if (!model) return { error: "Informe o modelo." };
    if (!Number.isFinite(year) || year < 1900 || year > 2100) return { error: "Ano invalido." };
    if (!Number.isFinite(odometerKm) || odometerKm < 0) return { error: "KM atual invalido." };

    return {
      payload: {
        user_id: userId,
        name,
        brand,
        model,
        year,
        plate: String(form.plate || "").trim().toUpperCase() || null,
        odometer_km: odometerKm,
        fuel_type: String(form.fuelType || "").trim() || null,
        last_km_update_at: !currentVehicle
          ? new Date().toISOString()
          : odometerKm !== Number(currentVehicle.odometer_km || 0)
            ? new Date().toISOString()
            : currentVehicle.last_km_update_at,
      },
    };
  }

  function validateMaintenancePayload(form, vehicle) {
    const name = String(form.name || "").trim();
    const category = String(form.category || "Outros").trim() || "Outros";
    const lastServiceKm = asInteger(form.lastServiceKm);
    const intervalKm = asInteger(form.intervalKm);
    const intervalDays = form.intervalDays === "" ? null : asInteger(form.intervalDays);
    const lastServiceAt = form.lastServiceAt ? new Date(`${form.lastServiceAt}T12:00:00`) : null;

    if (!vehicle?.id) return { error: "Selecione um veiculo." };
    if (!name) return { error: "Informe o nome da peca/servico." };
    if (!Number.isFinite(lastServiceKm) || lastServiceKm < 0) return { error: "KM da ultima troca invalido." };
    if (lastServiceKm > Number(vehicle.odometer_km || 0)) {
      return { error: "O KM da ultima troca nao pode ser maior que o KM atual do veiculo." };
    }
    if (!lastServiceAt || Number.isNaN(lastServiceAt.getTime())) return { error: "Data da ultima troca invalida." };
    if (!Number.isFinite(intervalKm) || intervalKm <= 0) return { error: "Intervalo em KM invalido." };
    if (intervalDays !== null && (!Number.isFinite(intervalDays) || intervalDays <= 0)) {
      return { error: "Intervalo em dias invalido." };
    }

    const nextServiceKm = lastServiceKm + intervalKm;
    const nextServiceAt = intervalDays ? new Date(lastServiceAt.getTime()) : null;
    if (nextServiceAt) nextServiceAt.setDate(nextServiceAt.getDate() + intervalDays);

    return {
      payload: {
        user_id: userId,
        vehicle_id: vehicle.id,
        name,
        category,
        last_service_km: lastServiceKm,
        last_service_at: lastServiceAt.toISOString(),
        interval_km: intervalKm,
        interval_days: intervalDays,
        next_service_km: nextServiceKm,
        next_service_at: nextServiceAt ? nextServiceAt.toISOString() : null,
        notes: String(form.notes || "").trim() || null,
      },
    };
  }

  async function saveVehicle(e) {
    e?.preventDefault?.();
    if (!userId) return;

    const currentVehicle = vehicles.find((vehicle) => vehicle.id === vehicleEditingId) || null;
    const nextOdometerKm = asInteger(vehicleForm.odometerKm);
    const { payload, error } = validateVehiclePayload(vehicleForm, currentVehicle);
    if (error) return alert(error);

    setSavingVehicle(true);
    let query = supabase.from("vehicles");
    if (vehicleEditingId) query = query.update(payload).eq("id", vehicleEditingId).eq("user_id", userId);
    else query = query.insert(payload);
    const { error: saveError } = await query;
    setSavingVehicle(false);

    if (saveError) return alert(saveError.message);
    if (currentVehicle && Number.isFinite(nextOdometerKm) && nextOdometerKm !== Number(currentVehicle.odometer_km || 0)) {
      const { error: kmHistoryError } = await supabase.from("vehicle_km_updates").insert({
        user_id: userId,
        vehicle_id: currentVehicle.id,
        previous_km: Number(currentVehicle.odometer_km || 0),
        new_km: nextOdometerKm,
        note: "Atualizacao via edicao do veiculo",
        recorded_at: new Date().toISOString(),
      });
      if (kmHistoryError) return alert(kmHistoryError.message);
    }
    await fetchAll();
    resetVehicleForm();
    onChanged?.();
  }

  function startEditVehicle(vehicle) {
    setSelectedVehicleId(vehicle.id);
    setVehicleEditingId(vehicle.id);
    setVehicleForm({
      name: vehicle.name || "",
      brand: vehicle.brand || "",
      model: vehicle.model || "",
      year: String(vehicle.year || ""),
      plate: vehicle.plate || "",
      odometerKm: String(vehicle.odometer_km || ""),
      fuelType: vehicle.fuel_type || "",
    });
  }

  async function removeVehicle(vehicleId) {
    if (!confirm("Remover este veiculo e todo o historico de manutencoes?")) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", vehicleId).eq("user_id", userId);
    if (error) return alert(error.message);
    await fetchAll();
    if (selectedVehicleId === vehicleId) setSelectedVehicleId(null);
    if (vehicleEditingId === vehicleId) resetVehicleForm();
    onChanged?.();
  }

  async function saveMaintenanceItem(e) {
    e?.preventDefault?.();
    const { payload, error } = validateMaintenancePayload(itemForm, selectedVehicle);
    if (error) return alert(error);

    setSavingItem(true);
    let query = supabase.from("vehicle_maintenance_items");
    if (itemEditingId) query = query.update(payload).eq("id", itemEditingId).eq("user_id", userId);
    else query = query.insert(payload);
    const { error: saveError } = await query;
    setSavingItem(false);

    if (saveError) return alert(saveError.message);
    await fetchAll();
    resetItemForm();
    onChanged?.();
  }

  function startEditItem(item) {
    setItemEditingId(item.id);
    setItemForm({
      name: item.name || "",
      category: item.category || "Outros",
      lastServiceKm: String(item.last_service_km || ""),
      lastServiceAt: toDateInputValue(item.last_service_at),
      intervalKm: String(item.interval_km || ""),
      intervalDays: item.interval_days == null ? "" : String(item.interval_days),
      notes: item.notes || "",
    });
  }

  async function removeMaintenanceItem(itemId) {
    if (!confirm("Remover este item de manutencao?")) return;
    const { error } = await supabase.from("vehicle_maintenance_items").delete().eq("id", itemId).eq("user_id", userId);
    if (error) return alert(error.message);
    await fetchAll();
    if (itemEditingId === itemId) resetItemForm();
    onChanged?.();
  }

  function openKmUpdate(vehicle) {
    setKmModal({
      open: true,
      vehicleId: vehicle.id,
      odometerKm: String(vehicle.odometer_km || ""),
      note: "",
    });
  }

  async function saveKmUpdate() {
    const vehicle = vehicles.find((entry) => entry.id === kmModal.vehicleId);
    const nextKm = asInteger(kmModal.odometerKm);
    if (!vehicle) return;
    if (!Number.isFinite(nextKm) || nextKm < 0) return alert("KM informado invalido.");
    if (nextKm < Number(vehicle.odometer_km || 0)) {
      return alert("O novo KM nao pode ser menor que o KM atual salvo.");
    }

    const recordedAt = new Date().toISOString();
    const { error: historyError } = await supabase.from("vehicle_km_updates").insert({
      user_id: userId,
      vehicle_id: vehicle.id,
      previous_km: Number(vehicle.odometer_km || 0),
      new_km: nextKm,
      note: String(kmModal.note || "").trim() || null,
      recorded_at: recordedAt,
    });
    if (historyError) return alert(historyError.message);

    const { error: vehicleError } = await supabase
      .from("vehicles")
      .update({ odometer_km: nextKm, last_km_update_at: recordedAt })
      .eq("id", vehicle.id)
      .eq("user_id", userId);

    if (vehicleError) return alert(vehicleError.message);
    setKmModal({ open: false, vehicleId: null, odometerKm: "", note: "" });
    await fetchAll();
    onChanged?.();
  }

  async function saveInlineKmUpdate() {
    if (!selectedVehicle) return;
    const nextKm = asInteger(inlineKmValue);
    if (!Number.isFinite(nextKm) || nextKm < 0) return alert("KM informado invalido.");
    if (nextKm === Number(selectedVehicle.odometer_km || 0)) return;
    if (nextKm < Number(selectedVehicle.odometer_km || 0)) {
      return alert("O novo KM nao pode ser menor que o KM atual salvo.");
    }

    const recordedAt = new Date().toISOString();
    setSavingInlineKm(true);
    const { error: historyError } = await supabase.from("vehicle_km_updates").insert({
      user_id: userId,
      vehicle_id: selectedVehicle.id,
      previous_km: Number(selectedVehicle.odometer_km || 0),
      new_km: nextKm,
      note: "Atualizacao rapida de KM",
      recorded_at: recordedAt,
    });
    if (historyError) {
      setSavingInlineKm(false);
      return alert(historyError.message);
    }

    const { error: vehicleError } = await supabase
      .from("vehicles")
      .update({ odometer_km: nextKm, last_km_update_at: recordedAt })
      .eq("id", selectedVehicle.id)
      .eq("user_id", userId);

    setSavingInlineKm(false);
    if (vehicleError) return alert(vehicleError.message);
    await fetchAll();
    onChanged?.();
  }

  function openRegisterService(item) {
    setServiceModal({
      open: true,
      itemId: item.id,
      name: item.name,
      serviceKm: String(selectedVehicle?.odometer_km || item.last_service_km || ""),
      serviceAt: toDateInputValue(new Date()),
      note: "",
    });
  }

  async function saveServiceRegistration() {
    const item = maintenanceItems.find((entry) => entry.id === serviceModal.itemId);
    const vehicle = vehicles.find((entry) => entry.id === item?.vehicle_id);
    const serviceKm = asInteger(serviceModal.serviceKm);
    const serviceAt = serviceModal.serviceAt ? new Date(`${serviceModal.serviceAt}T12:00:00`) : null;
    if (!item || !vehicle) return;
    if (!Number.isFinite(serviceKm) || serviceKm < 0) return alert("KM da troca invalido.");
    if (serviceKm > Number(vehicle.odometer_km || 0)) {
      return alert("O KM da troca nao pode ser maior que o KM atual do veiculo.");
    }
    if (!serviceAt || Number.isNaN(serviceAt.getTime())) return alert("Data da troca invalida.");

    const nextServiceKm = Number(item.interval_km || 0) > 0 ? serviceKm + Number(item.interval_km) : null;
    const nextServiceAt = Number(item.interval_days || 0) > 0
      ? new Date(serviceAt.getTime() + Number(item.interval_days) * 24 * 60 * 60 * 1000)
      : null;

    const { error: logError } = await supabase.from("vehicle_maintenance_logs").insert({
      user_id: userId,
      vehicle_id: vehicle.id,
      maintenance_item_id: item.id,
      name: item.name,
      service_km: serviceKm,
      service_at: serviceAt.toISOString(),
      note: String(serviceModal.note || "").trim() || null,
    });
    if (logError) return alert(logError.message);

    const { error: updateError } = await supabase
      .from("vehicle_maintenance_items")
      .update({
        last_service_km: serviceKm,
        last_service_at: serviceAt.toISOString(),
        next_service_km: nextServiceKm,
        next_service_at: nextServiceAt ? nextServiceAt.toISOString() : null,
      })
      .eq("id", item.id)
      .eq("user_id", userId);

    if (updateError) return alert(updateError.message);
    setServiceModal({ open: false, itemId: null, name: "", serviceKm: "", serviceAt: toDateInputValue(new Date()), note: "" });
    await fetchAll();
    onChanged?.();
  }

  async function addTemplateItems() {
    if (!selectedVehicle) return;
    const existingNames = new Set(
      maintenanceItems
        .filter((item) => item.vehicle_id === selectedVehicle.id)
        .map((item) => String(item.name || "").trim().toLowerCase())
    );
    const lastServiceAt = new Date().toISOString();
    const payload = VEHICLE_MAINTENANCE_TEMPLATES
      .filter((template) => !existingNames.has(template.name.toLowerCase()))
      .map((template) => ({
        user_id: userId,
        vehicle_id: selectedVehicle.id,
        name: template.name,
        category: template.category,
        last_service_km: Number(selectedVehicle.odometer_km || 0),
        last_service_at: lastServiceAt,
        interval_km: template.intervalKm,
        interval_days: template.intervalDays,
        next_service_km: template.intervalKm ? Number(selectedVehicle.odometer_km || 0) + template.intervalKm : null,
        next_service_at: template.intervalDays
          ? new Date(Date.now() + template.intervalDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
        notes: null,
      }));

    if (payload.length === 0) return alert("Os itens comuns ja foram adicionados para este veiculo.");
    const { error } = await supabase.from("vehicle_maintenance_items").insert(payload);
    if (error) return alert(error.message);
    await fetchAll();
    onChanged?.();
  }

  return (
    <div style={{ ...styles.card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: 16 }}>Meus Veiculos</div>
          <div style={{ ...styles.muted, fontSize: 13 }}>
            Cadastre seus veiculos, atualize o KM e acompanhe manutencoes periodicas.
          </div>
        </div>
        <button style={styles.btnGhost} type="button" onClick={() => fetchAll()} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      <div style={{ ...styles.gridAuto, marginTop: 12 }}>
        <StatCard label="Veiculos" value={fleetSummary.vehiclesCount} />
        <StatCard label="Itens atrasados" value={fleetSummary.overdue} tone="rgb(244,63,94)" />
        <StatCard label="Proximos da troca" value={fleetSummary.upcoming} tone="rgb(245,158,11)" />
        <StatCard label="Itens em dia" value={fleetSummary.healthy} tone="rgb(16,185,129)" />
      </div>

      <div className="vehiclesPanelLayout" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 360px) minmax(0, 1fr)", gap: 14, marginTop: 14 }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...styles.card, background: "var(--card2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>{vehicleEditingId ? "Editar veiculo" : "Cadastrar veiculo"}</div>
              {vehicleEditingId ? (
                <button style={styles.btnGhost} type="button" onClick={resetVehicleForm}>Cancelar edicao</button>
              ) : null}
            </div>
            <form onSubmit={saveVehicle} style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <input style={styles.input} placeholder="Nome do veiculo" value={vehicleForm.name} onChange={(e) => setVehicleForm((p) => ({ ...p, name: e.target.value }))} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input style={styles.input} placeholder="Marca" value={vehicleForm.brand} onChange={(e) => setVehicleForm((p) => ({ ...p, brand: e.target.value }))} />
                <input style={styles.input} placeholder="Modelo" value={vehicleForm.model} onChange={(e) => setVehicleForm((p) => ({ ...p, model: e.target.value }))} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input style={styles.input} placeholder="Ano" value={vehicleForm.year} onChange={(e) => setVehicleForm((p) => ({ ...p, year: e.target.value }))} />
                <input style={styles.input} placeholder="Placa (opcional)" value={vehicleForm.plate} onChange={(e) => setVehicleForm((p) => ({ ...p, plate: e.target.value }))} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input style={styles.input} placeholder="KM atual" value={vehicleForm.odometerKm} onChange={(e) => setVehicleForm((p) => ({ ...p, odometerKm: e.target.value }))} />
                <select style={styles.input} value={vehicleForm.fuelType} onChange={(e) => setVehicleForm((p) => ({ ...p, fuelType: e.target.value }))}>
                  <option value="">Combustivel (opcional)</option>
                  {VEHICLE_FUEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <button style={styles.btn} type="submit" disabled={savingVehicle}>
                {savingVehicle ? "Salvando..." : vehicleEditingId ? "Salvar veiculo" : "Adicionar veiculo"}
              </button>
            </form>
          </div>

          <div style={{ ...styles.card, background: "var(--card2)" }}>
            <div style={{ fontWeight: 800 }}>Veiculos cadastrados</div>
            {vehicles.length === 0 ? (
              <div style={{ ...styles.muted, fontSize: 13, marginTop: 10 }}>Nenhum veiculo cadastrado ainda.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {vehicles.map((vehicle) => {
                  const summary = summarizeVehicleMaintenance(
                    vehicle,
                    maintenanceItems.filter((item) => item.vehicle_id === vehicle.id)
                  );
                  const active = vehicle.id === selectedVehicleId;
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => {
                        setSelectedVehicleId(vehicle.id);
                        resetItemForm();
                      }}
                      style={{
                        ...styles.btnGhost,
                        textAlign: "left",
                        borderColor: active ? "rgba(124,58,237,.45)" : "var(--border)",
                        background: active ? "rgba(124,58,237,.14)" : "var(--card)",
                      }}
                    >
                      <div style={{ fontWeight: 900 }}>{vehicle.name}</div>
                      <div style={{ ...styles.muted, fontSize: 12, marginTop: 2 }}>
                        {vehicle.brand} {vehicle.model} {vehicle.year ? `- ${vehicle.year}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                        <span style={styles.badge}>{formatKm(vehicle.odometer_km)}</span>
                        <span style={{ ...styles.badge, color: "rgb(244,63,94)" }}>Atrasados: {summary.overdue}</span>
                        <span style={{ ...styles.badge, color: "rgb(245,158,11)" }}>Proximos: {summary.upcoming}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {!selectedVehicle ? (
            <div style={{ ...styles.card, background: "var(--card2)" }}>
              <div style={{ fontWeight: 800 }}>Selecione um veiculo</div>
              <div style={{ ...styles.muted, fontSize: 13, marginTop: 6 }}>
                Escolha um veiculo na lista para visualizar manutencoes, atualizar KM e registrar trocas.
              </div>
            </div>
          ) : (
            <>
              <div style={{ ...styles.card, background: "var(--card2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start" }}>
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 18 }}>{selectedVehicle.name}</div>
                    <div style={{ ...styles.muted, fontSize: 13, marginTop: 2 }}>
                      {selectedVehicle.brand} {selectedVehicle.model} - {selectedVehicle.year}
                      {selectedVehicle.plate ? ` - ${selectedVehicle.plate}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button style={styles.btn} type="button" onClick={() => openKmUpdate(selectedVehicle)}>Atualizar KM</button>
                    <button style={styles.btnGhost} type="button" onClick={() => startEditVehicle(selectedVehicle)}>Editar</button>
                    <button style={styles.btnGhost} type="button" onClick={() => removeVehicle(selectedVehicle.id)}>Remover</button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 12 }}>
                  <div style={{ ...styles.card, background: "rgba(255,255,255,.03)", padding: 10 }}>
                    <div style={{ ...styles.muted, fontSize: 12 }}>KM atual</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 6, alignItems: "center" }}>
                      <input
                        style={styles.input}
                        value={inlineKmValue}
                        onChange={(e) => setInlineKmValue(e.target.value)}
                        placeholder="KM atual"
                      />
                      <button
                        style={styles.btn}
                        type="button"
                        onClick={saveInlineKmUpdate}
                        disabled={savingInlineKm || inlineKmValue === String(selectedVehicle.odometer_km || "")}
                      >
                        {savingInlineKm ? "Salvando..." : "Salvar KM"}
                      </button>
                    </div>
                    <div style={{ ...styles.muted, fontSize: 12, marginTop: 6 }}>
                      Atual: {formatKm(selectedVehicle.odometer_km)}
                    </div>
                  </div>
                  <InfoCard label="Combustivel" value={selectedVehicle.fuel_type || "-"} />
                  <InfoCard label="Ultima atualizacao de KM" value={formatDateLabel(selectedVehicle.last_km_update_at)} />
                  <InfoCard label="Itens de manutencao" value={itemsForSelectedVehicle.length} />
                </div>
              </div>

              <div style={{ ...styles.gridAuto, marginTop: 0 }}>
                <StatCard label="Atrasados" value={itemsForSelectedVehicle.filter((item) => item.status === "atrasado").length} tone="rgb(244,63,94)" />
                <StatCard label="Proximos da troca" value={itemsForSelectedVehicle.filter((item) => item.status === "proximo").length} tone="rgb(245,158,11)" />
                <StatCard label="Em dia" value={itemsForSelectedVehicle.filter((item) => item.status === "em_dia").length} tone="rgb(16,185,129)" />
              </div>

              <div style={{ ...styles.card, background: "var(--card2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800 }}>{itemEditingId ? "Editar manutencao" : "Nova manutencao"}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button style={styles.btnGhost} type="button" onClick={addTemplateItems}>Adicionar itens comuns</button>
                    {itemEditingId ? (
                      <button style={styles.btnGhost} type="button" onClick={resetItemForm}>Cancelar edicao</button>
                    ) : null}
                  </div>
                </div>
                <form onSubmit={saveMaintenanceItem} style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.3fr) minmax(180px, 1fr)", gap: 10 }}>
                    <input style={styles.input} placeholder="Peca ou servico" value={itemForm.name} onChange={(e) => setItemForm((p) => ({ ...p, name: e.target.value }))} />
                    <select style={styles.input} value={itemForm.category} onChange={(e) => setItemForm((p) => ({ ...p, category: e.target.value }))}>
                      {VEHICLE_MAINTENANCE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                    <input style={styles.input} placeholder="KM ultima troca" value={itemForm.lastServiceKm} onChange={(e) => setItemForm((p) => ({ ...p, lastServiceKm: e.target.value }))} />
                    <input style={styles.input} type="date" value={itemForm.lastServiceAt} onChange={(e) => setItemForm((p) => ({ ...p, lastServiceAt: e.target.value }))} />
                    <input style={styles.input} placeholder="Intervalo em KM" value={itemForm.intervalKm} onChange={(e) => setItemForm((p) => ({ ...p, intervalKm: e.target.value }))} />
                    <input style={styles.input} placeholder="Intervalo em dias (opcional)" value={itemForm.intervalDays} onChange={(e) => setItemForm((p) => ({ ...p, intervalDays: e.target.value }))} />
                  </div>
                  <textarea
                    style={{ ...styles.input, minHeight: 92, resize: "vertical" }}
                    placeholder="Observacoes"
                    value={itemForm.notes}
                    onChange={(e) => setItemForm((p) => ({ ...p, notes: e.target.value }))}
                  />
                  <button style={styles.btn} type="submit" disabled={savingItem}>
                    {savingItem ? "Salvando..." : itemEditingId ? "Salvar manutencao" : "Adicionar manutencao"}
                  </button>
                </form>
              </div>

              <div style={{ marginTop: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
                  Itens de manutencao
                </div>
                {itemsForSelectedVehicle.length === 0 ? (
                  <div style={{ padding: 12, ...styles.muted }}>Nenhuma manutencao cadastrada para este veiculo.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10, padding: 12 }}>
                    {itemsForSelectedVehicle.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          ...styles.card,
                          background: "var(--card2)",
                          borderColor: `${item.statusTone}55`,
                          boxShadow: `inset 4px 0 0 ${item.statusTone}`,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "start" }}>
                          <div>
                            <div style={{ fontWeight: 900 }}>{item.name}</div>
                            <div style={{ ...styles.muted, fontSize: 12, marginTop: 2 }}>{item.category}</div>
                          </div>
                          <span style={{ ...styles.badge, color: item.statusTone }}>
                            {getMaintenanceStatusLabel(item.status)}
                          </span>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 10 }}>
                          <InfoCard label="Ultima troca" value={`${formatKm(item.last_service_km)} - ${formatDateLabel(item.last_service_at)}`} />
                          <InfoCard label="Proxima troca em KM" value={item.next_service_km ? formatKm(item.next_service_km) : "-"} />
                          <InfoCard
                            label="KM restante"
                            value={item.km_remaining == null ? "-" : `${Number(item.km_remaining).toLocaleString("pt-BR")} km`}
                            tone={item.km_remaining != null && item.km_remaining < 0 ? "rgb(244,63,94)" : undefined}
                          />
                          <InfoCard label="Proxima data" value={formatDateLabel(item.next_service_at)} />
                        </div>

                        {item.notes ? (
                          <div style={{ ...styles.muted, fontSize: 12, marginTop: 10 }}>{item.notes}</div>
                        ) : null}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                          <button style={styles.btn} type="button" onClick={() => openRegisterService(item)}>Registrar troca</button>
                          <button style={styles.btnGhost} type="button" onClick={() => startEditItem(item)}>Editar</button>
                          <button style={styles.btnGhost} type="button" onClick={() => removeMaintenanceItem(item.id)}>Remover</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: 12, background: "var(--card2)", borderBottom: "1px solid var(--border)", fontWeight: 800 }}>
                  Ultimos registros de troca
                </div>
                {logsForSelectedVehicle.length === 0 ? (
                  <div style={{ padding: 12, ...styles.muted }}>Nenhum registro de troca ainda.</div>
                ) : (
                  logsForSelectedVehicle.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 10,
                        padding: 12,
                        borderTop: "1px solid var(--border)",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 800 }}>{log.name}</div>
                        <div style={{ ...styles.muted, fontSize: 12 }}>
                          {formatKm(log.service_km)} - {formatDateLabel(log.service_at)}
                        </div>
                        {log.note ? <div style={{ ...styles.muted, fontSize: 12 }}>{log.note}</div> : null}
                      </div>
                      <span style={styles.badge}>{new Date(log.created_at).toLocaleDateString("pt-BR")}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {kmModal.open ? (
        <ModalShell title="Atualizar KM atual" onClose={() => setKmModal({ open: false, vehicleId: null, odometerKm: "", note: "" })}>
          <div style={{ display: "grid", gap: 10 }}>
            <input
              style={styles.input}
              placeholder="KM atual"
              value={kmModal.odometerKm}
              onChange={(e) => setKmModal((p) => ({ ...p, odometerKm: e.target.value }))}
            />
            <textarea
              style={{ ...styles.input, minHeight: 88, resize: "vertical" }}
              placeholder="Observacoes (opcional)"
              value={kmModal.note}
              onChange={(e) => setKmModal((p) => ({ ...p, note: e.target.value }))}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button style={styles.btnGhost} type="button" onClick={() => setKmModal({ open: false, vehicleId: null, odometerKm: "", note: "" })}>
              Cancelar
            </button>
            <button style={styles.btn} type="button" onClick={saveKmUpdate}>
              Salvar KM
            </button>
          </div>
        </ModalShell>
      ) : null}

      {serviceModal.open ? (
        <ModalShell title={`Registrar troca - ${serviceModal.name}`} onClose={() => setServiceModal({ open: false, itemId: null, name: "", serviceKm: "", serviceAt: toDateInputValue(new Date()), note: "" })}>
          <div style={{ display: "grid", gap: 10 }}>
            <input
              style={styles.input}
              placeholder="KM da troca"
              value={serviceModal.serviceKm}
              onChange={(e) => setServiceModal((p) => ({ ...p, serviceKm: e.target.value }))}
            />
            <input
              style={styles.input}
              type="date"
              value={serviceModal.serviceAt}
              onChange={(e) => setServiceModal((p) => ({ ...p, serviceAt: e.target.value }))}
            />
            <textarea
              style={{ ...styles.input, minHeight: 88, resize: "vertical" }}
              placeholder="Observacoes da troca"
              value={serviceModal.note}
              onChange={(e) => setServiceModal((p) => ({ ...p, note: e.target.value }))}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button
              style={styles.btnGhost}
              type="button"
              onClick={() => setServiceModal({ open: false, itemId: null, name: "", serviceKm: "", serviceAt: toDateInputValue(new Date()), note: "" })}
            >
              Cancelar
            </button>
            <button style={styles.btn} type="button" onClick={saveServiceRegistration}>
              Registrar
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
