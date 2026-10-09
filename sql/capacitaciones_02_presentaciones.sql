-- Capacitaciones: nuevo tipo de lección "presentacion" (Canva, Google Slides, PowerPoint).
-- Solo cambia la regla de qué tipos de lección se permiten. No borra ni modifica datos.
alter table capacitacion_lecciones drop constraint if exists capacitacion_lecciones_tipo_check;
alter table capacitacion_lecciones add constraint capacitacion_lecciones_tipo_check
  check (tipo in ('video','pdf','texto','presentacion'));
