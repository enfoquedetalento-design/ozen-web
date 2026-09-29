-- ════════════════════════════════════════════════════════════════════════════
-- Módulo "Inducciones y capacitaciones" — tablas nuevas + espacio para PDFs
-- Correr PRIMERO en Supabase de PRÁCTICA (ozen-staging). Solo crea cosas nuevas:
-- no modifica ni borra ninguna tabla existente. Se puede correr más de una vez
-- sin dañar nada (usa "if not exists").
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Cursos
create table if not exists capacitacion_cursos (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  descripcion     text,
  orden           int  not null default 0,
  puntaje_minimo  int  not null default 80 check (puntaje_minimo between 1 and 100),
  activo          boolean not null default true,   -- false = archivado (no se borra)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 2) Lecciones de cada curso (video por link, PDF subido o texto)
create table if not exists capacitacion_lecciones (
  id          uuid primary key default gen_random_uuid(),
  curso_id    uuid not null references capacitacion_cursos(id) on delete cascade,
  orden       int  not null default 0,
  titulo      text not null,
  tipo        text not null check (tipo in ('video','pdf','texto')),
  url         text,           -- link del video, o URL pública del PDF subido
  pdf_path    text,           -- ruta del PDF dentro del espacio capacitacion-pdfs
  contenido   text,           -- texto de la lección (o nota que acompaña al video/PDF)
  created_at  timestamptz not null default now()
);

-- 3) Preguntas del quiz de cada curso (opción múltiple, una correcta)
create table if not exists capacitacion_preguntas (
  id                uuid primary key default gen_random_uuid(),
  curso_id          uuid not null references capacitacion_cursos(id) on delete cascade,
  orden             int  not null default 0,
  enunciado         text not null,
  opciones          jsonb not null,          -- lista de textos: ["opción A","opción B",...]
  respuesta_correcta int not null,           -- posición (0, 1, 2...) de la opción correcta
  created_at        timestamptz not null default now()
);

-- 4) Qué lecciones vio cada persona (una sola vez por persona y lección)
--    usuario_id va como texto y sin relación a "usuarios" a propósito: así borrar o
--    desactivar un usuario nunca borra (ni bloquea) su historial de capacitación.
create table if not exists capacitacion_lecciones_vistas (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      text not null,
  usuario_nombre  text,
  leccion_id      uuid not null references capacitacion_lecciones(id) on delete cascade,
  curso_id        uuid not null references capacitacion_cursos(id) on delete restrict,
  created_at      timestamptz not null default now(),
  unique (usuario_id, leccion_id)
);

-- 5) Intentos de quiz (historial completo; la fecha de finalización de un curso es
--    la del primer intento aprobado). Se guarda una copia de preguntas y respuestas,
--    así el historial no cambia aunque después se editen las preguntas.
create table if not exists capacitacion_intentos (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      text not null,
  usuario_nombre  text,
  curso_id        uuid not null references capacitacion_cursos(id) on delete restrict,
  puntaje         int  not null,           -- 0 a 100
  aprobado        boolean not null,
  respuestas      jsonb not null,
  created_at      timestamptz not null default now()
);

create index if not exists capacitacion_lecciones_curso_idx on capacitacion_lecciones(curso_id);
create index if not exists capacitacion_preguntas_curso_idx on capacitacion_preguntas(curso_id);
create index if not exists capacitacion_vistas_usuario_idx  on capacitacion_lecciones_vistas(usuario_id);
create index if not exists capacitacion_intentos_usuario_idx on capacitacion_intentos(usuario_id);

-- ── Seguridad (RLS) ─────────────────────────────────────────────────────────
-- Cursos, lecciones y preguntas: se pueden leer, crear, editar y borrar desde la app.
-- Lecciones vistas e intentos: SOLO leer y agregar — nadie puede modificar ni borrar
-- un intento o una lección vista (igual que los Acuerdos de La Junta).
alter table capacitacion_cursos            enable row level security;
alter table capacitacion_lecciones         enable row level security;
alter table capacitacion_preguntas         enable row level security;
alter table capacitacion_lecciones_vistas  enable row level security;
alter table capacitacion_intentos          enable row level security;

drop policy if exists "cap_cursos_todo"      on capacitacion_cursos;
drop policy if exists "cap_lecciones_todo"   on capacitacion_lecciones;
drop policy if exists "cap_preguntas_todo"   on capacitacion_preguntas;
drop policy if exists "cap_vistas_leer"      on capacitacion_lecciones_vistas;
drop policy if exists "cap_vistas_agregar"   on capacitacion_lecciones_vistas;
drop policy if exists "cap_intentos_leer"    on capacitacion_intentos;
drop policy if exists "cap_intentos_agregar" on capacitacion_intentos;

create policy "cap_cursos_todo"      on capacitacion_cursos    for all to anon, authenticated using (true) with check (true);
create policy "cap_lecciones_todo"   on capacitacion_lecciones for all to anon, authenticated using (true) with check (true);
create policy "cap_preguntas_todo"   on capacitacion_preguntas for all to anon, authenticated using (true) with check (true);
create policy "cap_vistas_leer"      on capacitacion_lecciones_vistas for select to anon, authenticated using (true);
create policy "cap_vistas_agregar"   on capacitacion_lecciones_vistas for insert to anon, authenticated with check (true);
create policy "cap_intentos_leer"    on capacitacion_intentos  for select to anon, authenticated using (true);
create policy "cap_intentos_agregar" on capacitacion_intentos  for insert to anon, authenticated with check (true);

-- ── Espacio para los PDFs (Storage) ─────────────────────────────────────────
-- Público para lectura (el PDF se abre con su link), máximo 50 MB por archivo, solo PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capacitacion-pdfs', 'capacitacion-pdfs', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "cap_pdfs_leer"    on storage.objects;
drop policy if exists "cap_pdfs_subir"   on storage.objects;
drop policy if exists "cap_pdfs_borrar"  on storage.objects;
create policy "cap_pdfs_leer"   on storage.objects for select to anon, authenticated using (bucket_id = 'capacitacion-pdfs');
create policy "cap_pdfs_subir"  on storage.objects for insert to anon, authenticated with check (bucket_id = 'capacitacion-pdfs');
create policy "cap_pdfs_borrar" on storage.objects for delete to anon, authenticated using (bucket_id = 'capacitacion-pdfs');
