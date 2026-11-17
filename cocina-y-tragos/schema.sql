-- Cocina & Tragos · estructura de la base de datos
-- Pegá todo esto en Supabase → SQL Editor → New query → Run.

-- Recetas y tragos (el contenido completo va en "data")
create table if not exists public.recetas (
  id          text primary key,
  tipo        text not null default 'comida',      -- 'comida' | 'trago'
  data        jsonb not null,
  imagen      text,                                -- URL pública de la foto
  regenerar   boolean not null default false,      -- el script la vuelve a generar
  actualizado timestamptz not null default now()
);

-- Estado compartido: semanas, compras, despensa, favoritos, ajustes, plantillas
create table if not exists public.estado (
  clave       text primary key,
  valor       jsonb,
  actualizado timestamptz not null default now()
);

-- Historial de lo que cocinaron
create table if not exists public.historial (
  id         text primary key,
  receta_id  text not null,
  fecha      date not null,
  slot       text
);
create index if not exists historial_fecha on public.historial (fecha desc);

-- Seguridad: solo usuarios con sesión iniciada (ustedes dos) pueden leer y escribir.
alter table public.recetas   enable row level security;
alter table public.estado    enable row level security;
alter table public.historial enable row level security;

drop policy if exists "familia" on public.recetas;
drop policy if exists "familia" on public.estado;
drop policy if exists "familia" on public.historial;
create policy "familia" on public.recetas   for all to authenticated using (true) with check (true);
create policy "familia" on public.estado    for all to authenticated using (true) with check (true);
create policy "familia" on public.historial for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.recetas, public.estado, public.historial to authenticated;

-- Fotos: bucket público para ver, solo usuarios con sesión para subir.
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

drop policy if exists "fotos subir" on storage.objects;
drop policy if exists "fotos actualizar" on storage.objects;
create policy "fotos subir" on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos actualizar" on storage.objects for update to authenticated using (bucket_id = 'fotos');
