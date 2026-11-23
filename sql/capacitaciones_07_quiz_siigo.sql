-- ════════════════════════════════════════════════════════════════════════════
-- Capacitaciones · parte 7: quiz de la lección 3 «Facturación en Siigo» (10 preguntas, 1 con imagen)
-- del curso «Inducción Asesor Comercial». Si esa lección ya tiene preguntas, no hace nada.
-- La imagen está en public/capacitacion/siigo/ (se publica con el código).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_curso uuid;
  v_lec   uuid;
begin
  select id into v_curso from capacitacion_cursos where titulo = 'Inducción Asesor Comercial';
  select id into v_lec from capacitacion_lecciones where curso_id = v_curso and titulo = 'Facturación en Siigo';
  if v_lec is null then
    raise exception 'No encontré la lección «Facturación en Siigo» del curso «Inducción Asesor Comercial».';
  end if;
  if exists (select 1 from capacitacion_preguntas where leccion_id = v_lec) then
    raise notice 'La lección «Facturación en Siigo» ya tiene preguntas: no se cargó nada.';
    return;
  end if;

  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿En qué casos se hace una nota crédito?', 'unica', '["Cuando se anula una venta o el cliente devuelve artículos", "Cuando el cliente pide un descuento después de pagar", "Al hacer el cierre de caja", "Cuando se registra un Flexipago"]'::jsonb, 0, null, null, 'La nota crédito se hace por anulación de la venta o por devolución de artículos, siempre desde la factura original.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Desde qué menú de Siigo empiezas una nota crédito?', 'unica', '["Ventas", "Compras y gastos", "Cajas y bancos", "Contabilidad"]'::jsonb, 0, null, null, 'Se entra a «Ventas» en el menú de la izquierda, se busca la factura y se da clic en su número.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'Ya estás dentro de la factura. ¿Dónde encuentras «Aplicar nota crédito»?', 'unica', '["En el botón «Editar»", "En el menú «Cartera»", "En el menú «Más»", "En «Enviar por correo»"]'::jsonb, 2, null, null, 'En la factura se abre el menú «Más» y se elige «Aplicar nota crédito».');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, '¿Qué campos llenas tú en la nota crédito? (Marca todos los correctos)', 'multiple', '["Tipo", "Motivo DIAN", "Cliente", "Fecha de elaboración", "Vendedor", "Centro de costo"]'::jsonb, 0, '[0, 1]'::jsonb, null, 'Solo se llenan los campos en rojo: «Tipo» (la nota crédito de tu tienda) y «Motivo DIAN» (anulación o devolución). Lo demás lo trae Siigo de la factura.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, 'Estás en Unicentro. ¿Qué tipo de nota crédito eliges?', 'unica', '["NC-2", "NC-3", "NC-4", "NC-5"]'::jsonb, 2, null, null, 'Unicentro es NC-4. Chipichape es NC-2, Llano Grande NC-3 y Jardín Plaza NC-5.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 5, 'Una venta de Jardín Plaza tiene la factura FV-3. ¿Qué nota crédito le corresponde?', 'unica', '["NC-3, porque es el mismo número de la factura", "NC-5", "NC-2", "NC-4"]'::jsonb, 1, null, null, 'Los números de factura y de nota crédito no coinciden: Jardín Plaza factura con FV-3 y su nota crédito es NC-5. Elige siempre por el nombre de la tienda.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 6, 'Ya llenaste los campos en rojo. ¿Qué sigue?', 'unica', '["Reviso y ajusto el valor y los datos del cliente", "No cambio nada más y doy clic en «Guardar y enviar»", "Cambio la fecha a la de hoy", "Doy clic en «Cancelar» y la hago desde cero"]'::jsonb, 1, null, null, 'Siigo ya carga toda la información de la factura: no se modifica ningún otro dato y se da clic en «Guardar y enviar». Siigo genera el PDF.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 7, '¿Cómo encuentras el informe de ventas diario en Siigo?', 'unica', '["En «Buscar en Siigo», escribiendo «Comprobante informe diario»", "En Ventas › Notas de crédito", "En Reportes › Nómina", "Se lo pido a Finanzas"]'::jsonb, 0, null, null, 'Arriba, en «Buscar en Siigo», se escribe «Comprobante informe diario» y se elige la opción.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 8, '¿Qué hora pones en «Hora cierre diario»?', 'unica', '["Siempre las 8:00 p. m.", "La hora en que abrió la tienda", "La hora que se ve en el monitor al hacer el cierre", "Cualquiera, no importa"]'::jsonb, 2, null, '/capacitacion/siigo/sg-01.jpg', 'Va la hora real del cierre, la que se ve en el monitor, porque auditoría la compara.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 9, 'En el informe de ventas diario, ¿dónde eliges la caja de tu tienda?', 'unica', '["En «Moneda local»", "En «Tipo de comprobante», con la factura de tu tienda", "En «Máquinas registradoras»", "En «Limpiar filtros»"]'::jsonb, 1, null, null, 'En «Tipo de comprobante» se elige la factura de la tienda (por ejemplo FV-5 FACTURA UNICENTRO), se da clic en «Buscar» y luego en el ícono de PDF.');

  raise notice 'Quiz de Facturación en Siigo cargado: 10 preguntas.';
end $$;
