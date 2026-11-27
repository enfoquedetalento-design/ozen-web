-- Historial de ventas de los Excel (jul 2021 – jul 2026), para Consultas. 27 nov 2026.
-- Tabla aparte: NO toca ventas, Caja, Lista ni Flexipagos. Agrupada por día, tienda, asesor, tipo y
-- medio de pago; "n" = cuántas ventas fueron. tipo: producto | flexipago (se terminó de pagar con lo
-- separado) | abono_sep | arreglo | marcacion | grabado | bono (NC/bono: solo descuento) | otro.
-- asesor_id se llena solo con el usuario de la página que tenga el mismo nombre (si sigue).
-- Se puede correr varias veces. Correr primero en STAGING y después en PRODUCCIÓN.
create table if not exists ventas_historico (
  id          bigint generated always as identity primary key,
  fecha       date not null,
  tienda_id   text not null,
  asesor      text,
  asesor_id   text,
  tipo        text not null,
  medio       text,
  compartida  boolean not null default false,   -- venta de "Edwin y David" repartida
  valor       numeric not null default 0,
  descuento   numeric not null default 0,
  n           integer not null default 0,
  origen      text default 'excel'
);
create index if not exists ventas_historico_fecha_idx on ventas_historico (fecha);
alter table ventas_historico enable row level security;
drop policy if exists "vh_leer" on ventas_historico;
create policy "vh_leer" on ventas_historico for select to anon, authenticated using (true);
-- Revisión: debe salir 0 la primera vez (después de cargar las partes, ~12.500).
select count(*) as filas from ventas_historico;
