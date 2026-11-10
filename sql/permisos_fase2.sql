-- ════════════════════════════════════════════════════════
-- Módulo "Permisos" — Fase 2: tablas de permisos + dos mejoras de La Junta
-- Correr PRIMERO en Supabase de PRÁCTICA (ozen-staging). Después, cuando Santiago
-- lo apruebe, en la REAL (OZEN). Solo crea cosas nuevas: no borra ni cambia ningún
-- dato existente. Se puede correr más de una vez sin dañar nada.
--
-- OJO: la lista del punto 6 se genera desde PERMISOS (src/App.jsx). Si se agrega o
-- cambia un permiso en el código, hay que regenerar este archivo; el tablero de
-- Permisos avisa cuando la tabla y el código dejan de coincidir.
-- ════════════════════════════════════════════════════════

-- 1) Qué permiso tiene cada rol. Una fila = ese rol SÍ tiene ese permiso.
--    condicion vacía = siempre; con texto = solo con esa condición ("solo hoy", "su tienda"...).
create table if not exists permisos_roles (
  permiso          text not null,
  rol              text not null,
  condicion        text,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  text,
  primary key (permiso, rol)
);

-- 2) Excepciones por persona: darle algo extra a alguien, o quitarle algo de su rol.
--    usuario_id va como texto y sin relación a "usuarios" a propósito (igual que en
--    capacitaciones): así borrar o desactivar un usuario nunca borra ni bloquea nada.
create table if not exists permisos_excepciones (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      text not null,
  usuario_nombre  text,
  permiso         text not null,
  tipo            text not null check (tipo in ('extra','quitado')),
  condicion       text,
  motivo          text,
  creado_por      text,
  created_at      timestamptz not null default now(),
  unique (usuario_id, permiso)
);

-- 3) Historial: quién cambió qué y cuándo. Solo se agrega; nunca se edita ni se borra.
create table if not exists permisos_historial (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  hecho_por       text,
  hecho_por_id    text,
  accion          text not null,
  permiso         text,
  rol             text,
  usuario_id      text,
  usuario_nombre  text,
  antes           jsonb,
  despues         jsonb,
  motivo          text
);
create index if not exists permisos_historial_fecha_idx on permisos_historial (created_at desc);

-- 4) La Junta: enlazar cada líder con su cuenta (en vez de comparar nombres), y que el
--    monitor pueda PEDIR que se borre una tarea vencida o cumplida para que master apruebe.
alter table junta_lideres      add column if not exists usuario_id text;
alter table junta_compromisos  add column if not exists borrado_solicitado_por text;
alter table junta_compromisos  add column if not exists borrado_solicitado_en  timestamptz;

-- 5) Acceso desde la app (mismo esquema que el resto de tablas del proyecto).
alter table permisos_roles         enable row level security;
alter table permisos_excepciones   enable row level security;
alter table permisos_historial     enable row level security;

drop policy if exists "permisos_roles_todo"         on permisos_roles;
drop policy if exists "permisos_excepciones_todo"   on permisos_excepciones;
drop policy if exists "permisos_historial_leer"     on permisos_historial;
drop policy if exists "permisos_historial_agregar"  on permisos_historial;

create policy "permisos_roles_todo"         on permisos_roles        for all    to anon, authenticated using (true) with check (true);
create policy "permisos_excepciones_todo"   on permisos_excepciones  for all    to anon, authenticated using (true) with check (true);
create policy "permisos_historial_leer"     on permisos_historial    for select to anon, authenticated using (true);
create policy "permisos_historial_agregar"  on permisos_historial    for insert to anon, authenticated with check (true);

-- 6) Siembra: EXACTAMENTE lo que hoy hace el código (61 permisos, 200 filas).
--    Si una fila ya existe no la toca, así no pisa cambios hechos después desde el tablero.
insert into permisos_roles (permiso, rol, condicion) values
  ('ventas.registrar.ver', 'master', null),
  ('ventas.registrar.ver', 'admin', 'solo ver'),
  ('ventas.registrar.ver', 'admin_finanzas', null),
  ('ventas.registrar.ver', 'admin_turnos', 'solo ver'),
  ('ventas.registrar.ver', 'visualizador', 'solo ver'),
  ('ventas.registrar.ver', 'tienda', 'su tienda'),
  ('ventas.registrar.guardar', 'master', null),
  ('ventas.registrar.guardar', 'admin_finanzas', null),
  ('ventas.registrar.guardar', 'tienda', 'su tienda'),
  ('ventas.fecha_libre', 'master', null),
  ('ventas.fecha_libre', 'admin_finanzas', null),
  ('ventas.vendedor', 'master', null),
  ('ventas.vendedor', 'admin', null),
  ('ventas.vendedor', 'admin_finanzas', null),
  ('ventas.vendedor', 'admin_turnos', null),
  ('ventas.vendedor', 'advisor', null),
  ('ventas.lista.ver', 'master', null),
  ('ventas.lista.ver', 'admin', null),
  ('ventas.lista.ver', 'admin_finanzas', null),
  ('ventas.lista.ver', 'admin_turnos', null),
  ('ventas.lista.ver', 'visualizador', null),
  ('ventas.lista.ver', 'tienda', 'su tienda'),
  ('ventas.abono.registrar', 'master', null),
  ('ventas.abono.registrar', 'admin_finanzas', null),
  ('ventas.abono.registrar', 'tienda', 'su tienda'),
  ('ventas.abono.corregir', 'master', null),
  ('ventas.abono.corregir', 'admin_finanzas', null),
  ('ventas.flexipago.reabrir', 'master', null),
  ('ventas.flexipago.reabrir', 'admin_finanzas', null),
  ('ventas.notacredito.hacer', 'master', null),
  ('ventas.notacredito.hacer', 'admin_finanzas', null),
  ('ventas.factura.corregir', 'master', null),
  ('ventas.factura.corregir', 'admin_finanzas', null),
  ('ventas.factura.corregir', 'tienda', 'solo hoy'),
  ('ventas.eliminar', 'master', null),
  ('ventas.eliminar', 'admin_finanzas', null),
  ('ventas.eliminar', 'tienda', 'solo hoy'),
  ('ventas.correccion.solicitar', 'tienda', 'días anteriores'),
  ('ventas.correccion.resolver', 'master', null),
  ('ventas.correccion.resolver', 'admin_finanzas', null),
  ('ventas.correccion.aplicar', 'master', 'con aprobación'),
  ('ventas.correccion.aplicar', 'admin_finanzas', 'con aprobación'),
  ('ventas.correccion.aplicar', 'tienda', 'con aprobación'),
  ('ventas.metricas.ver', 'master', null),
  ('ventas.metricas.ver', 'admin', null),
  ('ventas.metricas.ver', 'admin_finanzas', null),
  ('ventas.metricas.ver', 'admin_turnos', null),
  ('ventas.metricas.ver', 'visualizador', null),
  ('ventas.metricas.ver', 'tienda', null),
  ('ventas.metricas.consultas', 'master', null),
  ('ventas.metricas.consultas', 'admin', null),
  ('ventas.metricas.consultas', 'admin_finanzas', null),
  ('ventas.metricas.consultas', 'admin_turnos', null),
  ('ventas.metricas.consultas', 'visualizador', null),
  ('ventas.metas.asignar', 'master', null),
  ('ventas.metas.asignar', 'admin_finanzas', null),
  ('caja.ver', 'master', null),
  ('caja.ver', 'admin', null),
  ('caja.ver', 'admin_finanzas', null),
  ('caja.ver', 'admin_turnos', null),
  ('caja.ver', 'visualizador', null),
  ('caja.ver', 'tienda', 'su tienda'),
  ('caja.registrar', 'master', null),
  ('caja.registrar', 'admin_finanzas', null),
  ('caja.registrar', 'tienda', 'su tienda, hoy'),
  ('caja.fecha_libre', 'master', null),
  ('caja.fecha_libre', 'admin_finanzas', null),
  ('caja.recoleccion.registrar', 'master', null),
  ('caja.recoleccion.registrar', 'admin_finanzas', null),
  ('caja.recoleccion.registrar', 'tienda', 'su tienda'),
  ('caja.recoleccion.recibir', 'master', null),
  ('caja.recoleccion.recibir', 'admin', null),
  ('caja.recoleccion.recibir', 'admin_finanzas', null),
  ('caja.recoleccion.recibir', 'admin_turnos', null),
  ('caja.novedad.aprobar', 'master', null),
  ('caja.novedad.aprobar', 'admin_finanzas', null),
  ('caja.novedad.editar', 'master', null),
  ('caja.novedad.editar', 'admin_finanzas', null),
  ('caja.novedad.editar', 'tienda', 'solo hoy'),
  ('caja.borrar', 'master', null),
  ('caja.borrar', 'admin_finanzas', null),
  ('caja.borrado.solicitar', 'tienda', null),
  ('caja.borrado.resolver', 'master', null),
  ('caja.borrado.resolver', 'admin_finanzas', null),
  ('caja.detalle_calculo', 'master', null),
  ('caja.detalle_calculo', 'admin_finanzas', null),
  ('asistencia.marcar', 'master', null),
  ('asistencia.marcar', 'admin', null),
  ('asistencia.marcar', 'admin_finanzas', null),
  ('asistencia.marcar', 'admin_turnos', null),
  ('asistencia.marcar', 'visualizador', null),
  ('asistencia.marcar', 'advisor', null),
  ('asistencia.historial', 'master', null),
  ('asistencia.historial', 'admin', null),
  ('asistencia.historial', 'admin_finanzas', null),
  ('asistencia.historial', 'admin_turnos', null),
  ('asistencia.historial', 'visualizador', null),
  ('asistencia.historial', 'advisor', null),
  ('asistencia.panel', 'master', null),
  ('asistencia.panel', 'admin', null),
  ('asistencia.panel', 'admin_finanzas', null),
  ('asistencia.panel', 'admin_turnos', null),
  ('asistencia.panel', 'visualizador', null),
  ('asistencia.registros.ver', 'master', null),
  ('asistencia.registros.ver', 'admin', null),
  ('asistencia.registros.ver', 'admin_finanzas', null),
  ('asistencia.registros.ver', 'admin_turnos', null),
  ('asistencia.registros.ver', 'visualizador', null),
  ('asistencia.registros.corregir', 'master', null),
  ('asistencia.informes', 'master', null),
  ('asistencia.informes', 'admin', null),
  ('asistencia.informes', 'admin_finanzas', null),
  ('asistencia.informes', 'admin_turnos', null),
  ('asistencia.informes', 'visualizador', null),
  ('asistencia.avisos', 'master', null),
  ('asistencia.avisos', 'admin_turnos', null),
  ('turnos.ver', 'master', null),
  ('turnos.ver', 'admin', null),
  ('turnos.ver', 'admin_finanzas', null),
  ('turnos.ver', 'admin_turnos', null),
  ('turnos.ver', 'visualizador', null),
  ('turnos.ver', 'advisor', null),
  ('turnos.ver', 'tienda', null),
  ('turnos.editar', 'master', null),
  ('turnos.editar', 'admin_turnos', null),
  ('turnos.publicar', 'master', null),
  ('turnos.publicar', 'admin_turnos', null),
  ('turnos.asesores', 'master', null),
  ('turnos.asesores', 'admin_turnos', null),
  ('turnos.tiendas', 'master', null),
  ('turnos.tiendas', 'admin_turnos', null),
  ('turnos.especiales', 'master', null),
  ('turnos.especiales', 'admin_turnos', null),
  ('turnos.horarios', 'master', null),
  ('turnos.horarios', 'admin_turnos', null),
  ('turnos.malla_activos', 'master', null),
  ('turnos.malla_activos', 'admin_turnos', null),
  ('junta.ver', 'master', null),
  ('junta.ver', 'admin', null),
  ('junta.ver', 'admin_finanzas', null),
  ('junta.ver', 'admin_turnos', null),
  ('junta.ver', 'visualizador', null),
  ('junta.tareas.gestionar', 'master', null),
  ('junta.tareas.gestionar', 'admin', 'si es Monitor'),
  ('junta.tareas.gestionar', 'admin_finanzas', 'si es Monitor'),
  ('junta.tareas.gestionar', 'admin_turnos', 'si es Monitor'),
  ('junta.tareas.borrar', 'master', null),
  ('junta.tareas.borrar', 'admin', 'si es Monitor'),
  ('junta.tareas.borrar', 'admin_finanzas', 'si es Monitor'),
  ('junta.tareas.borrar', 'admin_turnos', 'si es Monitor'),
  ('junta.tareas.borrado.solicitar', 'admin', 'si es Monitor'),
  ('junta.tareas.borrado.solicitar', 'admin_finanzas', 'si es Monitor'),
  ('junta.tareas.borrado.solicitar', 'admin_turnos', 'si es Monitor'),
  ('junta.tareas.borrado.resolver', 'master', null),
  ('junta.tareas.autorreportar', 'admin', 'si es su tarea'),
  ('junta.tareas.autorreportar', 'admin_finanzas', 'si es su tarea'),
  ('junta.tareas.autorreportar', 'admin_turnos', 'si es su tarea'),
  ('junta.tareas.comentar', 'master', null),
  ('junta.tareas.comentar', 'admin', null),
  ('junta.tareas.comentar', 'admin_finanzas', null),
  ('junta.tareas.comentar', 'admin_turnos', null),
  ('junta.acuerdos.crear', 'master', null),
  ('junta.acuerdos.crear', 'admin', null),
  ('junta.acuerdos.crear', 'admin_finanzas', null),
  ('junta.acuerdos.crear', 'admin_turnos', null),
  ('junta.equipo.editar', 'master', null),
  ('junta.equipo.editar', 'admin', null),
  ('junta.equipo.editar', 'admin_finanzas', null),
  ('junta.equipo.editar', 'admin_turnos', null),
  ('junta.indicadores.congelar', 'master', null),
  ('escuela.cursar', 'master', null),
  ('escuela.cursar', 'admin', null),
  ('escuela.cursar', 'admin_finanzas', null),
  ('escuela.cursar', 'admin_turnos', null),
  ('escuela.cursar', 'advisor', null),
  ('escuela.progreso', 'master', null),
  ('escuela.progreso', 'admin', null),
  ('escuela.progreso', 'admin_finanzas', null),
  ('escuela.progreso', 'admin_turnos', null),
  ('escuela.progreso', 'visualizador', null),
  ('escuela.administrar', 'master', null),
  ('escuela.administrar', 'admin', null),
  ('escuela.administrar', 'admin_finanzas', null),
  ('escuela.administrar', 'admin_turnos', null),
  ('cuenta.usuarios', 'master', null),
  ('cuenta.permisos', 'master', null),
  ('cuenta.acceso_tiendas', 'master', 'desde Usuarios'),
  ('cuenta.acceso_tiendas', 'admin_finanzas', null),
  ('cuenta.firmar', 'master', null),
  ('cuenta.firmar', 'admin', null),
  ('cuenta.firmar', 'admin_finanzas', null),
  ('cuenta.firmar', 'admin_turnos', null),
  ('cuenta.firmar', 'visualizador', null),
  ('cuenta.firmar', 'advisor', null),
  ('cuenta.password', 'master', 'desde Usuarios'),
  ('cuenta.password', 'admin', null),
  ('cuenta.password', 'admin_finanzas', null),
  ('cuenta.password', 'admin_turnos', null),
  ('cuenta.password', 'visualizador', null),
  ('cuenta.password', 'advisor', null)
on conflict (permiso, rol) do nothing;

-- 7) Comprobación: debe decir 200.
select count(*) as filas_sembradas from permisos_roles;
