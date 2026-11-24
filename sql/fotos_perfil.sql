-- Fotos de perfil (nov 2026, pedido de Santiago): cada persona se toma su foto desde el menú de su
-- cuenta («Mi foto») y sale en un circulito en la barra de arriba, rankings, Ventas por asesor,
-- Hoy en las tiendas, La Junta y Usuarios. Es voluntaria: quien no tenga foto sigue con su inicial.
-- Correr UNA vez en Supabase (SQL Editor), en staging y en producción.

alter table usuarios add column if not exists foto_url text;

-- Espacio aparte de las fotos de asistencia. Público para lectura (la foto se ve con su link),
-- máximo 2 MB por archivo, solo JPG (la app la manda recortada a 320×320, pesa ~20 KB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-perfil', 'fotos-perfil', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "fotos_perfil_leer"   on storage.objects;
drop policy if exists "fotos_perfil_subir"  on storage.objects;
drop policy if exists "fotos_perfil_borrar" on storage.objects;
create policy "fotos_perfil_leer"   on storage.objects for select to anon, authenticated using (bucket_id = 'fotos-perfil');
create policy "fotos_perfil_subir"  on storage.objects for insert to anon, authenticated with check (bucket_id = 'fotos-perfil');
create policy "fotos_perfil_borrar" on storage.objects for delete to anon, authenticated using (bucket_id = 'fotos-perfil');
