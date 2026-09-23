# Estado del proyecto OZEN-WEB — resumen para retomar en otro chat

_Última actualización: 21 de septiembre de 2026_

## Cómo usar este archivo

Si este chat deja de funcionar, abre uno nuevo y pégale esto:

> "Lee el archivo ESTADO-PROYECTO.md en mi carpeta OZEN-WEB y sigue desde ahí."

Un chat nuevo NO recuerda automáticamente esta conversación — no hay memoria compartida entre chats. Lo que sí está seguro pase lo que pase es el código: todo lo terminado ya quedó comiteado y publicado en GitHub, en `staging` y `main`. Este archivo es el puente para que el chat nuevo entienda el contexto sin que tengas que repetir todo.

## Cómo funciona el flujo de trabajo (para que el chat nuevo lo sepa)

- Dos ramas de git: `staging` (pruebas, base de datos Supabase separada) y `main` (producción, datos reales).
- Todo cambio de código se prueba primero en `staging`, se verifica (parser + eslint), se publica ahí, y solo después de que tú confirmas o pides seguir, se replica igual en `main`.
- Cambios visuales/de tema quedan SOLO en `staging` — nunca en `main` (main sigue con el tema oscuro original).
- El asistente no puede correr `git commit`/`push` de forma confiable desde su sandbox (error de permisos con `.git/index.lock`) — por eso te da los comandos para que los corras tú en tu terminal. Si ves ese error de "index.lock", el comando `rm -f /Users/santiagorodriguez/Desktop/OZEN-WEB/.git/index.lock` lo resuelve.
- Antes de cualquier corrección de datos reales (UPDATE/DELETE), el asistente te muestra primero un SELECT para que confirmes, y solo después te da el UPDATE.

## Qué se hizo en la sesión más reciente (16–21 de septiembre 2026)

1. **Nota crédito con excedente — medios de pago.** El botón "📝 Aplicar Notacrédito" no dejaba elegir medio de pago (a diferencia de "🧾 Notacrédito Siigo"). Se corrigió. También: el N.º de factura Siigo es obligatorio ahí, y ya no sobreescribe el número de factura original (el nuevo número queda en el registro espejo/ajuste, no en la venta original).

2. **Descuadre de Caja en Unicentro (~$200.000).** Causa: el cálculo de "efectivo pendiente" revalidaba TODA la historia de recolecciones contra datos en vivo — un cambio en una venta vieja podía descuadrar una recolección de semanas atrás. Se rediseñó para que la ÚLTIMA recolección sea un corte fijo (todo lo anterior a esa fecha se da por recogido al 100%, sin revisarlo de nuevo). Verificado matemáticamente contra datos reales antes de publicar.

3. **Excedente de notacrédito mal fechado.** Cuando se aplicaba un excedente (plata que llega HOY sobre una venta de un día anterior) con el botón "Aplicar Notacrédito", el sistema mezclaba esa plata nueva con el pago original de la venta vieja — Caja la contaba como si hubiera entrado ese día viejo, no hoy. Se corrigió para que el excedente quede en un renglón nuevo, fechado hoy, separado del original. Se corrigió también el dato histórico de la venta #49 (Cristina Millán, Unicentro) que ya estaba mal guardada.

4. **La Junta — tareas reabiertas quedaban congeladas para siempre.** Cuando una tarea de un mes anterior se reabría (porque la reunión de traspaso se corrió de fecha) con una nueva fecha en el mes nuevo, el sistema la congelaba de todos modos apenas pasaba la semana 3 del mes nuevo — dejándola bloqueada para el monitor de turno (le pasó a Paolo). Se corrigió: una tarea reabierta ya no se congela, sin importar cuánto haya pasado, hasta que se cierre de verdad.

Todo lo anterior está publicado y verificado (parser + eslint sin errores) en `main` (commit `66d6df9`) y `staging` (commit `02cef04`).

## Pendientes (no resueltos, de sesiones anteriores)

- Permisos de creación de cuentas de login de tienda — quedó pendiente de una sesión anterior, sin detalle adicional registrado.
- Fix Junta: tareas vencidas de semana-puente no aparecen para reabrir — quedó pendiente de una sesión anterior, sin detalle adicional registrado.

Si alguno de estos dos ya no aplica o cambió, dile al chat nuevo para que actualice este archivo.

## Datos técnicos que el chat nuevo necesita saber

- Tabla de usuarios se llama `usuarios`, no `users`.
- `ventas_items.pagos` / `ventas_abonos.pagos`: array JSONB de `{medio_pago, valor, numero_autorizacion}`.
- `es_original` + `fecha_item` en `ventas_items`: distinguen el renglón original de la venta de renglones nuevos de excedente con fecha propia.
- `junta_lideres` (orden, nombre) define la rotación de monitor de La Junta — rota mensualmente desde agosto 2026, comparando nombre contra `usuarios.name` (sin acentos/mayúsculas).
- `usuarios.role` de Paolo: `admin_turnos`.
