-- ════════════════════════════════════════════════════════
-- Producto (generador de etiquetas): acceso para Felipe — 18 nov 2026
-- Felipe creó el Excel "Modelo Pricing", así que prueba Producto junto con Edwin y Master.
-- Correr en PRÁCTICA y en la REAL (en la real, DESPUÉS de operaciones_05_producto.sql).
--
-- 1) Siembra los 4 permisos de Producto solo para el rol Master (el líder, Edwin, los tiene aparte).
-- 2) Le da a Felipe excepciones personales ("extra"): entrar a Operaciones y todo lo de Producto.
--    Con "Entrar a Operaciones" también ve las órdenes de Externas e Internas (solo verlas: mover
--    órdenes depende de otros permisos que no se le dan).
-- Se puede correr más de una vez. Para quitárselo: Usuarios → Permisos → Personas → Felipe.
-- ════════════════════════════════════════════════════════

-- Debe haber UNA sola cuenta activa que empiece por "Felipe"; si no, se detiene sin tocar nada.
do $$ begin
  if (select count(*) from usuarios where name ilike 'felipe%' and active is not false) <> 1 then
    raise exception 'No hay exactamente una cuenta activa que empiece por "Felipe": avísale a Claude';
  end if;
end $$;

insert into permisos_roles (permiso, rol, condicion, actualizado_por)
select p, 'master', null, 'Santiago (Producto)'
  from unnest(array['operaciones.producto.ver','operaciones.producto.generar','operaciones.producto.codex','operaciones.producto.precio']) as p
on conflict (permiso, rol) do nothing;

insert into permisos_excepciones (usuario_id, usuario_nombre, permiso, tipo, motivo, creado_por)
select u.id::text, u.name, p, 'extra', 'Felipe creó el Excel de etiquetas: prueba Producto', 'Santiago'
  from usuarios u,
       unnest(array['operaciones.ver','operaciones.producto.ver','operaciones.producto.generar','operaciones.producto.codex','operaciones.producto.precio']) as p
 where u.name ilike 'felipe%' and u.active is not false
on conflict (usuario_id, permiso) do nothing;

insert into permisos_historial (hecho_por, accion, permiso, motivo)
values ('Santiago', 'producto_felipe', 'operaciones.producto.ver', 'Acceso a Producto para Felipe (creó el Excel de etiquetas)');

-- Comprobación: debe salir Felipe con 5 permisos.
select usuario_nombre as persona, count(*) as permisos, string_agg(permiso, ', ' order by permiso) as cuales
  from permisos_excepciones
 where tipo = 'extra' and usuario_nombre ilike 'felipe%'
   and (permiso = 'operaciones.ver' or permiso like 'operaciones.producto.%')
 group by usuario_nombre;
