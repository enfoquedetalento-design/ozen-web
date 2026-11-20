-- Pasar un producto de un Flexipago a un Flexipago nuevo (20 nov 2026, pedido de Santiago).
-- Se puede correr varias veces. Correr primero en PRÁCTICA (staging) y, cuando Santiago apruebe,
-- en la REAL antes de subir el código a main.
--
-- 1) Constancia en la venta original: lista de productos que salieron, con fecha, valor, quién, a
--    qué Flexipago nuevo y cuánto se trasladó. La app la usa para que los días ANTERIORES a la
--    separación sigan viendo el valor de antes (así ningún abono viejo "completa" el Flexipago).
alter table ventas add column if not exists flexipago_separaciones jsonb;

-- 2) Todo el paso en UNA sola transacción: o queda completo o no queda nada.
--    - El Flexipago original baja su valor en lo que vale el producto (renglón, total, valor_original).
--    - Se crea el Flexipago nuevo: mismo cliente, tienda y asesor, con ese producto.
--    - Si lo abonado ya alcanza para lo que queda: el original se cierra ese día con un abono
--      "traslado" de -sobrante, y el nuevo recibe un abono "traslado" de +sobrante (no es plata
--      nueva: Caja y efectivo no lo cuentan como ingreso).
create or replace function flexipago_pasar_producto(p_venta_id text, p_indice int, p_por text, p_fecha date)
returns jsonb
language plpgsql
as $$
declare
  v ventas%rowtype;
  it ventas_items%rowtype;
  nueva ventas%rowtype;
  n_items int;
  prod jsonb;
  r numeric;
  valor_neto numeric;
  abonado numeric;
  valor_nuevo numeric;
  sobrante numeric := 0;
  se_cierra boolean := false;
  codigos_restantes jsonb;
begin
  select * into v from ventas where id::text = p_venta_id for update;
  if not found then raise exception 'No se encontró la venta.'; end if;
  if not coalesce(v.es_flexipago, false) then raise exception 'Esta venta no es un Flexipago.'; end if;

  select count(*) into n_items from ventas_items where venta_id = v.id and tipo = 'flexipago';
  if n_items <> 1 then raise exception 'El Flexipago debe tener un solo renglón de Flexipago (tiene %).', n_items; end if;
  select * into it from ventas_items where venta_id = v.id and tipo = 'flexipago' for update;

  if jsonb_typeof(it.codigos_producto) is distinct from 'array' or jsonb_array_length(it.codigos_producto) < 2 then
    raise exception 'El Flexipago necesita al menos dos productos para poder pasar uno.';
  end if;
  if p_indice < 0 or p_indice >= jsonb_array_length(it.codigos_producto) then raise exception 'Producto no válido.'; end if;

  prod := it.codigos_producto -> p_indice;
  r := coalesce(nullif(regexp_replace(coalesce(prod->>'valor', ''), '[^0-9]', '', 'g'), '')::numeric, 0);
  if r <= 0 then raise exception 'Ese producto no tiene valor.'; end if;

  valor_neto := coalesce(it.valor, 0) - coalesce(it.descuento, 0);
  select coalesce(sum(valor), 0) into abonado from ventas_abonos where venta_id = v.id;
  if abonado >= valor_neto then raise exception 'Este Flexipago ya está pagado completo.'; end if;
  valor_nuevo := valor_neto - r;
  if valor_nuevo <= 0 then raise exception 'El Flexipago original quedaría sin valor.'; end if;
  if abonado >= valor_nuevo then se_cierra := true; sobrante := abonado - valor_nuevo; end if;

  select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into codigos_restantes
    from jsonb_array_elements(it.codigos_producto) with ordinality as t(e, o)
    where o - 1 <> p_indice;

  insert into ventas (fecha, numero_factura, tienda_id, vendedor_id, vendedor_nombre, registrado_por,
                      cliente_tipo_doc, cliente_documento, cliente_nombre, cliente_telefono, observacion,
                      valor_bruto, descuento_total, total, valor_original, es_flexipago)
  values (p_fecha, null, v.tienda_id, v.vendedor_id, v.vendedor_nombre, p_por,
          v.cliente_tipo_doc, v.cliente_documento, v.cliente_nombre, v.cliente_telefono,
          'Producto pasado desde el Flexipago del ' || v.fecha::text || coalesce(' (factura ' || v.numero_factura || ')', ''),
          r, 0, r, r, true)
  returning * into nueva;

  insert into ventas_items (venta_id, tipo, valor, descuento, codigos_producto)
  values (nueva.id, 'flexipago', r, 0, jsonb_build_array(prod));

  update ventas_items set valor = valor - r, codigos_producto = codigos_restantes where id = it.id;

  update ventas set
    total = coalesce(total, 0) - r,
    valor_bruto = coalesce(valor_bruto, total, 0) - r,
    valor_original = coalesce(valor_original, total, 0) - r,
    flexipago_separaciones = coalesce(flexipago_separaciones, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'fecha', p_fecha, 'en', now(), 'valor', r, 'codigo', prod->>'codigo', 'por', p_por,
      'venta_nueva_id', nueva.id, 'traslado', sobrante, 'se_cerro', se_cierra)),
    updated_at = now()
  where id = v.id;

  if se_cierra then
    insert into ventas_abonos (venta_id, fecha, valor, registrado_por, medio_pago)
    values (v.id, p_fecha, -sobrante, p_por, 'traslado');
    if sobrante > 0 then
      insert into ventas_abonos (venta_id, fecha, valor, registrado_por, medio_pago)
      values (nueva.id, p_fecha, sobrante, p_por, 'traslado');
    end if;
  end if;

  return jsonb_build_object('venta_nueva_id', nueva.id, 'valor_producto', r, 'valor_nuevo', valor_nuevo,
                            'abonado', abonado, 'traslado', sobrante, 'se_cerro', se_cierra);
end;
$$;

grant execute on function flexipago_pasar_producto(text, int, text, date) to anon, authenticated;

-- Revisión: debe salir 1 fila con la columna y 1 con la función.
select 'columna' as que, column_name as nombre from information_schema.columns
  where table_name = 'ventas' and column_name = 'flexipago_separaciones'
union all
select 'funcion', proname from pg_proc where proname = 'flexipago_pasar_producto';
