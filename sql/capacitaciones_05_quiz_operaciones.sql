-- ════════════════════════════════════════════════════════════════════════════
-- Capacitaciones · parte 5: quiz de la lección 4 «Operaciones» (10 preguntas, 5 con imagen)
-- del curso «Inducción Asesor Comercial». Si esa lección ya tiene preguntas, no hace nada.
-- Las imágenes están en public/capacitacion/operaciones/ (se publican con el código).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_curso uuid;
  v_lec   uuid;
begin
  select id into v_curso from capacitacion_cursos where titulo = 'Inducción Asesor Comercial';
  select id into v_lec from capacitacion_lecciones where curso_id = v_curso and titulo = 'Operaciones';
  if v_lec is null then
    raise exception 'No encontré la lección «Operaciones» del curso «Inducción Asesor Comercial».';
  end if;
  if exists (select 1 from capacitacion_preguntas where leccion_id = v_lec) then
    raise notice 'La lección «Operaciones» ya tiene preguntas: no se cargó nada.';
    return;
  end if;

  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, 'Mira tu «Registro de hoy». ¿Cuántas veces debes marcar asistencia en un día normal de trabajo?', 'unica', '["2 veces: entrada y salida", "3 veces: entrada, almuerzo y salida", "4 veces: entrada, inicio de almuerzo, fin de almuerzo y salida", "Solo la entrada"]'::jsonb, 2, null, '/capacitacion/operaciones/op-01.jpg', 'Son 4 marcaciones al día: entrada, inicio de almuerzo, fin de almuerzo y salida. Al final revisa «Registro de hoy» para confirmar que quedaron todas.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'En un mismo recibo puedes combinar varios tipos. ¿Cuál de estos va siempre solo?', 'unica', '["Venta", "Arreglo", "Grabado", "Flexipago"]'::jsonb, 3, null, '/capacitacion/operaciones/op-02.jpg', 'Venta, Arreglo, Marcación y Grabado se pueden sumar en un mismo recibo (por ejemplo, Venta + Grabado). El Flexipago va solo.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Con cuáles medios de pago se puede registrar una venta? (Marca todos los correctos)', 'multiple', '["Efectivo", "Tarjeta", "Transferencia", "ADDI", "Cheque", "Fiado (el cliente paga después)"]'::jsonb, 0, '[0, 1, 2, 3]'::jsonb, '/capacitacion/operaciones/op-03.jpg', 'Los medios son efectivo, tarjeta, transferencia y ADDI. Si el cliente paga con varios, se combinan en la misma venta y la app avisa cuando lo pagado cuadra con el valor.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'Hiciste una venta junto con un compañero. ¿Dónde dejas la constancia?', 'unica', '["Registro la venta dos veces, una por cada uno", "En «Notas (opcional)» del recibo", "Le aviso a Finanzas por WhatsApp y no registro nada en la app", "No se puede dejar constancia"]'::jsonb, 1, null, null, 'La venta se registra una sola vez y en «Notas (opcional)» se deja constancia de que fue compartida.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Cuánto tiempo tiene un cliente para terminar de pagar un Flexipago?', 'unica', '["30 días", "60 días calendario desde el primer abono", "90 días", "No tiene límite"]'::jsonb, 1, null, null, 'El cliente tiene 60 días calendario desde el primer abono para pagar el total.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 5, '¿Cuándo se le entrega el producto a un cliente con Flexipago?', 'unica', '["Cuando hace el primer abono", "Cuando ha pagado la mitad", "Solo cuando el pago está completo", "Cuando lo autorice cualquier asesor"]'::jsonb, 2, null, null, 'El Flexipago es un acuerdo de separación: el producto se entrega solo cuando el pago está completo.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 6, 'En los horarios de Turnos, ¿qué significa «JT1»?', 'unica', '["Jardín Plaza, turno 1", "Jornada de trabajo 1", "Jueves, turno 1", "Junta, tarea 1"]'::jsonb, 0, null, '/capacitacion/operaciones/op-04.jpg', 'JT1 es el turno 1 de Jardín Plaza (de 10 a.m. a 6 p.m.). Arriba de la rejilla están los horarios de cada tienda.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 7, 'Necesitas cambiar un turno con un compañero. ¿Qué haces?', 'unica', '["Lo cambian entre ustedes y listo", "Lo cambias tú mismo en la app", "Solo se cambia con aprobación de Operaciones", "Avisas el mismo día al llegar a la tienda"]'::jsonb, 2, null, null, 'Los cambios de turno solo se hacen con aprobación de Operaciones.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 8, 'Durante el día pagaste $20.000 de un domicilio con plata de la caja, con autorización de tu líder. ¿Cómo queda registrado en Caja?', 'unica', '["Como una Recolección, porque salió plata de la caja", "Como una Novedad (costo), indicando el líder que lo autorizó", "En el Cierre de caja, como un faltante", "No se registra, porque ya estaba autorizado"]'::jsonb, 1, null, '/capacitacion/operaciones/op-05.jpg', 'Los costos o ingresos que pasan durante el día se registran como Novedades, siempre con el líder que los autorizó. La Recolección es solo cuando un líder recoge el efectivo de la tienda.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 9, 'Al hacer el cierre de caja, el efectivo no cuadra con lo que muestra la app. ¿Qué haces?', 'unica', '["Lo dejas así, ya se arreglará", "Pones de tu plata para que cuadre", "Cambias el valor para que cuadre", "Agregas una nota y le avisas a tu líder de inmediato"]'::jsonb, 3, null, null, 'Si no cuadra, se registra tal como está, con una nota, y se le avisa al líder de inmediato.');

  raise notice 'Quiz de Operaciones cargado: 10 preguntas.';
end $$;
