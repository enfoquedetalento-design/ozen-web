-- ════════════════════════════════════════════════════════════════════════════
-- Turnos: Borrador de verdad (con botón "Publicar <mes>")
-- Lo que se edita en Turnos ▸ Borrador vive en `turnos_borrador` (copia aparte) y nadie más lo
-- ve hasta publicar; "Publicar" recién ahí actualiza `turnos_asignaciones` (lo oficial).
-- Solo crea cosas nuevas — no modifica ni borra datos existentes. Se puede correr más de una vez.
-- Correr primero en STAGING; luego en producción antes de subir el código a main.
-- ════════════════════════════════════════════════════════════════════════════

-- Copia de la estructura de turnos_asignaciones (mismos tipos de columna, sin llaves foráneas).
create table if not exists turnos_borrador (like turnos_asignaciones including defaults including identity including constraints including indexes);

-- Qué meses ya tienen su borrador iniciado (la primera vez se copia de lo publicado) y cuándo se publicó por última vez.
create table if not exists turnos_borrador_meses (
  mes           text primary key,            -- 'YYYY-MM'
  iniciado_en   timestamptz not null default now(),
  publicado_en  timestamptz,
  publicado_por text
);

alter table turnos_borrador       enable row level security;
alter table turnos_borrador_meses enable row level security;

drop policy if exists "turnos_borrador_todo"       on turnos_borrador;
drop policy if exists "turnos_borrador_meses_todo" on turnos_borrador_meses;
create policy "turnos_borrador_todo"       on turnos_borrador       for all to anon, authenticated using (true) with check (true);
create policy "turnos_borrador_meses_todo" on turnos_borrador_meses for all to anon, authenticated using (true) with check (true);

-- Confirma que quedaron creadas.
select table_name from information_schema.tables where table_name in ('turnos_borrador','turnos_borrador_meses');
