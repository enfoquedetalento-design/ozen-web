-- La Junta — reapertura ANTICIPADA (22 nov 2026)
-- Una tarea ACTIVA (todavía no vencida) a la que el Monitor le corre el plazo a una semana posterior
-- queda marcada en su historial (reaperturas) con "anticipada": true. Aunque después se cumpla, ya
-- NO cuenta "a tiempo". Este archivo actualiza el corte automático de medianoche (pg_cron) para que
-- cuente igual que la página (src/App.jsx, tuvoReaperturaTardia).
-- Único cambio frente a la versión anterior: en los dos "tuvo_reapertura_tardia" se agregó
--   (r->>'anticipada') = 'true' or ( ...regla de siempre... )
-- No cambia ninguna tabla ni ningún mes ya congelado. Se puede correr varias veces.
-- Correr en staging y, cuando se apruebe, en producción ANTES de subir el código a main.

create or replace function public.congelar_mes_junta()
 returns void
 language plpgsql
as $function$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_anio int;
  v_mes int; -- 1..12
  v_primer_dia date;
  v_ultimo_dia date;
  v_martes date[];
  v_ultimo_martes date;
  v_limite_real date;
  v_mes_str text;
  v_sesiones int;
  v_total_tareas int;
  v_total_cerradas int;
  v_completadas int;
  v_completadas_a_tiempo int;
  v_pct numeric;
  v_pct_a_tiempo numeric;
  v_por_lider jsonb;
begin
  v_mes := extract(month from v_today)::int - 1;
  v_anio := extract(year from v_today)::int;
  if v_mes = 0 then v_mes := 12; v_anio := v_anio - 1; end if;

  -- Ya existe una foto fija de ese mes (a mano o de una corrida anterior) — nunca se recalcula.
  if exists (select 1 from junta_indicadores_congelados where anio=v_anio and mes=v_mes) then
    return;
  end if;

  v_primer_dia := make_date(v_anio, v_mes, 1);
  v_ultimo_dia := (v_primer_dia + interval '1 month - 1 day')::date;
  select array_agg(d order by d) into v_martes
  from generate_series(v_primer_dia, v_ultimo_dia, interval '1 day') as d
  where extract(dow from d) = 2;

  if v_martes is null or array_length(v_martes,1) is null then
    return; -- no debería pasar nunca, todo mes tiene al menos un martes
  end if;

  v_ultimo_martes := v_martes[array_length(v_martes,1)];
  v_limite_real := v_ultimo_martes + 5; -- domingo de la última semana del mes candidato

  -- El mes candidato todavía no "termina de verdad" (su última semana sigue teniendo plazo).
  if v_today <= v_limite_real then
    return;
  end if;

  v_mes_str := to_char(v_primer_dia, 'YYYY-MM');

  with cerradas as (
    select c.*,
      case
        when c.completado then coalesce(to_char((c.completado_en at time zone 'America/Bogota')::date, 'YYYY-MM'), left(c.semana,7))
        when (not c.completado and c.fecha_estimada is not null and v_today > (c.fecha_estimada::date + 5))
          then coalesce(left(c.fecha_estimada::text,7), left(c.semana,7))
        else null
      end as mes_cierre,
      exists (
        select 1 from jsonb_array_elements(coalesce(c.reaperturas,'[]'::jsonb)) r
        where (r->>'anticipada') = 'true'
          or ((r->>'fecha_anterior') is not null and (r->>'en') is not null
            and ((r->>'en')::timestamptz at time zone 'America/Bogota')::date > ((r->>'fecha_anterior')::date + 5))
      ) as tuvo_reapertura_tardia
    from junta_compromisos c
  ),
  tareas as (
    select * from junta_compromisos c
    where c.semana = any(select to_char(unnest(v_martes), 'YYYY-MM-DD'))
  ),
  cerradas_mes as (
    select * from cerradas where mes_cierre = v_mes_str
  )
  select
    (select count(distinct semana) from tareas),
    (select count(*) from tareas),
    (select count(*) from cerradas_mes),
    (select count(*) from cerradas_mes where completado),
    (select count(*) from cerradas_mes where completado and not tuvo_reapertura_tardia)
  into v_sesiones, v_total_tareas, v_total_cerradas, v_completadas, v_completadas_a_tiempo;

  v_pct := case when v_total_cerradas>0 then round((v_completadas::numeric/v_total_cerradas)*100) else null end;
  v_pct_a_tiempo := case when v_total_cerradas>0 then round((v_completadas_a_tiempo::numeric/v_total_cerradas)*100) else null end;

  with cerradas as (
    select c.*,
      case
        when c.completado then coalesce(to_char((c.completado_en at time zone 'America/Bogota')::date, 'YYYY-MM'), left(c.semana,7))
        when (not c.completado and c.fecha_estimada is not null and v_today > (c.fecha_estimada::date + 5))
          then coalesce(left(c.fecha_estimada::text,7), left(c.semana,7))
        else null
      end as mes_cierre,
      exists (
        select 1 from jsonb_array_elements(coalesce(c.reaperturas,'[]'::jsonb)) r
        where (r->>'anticipada') = 'true'
          or ((r->>'fecha_anterior') is not null and (r->>'en') is not null
            and ((r->>'en')::timestamptz at time zone 'America/Bogota')::date > ((r->>'fecha_anterior')::date + 5))
      ) as tuvo_reapertura_tardia
    from junta_compromisos c
  ),
  tareas as (
    select * from junta_compromisos c
    where c.semana = any(select to_char(unnest(v_martes), 'YYYY-MM-DD'))
  ),
  por_lider as (
    select
      l.id as lider_id, l.nombre,
      count(t.*) filter (where t.id is not null) as total,
      count(cm.*) filter (where cm.completado) as completadas,
      count(cm.*) filter (where cm.completado and not cm.tuvo_reapertura_tardia) as completadas_a_tiempo,
      count(cm.*) as total_cerradas
    from junta_lideres l
    left join tareas t on t.lider_id = l.id
    left join cerradas cm on cm.lider_id = l.id and cm.mes_cierre = v_mes_str
    group by l.id, l.nombre
    having count(t.*) filter (where t.id is not null) > 0 or count(cm.*) > 0
  )
  select jsonb_agg(jsonb_build_object(
    'lider_id', lider_id, 'nombre', nombre, 'total', total,
    'completadas', completadas, 'completadasATiempo', completadas_a_tiempo,
    'totalCerradas', total_cerradas,
    'pct', case when total_cerradas>0 then round((completadas::numeric/total_cerradas)*100) else null end,
    'pctATiempo', case when total_cerradas>0 then round((completadas_a_tiempo::numeric/total_cerradas)*100) else null end
  ))
  into v_por_lider
  from por_lider;

  insert into junta_indicadores_congelados (
    anio, mes, sesiones, total_martes, total_tareas, completadas, completadas_a_tiempo,
    total_cerradas, pct, pct_a_tiempo, congelado_por, por_lider
  ) values (
    v_anio, v_mes, v_sesiones, array_length(v_martes,1), v_total_tareas, v_completadas, v_completadas_a_tiempo,
    v_total_cerradas, v_pct, v_pct_a_tiempo, 'corte automático (pg_cron)', coalesce(v_por_lider, '[]'::jsonb)
  )
  on conflict (anio, mes) do nothing;
end;
$function$;
