-- ============================================================
-- ESQUEMA SUPABASE: PROGRESO DE TESTS (GRADOS INFORMÁTICOS)
-- Compatible con Acceso Grados Informáticos y Preparar Tests
-- ============================================================

-- 1. Crear el esquema si no existe
create schema if not exists "grados-informaticos";

-- 2. Tabla para almacenar el progreso de tests de cada usuario
create table if not exists "grados-informaticos".progreso_tests (
  id serial primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  email text,
  asignatura_id text not null default 'general',
  historial jsonb not null default '{}'::jsonb,
  fallos jsonb not null default '[]'::jsonb,
  estadisticas jsonb not null default '{}'::jsonb,
  sesion_activa jsonb default null,
  total_practicadas integer default 0,
  actualizado_en timestamptz not null default now(),

  unique (usuario_id, asignatura_id)
);

-- 3. Habilitar Row Level Security (RLS)
alter table "grados-informaticos".progreso_tests enable row level security;

-- 4. Políticas de Seguridad RLS: cada usuario gestiona únicamente su propio progreso
drop policy if exists "Los usuarios pueden leer su propio progreso de tests" on "grados-informaticos".progreso_tests;
create policy "Los usuarios pueden leer su propio progreso de tests"
on "grados-informaticos".progreso_tests
for select
to authenticated
using (auth.uid() = usuario_id);

drop policy if exists "Los usuarios pueden insertar su propio progreso de tests" on "grados-informaticos".progreso_tests;
create policy "Los usuarios pueden insertar su propio progreso de tests"
on "grados-informaticos".progreso_tests
for insert
to authenticated
with check (auth.uid() = usuario_id);

drop policy if exists "Los usuarios pueden actualizar su propio progreso de tests" on "grados-informaticos".progreso_tests;
create policy "Los usuarios pueden actualizar su propio progreso de tests"
on "grados-informaticos".progreso_tests
for update
to authenticated
using (auth.uid() = usuario_id)
with check (auth.uid() = usuario_id);

drop policy if exists "Los usuarios pueden eliminar su propio progreso de tests" on "grados-informaticos".progreso_tests;
create policy "Los usuarios pueden eliminar su propio progreso de tests"
on "grados-informaticos".progreso_tests
for delete
to authenticated
using (auth.uid() = usuario_id);

-- 5. Índices para acelerar las consultas por usuario y asignatura
create index if not exists idx_progreso_tests_usuario on "grados-informaticos".progreso_tests (usuario_id);
create index if not exists idx_progreso_tests_asig on "grados-informaticos".progreso_tests (usuario_id, asignatura_id);
