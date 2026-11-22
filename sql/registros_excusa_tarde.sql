-- Asistencia: excusa de una llegada tarde (22 nov 2026).
-- Se guarda en la fila del evento "entrada" de esa jornada:
--   excusa_tarde  = el motivo (texto)
--   excusa_estado = 'aprobada' o 'no_aprobada'
-- Solo con excusa APROBADA esa llegada tarde deja de contar en Informes (nómina, reincidencia) y en
-- "Asistencia de hoy". Una excusa no aprobada sigue contando como tarde sin excusa válida.
-- La registra y decide, desde Registros, quien tiene el permiso "Corregir, crear o borrar una marcación".
-- Se puede correr varias veces sin problema.
alter table public.registros add column if not exists excusa_tarde text;
alter table public.registros add column if not exists excusa_estado text;
do $$ begin
  alter table public.registros add constraint registros_excusa_estado_valido
    check (excusa_estado is null or excusa_estado in ('aprobada','no_aprobada'));
exception when duplicate_object then null;
end $$;
