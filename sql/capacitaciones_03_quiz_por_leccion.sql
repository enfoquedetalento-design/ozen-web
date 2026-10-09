-- ════════════════════════════════════════════════════════════════════════════
-- Capacitaciones · parte 3: quiz por lección, desbloqueo en orden, preguntas de varias
-- respuestas, preguntas con imagen y explicación.
-- Correr DESPUÉS de capacitaciones.sql (y de capacitaciones_02_presentaciones.sql).
-- Solo agrega columnas y un espacio nuevo para imágenes: no borra ni cambia datos existentes.
-- Se puede correr más de una vez sin dañar nada.
-- ════════════════════════════════════════════════════════════════════════════

-- Cursos: si las lecciones se desbloquean en orden (por defecto sí).
alter table capacitacion_cursos add column if not exists en_orden boolean not null default true;

-- Preguntas: a qué lección pertenecen (vacío = quiz final del curso), tipo, varias correctas,
-- imagen y explicación.
alter table capacitacion_preguntas add column if not exists leccion_id uuid references capacitacion_lecciones(id) on delete cascade;
alter table capacitacion_preguntas add column if not exists tipo text not null default 'unica';
alter table capacitacion_preguntas drop constraint if exists capacitacion_preguntas_tipo_check;
alter table capacitacion_preguntas add constraint capacitacion_preguntas_tipo_check check (tipo in ('unica','multiple'));
alter table capacitacion_preguntas add column if not exists respuestas_correctas jsonb;   -- solo para tipo 'multiple': [0, 2, 4]
alter table capacitacion_preguntas add column if not exists imagen_url  text;
alter table capacitacion_preguntas add column if not exists imagen_path text;
alter table capacitacion_preguntas add column if not exists explicacion text;
create index if not exists capacitacion_preguntas_leccion_idx on capacitacion_preguntas(leccion_id);

-- Intentos: de qué quiz fue el intento (vacío = quiz final). Una lección con intentos no se puede
-- borrar, para no perder ese historial.
alter table capacitacion_intentos add column if not exists leccion_id uuid references capacitacion_lecciones(id) on delete restrict;
create index if not exists capacitacion_intentos_leccion_idx on capacitacion_intentos(leccion_id);

-- Espacio para las imágenes de las preguntas: público para lectura, máx. 5 MB, solo imágenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capacitacion-imagenes', 'capacitacion-imagenes', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "cap_img_leer"   on storage.objects;
drop policy if exists "cap_img_subir"  on storage.objects;
drop policy if exists "cap_img_borrar" on storage.objects;
create policy "cap_img_leer"   on storage.objects for select to anon, authenticated using (bucket_id = 'capacitacion-imagenes');
create policy "cap_img_subir"  on storage.objects for insert to anon, authenticated with check (bucket_id = 'capacitacion-imagenes');
create policy "cap_img_borrar" on storage.objects for delete to anon, authenticated using (bucket_id = 'capacitacion-imagenes');
