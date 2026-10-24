-- AERIS • миграция v4: рекордзал (scores) с серверной проверкой
--
-- Почему появилась. Таблица scores жила только в дашборде: её политики
-- нельзя было ни ревьюить, ни откатить, а проверок не было вовсе. Аудит
-- 2026-10-24 показал цену: любой мог записать в ник HTML и любой счёт,
-- и это видели все игроки. Здесь таблица закреплена в git вместе с
-- правилами: разумная длина и формат, счёт 0–999, время ставит сервер,
-- чужие разрешающие политики вставки снимаются, от залповых вставок
-- стоит тихий ограничитель.
--
-- Как применять: Supabase → SQL Editor → вставить целиком → Run.
-- Миграция написана так, чтобы её можно было запускать повторно.

-- 1. Таблица. Идентификатор, игра, имя, счёт и время — больше ничего:
--    ни почты, ни устройства, ни личных данных.
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  game text not null,
  name text not null,
  score integer not null default 0,
  created timestamptz not null default now()
);

create index if not exists scores_game_score_idx
  on public.scores (game, score desc, created asc);

alter table public.scores enable row level security;

-- 2. Читают все: это публичная доска.
drop policy if exists "взглянуть на рекорды" on public.scores;
create policy "взглянуть на рекорды"
  on public.scores for select using (true);

-- 3. Вставлять может каждый, но только правдоподобное. Та же проверка
--    формата, что у ников (v3), плюс диапазон счёта и вид адреса игры.
drop policy if exists "сдать рекорд" on public.scores;
create policy "сдать рекорд"
  on public.scores for insert with check (
    char_length(game) between 1 and 40
    and game ~ '^[0-9A-Za-z_-]+$'
    and char_length(name) between 1 and 20
    and name ~ '^[0-9A-Za-zА-Яа-яЁё_ -]{1,20}$'
    and name !~ '^[ _-]'
    and name !~ '[ _-]$'
    and score between 0 and 999
  );

-- 4. Снять старые разрешающие политики вставки с другими именами.
--    Сначала их видно так:
--      select policyname, cmd, qual, with_check from pg_policies
--      where schemaname='public' and tablename='scores';
--    Здесь удаляем именно INSERT-политики, кроме нашей, и ничего больше:
--    политики чтения и прочие команды не трогаем.
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname='public' and tablename='scores' and cmd='INSERT'
      and policyname <> 'сдать рекорд'
  loop
    execute format('drop policy %I on public.scores', p.policyname);
  end loop;
end $$;

-- 5. Время ставит сервер. Клиентское created не принимаем вовсе: иначе
--    можно было ставить 1970 год и выигрывать тай-брейк в топе.
create or replace function public.scores_force_created()
returns trigger language plpgsql as $$
begin
  new.created := now();
  return new;
end $$;

drop trigger if exists scores_force_created on public.scores;
create trigger scores_force_created
  before insert on public.scores
  for each row execute function public.scores_force_created();

-- 6. Тихий ограничитель: не больше десяти записей на одну игру и имя
--    в минуту. Это не замена честному ограничению по адресу (оно
--    возможно только на границе сети — Cloudflare или крайняя функция
--    Supabase), но залп «двести строк за секунду» отсекает.
create or replace function public.scores_quiet()
returns trigger language plpgsql as $$
declare n integer;
begin
  select count(*) into n
  from public.scores
  where game = new.game and lower(name) = lower(new.name)
    and created > now() - interval '1 minute';
  if n >= 10 then
    raise exception 'слишком много записей — подожди минуту';
  end if;
  return new;
end $$;

drop trigger if exists scores_quiet on public.scores;
create trigger scores_quiet
  before insert on public.scores
  for each row execute function public.scores_quiet();

-- 7. Уборка строк, которые оставил аудит (заведомо неигровые адреса).
--    Идёт ДО ограничений: строки с огромным счётом и 2000-символьным
--    именем иначе не дали бы их добавить. Боевые рекорды не трогаем.
delete from public.scores
where game like 'sec-probe-%' or game like 'tx-probe-%';

-- 8. Табличные ограничения — последний рубеж, если политику когда-нибудь
--    снимут или база примет вставку служебным ключом. Добавляем только
--    если их ещё нет: повторный запуск миграции не должен падать.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scores_score_range') then
    alter table public.scores
      add constraint scores_score_range check (score between 0 and 999);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scores_name_len') then
    alter table public.scores
      add constraint scores_name_len check (char_length(name) between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scores_game_len') then
    alter table public.scores
      add constraint scores_game_len check (char_length(game) between 1 and 40);
  end if;
end $$;

-- 9. Проверка после установки (ожидание: 0 запрещённых строк):
--    select count(*) from public.scores
--    where game like 'sec-probe-%' or game like 'tx-probe-%';
