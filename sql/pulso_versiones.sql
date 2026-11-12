-- ════════════════════════════════════════════════════════════════════════════
-- "Pulso" de versiones: la página solo descarga las tablas que cambiaron
-- Cada tabla tiene una tarjetita (tabla_versiones) a la que un disparador le suma 1 cada vez que
-- alguien inserta, edita o borra en esa tabla. La página lee las tarjetas (bytes) y solo vuelve a
-- bajar las tablas cuya versión cambió. No modifica ni borra datos existentes; se puede correr
-- más de una vez. Correr primero en STAGING; luego en PRODUCCIÓN ANTES de subir el código a main.
-- (Si el código llega a main sin correr esto, la página sigue funcionando como antes.)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists tabla_versiones (
  tabla   text primary key,
  version bigint not null default 0
);

alter table tabla_versiones enable row level security;
drop policy if exists "tabla_versiones_leer" on tabla_versiones;
create policy "tabla_versiones_leer" on tabla_versiones for select to anon, authenticated using (true);
-- (sin política de escritura: solo el disparador, que corre con permisos del dueño, la modifica)

create or replace function bump_tabla_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into tabla_versiones (tabla, version) values (tg_table_name, 1)
  on conflict (tabla) do update set version = tabla_versiones.version + 1;
  return null;
end $$;

-- Instala el disparador en cada tabla que la página descarga al abrir (las que no existan se saltan).
do $$
declare t text;
begin
  foreach t in array array[
    'tiendas','usuarios','registros',
    'junta_lideres','junta_compromisos','junta_acuerdos','junta_areas','junta_lider_areas','junta_indicadores_congelados',
    'ventas','ventas_items','ventas_metas','ventas_metas_asesor','ventas_abonos','ventas_ajustes',
    'ventas_caja_aperturas','ventas_caja_cierres','ventas_caja_recolecciones','ventas_caja_gastos','ventas_caja_solicitudes_borrado',
    'turnos_globales','turnos_asignaciones','turnos_horarios',
    'capacitacion_cursos','capacitacion_lecciones','capacitacion_preguntas','capacitacion_lecciones_vistas','capacitacion_intentos'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_pulso_version on public.%I', t);
      execute format('create trigger trg_pulso_version after insert or update or delete on public.%I for each statement execute function bump_tabla_version()', t);
      insert into tabla_versiones (tabla, version) values (t, 0) on conflict (tabla) do nothing;
    else
      raise notice 'La tabla % no existe, se salta', t;
    end if;
  end loop;
end $$;

-- Confirma: debe listar 28 tablas con su disparador.
select event_object_table as tabla, count(*) as disparadores
from information_schema.triggers where trigger_name = 'trg_pulso_version' group by 1 order by 1;
