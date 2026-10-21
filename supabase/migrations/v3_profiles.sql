-- AERIS • миграция v3: ники профилей (без паролей)
-- Ник = имя в рекордзале. Уникальность считаем без учёта регистра:
-- «Ваня» и «ВАНЯ» — один человек. Почт, паролей и прочих личных данных
-- здесь нет и не будет: это имя для зала славы, а не учётка.
-- Позже (взрослым) появится вход по коду с почты — тогда миграцией v4
-- приклеим ник к аккаунту, а до тех пор он просто закреплён в базе.

create table if not exists public.profiles (
  id bigint generated always as identity primary key,
  name text not null,
  created timestamptz not null default now()
);

-- Уникальный индекс «в нижнем регистре»: гонки двух игроков с одним
-- ником закрываются самой базой — второй получит «занято».
create unique index if not exists profiles_name_uidx
  on public.profiles (lower(name));

alter table public.profiles enable row level security;

/* Читать список ников можно всем: он и так публичен — это доска.
   Никаких личных данных в таблице, бояться нечего. */
drop policy if exists "взглянуть на ники" on public.profiles;
create policy "взглянуть на ники"
  on public.profiles for select using (true);

/* Занять может кто угодно, но только по нашему формату: 2–16 знаков,
   буквы/цифры/дефис/подчёркивание/пробел внутри, без них на торцах.
   Это страховка — формат проверяется и на сайте, а здесь он закреплён
   на случай, если кто-то шлёт запросы мимо нашей страницы. */
drop policy if exists "занять ник" on public.profiles;
create policy "занять ник"
  on public.profiles for insert with check (
    char_length(name) between 2 and 16
    and name ~ '^[0-9A-Za-zА-Яа-яЁё_ -]{2,16}$'
    and name !~ '^[ _-]'
    and name !~ '[ _-]$'
  );
