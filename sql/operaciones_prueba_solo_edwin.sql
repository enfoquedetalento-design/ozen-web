-- ════════════════════════════════════════════════════════
-- Operaciones en la REAL, solo para Master y Edwin (prueba antes de abrirlo a todos) — 18 nov 2026
-- Correr en la base REAL (proyecto OZEN) ANTES de publicar el código de Operaciones.
--
-- Deja el permiso "Entrar a Operaciones" (operaciones.ver) SOLO para el rol Master y le da a Edwin
-- una excepción personal ("extra"). Así, al publicar, nadie más ve el módulo: ni los otros admins,
-- ni el Visualizador, ni las cuentas de tienda (tampoco los avisos de la campana de Registrar venta).
-- No toca ningún otro permiso. Se puede correr más de una vez.
--
-- Para ABRIRLO A TODOS cuando Edwin lo apruebe: Usuarios → Permisos → Roles → Operaciones →
-- "Entrar a Operaciones y ver las órdenes", y prenderlo para Administrador, Admin Finanzas,
-- Admin Turnos, Visualizador y Tienda (la excepción de Edwin se puede dejar o quitar).
-- ════════════════════════════════════════════════════════

-- 1) "Entrar a Operaciones": solo el rol Master (se borran otras filas de ese permiso, si las hay).
delete from permisos_roles where permiso = 'operaciones.ver' and rol <> 'master';
insert into permisos_roles (permiso, rol, condicion, actualizado_por)
values ('operaciones.ver', 'master', null, 'Santiago (prueba de Operaciones)')
on conflict (permiso, rol) do nothing;

-- 2) Excepción personal para Edwin (cuenta activa cuyo nombre empieza por "Edwin").
insert into permisos_excepciones (usuario_id, usuario_nombre, permiso, tipo, motivo, creado_por)
select id::text, name, 'operaciones.ver', 'extra', 'Prueba de Operaciones antes de abrirlo a todos', 'Santiago'
  from usuarios where name ilike 'edwin%' and active is not false
on conflict (usuario_id, permiso) do nothing;

-- 3) Rastro en el historial de Permisos.
insert into permisos_historial (hecho_por, accion, permiso, motivo)
values ('Santiago', 'prueba_operaciones', 'operaciones.ver', 'Operaciones visible solo para Master y Edwin mientras Edwin lo aprueba');

-- Comprobación: debe salir el rol master y UNA persona (Edwin). Si sale más de una persona o
-- ninguna, avisar antes de publicar.
select 'rol' as tipo, rol as quien from permisos_roles where permiso = 'operaciones.ver'
union all
select 'persona', usuario_nombre from permisos_excepciones where permiso = 'operaciones.ver' and tipo = 'extra';
