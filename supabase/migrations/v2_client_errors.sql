-- AERIS • миграция v2: журнал ошибок клиента
-- Зачем: непойманные ошибки страницы уходят сюда, чтобы мы видели
-- поломку до первой жалобы игрока. Личных данных нет: только текст
-- сбоя, страница и время.
-- Вставка разрешена, чтение и правка запрещены всем, кроме владельца.

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  page text not null default 'index',
  msg text not null,
  created timestamptz not null default now()
);

create index if not exists client_errors_created_idx
  on public.client_errors (created desc);

alter table public.client_errors enable row level security;

drop policy if exists "клиент пишет сбой" on public.client_errors;
create policy "клиент пишет сбой"
  on public.client_errors for insert with check (true);
