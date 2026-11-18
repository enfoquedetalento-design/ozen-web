-- Operaciones · Producto (generador de etiquetas) — reemplaza el Excel "Modelo Pricing".
-- Correr UNA vez en Supabase (primero en PRÁCTICA, ozen-staging). Se puede volver a correr: no borra nada.
--
-- producto_codex      = hoja Codex: cada opción (línea, categoría, proveedor, material, modelo, tamaño,
--                       talla, grosor, motivo) con su código y su valor en pesos (o factor en categoría).
-- producto_productos  = un PLU por referencia (como en el Excel: el PLU va por referencia, el prefijo
--                       de la etiqueta es el código del proveedor).
-- producto_lotes      = cada lote de etiquetas que se genera (normalmente un pedido, ej. P1126-1).
-- producto_entradas   = cada fila del lote (lo que en el Excel es una fila del Consolidado), con su
--                       reparto por tienda.

create table if not exists producto_codex (
  id              bigint generated always as identity primary key,
  campo           text not null check (campo in ('linea','categoria','proveedor','material_base','material_ad','modelo','tamano','talla','grosor','motivo')),
  nombre          text not null default '',
  codigo          integer not null,
  valor           numeric not null default 0,
  por_costo       boolean not null default false,   -- categoría Golden: el precio sale del costo × factor
  siigo_codigo    text,                             -- solo líneas: con qué producto está creada en Siigo
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_por text,
  actualizado_en  timestamptz,
  unique (campo, codigo)
);

create table if not exists producto_productos (
  id              bigint generated always as identity primary key,
  plu             integer not null unique,
  referencia      text not null,
  partes          jsonb,
  descripcion     text,
  linea           text,
  pdv             integer not null,
  precio_ajustado boolean not null default false,
  motivo_ajuste   text,
  origen          text not null default 'app',
  creado_por      text,
  creado_en       timestamptz not null default now(),
  actualizado_por text,
  actualizado_en  timestamptz
);
create index if not exists producto_productos_ref on producto_productos (referencia);

create table if not exists producto_lotes (
  id               bigint generated always as identity primary key,
  pedido           text,
  notas            text,
  origen           text not null default 'app',
  estado           text not null default 'activo' check (estado in ('activo','anulado')),
  motivo_anulacion text,
  anulado_por      text,
  anulado_en       timestamptz,
  creado_por       text,
  creado_en        timestamptz not null default now()
);

create table if not exists producto_entradas (
  id              bigint generated always as identity primary key,
  lote_id         bigint not null references producto_lotes(id),
  plu             integer not null,
  prov_codigo     integer,
  codigo_etiqueta text,
  cantidad        integer not null default 0,
  pdc             numeric,
  pdv             integer,
  reparto         jsonb not null default '{}'::jsonb,
  ref_proveedor   text,
  pedido_excel    text,
  creado_en       timestamptz not null default now()
);
create index if not exists producto_entradas_lote on producto_entradas (lote_id);
create index if not exists producto_entradas_plu  on producto_entradas (plu);

alter table producto_codex     enable row level security;
alter table producto_productos enable row level security;
alter table producto_lotes     enable row level security;
alter table producto_entradas  enable row level security;

drop policy if exists "producto_codex_leer"      on producto_codex;
drop policy if exists "producto_codex_agregar"   on producto_codex;
drop policy if exists "producto_codex_cambiar"   on producto_codex;
drop policy if exists "producto_prod_leer"       on producto_productos;
drop policy if exists "producto_prod_agregar"    on producto_productos;
drop policy if exists "producto_prod_cambiar"    on producto_productos;
drop policy if exists "producto_lotes_leer"      on producto_lotes;
drop policy if exists "producto_lotes_agregar"   on producto_lotes;
drop policy if exists "producto_lotes_cambiar"   on producto_lotes;
drop policy if exists "producto_ent_leer"        on producto_entradas;
drop policy if exists "producto_ent_agregar"     on producto_entradas;

-- Igual que el resto de Operaciones: leer, agregar y cambiar; nada se borra desde la app.
create policy "producto_codex_leer"    on producto_codex     for select to anon, authenticated using (true);
create policy "producto_codex_agregar" on producto_codex     for insert to anon, authenticated with check (true);
create policy "producto_codex_cambiar" on producto_codex     for update to anon, authenticated using (true) with check (true);
create policy "producto_prod_leer"     on producto_productos for select to anon, authenticated using (true);
create policy "producto_prod_agregar"  on producto_productos for insert to anon, authenticated with check (true);
create policy "producto_prod_cambiar"  on producto_productos for update to anon, authenticated using (true) with check (true);
create policy "producto_lotes_leer"    on producto_lotes     for select to anon, authenticated using (true);
create policy "producto_lotes_agregar" on producto_lotes     for insert to anon, authenticated with check (true);
create policy "producto_lotes_cambiar" on producto_lotes     for update to anon, authenticated using (true) with check (true);
create policy "producto_ent_leer"      on producto_entradas  for select to anon, authenticated using (true);
create policy "producto_ent_agregar"   on producto_entradas  for insert to anon, authenticated with check (true);

-- Guardar un lote completo de una sola vez. Aquí (y no en la página) se decide el PLU, con la tabla
-- bloqueada mientras tanto: así dos personas guardando al mismo tiempo nunca reciben el mismo PLU.
--   p = { pedido, notas, creado_por, items:[{ referencia, partes, descripcion, linea, prov_codigo,
--         cantidad, pdc, pdv, precio_ajustado, motivo_ajuste, actualizar_precio, reparto, ref_proveedor }] }
-- Si la referencia ya existe, se usa su PLU (el más antiguo, como el BUSCARX del Excel) y su precio;
-- solo cambia el precio si el item trae actualizar_precio = true.
create or replace function producto_guardar_lote(p jsonb) returns bigint
language plpgsql as $$
declare
  v_lote bigint;
  it     jsonb;
  v_plu  integer;
  v_pdv  integer;
begin
  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then
    raise exception 'El lote no tiene productos';
  end if;
  perform pg_advisory_xact_lock(7305001);  -- una sola persona asignando PLU a la vez
  insert into producto_lotes (pedido, notas, origen, creado_por)
    values (nullif(trim(p->>'pedido'),''), nullif(trim(p->>'notas'),''), 'app', p->>'creado_por')
    returning id into v_lote;
  for it in select * from jsonb_array_elements(p->'items') loop
    select plu, pdv into v_plu, v_pdv from producto_productos
      where referencia = it->>'referencia' order by id limit 1;
    if v_plu is null then
      select coalesce(max(plu), 999) + 1 into v_plu from producto_productos;
      v_pdv := (it->>'pdv')::integer;
      insert into producto_productos (plu, referencia, partes, descripcion, linea, pdv, precio_ajustado, motivo_ajuste, origen, creado_por)
        values (v_plu, it->>'referencia', it->'partes', it->>'descripcion', it->>'linea', v_pdv,
                coalesce((it->>'precio_ajustado')::boolean, false), nullif(it->>'motivo_ajuste',''), 'app', p->>'creado_por');
    elsif coalesce((it->>'actualizar_precio')::boolean, false) then
      v_pdv := (it->>'pdv')::integer;
      update producto_productos set pdv = v_pdv, precio_ajustado = coalesce((it->>'precio_ajustado')::boolean, false),
             motivo_ajuste = nullif(it->>'motivo_ajuste',''), actualizado_por = p->>'creado_por', actualizado_en = now()
        where plu = v_plu;
    end if;
    insert into producto_entradas (lote_id, plu, prov_codigo, codigo_etiqueta, cantidad, pdc, pdv, reparto, ref_proveedor)
      values (v_lote, v_plu, (it->>'prov_codigo')::integer, (it->>'prov_codigo') || v_plu::text,
              (it->>'cantidad')::integer, nullif(it->>'pdc','')::numeric, v_pdv,
              coalesce(it->'reparto','{}'::jsonb), nullif(it->>'ref_proveedor',''));
  end loop;
  return v_lote;
end $$;

grant execute on function producto_guardar_lote(jsonb) to anon, authenticated;
