# Ozen · Control de Personal — estado del proyecto

Última actualización: 21 de julio de 2026.

## 🔴 Si este chat se cortó y estás empezando uno nuevo, haz esto:

1. Abre Cowork.
2. Entra al proyecto **"Ozen - Página"** (NO abras un chat en blanco cualquiera).
3. Escribe: **"Lee el archivo ESTADO_PROYECTO.md y sigamos con el proyecto."**
4. Listo. Con eso, Claude ya sabe todo lo de abajo sin que tengas que explicar nada.

> Este archivo existe para que, si Santiago abre un chat nuevo con Claude, con solo decir
> "sigue con el proyecto en esta carpeta" y conectar `OZEN-WEB`, Claude pueda leer este
> documento y retomar exactamente donde quedó — sin tener que volver a explicar nada ni
> revisar chats viejos. **Claude: actualiza este archivo cada vez que termines un cambio
> importante o descubras algo relevante.**

## Qué es esto

App interna de OZEN (joyería, varias tiendas físicas) para que los asesores marquen
entrada, inicio de almuerzo, fin de almuerzo y salida con foto, y el área de Gestión
Humana (Santiago) controle asistencia, puntualidad y liquide nómina con esos datos.
Santiago **no sabe programar** — depende 100% de Claude para cualquier cambio, así que
las instrucciones siempre deben ser paso a paso, sin dar por sentado nada técnico.

## Stack y dónde vive cada cosa

- **Frontend**: React + Vite. Todo el código de la app está en un solo archivo:
  `src/App.jsx`. El cliente de Supabase está en `src/supabase.js`.
- **Backend**: Supabase (Postgres + Auth simple por documento/password + Storage para
  fotos). Proyecto Supabase: **OZEN**, plan **Free** (⚠️ sin backups automáticos — ver
  "Incidentes" abajo).
- **Hosting**: Vercel, proyecto `ozen-web` en el workspace `ozen1`.
  URL de producción: **https://ozen-web-ten.vercel.app**
- **Código fuente**: GitHub, repo `enfoquedetalento-design/ozen-web`, rama `main`.
  Vercel está conectado a este repo y publica automáticamente cada `git push` a `main`.
- **Carpeta local**: `~/Desktop/OZEN-WEB`, se edita con VS Code.

## Ambientes: práctica (staging) y real (producción)

Desde el 20 de julio de 2026 hay DOS versiones de la app, para no volver a arriesgar
datos reales al probar cosas:

- **Real / producción**: rama de git `main` → https://ozen-web-ten.vercel.app →
  Supabase proyecto **OZEN**. Datos reales de nómina.
- **Práctica / staging**: rama de git `staging` → URL de preview de Vercel (buscarla en
  Vercel → proyecto ozen-web → Deployments → el más reciente de la rama `staging` →
  botón "Visit") → Supabase proyecto **ozen-staging**
  (URL: `https://crlyzeusnbtvhwkrhcle.supabase.co`; la anon key está guardada en
  Vercel, variables de entorno con scope "Preview", no hace falta repetirla aquí).
  Datos ficticios: admin de prueba `0000`/`0000`, asesores `1111`/`1111` y `2222`/`2222`,
  tienda `Tienda Prueba`.
- Las variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` en Vercel están
  configuradas con valores distintos por ambiente: scope "Production" → base real,
  scope "Preview" → base de staging. Así cualquier rama que no sea `main` usa
  automáticamente la base falsa.

## Cómo se publica un cambio (siempre igual — SIEMPRE primero en práctica)

Desde el 21 de julio de 2026, si la carpeta `OZEN-WEB` está conectada al chat, Claude
edita `src/App.jsx` directamente (ya no hace falta copiar y pegar nada). Si en algún
chat futuro la carpeta NO está conectada, se vuelve al método anterior: Claude entrega
el código completo y Santiago lo pega él mismo en VS Code (Cmd+A, Cmd+V, luego Cmd+S).

1. Claude edita el archivo (directo, o Santiago pega el código si no hay carpeta conectada).
2. Si Santiago tiene `src/App.jsx` abierto en VS Code cuando Claude edita directo, puede
   que VS Code le pregunte si quiere recargar el archivo — decir que sí.
3. Terminal, primero a la práctica:
   ```
   git checkout staging
   git add .
   git commit -m "descripción corta"
   git push
   ```
5. Esperar ~1 minuto, abrir la URL de práctica y probar con los datos falsos.
6. Si todo bien, pasar a la real:
   ```
   git checkout main
   git merge staging
   git push
   ```
7. Esperar ~1 minuto, verificar en la URL real.

## Datos del negocio

- Tiendas activas: Unicentro (UT*), Jardín Plaza (JT*), Chipichape (CT*), Oficina (TOF).
- Llanogrande (LT*) se cerró — ya no debería tener turnos nuevos asignados.
- Login: por número de documento + contraseña (inicial = mismo documento). Roles:
  `admin` (Gestión Humana) y `advisor` (asesor).
- **Horarios / turnos — fecha de corte 2026-07-15**: el 15 de julio de 2026 cambiaron
  las horas de entrada esperadas (usadas para calcular puntualidad). El código tiene
  `SHIFT_HOURS_OLD` (hasta el 14 de julio inclusive) y `SHIFT_HOURS_NEW` (desde el 15),
  y elige cuál usar según la fecha del registro (`CUTOVER_DATE` en `App.jsx`). Solo T2
  cambió de verdad (12:10/12:40 → 12:30/13:00); lo demás quedó igual. Si en el futuro
  vuelven a cambiar horarios, replicar este mismo patrón con una nueva fecha de corte.

## Incidentes conocidos (importante no repetir)

- **20 jul 2026 — pérdida de datos real**: al eliminar un asesor desde el panel admin,
  la base de datos borraba en cascada TODOS sus registros de asistencia (relación
  `registros.user_id → usuarios.id` con `ON DELETE CASCADE`). Como el plan es Free,
  no había backup que restaurar — esos registros se perdieron para siempre.
  **Arreglado en el código**: `deleteUser` y `deleteStore` ahora primero revisan si
  hay registros asociados; si hay, bloquean el borrado y sugieren desactivar
  (`active = false`) en vez de eliminar. Pendiente confirmar si el cierre de la
  tienda Llanogrande también perdió registros (correr
  `select count(*) from registros where store = 'llanogrande';` en Supabase).
- **Pendiente (recomendado, no urgente)**: cambiar la restricción de la base de datos
  de `ON DELETE CASCADE` a `ON DELETE RESTRICT` en `registros.user_id`, como capa
  extra de seguridad por si alguien borra algo directo desde el SQL Editor sin pasar
  por la app.

## Visión de largo plazo (21 jul 2026)

Santiago es el líder de Gestión Humana y quiere que esta app deje de ser solo control
de asistencia y se convierta en su herramienta de trabajo central con su equipo.
Hoy todo esto vive repartido en una carpeta de Google Drive compartida con el equipo
administrativo (que sigue siendo la fuente de verdad para documentos por ahora).

**Módulos que Santiago quiere eventualmente (Gestión Humana):**
1. Reclutamiento y selección
2. Inducción y capacitación
3. Carpetas de los colaboradores (contratación)
4. Bienestar y desarrollo
5. Dotación
6. SST (seguridad y salud en el trabajo)

**Módulos de otras áreas que también le gustaría meter aquí más adelante:**
- Flexipago (plan de separe de productos para clientes)
- Traslados de mercancía entre tiendas
- Arreglos (de joyas, presumiblemente)
- Registro de ventas

**Cómo vamos a abordar esto**: uno por uno, aterrizando bien el alcance de cada
módulo antes de construirlo, probando siempre primero en `staging`. No se está
construyendo todo de una — cada módulo es su propio mini-proyecto. Actualizar esta
lista marcando qué está construido y qué sigue pendiente conforme avancemos.

**Primer módulo en construcción — Junta Admin / rol de Monitor**

Contexto: el equipo administrativo se reúne todos los martes 9:00am a revisar avances.
Hoy todo se registra en un Excel de la Junta ("lo que no queda en el Excel, no es
válido"). La idea es que este módulo reemplace (o al menos acompañe al inicio) ese
Excel. Miembros de la junta = los usuarios que ya existen con rol `admin`.

**Líder del equipo**: Edwin (fijo, no rota — distinto del rol de Monitor).

**Rol de Monitor — rota cada 2 meses**, empezando por Santiago (para modelar el
protocolo). El monitor de turno sigue el guion de abajo tal cual, no su estilo
personal.

Funciones del Monitor — lo que SÍ hace:
- Garantiza que la reunión pase siempre el martes 9:00am; si hay que reprogramar, lo
  resuelve el mismo día.
- Conduce la sesión con el guion fijo de 5 momentos (ver abajo), sin improvisar.
- Operacionaliza tareas vagas: qué es exactamente, cómo, cuánto tiempo, qué resultado
  queda.
- Registra todo (plan de cada uno, cumplimiento, evidencia, acuerdos) — hoy en Excel.
- Ante algo incumplido, ayuda a destrabarlo ("¿cómo lo resolvemos?"), no pregunta el
  porqué.

Lo que NO hace (esto blinda el rol):
- No juzga ni reprocha.
- No lidera el equipo (eso es de Edwin) — solo hace seguimiento de la semana.
- No ejecuta el trabajo de otros, solo lo hace visible.
- No reporta hacia arriba ni interpreta — el reporte es a la propia Junta, en vivo.

**El guion fijo de cada martes, en 5 momentos, en este orden:**

1. **Revisión de la semana anterior** (siempre se abre así)
   - ¿Qué te comprometiste a hacer la semana pasada?
   - ¿Qué quedó hecho y qué no?
   - ¿Cuál es la evidencia de lo hecho?
2. **Planeación individual de la semana** (uno por uno, todos escuchan)
   - ¿Qué vas a hacer esta semana?
   - ¿Cómo, día por día?
   - ¿Qué queda como resultado verificable de cada tarea?
3. **Operacionalización** (cuando una tarea llega vaga)
   - Eso concretamente, ¿es hacer qué? ¿Cuánto tiempo toma? ¿Con quién/dónde/con qué?
   - ¿Qué evidencia deja? Si no deja nada, ¿cómo sabremos que se hizo?
4. **Trabajo grupal** (lo compartido entre varios)
   - ¿Quién toma qué parte? ¿De qué/quién depende cada parte? ¿Acuerdo concreto y
     para cuándo? → queda registrado.
5. **Cierre — lo no previsto**
   - Además de lo planeado, ¿qué te cayó la semana pasada que no estaba previsto?
   - Importante: en un trabajo tan reactivo como el de ellos, mucho del esfuerzo real
     no fue agendado un martes. Esta pregunta existe para que ese trabajo también
     cuente y sea visible, no solo lo planeado.

**Decisiones confirmadas por Santiago (21 jul 2026)**: este módulo REEMPLAZA el Excel
desde ya (no corre en paralelo). Edwin ya existe como usuario admin en el sistema.

**Estado: construido en código (rama `staging`), pendiente de**:
1. Correr el SQL de abajo en Supabase de PRÁCTICA (`ozen-staging`).
2. Publicar en la URL de práctica y probarlo con calma.
3. Marcar a Edwin como líder y poner el orden de rotación (1 = Santiago) desde la
   pestaña "Equipo y perfiles" dentro del propio módulo — ya no hace falta SQL para eso.
4. Cuando esté aprobado: correr el mismo SQL en Supabase REAL (proyecto `OZEN`) y
   fusionar `staging` a `main`.

**Qué se construyó**: una pestaña nueva "Junta Admin" en el menú de admin, con 3
sub-pestañas:
- **Monitor y guion**: quién es el Monitor de turno (calculado automáticamente según
  la rotación), quién es el líder fijo, la lista de funciones que sí/no hace el
  Monitor, y el guion de los 5 momentos como referencia.
- **Seguimiento semanal**: la pantalla de trabajo de cada martes. Por cada admin:
  revisión de lo comprometido la semana anterior (con estado y evidencia), planeación
  de la semana actual (qué, cómo día por día, resultado esperado, fecha límite), y lo
  no previsto de la semana pasada. Debajo, una sección aparte para acuerdos de trabajo
  grupal (quién hace qué, de qué depende, para cuándo).
- **Equipo y perfiles**: marcar el líder fijo del equipo, el orden de rotación del
  Monitor, y el objetivo + procesos macro de cada admin (visible para todo el equipo).

**Datos nuevos en la base de datos**: tablas `junta_compromisos` (una fila por tarea,
sirve para revisión/planeación/no previsto/grupal según sus columnas) y
`junta_perfiles` (objetivo y procesos macro por persona), más dos columnas nuevas en
`usuarios`: `junta_orden` (número, para la rotación) y `junta_lider` (sí/no).

**Rotación del Monitor**: arranca el 21 de julio de 2026 con la persona que tenga
`junta_orden = 1` (debe ser Santiago), rota cada 2 meses en orden. Se calcula solo,
no hay que tocarlo cada vez — solo definir el orden una vez desde "Equipo y perfiles".

## Pendiente / roadmap operativo (registro de asistencia)

- Reportes / exportar a Excel.
- Notificaciones de inasistencia (WhatsApp o correo).
- Gestión de más de un admin desde la propia app (hoy se hace directo en Supabase).
- La idea de convertir esto en un producto para vender a otras empresas quedó
  mencionada pero no decidida — no es prioridad mientras la operación de Ozen no
  esté 100% estable.

## Cosas que Santiago necesita que Claude tenga siempre presentes

- Cero conocimiento de programación, literal cero — ni un término técnico sin explicar.
  El 20 de julio de 2026 Santiago pidió explícitamente: instrucciones de a un paso a la
  vez, sin mezclar explicaciones de "por qué" con el paso a seguir, y que Claude diga
  siempre explícitamente si un paso es sobre la página de **práctica** o la **real**
  para que nunca tenga que adivinar.
- Cualquier cambio que involucre `DELETE` o pueda perder datos reales de nómina debe
  tratarse con máxima precaución — confirmar antes de sugerir cualquier `UPDATE`/`DELETE`
  directo en Supabase con datos reales de producción.
- Desde ahora, cualquier cambio de código se prueba primero en `staging` (ver sección
  de ambientes arriba) antes de pasar a `main`. No saltarse este paso.
