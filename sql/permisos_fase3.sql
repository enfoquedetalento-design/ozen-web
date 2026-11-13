-- ════════════════════════════════════════════════════════
-- Módulo "Permisos" — Fase 3: que la página se entere cuando cambian los permisos
-- Desde la Fase 3 la página descarga permisos_roles y permisos_excepciones al abrir. Esto las
-- conecta al "pulso" de versiones (sql/pulso_versiones.sql) para que solo se vuelvan a descargar
-- cuando alguien cambia un permiso, y no cada 5 minutos.
-- Correr PRIMERO en Supabase de PRÁCTICA (ozen-staging); después en la REAL, antes de subir el
-- código a main. No modifica ni borra datos; se puede correr más de una vez.
-- (Si no se corre, todo funciona igual: solo se descargan esas dos tablitas más seguido.)
-- ════════════════════════════════════════════════════════
do $$
declare t text;
begin
  if to_regclass('public.tabla_versiones') is null or to_regprocedure('public.bump_tabla_version()') is null then
    raise notice 'Falta correr primero sql/pulso_versiones.sql — no se instaló nada';
    return;
  end if;
  foreach t in array array['permisos_roles','permisos_excepciones'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_pulso_version on public.%I', t);
      execute format('create trigger trg_pulso_version after insert or update or delete on public.%I for each statement execute function bump_tabla_version()', t);
      insert into tabla_versiones (tabla, version) values (t, 0) on conflict (tabla) do nothing;
    else
      raise notice 'La tabla % no existe (falta sql/permisos_fase2.sql), se salta', t;
    end if;
  end loop;
end $$;

-- Comprobación: debe listar 2 filas (permisos_excepciones y permisos_roles).
select tabla, version from tabla_versiones where tabla in ('permisos_roles','permisos_excepciones') order by tabla;
