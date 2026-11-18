-- ════════════════════════════════════════════════════════
-- Operaciones — fecha de entrega y "a tiempo" (18 nov 2026)
-- Correr PRIMERO en Supabase de PRÁCTICA (ozen-staging). En la REAL, ANTES de publicar el código
-- (va después de sql/operaciones.sql). Solo agrega columnas; no borra nada. Se puede correr más
-- de una vez sin dañar nada.
--
--  · fecha_entrega_original: la fecha que se puso al crear la orden.
--  · reprogramada: true si después de creada el líder o Master cambió la fecha → queda No a tiempo.
--  · lista_en: cuándo llegó a "Lista en tienda" (eso es "cumplida" para el indicador a tiempo).
-- ════════════════════════════════════════════════════════
alter table operaciones_externas add column if not exists fecha_entrega_original date;
alter table operaciones_externas add column if not exists reprogramada boolean not null default false;
alter table operaciones_externas add column if not exists lista_en timestamptz;

-- Órdenes que ya existían: la original es la que tenían.
update operaciones_externas set fecha_entrega_original = fecha_estimada_entrega
 where fecha_entrega_original is null and fecha_estimada_entrega is not null;

-- Órdenes creadas desde la app que ya pasaron por "Lista en tienda": se toma del historial.
update operaciones_externas o set lista_en = (
  select max((h->>'en')::timestamptz) from jsonb_array_elements(o.historial) h
   where h->>'etapa' = 'lista' and h->>'accion' in ('etapa','creada')
     and coalesce(h->>'cuenta','') <> '[EXCEL]')
 where lista_en is null and etapa in ('lista','entregada');

-- Comprobación: debe listar las 3 columnas nuevas.
select column_name from information_schema.columns
 where table_name = 'operaciones_externas' and column_name in ('fecha_entrega_original','reprogramada','lista_en') order by 1;
