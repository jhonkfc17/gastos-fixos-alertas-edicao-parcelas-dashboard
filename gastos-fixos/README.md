# Controle de Gastos Fixos (Supabase)

App simples para controlar **gastos mensais fixos** com:
- Login (Supabase Auth)
- CRUD de gastos fixos
- Dashboard (gráfico por categoria)
- Controle mensal de pagamento (pago/pendente por mês)
- RLS (cada usuário acessa apenas seus dados)

## 1) Configurar Supabase
1. Crie um projeto no Supabase.
2. No **SQL Editor**, rode o arquivo `supabase/schema.sql`.
3. Em **Authentication → URL Configuration**, adicione:
   - `http://localhost:5173` (dev)
   - (quando publicar) sua URL de produção.

## 2) Variáveis de ambiente
Copie `.env.example` para `.env` e preencha:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 3) Rodar
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```


## Atualizações (comprovantes + histórico)

### SQL OBRIGATÓRIA (execute agora)
> Necessário para o painel não quebrar ao registrar pagamentos com comprovante.

```sql
-- 1) Wallet: campos opcionais (comprovante + parcela + vínculo ao gasto fixo)
alter table public.wallet_transactions
  add column if not exists receipt_url text,
  add column if not exists fixed_expense_id uuid,
  add column if not exists installment_number integer,
  add column if not exists installment_total integer,
  add column if not exists installment_label text;

-- 2) Status mensal: número de parcelas já pagas no mês (para gastos parcelados)
alter table public.monthly_expense_status
  add column if not exists paid_installments integer;

-- 3) Storage: bucket de comprovantes
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

-- 4) Policies Storage (público para leitura do link; escrita apenas do dono)
-- Leitura pública (para abrir "Ver" no painel)
drop policy if exists "Public read receipts" on storage.objects;
create policy "Public read receipts"
on storage.objects for select
to public
using (bucket_id = 'receipts');

-- Upload somente autenticado (e só no próprio diretório userId/...)
drop policy if exists "Users upload receipts" on storage.objects;
create policy "Users upload receipts"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Deletar somente o próprio arquivo
drop policy if exists "Users delete receipts" on storage.objects;
create policy "Users delete receipts"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);
```

### SQL OPCIONAL
> Para performance e organização (não é obrigatório para funcionar).

```sql
create index if not exists idx_wallet_transactions_user_created_at
  on public.wallet_transactions (user_id, created_at desc);

create index if not exists idx_monthly_status_user_ym
  on public.monthly_expense_status (user_id, year, month);
```

### O que mudou no painel
- Modal de **Registrar pagamento** com:
  - valor (aceita vírgula)
  - método
  - **upload de comprovante** (opcional)
  - se for parcelado, mostra **parcela X/Y**
- Nova aba **Histórico** com filtro por mês e busca, incluindo link do comprovante.
- Integração mais resiliente: se a sua base ainda não tiver alguma coluna opcional, o app tenta gravar sem quebrar.
