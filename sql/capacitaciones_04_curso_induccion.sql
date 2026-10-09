-- ════════════════════════════════════════════════════════════════════════════
-- Capacitaciones · parte 4: carga el curso «Inducción Asesor Comercial»
-- 8 lecciones (tipo Presentación, sin link todavía) y las preguntas del quiz de cada lección.
-- Correr DESPUÉS de capacitaciones_03_quiz_por_leccion.sql.
-- Si ya existe un curso con este mismo título, no hace nada (no duplica).
-- Los links de las presentaciones se pegan después desde la app (Cursos › editar lección).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_curso uuid;
  v_lec   uuid;
begin
  if exists (select 1 from capacitacion_cursos where titulo = 'Inducción Asesor Comercial') then
    raise notice 'Ya existe el curso «Inducción Asesor Comercial»: no se cargó nada.';
    return;
  end if;

  insert into capacitacion_cursos (titulo, descripcion, orden, puntaje_minimo, activo, en_orden)
  values ('Inducción Asesor Comercial', 'Inducción para asesores comerciales de OZEN: 8 lecciones que se pueden hacer en cualquier orden. Cada quiz se aprueba con 80%.', 0, 80, true, false)
  returning id into v_curso;


  -- Lección 1 · Políticas de la empresa
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 0, 'Políticas de la empresa', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Cuál es la misión de OZEN?', 'unica', '["Ofrecer productos artesanales exclusivos", "Ofrecer productos y servicios de alta calidad que creen experiencias memorables", "Convertirse en el líder mundial en joyería artesanal", "Ofrecer solo productos de lujo"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Qué año se menciona como meta para alcanzar la visión de la empresa?', 'unica', '["2025", "2028", "2031", "2035"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Cuál de los siguientes NO es uno de los principios de OZEN?', 'unica', '["Trabajo en equipo", "Actuar con autonomía", "Primero la rentabilidad", "Primero la gente y nuestros clientes"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, 'Si NO puedo presentarme a trabajar, ¿qué soporte debo presentar a la empresa?', 'unica', '["Solo un mensaje de WhatsApp explicando que no iré a trabajar", "Incapacidad de mi EPS o evidencia de calamidad doméstica (como la muerte de un familiar)", "Una foto en urgencias", "Incapacidad de la droguería de confianza"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Cuál NO es un principio de OZEN?', 'unica', '["Actuar con autonomía", "Inclusión y respeto", "Responder con confianza", "Tomamos decisiones rápidas"]'::jsonb, 3, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 5, '¿Cómo debe ser la ropa de los asesores?', 'unica', '["Completamente negra", "Camiseta azul de la marca y pantalón beige", "Camisa blanca y pantalón negro", "Cualquier color neutro"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 6, '¿Cuál de las siguientes prendas o accesorios está prohibido?', 'unica', '["Camiseta de la marca", "Accesorios de la marca", "Jeans rotos", "Zapatos cerrados"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 7, '¿Qué características debe tener el maquillaje?', 'unica', '["Brillante y llamativo", "Estilo artístico", "Tonos neutros y sobrios", "Intenso y de colores vivos"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 8, '¿Cuál es el estado ideal del cabello durante la jornada laboral?', 'unica', '["Siempre recogido", "Limpio y bien peinado", "Tinturado de colores llamativos", "Recogido con accesorios"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 9, '¿Qué debe hacerse con los dijes de fotograbado de dotación?', 'unica', '["Guardarlos en los cajones", "Tenerlos en el bolso o en la casa", "Exhibirlos en las vitrinas", "Tenerlos en el look diario"]'::jsonb, 3, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 10, '¿Cuánto dura la jornada laboral diaria?', 'unica', '["6 horas", "7,33 horas + 1 hora de descanso", "8 horas exactas", "9 horas sin descanso"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 11, '¿Cuál es el único centro comercial donde los asesores son fijos?', 'unica', '["Chipichape", "Llanogrande", "Jardín Plaza", "Unicentro"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 12, 'De acuerdo con el contrato indefinido, ¿cuántos domingos al mes descansa cada asesor?', 'unica', '["1 domingo y 3 compensatorios", "2 domingos y 2 compensatorios", "3 domingos y 1 compensatorio", "Ninguno"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 13, '¿Con cuánta antelación deben notificarse los permisos?', 'unica', '["24 horas", "3 días", "5 días", "No se requiere aviso"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 14, '¿Qué condición se menciona para hacer horas extra?', 'unica', '["Deben ser autorizadas previamente", "Se pagan automáticamente", "Solo se pagan los domingos", "Se informan al final de mes"]'::jsonb, 0, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 15, '¿En qué casos se permite el uso del celular?', 'unica', '["Situaciones necesarias o de emergencia", "Para revisar redes sociales", "Para escuchar música", "Cuando no hay clientes"]'::jsonb, 0, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 16, '¿Por qué no se permite consumir alimentos dentro del punto de venta?', 'unica', '["Porque los clientes podrían robar productos", "Para mantener la estética y el profesionalismo de la marca", "Porque está prohibido por el centro comercial", "Porque podría ensuciar la caja registradora"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 17, '¿Cuál de estas conductas está prohibida durante el turno?', 'unica', '["Mantener la tienda organizada", "Usar audífonos", "Permanecer en el punto de venta", "Reorganizar los productos de las vitrinas"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 18, '¿Qué se espera del estado de las vitrinas?', 'unica', '["Se limpian una vez al final del día", "Se deben mantener limpias, completas y organizadas", "Se limpian una vez por semana", "No es necesario mantenerlas completas"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 19, '¿Qué se debe evitar para mantener el enfoque en el cliente?', 'unica', '["Hablar con los compañeros", "Recibir visitas personales durante la jornada", "Usar el uniforme", "Seguir las normas del centro comercial"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 20, '¿Cuál es el porcentaje de bonificación por cumplir solo la meta personal?', 'unica', '["2% (sin IVA)", "3% (sin IVA)", "4% (sin IVA)", "5% (sin IVA)"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 21, '¿Cuál es la bonificación por cumplir la meta personal y la global?', 'unica', '["3% (sin IVA)", "4% (sin IVA)", "5% (sin IVA)", "6% (sin IVA)"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 22, '¿Cada cuánto tiempo se paga la bonificación?', 'unica', '["Diariamente", "Semanalmente", "Quincenalmente", "Mensualmente"]'::jsonb, 3, null, null, null);

  -- Lección 2 · La Junta
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 1, 'La Junta', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Qué área gestiona las incapacidades con las EPS?', 'unica', '["Comercial", "Finanzas", "Marketing", "Gestión Humana"]'::jsonb, 3, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Qué área organiza los turnos y horarios?', 'unica', '["Comercial", "Finanzas", "Operaciones", "Marketing"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Quién se encarga de los pagos de nómina?', 'unica', '["Comercial", "Operaciones", "Finanzas", "Gestión Humana"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, '¿Qué área está a cargo del visual merchandising de producto?', 'unica', '["Comercial", "Operaciones", "Marketing", "Gestión Humana"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Quién hace seguimiento a la Stopper y apoya las metas individuales?', 'unica', '["Marketing", "Operaciones", "Comercial", "Gestión Humana"]'::jsonb, 2, null, null, null);

  -- Lección 3 · Facturación en Siigo
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 2, 'Facturación en Siigo', 'presentacion', null, null) returning id into v_lec;

  -- Lección 4 · Operaciones
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 3, 'Operaciones', 'presentacion', null, null) returning id into v_lec;

  -- Lección 5 · Producto, merchandising y fotograbado
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 4, 'Producto, merchandising y fotograbado', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Cuál es el principal material que manejamos en OZEN?', 'unica', '["Acero inoxidable de alta calidad", "Acero quirúrgico hipoalergénico calidad 316L", "Acero hipoalergénico inoxidable", "Acero cromado"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Cuál de los siguientes NO es un revestimiento que manejemos en OZEN?', 'unica', '["Revestimiento en oro italiano", "Revestimiento en tungsteno", "Revestimiento en pavonado", "Revestimiento en oro rosa"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Por cuánto tiempo damos garantía sobre las propiedades de nuestro acero?', 'unica', '["Garantía de 1 año", "Garantía permanente sin incluir rupturas", "No tiene garantía nuestro acero", "Garantía permanente incluyendo rupturas"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, '¿Por cuánto tiempo damos garantía sobre nuestros revestimientos?', 'unica', '["Garantía de 12 meses", "Garantía permanente", "Garantía de 6 meses", "No tiene garantía"]'::jsonb, 0, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 4, '¿Cuál es el cuidado que debe tener el acero, y los revestimientos?', 'unica', '["Se puede dejar sin limpiar", "Limpieza con agua, jabón neutro y franela", "Limpieza con brillametal, alcohol y franela", "Limpieza con agua caliente"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 5, '¿Cuál NO es un cuidado que debe tener el cuero?', 'unica', '["Evitar el contacto con agua", "Limpieza con jabón neutro y franela", "Evitar el contacto con productos químicos", "Evitar la exposición al sol"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 6, '¿Cuál NO es un cuidado que debe tener el neopreno?', 'unica', '["Evitar el contacto con agua y sol", "Limpieza con agua, jabón neutro y franela", "Evitar el contacto con productos químicos", "Limpieza con paño seco"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 7, '¿Cuál NO es un cuidado que debe tener el tungsteno o wolframio?', 'unica', '["Limpieza con agua, jabón neutro y franela", "Evitar altas temperaturas", "Evitar caídas", "Evitar golpes contundentes"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 8, '¿Cuál NO es un cuidado que debe tener la cerámica china?', 'unica', '["Limpieza con agua, jabón neutro y franela", "Evitar altas temperaturas", "Evitar caídas", "Evitar golpes contundentes"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 9, '¿Cuáles NO son tipos de piedras que manejemos en OZEN?', 'unica', '["Naturales y simuladas", "Preciosas y semipreciosas", "Simuladas y artificiales", "Artificiales y naturales"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 10, '¿Cuáles piedras NO manejamos en OZEN?', 'multiple', '["Zafiro", "Diamante", "Perla", "Ópalo", "Ojo de tigre", "Zircón", "Ónix", "Hematita", "Volcánica", "Ojo de gato"]'::jsonb, 0, '[0, 1, 2, 3]'::jsonb, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 11, '¿Cuál NO es un cuidado del hilo de seda?', 'unica', '["Evitar el agua", "Evitar caídas", "Evitar el sol", "Evitar la humedad"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 12, '¿Cuál NO es un cuidado o una característica del aluminio?', 'unica', '["Solo hay placas para mascotas con este material", "Evitar el contacto con agua y sol", "Limpieza con jabón neutro y franela", "Se pueden fotograbar imágenes y texto"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 13, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 0, null, '/capacitacion/tejidos/t-000.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 14, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 1, null, '/capacitacion/tejidos/t-001.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 15, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 2, null, '/capacitacion/tejidos/t-002.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 16, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 3, null, '/capacitacion/tejidos/t-003.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 17, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 4, null, '/capacitacion/tejidos/t-004.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 18, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 5, null, '/capacitacion/tejidos/t-005.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 19, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 6, null, '/capacitacion/tejidos/t-006.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 20, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 7, null, '/capacitacion/tejidos/t-007.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 21, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 8, null, '/capacitacion/tejidos/t-008.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 22, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 9, null, '/capacitacion/tejidos/t-009.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 23, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 10, null, '/capacitacion/tejidos/t-010.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 24, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 11, null, '/capacitacion/tejidos/t-011.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 25, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 12, null, '/capacitacion/tejidos/t-012.jpg', null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 26, '¿Cuál es el nombre de este tejido?', 'unica', '["Portugués arredondado", "Bolas", "Fígaro / 3 en 1 / Cartier", "Cordón bahiano", "Portugués", "Ancla", "Grumet", "Doble grumet", "Veneciana", "Singapur", "Cola de ratón", "Bizantina", "Eslabón trenzado", "Zig Zag"]'::jsonb, 13, null, '/capacitacion/tejidos/t-013.jpg', null);

  -- Lección 6 · Organización y limpieza
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 5, 'Organización y limpieza', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Con qué frecuencia se debe limpiar el interior de las vitrinas?', 'unica', '["Diariamente", "Semanalmente", "Cada 15 días", "Solo cuando hay auditoría"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, '¿Qué debe hacerse con los insumos de limpieza durante la jornada?', 'unica', '["Dejarlos en el escritorio", "Guardarlos dentro de las vitrinas", "Mantenerlos fuera de la vista del cliente", "No importa dónde se ubiquen"]'::jsonb, 2, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Qué zonas deben estar siempre despejadas y organizadas?', 'unica', '["Bodega y baño", "Escritorio, vitrinas y piso", "Áreas de comidas", "Únicamente el escritorio"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, '¿Qué se debe hacer con las herramientas luego de usarlas?', 'unica', '["Guardarlas en la bandeja de servicio", "Limpiarlas y dejarlas ordenadas", "No se deben limpiar", "Ponerles cinta en las puntas"]'::jsonb, 1, null, null, null);

  -- Lección 7 · Seguridad y salud en el trabajo
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 6, 'Seguridad y salud en el trabajo', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Cuál de los siguientes elementos representa un riesgo físico en tu puesto de trabajo?', 'unica', '["El uniforme de la empresa", "Herramientas para arreglos y fotograbado", "El catálogo de productos", "El celular personal"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'En caso de una emergencia dentro del centro comercial, ¿qué debes hacer primero?', 'unica', '["Salir corriendo lo más rápido posible", "Mantener la calma y seguir las instrucciones del personal encargado", "Esperar a que llegue la policía", "Llamar a mis familiares para avisarles"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, '¿Qué debes hacer si identificas un posible intento de hurto hormiga?', 'unica', '["Enfrentar directamente al sospechoso", "Reportarlo de inmediato a algún líder del equipo administrativo", "Ignorarlo para evitar problemas", "Esperar a que otro compañero actúe"]'::jsonb, 1, null, null, null);
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 3, '¿Cuál de los siguientes riesgos psicosociales puede afectar tu bienestar en OZEN?', 'unica', '["Escuchar música mientras trabajas", "Estrés por cumplimiento de metas", "Usar uniforme todos los días", "Trabajar en un centro comercial"]'::jsonb, 1, null, null, null);

  -- Lección 8 · Comercial
  insert into capacitacion_lecciones (curso_id, orden, titulo, tipo, url, contenido)
  values (v_curso, 7, 'Comercial', 'presentacion', null, null) returning id into v_lec;
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 0, '¿Cuáles son obligaciones que le corresponden al asesor comercial?', 'multiple', '["Mantener la tienda siempre limpia, ordenada y completa", "Aprobar o negar cambios de turno entre compañeros", "Revisar y confirmar que la información de Siigo, la app de ventas y el dinero esté correcta en cada apertura y cierre", "Decidir las estrategias comerciales del mes", "Reportar con suficiente tiempo cualquier ausencia, para no afectar la operación", "Definir los precios de los productos", "Cubrir turnos por novedades como incapacidades, descansos o renuncias", "Hacer seguimiento de si los demás compañeros recibieron inducciones completas"]'::jsonb, 0, '[0, 2, 4, 6]'::jsonb, null, 'Mantener la tienda, revisar la información en cada apertura y cierre, avisar las ausencias a tiempo y cubrir turnos por novedades son parte del rol. Aprobar cambios de turno, decidir estrategias, definir precios y hacer seguimiento a las inducciones les corresponde a los líderes.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 1, 'Si un cliente dice: «Está muy caro», ¿cuál es la mejor forma de responder para mantener la venta activa?', 'unica', '["«Podemos ver otra opción más económica»", "«Nuestros productos tienen garantía y durabilidad, ¿quieres que te muestre?»", "«La calidad siempre cuesta más»", "«Tal vez prefieras esperar una promoción»"]'::jsonb, 1, null, null, 'La respuesta correcta es la B: en lugar de discutir el precio, cambia el enfoque hacia el valor, resalta dos atributos claves de OZEN (garantía y durabilidad) y mantiene la conversación activa con una pregunta. La A valida que está caro y lleva la venta a lo más barato; la C suena defensiva y cierra el diálogo; la D aleja al cliente de la compra al invitarlo a esperar.');
  insert into capacitacion_preguntas (curso_id, leccion_id, orden, enunciado, tipo, opciones, respuesta_correcta, respuestas_correctas, imagen_url, explicacion)
  values (v_curso, v_lec, 2, 'Si un cliente al que le obsequiamos el dije de la Stopper te dice: «Ya tengo cadenas para el dije», ¿cuál sería la mejor forma de responder para romper esa objeción y mantener la venta activa?', 'multiple', '["«Entiendo, pero te muestro esta cadena: es la medida y el diseño exactos para que el dije luzca mejor»", "«Bueno, si ya tienes cadenas, entonces no necesitas otra»", "«Genial, mira esta cadena, así puedes tener más opciones para combinar el dije según la ocasión»", "«Perfecto, vuelve cuando quieras»", "«Claro, aunque también tenemos aretes y pulseras que hacen juego con el dije. Te muestro algunos»"]'::jsonb, 0, '[0, 2, 4]'::jsonb, null, 'Las correctas son A, C y E: muestran la cadena como el complemento ideal del dije, abren más opciones de estilo y llevan la conversación hacia otros productos. B y D cierran la oportunidad de venta porque aceptan el «no» sin insistir de forma estratégica.');

  raise notice 'Curso cargado: 8 lecciones y 66 preguntas.';
end $$;
