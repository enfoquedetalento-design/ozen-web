# Guía de Notacrédito en OZEN — para capacitar asesores

Hay **tres formas** de corregir una venta ya registrada. Cuál usar depende de quién eres y de si Siigo generó (o va a generar) un número de factura nuevo.

| | ¿Quién la usa? | ¿Cuándo? | ¿Necesita N.º de factura nuevo? |
|---|---|---|---|
| 🛠️ **Corregir factura** | Cuenta de tienda (asesor) | Solo lo registrado **hoy mismo** | No |
| 🔒 **Solicitar Notacrédito** → 📝 **Aplicar Notacrédito** | Cuenta de tienda (asesor) | Cualquier día, con aprobación | No |
| 🧾 **Notacrédito Siigo** (incluye 🔄 Cambio de producto) | Master / Admin finanzas | Cualquier día, directo | Sí, siempre |

---

## 1. 🛠️ Corregir factura (para asesores — solo el mismo día)

Úsalo cuando **te equivocaste al digitar** algo hoy mismo (tipo, valor o medio de pago) y **en Siigo no cambió nada** — fue un error nuestro, no una nota crédito real.

**Pasos:**
1. Entra a la venta (en "Ventas de hoy" o "Lista de ventas") y ábrela.
2. Dale clic a **🛠️ Corregir factura**.
3. Edita lo que necesites: tipo, valor, medios de pago. El valor puede subir o bajar libremente.
4. Guarda.

No pide número de factura nuevo, no queda ningún rastro de "notacrédito" — simplemente corrige el registro.

⚠️ Solo funciona sobre ventas de **hoy**. Para un día anterior, sigue el punto 2.

---

## 2. 🔒 Solicitar Notacrédito → 📝 Aplicar Notacrédito (para asesores — cualquier día)

Úsalo cuando necesitas corregir algo de un **día anterior** y no eres master/admin de finanzas.

**Pasos del asesor:**
1. Entra a la venta y dale clic a **🔒 Solicitar Notacrédito**.
2. Escribe qué hay que corregir y por qué. Envía.
3. La solicitud queda "Pendiente" — espera a que master o admin finanzas la apruebe.
4. Cuando la aprueban, en esa misma venta te va a aparecer un botón nuevo: **📝 Aplicar Notacrédito**.
5. Dale clic — ahí puedes corregir lo que se aprobó (tipo y valor de lo ya registrado, sin agregar renglones nuevos). Guarda.

**¿Qué es exactamente "Aplicar Notacrédito"?** Es el botón que aparece SOLO cuando ya tienes una solicitud aprobada y todavía no la has aplicado. No es un botón que salga siempre — si lo ves, es porque master/admin finanzas ya te dieron luz verde para corregir esa venta.

**Del lado de master/admin finanzas:** en la venta van a ver la solicitud pendiente con botones **Aprobar** o **Rechazar**.

---

## 3. 🧾 Notacrédito Siigo (para master / admin finanzas)

Úsalo cuando la corrección **SÍ generó un número de factura nuevo en Siigo** — es decir, es una notacrédito real, no un error de digitación.

**Pasos:**
1. Entra a la venta y dale clic a **🧾 Notacrédito Siigo**.
2. Escribe "CORREGIR" para confirmar.
3. Aquí tienes **dos caminos**, según qué pasó:

### 3a. El valor cambió (devolución, ajuste de precio, etc.)
- Edita los renglones normalmente: puedes corregir un renglón existente o agregar uno nuevo con su propia fecha.
- El valor total **no puede quedar por debajo** de lo ya registrado.
- Escribe el **N.º de factura (Siigo) nuevo** — es obligatorio.
- Guarda.

### 3b. Cambio de producto por el mismo valor (NUEVO ✨)
Esto es cuando el cliente cambió un producto por otro **de exactamente el mismo valor** — en Siigo esto igual genera una factura nueva, aunque no haya diferencia de plata.

- Marca el check **🔄 Cambio de producto (mismo valor)**.
- El formulario se simplifica: solo pide **Fecha** y **N.º de factura (Siigo) nuevo**, lado a lado. El valor se toma automático de la factura — no hay que escribirlo.
- Guarda.

**¿Qué pasa después de guardar un Cambio de producto?**
- La venta original **no cambia en nada** — ni el total, ni los medios de pago.
- Queda una nota informativa visible en esa misma factura (dice fecha, N.º de la notacrédito y el valor).
- Ese mismo día, en **Caja → Cierre de caja**, aparece una línea "🔄 Cambio de producto (informativo)" con el valor — para que puedas contrastarlo contra Siigo. Esto **no suma ni resta** de Ventas ni de Ingreso: es solo para que, si un día no vendiste nada pero hiciste un cambio de producto de $100.000, el Cierre te lo muestre aunque Ventas siga en $0.

---

## Resumen rápido para los asesores

- **¿Te equivocaste digitando algo de HOY?** → 🛠️ Corregir factura.
- **¿Necesitas corregir algo de OTRO día?** → 🔒 Solicitar Notacrédito, y espera el botón 📝 Aplicar Notacrédito.
- **¿Hubo una notacrédito real en Siigo (con o sin cambio de valor)?** → Eso lo hace master o admin finanzas con 🧾 Notacrédito Siigo — avísales.
