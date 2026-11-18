-- ════════════════════════════════════════════════════════
-- Operaciones — estado de pago "Valor por definir" (18 nov 2026)
-- Arreglos que hasta llegar al taller no se sabe cuánto cuestan. Solo amplía la lista de estados
-- de pago permitidos; no cambia ni borra datos. Se puede correr más de una vez.
-- Correr PRIMERO en PRÁCTICA (ozen-staging). En la REAL, ANTES de publicar el código
-- (después de sql/operaciones.sql y sql/operaciones_02_fecha_entrega.sql).
-- ════════════════════════════════════════════════════════
alter table operaciones_externas drop constraint if exists operaciones_externas_estado_pago_check;
alter table operaciones_externas add constraint operaciones_externas_estado_pago_check
  check (estado_pago in ('pago','debe','no_aplica','por_definir'));

-- Comprobación: debe mostrar la regla con los 4 estados.
select pg_get_constraintdef(oid) as regla from pg_constraint where conname = 'operaciones_externas_estado_pago_check';
