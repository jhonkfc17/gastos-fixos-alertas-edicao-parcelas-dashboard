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

  -- Parcelamento (compra parcelada)
  is_installment boolean not null default false,
  installment_total_amount numeric(12,2),
  installment_total int,
  installment_start_year int,
  installment_start_month int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibilidade (caso a tabela já exista)
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
-- MONTHLY STATUS (pago por mês)
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

-- evita duplicar o status do mesmo gasto no mesmo mês
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
  order_value numeric(18,8) not null check (order_value >= 0),
  bank_balance numeric(18,2) not null,
  note text,
  executed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
