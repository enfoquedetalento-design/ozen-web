-- Constancia de "Avisar por WhatsApp" en los Flexipagos (18 nov 2026, pedido de Santiago).
-- Una fila por cada vez que se le avisó a un cliente: qué venta, cuándo y quién.
-- Tabla aparte (y no una columna en ventas) para que cada aviso no obligue a todos los
-- dispositivos a volver a bajar toda la tabla de ventas: solo se baja esta, que es pequeña.
-- Se puede correr varias veces sin problema. Correr primero en PRÁCTICA (staging) y, cuando
-- Santiago apruebe, en la REAL antes de subir el código a main.

create table if not exists ventas_flexipago_avisos (
  id          uuid primary key default gen_random_uuid(),
  venta_id    text not null,            -- id de la venta (Flexipago) a la que se avisó
  tienda_id   text,
  fecha       date not null default (now() at time zone 'America/Bogota')::date,
  creado_en   timestamptz not null default now(),
  por         text,                     -- quién avisó (asesor elegido o la cuenta)
  cuenta      text                      -- cuenta con la que se hizo
);
create index if not exists ventas_flexipago_avisos_venta_idx on ventas_flexipago_avisos (venta_id);

alter table ventas_flexipago_avisos enable row level security;
drop policy if exists "vfa_leer"    on ventas_flexipago_avisos;
drop policy if exists "vfa_agregar" on ventas_flexipago_avisos;
create policy "vfa_leer"    on ventas_flexipago_avisos for select to anon, authenticated using (true);
create policy "vfa_agregar" on ventas_flexipago_avisos for insert to anon, authenticated with check (true);

-- Pulso de versiones (ver sql/pulso_versiones.sql): así los demás dispositivos se enteran solos.
drop trigger if exists trg_pulso_version on public.ventas_flexipago_avisos;
create trigger trg_pulso_version after insert or update or delete on public.ventas_flexipago_avisos
  for each statement execute function bump_tabla_version();
insert into tabla_versiones (tabla, version) values ('ventas_flexipago_avisos', 0) on conflict (tabla) do nothing;

-- Revisión: debe salir 1 fila.
select tabla, version from tabla_versiones where tabla = 'ventas_flexipago_avisos';
