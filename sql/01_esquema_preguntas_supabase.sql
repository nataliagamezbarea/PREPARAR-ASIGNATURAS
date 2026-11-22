-- ============================================================
-- ESQUEMA SUPABASE: CONFIGURACIÓN DE RAMAS/CURSOS Y PROGRESO
-- (Las preguntas JSON se alojan en tu repositorio privado de GitHub)
-- ============================================================

-- 1. Tabla para configurar qué rama y qué carpeta de GitHub tiene los JSONs de cada examen/curso
create table if not exists public.configuracion_cursos_test (
  id serial primary key,
  curso text not null,                       -- Ej: 'DWEC - 2º Grado Superior'
  examen text not null default 'Examen 1',   -- Ej: 'Examen 1', 'Examen 2'
  asignatura text not null default 'WEC',    -- Ej: 'WEC', 'DAW'
  gh_repo text not null default 'nataliagamezbarea/GRADOS_INFORMATICOS',
  rama text not null default 'Segundo_grado_superior', -- Nombre de la rama en GitHub
  carpeta_json text not null default 'datos/bancos/WEC', -- Carpeta en GitHub con los .json
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Valores iniciales para tu curso actual
insert into public.configuracion_cursos_test (curso, examen, asignatura, gh_repo, rama, carpeta_json)
values 
  ('DWEC - Segundo Curso (Examen 1)', 'Examen 1', 'WEC', 'nataliagamezbarea/GRADOS_INFORMATICOS', 'Segundo_grado_superior', 'datos/bancos/WEC'),
  ('DWEC - Segundo Curso (Examen 2)', 'Examen 2', 'WEC', 'nataliagamezbarea/GRADOS_INFORMATICOS', 'Segundo_grado_superior', 'datos/bancos/WEC/examen2')
on conflict do nothing;

-- 2. Progreso de los usuarios (guarda los aciertos, fallos y preguntas practicadas sincronizadas)
create table if not exists public.progreso_usuario_test (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  examen text not null default 'Examen 1',
  asignatura text not null default 'WEC',
  rama text not null default 'Segundo_grado_superior',
  practicadas integer not null default 0,
  aciertos integer not null default 0,
  fallos integer not null default 0,
  datos_progreso jsonb not null default '{}'::jsonb, -- Historial completo de respuestas
  actualizado_en timestamptz not null default now(),
  unique (user_id, examen, asignatura)
);

create index if not exists idx_progreso_usuario_resumen on public.progreso_usuario_test (user_id, examen);

-- Políticas RLS (Seguridad a nivel de fila)
alter table public.configuracion_cursos_test enable row level security;
alter table public.progreso_usuario_test enable row level security;

-- Cualquiera puede consultar la lista de cursos y ramas activos
drop policy if exists "Lectura publica de configuracion de cursos" on public.configuracion_cursos_test;
create policy "Lectura publica de configuracion de cursos" on public.configuracion_cursos_test
  for select using (true);

-- Solo el usuario autenticado puede leer y guardar su propio progreso
drop policy if exists "Gestion de progreso propio de usuario" on public.progreso_usuario_test;
create policy "Gestion de progreso propio de usuario" on public.progreso_usuario_test
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
