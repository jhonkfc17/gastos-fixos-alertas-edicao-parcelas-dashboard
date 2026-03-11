-- =========================
-- FIXED EXPENSES (gastos fixos)
-- =========================

create table if not exists public.fixed_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  name text not null,
  category text not null default 'Contas',
  amount numeric(12,2) not null check (amount >= 0),
  due_day int not null check (due_day between 1 and 31),
  payment_method text,
  active boolean not null default true,

  is_installment boolean not null default false,
  installment_total_amount numeric(12,2),
  installment_total int,
  installment_start_year int,
  installment_start_month int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fixed_expenses add column if not exists is_installment boolean not null default false;
alter table public.fixed_expenses add column if not exists installment_total_amount numeric(12,2);
alter table public.fixed_expenses add column if not exists installment_total int;
alter table public.fixed_expenses add column if not exists installment_start_year int;
alter table public.fixed_expenses add column if not exists installment_start_month int;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_fixed_expenses_updated_at on public.fixed_expenses;
create trigger trg_fixed_expenses_updated_at
before update on public.fixed_expenses
for each row execute function public.set_updated_at();

create index if not exists idx_fixed_expenses_user on public.fixed_expenses(user_id);
create index if not exists idx_fixed_expenses_user_active on public.fixed_expenses(user_id, active);

alter table public.fixed_expenses enable row level security;

drop policy if exists "fixed_expenses_select_own" on public.fixed_expenses;
create policy "fixed_expenses_select_own"
on public.fixed_expenses for select
using (auth.uid() = user_id);

drop policy if exists "fixed_expenses_insert_own" on public.fixed_expenses;
create policy "fixed_expenses_insert_own"
on public.fixed_expenses for insert
with check (auth.uid() = user_id);

drop policy if exists "fixed_expenses_update_own" on public.fixed_expenses;
create policy "fixed_expenses_update_own"
on public.fixed_expenses for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "fixed_expenses_delete_own" on public.fixed_expenses;
create policy "fixed_expenses_delete_own"
on public.fixed_expenses for delete
using (auth.uid() = user_id);

-- =========================
-- MONTHLY STATUS (pago por mes)
-- =========================

create table if not exists public.monthly_expense_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_id uuid not null references public.fixed_expenses(id) on delete cascade,
  year int not null,
  month int not null,
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_monthly_expense_status_updated_at on public.monthly_expense_status;
create trigger trg_monthly_expense_status_updated_at
before update on public.monthly_expense_status
for each row execute function public.set_updated_at();

create unique index if not exists uq_monthly_status
  on public.monthly_expense_status(user_id, expense_id, year, month);

create index if not exists idx_monthly_status_user_ym
  on public.monthly_expense_status(user_id, year, month);

alter table public.monthly_expense_status enable row level security;

drop policy if exists "monthly_select_own" on public.monthly_expense_status;
create policy "monthly_select_own"
on public.monthly_expense_status for select
using (auth.uid() = user_id);

drop policy if exists "monthly_insert_own" on public.monthly_expense_status;
create policy "monthly_insert_own"
on public.monthly_expense_status for insert
with check (auth.uid() = user_id);

drop policy if exists "monthly_update_own" on public.monthly_expense_status;
create policy "monthly_update_own"
on public.monthly_expense_status for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "monthly_delete_own" on public.monthly_expense_status;
create policy "monthly_delete_own"
on public.monthly_expense_status for delete
using (auth.uid() = user_id);

-- =========================
-- CRYPTO ORDERS (investimentos)
-- =========================

create table if not exists public.crypto_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(18,8) not null check (quantity > 0),
  execution_price numeric(18,8) not null check (execution_price > 0),
  fee numeric(18,8) not null default 0 check (fee >= 0),
  fee_currency text not null default 'USD',
  order_value numeric(18,8) not null check (order_value >= 0),
  bank_balance numeric(18,2) not null,
  note text,
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crypto_orders add column if not exists fee numeric(18,8) not null default 0;
alter table public.crypto_orders add column if not exists fee_currency text not null default 'USD';

create index if not exists idx_crypto_orders_user on public.crypto_orders(user_id);
create index if not exists idx_crypto_orders_user_executed_at on public.crypto_orders(user_id, executed_at desc);

drop trigger if exists trg_crypto_orders_updated_at on public.crypto_orders;
create trigger trg_crypto_orders_updated_at
before update on public.crypto_orders
for each row execute function public.set_updated_at();

alter table public.crypto_orders enable row level security;

drop policy if exists "crypto_orders_select_own" on public.crypto_orders;
create policy "crypto_orders_select_own"
on public.crypto_orders for select
using (auth.uid() = user_id);

drop policy if exists "crypto_orders_insert_own" on public.crypto_orders;
create policy "crypto_orders_insert_own"
on public.crypto_orders for insert
with check (auth.uid() = user_id);

drop policy if exists "crypto_orders_update_own" on public.crypto_orders;
create policy "crypto_orders_update_own"
on public.crypto_orders for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "crypto_orders_delete_own" on public.crypto_orders;
create policy "crypto_orders_delete_own"
on public.crypto_orders for delete
using (auth.uid() = user_id);

-- =========================
-- BANK BALANCE ENTRIES (saldo da banca)
-- =========================

create table if not exists public.bank_balance_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(18,2) not null check (amount >= 0),
  entry_type text not null check (entry_type in ('deposit', 'withdraw', 'adjustment')),
  note text,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bank_balance_entries_user on public.bank_balance_entries(user_id);
create index if not exists idx_bank_balance_entries_user_recorded_at on public.bank_balance_entries(user_id, recorded_at desc);

drop trigger if exists trg_bank_balance_entries_updated_at on public.bank_balance_entries;
create trigger trg_bank_balance_entries_updated_at
before update on public.bank_balance_entries
for each row execute function public.set_updated_at();

alter table public.bank_balance_entries enable row level security;

drop policy if exists "bank_balance_entries_select_own" on public.bank_balance_entries;
create policy "bank_balance_entries_select_own"
on public.bank_balance_entries for select
using (auth.uid() = user_id);

drop policy if exists "bank_balance_entries_insert_own" on public.bank_balance_entries;
create policy "bank_balance_entries_insert_own"
on public.bank_balance_entries for insert
with check (auth.uid() = user_id);

drop policy if exists "bank_balance_entries_update_own" on public.bank_balance_entries;
create policy "bank_balance_entries_update_own"
on public.bank_balance_entries for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "bank_balance_entries_delete_own" on public.bank_balance_entries;
create policy "bank_balance_entries_delete_own"
on public.bank_balance_entries for delete
using (auth.uid() = user_id);

-- =========================
-- VEHICLES
-- =========================

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text not null,
  model text not null,
  year int not null check (year between 1900 and 2100),
  plate text,
  odometer_km int not null default 0 check (odometer_km >= 0),
  fuel_type text,
  last_km_update_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicles_user on public.vehicles(user_id);
create index if not exists idx_vehicles_user_updated on public.vehicles(user_id, updated_at desc);

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

alter table public.vehicles enable row level security;

drop policy if exists "vehicles_select_own" on public.vehicles;
create policy "vehicles_select_own"
on public.vehicles for select
using (auth.uid() = user_id);

drop policy if exists "vehicles_insert_own" on public.vehicles;
create policy "vehicles_insert_own"
on public.vehicles for insert
with check (auth.uid() = user_id);

drop policy if exists "vehicles_update_own" on public.vehicles;
create policy "vehicles_update_own"
on public.vehicles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "vehicles_delete_own" on public.vehicles;
create policy "vehicles_delete_own"
on public.vehicles for delete
using (auth.uid() = user_id);

-- =========================
-- VEHICLE MAINTENANCE ITEMS
-- =========================

create table if not exists public.vehicle_maintenance_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  name text not null,
  category text not null default 'Outros',
  last_service_km int not null check (last_service_km >= 0),
  last_service_at timestamptz not null,
  interval_km int not null check (interval_km > 0),
  interval_days int check (interval_days > 0),
  next_service_km int,
  next_service_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_maintenance_items_user on public.vehicle_maintenance_items(user_id);
create index if not exists idx_vehicle_maintenance_items_vehicle on public.vehicle_maintenance_items(vehicle_id);

drop trigger if exists trg_vehicle_maintenance_items_updated_at on public.vehicle_maintenance_items;
create trigger trg_vehicle_maintenance_items_updated_at
before update on public.vehicle_maintenance_items
for each row execute function public.set_updated_at();

alter table public.vehicle_maintenance_items enable row level security;

drop policy if exists "vehicle_maintenance_items_select_own" on public.vehicle_maintenance_items;
create policy "vehicle_maintenance_items_select_own"
on public.vehicle_maintenance_items for select
using (auth.uid() = user_id);

drop policy if exists "vehicle_maintenance_items_insert_own" on public.vehicle_maintenance_items;
create policy "vehicle_maintenance_items_insert_own"
on public.vehicle_maintenance_items for insert
with check (auth.uid() = user_id);

drop policy if exists "vehicle_maintenance_items_update_own" on public.vehicle_maintenance_items;
create policy "vehicle_maintenance_items_update_own"
on public.vehicle_maintenance_items for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "vehicle_maintenance_items_delete_own" on public.vehicle_maintenance_items;
create policy "vehicle_maintenance_items_delete_own"
on public.vehicle_maintenance_items for delete
using (auth.uid() = user_id);

-- =========================
-- VEHICLE KM UPDATES
-- =========================

create table if not exists public.vehicle_km_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  previous_km int check (previous_km >= 0),
  new_km int not null check (new_km >= 0),
  note text,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_km_updates_user on public.vehicle_km_updates(user_id);
create index if not exists idx_vehicle_km_updates_vehicle on public.vehicle_km_updates(vehicle_id, recorded_at desc);

drop trigger if exists trg_vehicle_km_updates_updated_at on public.vehicle_km_updates;
create trigger trg_vehicle_km_updates_updated_at
before update on public.vehicle_km_updates
for each row execute function public.set_updated_at();

alter table public.vehicle_km_updates enable row level security;

drop policy if exists "vehicle_km_updates_select_own" on public.vehicle_km_updates;
create policy "vehicle_km_updates_select_own"
on public.vehicle_km_updates for select
using (auth.uid() = user_id);

drop policy if exists "vehicle_km_updates_insert_own" on public.vehicle_km_updates;
create policy "vehicle_km_updates_insert_own"
on public.vehicle_km_updates for insert
with check (auth.uid() = user_id);

drop policy if exists "vehicle_km_updates_update_own" on public.vehicle_km_updates;
create policy "vehicle_km_updates_update_own"
on public.vehicle_km_updates for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "vehicle_km_updates_delete_own" on public.vehicle_km_updates;
create policy "vehicle_km_updates_delete_own"
on public.vehicle_km_updates for delete
using (auth.uid() = user_id);

-- =========================
-- VEHICLE MAINTENANCE LOGS
-- =========================

create table if not exists public.vehicle_maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  maintenance_item_id uuid not null references public.vehicle_maintenance_items(id) on delete cascade,
  name text not null,
  service_km int not null check (service_km >= 0),
  service_at timestamptz not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vehicle_maintenance_logs_user on public.vehicle_maintenance_logs(user_id);
create index if not exists idx_vehicle_maintenance_logs_vehicle on public.vehicle_maintenance_logs(vehicle_id, service_at desc);
create index if not exists idx_vehicle_maintenance_logs_item on public.vehicle_maintenance_logs(maintenance_item_id, service_at desc);

drop trigger if exists trg_vehicle_maintenance_logs_updated_at on public.vehicle_maintenance_logs;
create trigger trg_vehicle_maintenance_logs_updated_at
before update on public.vehicle_maintenance_logs
for each row execute function public.set_updated_at();

alter table public.vehicle_maintenance_logs enable row level security;

drop policy if exists "vehicle_maintenance_logs_select_own" on public.vehicle_maintenance_logs;
create policy "vehicle_maintenance_logs_select_own"
on public.vehicle_maintenance_logs for select
using (auth.uid() = user_id);

drop policy if exists "vehicle_maintenance_logs_insert_own" on public.vehicle_maintenance_logs;
create policy "vehicle_maintenance_logs_insert_own"
on public.vehicle_maintenance_logs for insert
with check (auth.uid() = user_id);

drop policy if exists "vehicle_maintenance_logs_update_own" on public.vehicle_maintenance_logs;
create policy "vehicle_maintenance_logs_update_own"
on public.vehicle_maintenance_logs for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "vehicle_maintenance_logs_delete_own" on public.vehicle_maintenance_logs;
create policy "vehicle_maintenance_logs_delete_own"
on public.vehicle_maintenance_logs for delete
using (auth.uid() = user_id);
