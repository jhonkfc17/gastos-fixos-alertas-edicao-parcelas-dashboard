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
