-- ════════════════════════════════════════════════════════════════════════════
-- Capacitaciones · parte 8: curso «OZEN Club · Inventario» (inventario de OZEN Club para asesores)
-- 6 lecciones (Presentación, sin link todavía) en cualquier orden, cada una con su quiz
-- (30 preguntas). Se aprueba con 80%. Si el curso ya existe, no hace nada.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_curso uuid;
  v_lec   uuid;
begin
  if exists (select 1 from capacitacion_cursos where titulo = 'OZEN Club · Inventario') then
    raise notice 'Ya existe el curso «OZEN Club · Inventario»: no se cargó nada.';
    return;
  end if;

  insert into capacitacion_cursos (titulo, descripcion, orden, puntaje_minimo, activo, en_orden)
  values ('OZEN Club · Inventario', 'Cómo usar el inventario de OZEN Club en tu punto de venta: consultar, registrar movimientos, plan separe, traslados, conteos y trazabilidad.', 1, 80, true, false)
  returning id into v_curso;


  -- Lección 1 · Consultar productos
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 0, 'Consultar productos', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Cómo entras a OZEN Club?', 'unica', '["En club.ozenjoyeria.com, con tu usuario de punto de venta", "Con la cuenta de la tienda de la app OZEN", "Desde Siigo, en «Buscar en Siigo»", "Pidiéndole el inventario a administración por WhatsApp"]'::jsonb, 0, null, null, 'Se entra a club.ozenjoyeria.com con el usuario de punto de venta y se abre «Inventario Joyas».');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'Una pieza muestra: En sede 3 · Separadas 1. ¿Cuántas puedes ofrecerle a un cliente?', 'unica', '["3", "2", "1", "4"]'::jsonb, 1, null, null, 'Disponibles = en sede − separadas: 3 − 1 = 2. Hay tres piezas, pero una está reservada.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'Según esta ficha, ¿cuántas unidades de esta variante hay disponibles en Unicentro?', 'unica', '["0", "1", "2", "4"]'::jsonb, 1, null, '/capacitacion/ozenclub/oc-01.jpg', 'En la fila de Unicentro Cali dice 1 en sede, 0 separadas y 1 disponible.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, '¿Por qué la referencia sola no basta para identificar la pieza?', 'unica', '["Porque varias tallas o medidas pueden compartir la misma referencia", "Porque la referencia cambia cada mes", "Porque solo administración puede ver la referencia", "Porque el catálogo público no la muestra"]'::jsonb, 0, null, null, 'Un diseño puede reunir varias tallas con la misma referencia: hay que elegir la talla, el ancho o el largo exactos.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, 'En la ficha del producto aparecen varias sedes. ¿Cuál lees?', 'unica', '["El total general", "La fila de tu sede", "La sede con más unidades", "La de OZEN Web"]'::jsonb, 1, null, null, 'El total general no es el saldo de tu tienda: lee siempre la fila de tu punto de venta.');

  -- Lección 2 · Registrar movimientos
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 1, 'Registrar movimientos', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, 'Vendiste 2 unidades de una pieza que tenía 5. ¿Qué registras?', 'unica', '["Venta · restar, y escribes 2", "Venta · restar, y escribes 3", "Corrección · fijar saldo, y escribes 3", "Entrada · sumar, y escribes 2"]'::jsonb, 0, null, null, 'En una venta se escriben las unidades vendidas, no el saldo que debe quedar.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'El sistema dice 5 y al contar encuentras 3. En «Corrección · fijar saldo», ¿qué escribes?', 'unica', '["2", "−2", "3", "5"]'::jsonb, 2, null, null, 'La corrección pide la cantidad física final, no la diferencia. Y el motivo es obligatorio.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'En una venta, ¿qué anotas en «Motivo»?', 'unica', '["El número de factura de Siigo", "El nombre del cliente", "El valor que pagó", "Nada, siempre se deja vacío"]'::jsonb, 0, null, null, 'Se anota preferiblemente la referencia del comprobante: el número de factura de Siigo.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'Un cliente recoge la pieza que tenía separada. Ya pulsaste «Entregar mercancía». ¿Registras también una «Venta · restar»?', 'unica', '["Sí, siempre", "No: «Entregar mercancía» ya descuenta las unidades", "Sí, si pagó en efectivo", "Solo si es más de una unidad"]'::jsonb, 1, null, null, 'Registrar además una venta descontaría las mismas piezas dos veces.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Para qué NO se debe usar una corrección? (Marca todas las correctas)', 'multiple', '["Para simular una venta", "Para ocultar un faltante", "Para saltar un bloqueo por separados", "Para dejar el saldo real después de contar y comprobar una diferencia"]'::jsonb, 0, '[0, 1, 2]'::jsonb, null, 'La corrección es solo para dejar el saldo físico comprobado, con su motivo. Nunca para simular ventas, ocultar faltantes o saltar bloqueos.');

  -- Lección 3 · Plan separe
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 2, 'Plan separe', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, 'Al separar mercancía, ¿qué referencia escribes?', 'unica', '["La del Flexipago en la app OZEN", "El valor del abono", "La cédula del cliente", "El número de factura de Siigo"]'::jsonb, 0, null, null, 'Se escribe la referencia del separado en la otra plataforma (el Flexipago de la app OZEN). Nunca valores ni abonos.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'Una pieza tiene En sede 2 y Separadas 0. Separas 1. ¿Cómo queda?', 'unica', '["En sede 2 · Separadas 1 · Disponibles 1", "En sede 1 · Separadas 1 · Disponibles 0", "En sede 1 · Separadas 0 · Disponibles 1", "En sede 2 · Separadas 0 · Disponibles 2"]'::jsonb, 0, null, null, 'La cantidad física no cambia: suben las separadas y bajan las disponibles.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'El cliente vino y se llevó la pieza separada. ¿Qué haces?', 'unica', '["Entregar mercancía › Confirmar entrega", "Liberar separado", "Registrar una «Venta · restar»", "Nada, se descuenta sola"]'::jsonb, 0, null, null, '«Entregar mercancía» descuenta las unidades y deja el separado como Entregado.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'El cliente canceló y la pieza sigue en la vitrina. ¿Qué haces?', 'unica', '["Entregar mercancía", "Liberar separado › Confirmar liberación", "Corrección · fijar saldo", "Solicitar un traslado"]'::jsonb, 1, null, null, 'Liberar no cambia el saldo físico: la pieza vuelve a estar disponible.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Dónde encuentras los separados activos de tu sede?', 'unica', '["En el menú de arriba, en «Separados» › Separados activos", "En Trazabilidad", "En Conteos físicos", "En el catálogo público"]'::jsonb, 0, null, null, 'En «Separados» se filtra por estado y se busca por referencia, producto o talla.');

  -- Lección 4 · Traslados
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 3, 'Traslados', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, 'Acabas de solicitar un traslado. ¿Ya se descontaron las unidades?', 'unica', '["Sí, se descuentan al solicitar", "No: queda «Solicitado» hasta que administración lo apruebe", "Sí, y se suman de una vez al destino", "Solo si el destino es Jardín Plaza"]'::jsonb, 1, null, null, 'Solicitar no descuenta ni reserva. Se descuenta al despachar y se suma al confirmar la recepción.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Quién aprueba un traslado?', 'unica', '["La sede de origen", "La sede de destino", "Administración", "Cualquier asesor"]'::jsonb, 2, null, null, 'Administración aprueba. El origen despacha y el destino confirma la recepción.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'Tu tienda es el origen y el traslado está «Aprobado». Las piezas ya salieron. ¿Qué pulsas?', 'unica', '["Despachar", "Confirmar recepción", "Venta · restar", "Cancelar"]'::jsonb, 0, null, null, 'Al despachar se descuentan del origen y el traslado pasa a «En tránsito».');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'Recibiste un traslado y falta una pieza. ¿Qué haces?', 'unica', '["Confirmo la recepción y luego hago una corrección", "Confirmo la recepción y hago una entrada por lo que llegó", "No confirmo una recepción completa y reporto el código y la diferencia a administración", "Lo devuelvo sin avisar"]'::jsonb, 2, null, null, 'Si falta mercancía, llegó dañada o la talla no coincide, no se confirma completa: se reporta a administración.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Qué significa «En tránsito»?', 'unica', '["Que está pendiente de aprobación", "Que ya salió del origen y aún no se ha recibido en el destino", "Que ya se sumó al destino", "Que se canceló"]'::jsonb, 1, null, null, 'En tránsito: despachado en el origen, todavía sin confirmar en el destino.');

  -- Lección 5 · Conteo físico
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 4, 'Conteo físico', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Cuántos conteos abiertos puede haber al tiempo en una sede?', 'unica', '["Uno", "Dos", "Uno por asesor", "Los que se necesiten"]'::jsonb, 0, null, null, 'Solo puede haber un conteo abierto por sede. Si ya existe, se abre desde «Conteos recientes».');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Qué piezas cuentas? (Marca todas las correctas)', 'multiple', '["Las disponibles en la vitrina", "Las separadas que siguen en la sede", "Las despachadas que van en tránsito", "Las que están en otra sede"]'::jsonb, 0, '[0, 1]'::jsonb, null, 'Se cuenta todo lo que está físicamente en la sede, incluidos los separados. Lo que ya salió en tránsito no.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'De una referencia no encontraste ninguna pieza. ¿Qué haces?', 'unica', '["Dejo el campo vacío", "Escribo 0 y pulso «Guardar»", "Escribo el saldo que muestra el sistema", "La salto y sigo con la siguiente"]'::jsonb, 1, null, null, 'Un campo vacío significa que falta contar. El cero hay que escribirlo y guardarlo.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'En la revisión, una diferencia negativa significa:', 'unica', '["Un sobrante", "Un faltante", "Que hubo una venta", "Que falta guardar"]'::jsonb, 1, null, null, 'Diferencia positiva = sobrante; negativa = faltante. Se recuenta y se escribe el motivo.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, 'Ya enviaste el conteo con un faltante. ¿Haces además una corrección manual?', 'unica', '["Sí, para que el saldo quede bien de una vez", "No: solo administración aprueba la conciliación; el ajuste quedaría doble", "Sí, si el faltante es de una sola pieza", "Sí, pero solo al día siguiente"]'::jsonb, 1, null, null, 'Enviar no cambia cantidades: administración concilia. Una corrección manual aplicaría el ajuste dos veces.');

  -- Lección 6 · Trazabilidad y problemas
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 5, 'Trazabilidad y problemas', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Para qué sirve «Trazabilidad»?', 'unica', '["Para ver cada ingreso y egreso con responsable, fecha, motivo y saldo", "Para crear productos nuevos", "Para aprobar traslados", "Para cambiar precios"]'::jsonb, 0, null, null, 'Muestra el historial de movimientos de tu sede, con el saldo antes y después.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'Al registrar una venta salió «tiempo de espera». ¿Qué haces?', 'unica', '["La registro otra vez de inmediato", "Actualizo y reviso Trazabilidad antes de repetirla", "Hago una corrección para asegurar", "Hago una entrada y luego la venta otra vez"]'::jsonb, 1, null, null, 'Puede que sí se haya guardado. Primero se comprueba en Trazabilidad; si no se puede saber, se consulta a administración.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Una pieza separada aparece en el catálogo público?', 'unica', '["Sí, con un aviso de separada", "No: el catálogo solo ofrece unidades disponibles", "Sí, solo en la sede donde está", "Solo si tiene precio"]'::jsonb, 1, null, null, 'El catálogo solo ofrece variantes activas, con precio y unidades disponibles. Los separados no se ofrecen.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'Sale «No hay suficientes unidades». ¿Qué NUNCA debes hacer?', 'unica', '["Revisar la sede y la talla", "Actualizar el saldo", "Hacer una entrada ficticia para que deje vender", "Revisar la cantidad que escribiste"]'::jsonb, 2, null, null, 'Nunca se suman unidades ficticias para habilitar una salida.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, 'Al pedir ayuda a administración, ¿qué envías? (Marca todas las correctas)', 'multiple', '["Sede, referencia y talla", "La operación que intentaste y la hora aproximada", "Captura del mensaje", "Tu contraseña"]'::jsonb, 0, '[0, 1, 2]'::jsonb, null, 'Sede, referencia, talla, cantidad, operación, hora y captura. Las contraseñas nunca se comparten.');

  raise notice 'Curso cargado: 6 lecciones y 30 preguntas.';
end $$;
