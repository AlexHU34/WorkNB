-- AERIS • миграция v4 (продолжение): тишина и мусор
--
-- Аудит 2026-10-24: таблицы pings и client_errors принимали любые строки
-- любой длины, а ограничение «не больше N в минуту» жило только в
-- браузере и обходилось прямым запросом. Здесь — серверная правда:
-- разумные длины, запрет пустых строк и тихий ограничитель залпов.
-- Чтение pings нужно счётчику «открытий на сайте», поэтому SELECT
-- не трогаем; client_errors читает только владелец.
--
-- Применять после v4_scores.sql, тем же способом (SQL Editor → Run).
-- Повторный запуск безопасен.

-- ---------- pings: отметки «открыли игру» ----------
do $$
declare p record;
begin
  if to_regclass('public.pings') is null then
    raise notice 'pings: таблицы нет — пропускаем';
    return;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pings_event_len') then
    alter table public.pings
      add constraint pings_event_len check (char_length(event) between 1 and 40);
  end if;

  -- Старые разрешающие политики вставки снимаем: иначе они складываются
  -- с новой через «или», и проверка ничего не значит.
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pings' and cmd = 'INSERT'
      and policyname <> 'отметить открытие'
  loop
    execute format('drop policy %I on public.pings', p.policyname);
  end loop;

  execute 'drop policy if exists "отметить открытие" on public.pings';
  execute 'create policy "отметить открытие" on public.pings for insert with check (
    char_length(event) between 1 and 40
    and event ~ ''^[0-9A-Za-zА-Яа-яЁё:_ -]+$''
  )';
end $$;

-- Тот же тихий ограничитель, что у рекордов: не больше десяти отметок
-- одного события в минуту. Общий залп по разным событиям это не
-- остановит — для него нужна граница сети (Cloudflare/крайняя функция);
-- но самый простой мусор отсекается уже здесь.
create or replace function public.pings_quiet()
returns trigger language plpgsql as $$
declare n integer;
begin
  select count(*) into n
  from public.pings
  where event = new.event and created > now() - interval '1 minute';
  if n >= 10 then
    raise exception 'слишком часто — подожди минуту';
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.pings') is not null then
    execute 'drop trigger if exists pings_quiet on public.pings';
    execute 'create trigger pings_quiet before insert on public.pings
             for each row execute function public.pings_quiet()';
  end if;
end $$;

-- ---------- client_errors: тихие сообщения об ошибках ----------
do $$
declare p record;
begin
  if to_regclass('public.client_errors') is null then
    raise notice 'client_errors: таблицы нет — пропускаем';
    return;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'client_errors_msg_len') then
    alter table public.client_errors
      add constraint client_errors_msg_len check (char_length(msg) between 1 and 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_errors_page_len') then
    alter table public.client_errors
      add constraint client_errors_page_len check (char_length(page) between 1 and 30);
  end if;

  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'client_errors' and cmd = 'INSERT'
      and policyname <> 'положить ошибку'
  loop
    execute format('drop policy %I on public.client_errors', p.policyname);
  end loop;

  execute 'drop policy if exists "положить ошибку" on public.client_errors';
  execute 'create policy "положить ошибку" on public.client_errors for insert with check (
    char_length(msg) between 1 and 140
    and char_length(page) between 1 and 30
  )';
end $$;

-- ---------- уборка тестовых строк аудита ----------
-- Только заведомо неигровые адреса из отчёта. Боевые данные не трогаем.
do $$
begin
  if to_regclass('public.pings') is not null then
    delete from public.pings where event like 'tx-probe-%';
  end if;
  if to_regclass('public.client_errors') is not null then
    delete from public.client_errors where page = 'sec-probe';
  end if;
end $$;

-- Проверка после установки:
--   select count(*) from public.pings where event like 'tx-probe-%';      -- 0
--   select count(*) from public.client_errors where page = 'sec-probe';   -- 0
