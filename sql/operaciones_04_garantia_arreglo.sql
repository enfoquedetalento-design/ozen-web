-- ════════════════════════════════════════════════════════
-- Operaciones — garantía que no se cubre, con o sin arreglo (18 nov 2026)
-- Agrega una sola columna; no cambia ni borra datos. Se puede correr más de una vez.
-- Correr PRIMERO en PRÁCTICA (ozen-staging). En la REAL, ANTES de publicar el código
-- (después de operaciones.sql, operaciones_02 y operaciones_03).
-- ════════════════════════════════════════════════════════
alter table operaciones_externas add column if not exists garantia_con_arreglo boolean not null default false;

-- Comprobación: debe listar la columna.
select column_name from information_schema.columns
 where table_name = 'operaciones_externas' and column_name = 'garantia_con_arreglo';
