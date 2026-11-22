import json
import os
import csv

with open("/home/natalia/Escritorio/preguntas_1656_todas.json", "r", encoding="utf-8") as f:
    todas = json.load(f)

dir_sql = "/home/natalia/Escritorio/preparar-tests/sql"
os.makedirs(dir_sql, exist_ok=True)

MAPA_TEMAS = {
    "DWEC · Tema 1 · Selección de arquitecturas y herramientas de programación": 1,
    "DWEC · Tema 2 · Aplicación y verificación de la sintaxis del lenguaje": 2,
    "DWEC · Tema 3 · Identificación y aplicación de objetos predefinidos del lenguaje": 3,
    "DWEC · Tema 4 · Funciones, arrays, métodos de array, objetos literales y JSON": 4
}

TITULOS = {
    1: "Tema 1 · Selección de arquitecturas y de herramientas de programación",
    2: "Tema 2 · Aplicación y verificación de la sintaxis del lenguaje",
    3: "Tema 3 · Identificación y aplicación de objetos predefinidos del lenguaje",
    4: "Tema 4 · Funciones, arrays, métodos de array, objetos literales y JSON"
}

# 1. Esquema
esquema = """-- ============================================================
-- ESQUEMA DE PREGUNTAS Y PROGRESO PARA SUPABASE
-- Compatible con public y grados-informaticos
-- ============================================================

create table if not exists public.preguntas_test (
  id text primary key,
  asignatura text not null default 'WEC',
  examen text not null default 'Examen 1',
  tema integer not null,
  tema_nombre text,
  apartado integer not null default 1,
  apartado_nombre text,
  categoria text not null default 'entrenamiento',
  enunciado text not null,
  opciones jsonb not null,
  correcta text not null,
  explicacion text,
  creado_en timestamptz not null default now()
);

create index if not exists idx_preguntas_asig_examen on public.preguntas_test (asignatura, examen);
create index if not exists idx_preguntas_tema on public.preguntas_test (tema);
create index if not exists idx_preguntas_categoria on public.preguntas_test (categoria);

create table if not exists public.progreso_test (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pregunta_id text not null references public.preguntas_test(id) on delete cascade,
  asignatura text not null default 'WEC',
  examen text not null default 'Examen 1',
  intentos integer not null default 0,
  aciertos integer not null default 0,
  fallos integer not null default 0,
  ultima_respuesta text,
  ultimo_resultado text,
  actualizado_en timestamptz not null default now(),
  unique (user_id, pregunta_id)
);

create index if not exists idx_progreso_usuario on public.progreso_test (user_id, examen);

alter table public.preguntas_test enable row level security;
alter table public.progreso_test enable row level security;

drop policy if exists "Lectura publica de preguntas" on public.preguntas_test;
create policy "Lectura publica de preguntas" on public.preguntas_test for select using (true);

drop policy if exists "Gestion de progreso propio" on public.progreso_test;
create policy "Gestion de progreso propio" on public.progreso_test
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
"""

with open(os.path.join(dir_sql, "01_esquema_preguntas_supabase.sql"), "w", encoding="utf-8") as f:
    f.write(esquema)

# 2. Datos SQL
def escape_sql(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"

sql_lines = ["-- INSERTS DE 1656 PREGUNTAS (EXAMEN 1 - WEC)\n"]
batch_size = 50

for i in range(0, len(todas), batch_size):
    batch = todas[i:i+batch_size]
    sql_lines.append("INSERT INTO public.preguntas_test (id, asignatura, examen, tema, tema_nombre, apartado, apartado_nombre, categoria, enunciado, opciones, correcta, explicacion) VALUES")
    rows = []
    for p in batch:
        t_num = MAPA_TEMAS.get(p.get("bloque"), 1)
        t_nom = TITULOS.get(t_num, "")
        opts = {}
        raw_opts = p.get("opciones")
        if isinstance(raw_opts, list):
            for o in raw_opts:
                opts[o["letra"].upper()] = o["texto"]
        elif isinstance(raw_opts, dict):
            opts = raw_opts
        cat = p.get("categoria") or "entrenamiento"
        sub_num = p.get("subtemaNumero") or 1
        sub_nom = p.get("subtema") or ""
        row = f"  ({escape_sql(p['id'])}, 'WEC', 'Examen 1', {t_num}, {escape_sql(t_nom)}, {sub_num}, {escape_sql(sub_nom)}, {escape_sql(cat)}, {escape_sql(p['enunciado'])}, {escape_sql(json.dumps(opts, ensure_ascii=False))}::jsonb, {escape_sql(p['correcta'].upper())}, {escape_sql(p.get('explicacion') or '')})"
        rows.append(row)
    sql_lines.append(",\n".join(rows))
    sql_lines.append("ON CONFLICT (id) DO UPDATE SET asignatura = EXCLUDED.asignatura, examen = EXCLUDED.examen, enunciado = EXCLUDED.enunciado, opciones = EXCLUDED.opciones, correcta = EXCLUDED.correcta, explicacion = EXCLUDED.explicacion;\n")

with open(os.path.join(dir_sql, "02_datos_preguntas_1656_examen1.sql"), "w", encoding="utf-8") as f:
    f.write("\n".join(sql_lines))

# 3. CSV
with open(os.path.join(dir_sql, "preguntas_1656_wec_examen1.csv"), "w", encoding="utf-8", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["id", "asignatura", "examen", "tema", "tema_nombre", "apartado", "apartado_nombre", "categoria", "enunciado", "opciones", "correcta", "explicacion"])
    for p in todas:
        t_num = MAPA_TEMAS.get(p.get("bloque"), 1)
        t_nom = TITULOS.get(t_num, "")
        opts = {}
        raw_opts = p.get("opciones")
        if isinstance(raw_opts, list):
            for o in raw_opts:
                opts[o["letra"].upper()] = o["texto"]
        elif isinstance(raw_opts, dict):
            opts = raw_opts
        writer.writerow([
            p["id"],
            "WEC",
            "Examen 1",
            t_num,
            t_nom,
            p.get("subtemaNumero") or 1,
            p.get("subtema") or "",
            p.get("categoria") or "entrenamiento",
            p.get("enunciado"),
            json.dumps(opts, ensure_ascii=False),
            p["correcta"].upper(),
            p.get("explicacion") or ""
        ])

print("Archivos SQL y CSV generados con exito en", dir_sql)
