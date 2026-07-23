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
  `master` (Santiago — control total), `admin` (Gestión Humana) y `advisor` (asesor).
  Ver "Séptima ronda" más abajo para el detalle del rol master.
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
desde ya (no corre en paralelo).

**Rediseño (21 jul 2026, segunda vuelta, tras la primera versión)**: Santiago pidió
tres cambios grandes sobre la primera versión:
1. Que al entrar a la sesión aparezca primero una pantalla para elegir entre
   **"La Junta Admin"** y **"Registro de Asistencia"** — son dos herramientas que no
   tienen que ver entre sí, así que se separan desde el login (solo aplica a usuarios
   admin; los asesores entran directo a marcar asistencia, igual que siempre).
2. Que los "líderes" de la Junta ya NO sean los usuarios admin del sistema (que sirven
   para iniciar sesión), sino una lista aparte de cargos: **Líder 1, Líder 2... Líder
   N**, cada uno con el nombre de quien lo ocupa en texto libre, y que se puedan
   agregar o quitar líderes cuando haga falta.
3. Que "Seguimiento semanal" sea una lista de checklist simple (tarea, quién la hace,
   fecha estimada, comentarios, check de completado) en vez de la estructura de 5
   momentos por persona que tenía la primera versión.

**Estado: construido en código (rama `staging`), pendiente de**:
1. Correr el SQL de abajo en Supabase de PRÁCTICA (`ozen-staging`) — este SQL
   REEMPLAZA las tablas de la primera versión (`junta_perfiles` y las columnas
   `junta_orden`/`junta_lider` en `usuarios` quedan sin usar, no hace falta borrarlas).
2. Publicar en la URL de práctica y probarlo con calma.
3. Desde "La Junta Admin" → "Equipo y perfiles", agregar los líderes reales (ya viene
   con espacio para 5, se pueden agregar o quitar) y usar las flechas ▲▼ para dejar a
   Santiago como Líder 1 (así la rotación mensual empieza con él).
4. Cuando esté aprobado: correr el mismo SQL en Supabase REAL (proyecto `OZEN`) y
   fusionar `staging` a `main`.

**Qué se construyó**:
- **Pantalla de selección de área** (solo para admins, justo después de iniciar
  sesión): dos botones grandes, "La Junta Admin" y "Registro de Asistencia". Cada uno
  lleva a su propio menú lateral independiente. Hay un botón "🔀 Cambiar de área" para
  volver a elegir sin cerrar sesión.
- **La Junta Admin**, con 3 pestañas en este orden:
  - **Equipo y perfiles** (primera pestaña): la lista de liderazgos — "Líder 1",
    "Líder 2", etc. — cada uno con nombre libre, objetivo y procesos macro editables,
    botón para marcar cuál es el líder fijo del equipo, y botones para agregar o
    quitar líderes.
  - **Seguimiento semanal**: checklist por semana (selector de "martes de la
    semana"). Cada tarea tiene: descripción, quién la hace (elegido de la lista de
    líderes), fecha estimada de término, comentarios/avance de texto libre, y un
    check para marcarla completada.
  - **Explicación del rol** (última pestaña): quién es el Monitor de turno (calculado
    solo según la rotación), quién es el líder fijo del equipo, la lista de funciones
    que sí/no hace el Monitor, y el guion de los 5 momentos de la reunión como
    referencia de lectura.
- **Registro de Asistencia**: exactamente lo mismo que ya existía (Panel, Registros,
  Asesores, Tiendas, Informes), ahora como su propia área separada de la Junta.

**Datos en la base de datos**: tabla `junta_lideres` (un renglón por liderazgo: orden,
nombre, objetivo, procesos_macro, si es el líder fijo del equipo) y tabla
`junta_compromisos` (un renglón por tarea del checklist: semana, descripción, a qué
líder está asignada, fecha estimada, comentarios, si está completada). Ya no se usan
`junta_perfiles` ni las columnas `junta_orden`/`junta_lider` de `usuarios` de la
primera versión — quedaron huérfanas en la base pero no estorban.

**Rotación del Monitor**: arranca el 21 de julio de 2026 con quien tenga el número más
bajo en "Equipo y perfiles" (debe quedar Santiago = Líder 1), rota cada 2 meses según
el orden de la lista. Se calcula solo, no hay que tocarlo cada semana.

**Segunda ronda de ajustes (21 jul 2026)**: Santiago pidió dos cosas más, ambas por la
misma preocupación de fondo — que alguien pueda decir después "esto nunca existió" o
manipular la información a su favor:

1. **Fecha de creación y última actualización visibles en cada perfil de líder**
   (pestaña "Equipo y perfiles"). Se agregó la columna `updated_at` a
   `junta_lideres` y se muestra debajo de cada perfil "Creado: ... · Última
   actualización: ...".
2. **Nueva pestaña "Acuerdos y decisiones"** (la última, con candado 🔒): para
   guardar decisiones tomadas en la Junta (ej. "desde la semana X la reunión es a
   las 8am"). Registra fecha del acuerdo, el texto, quién lo registró (el admin que
   tiene la sesión abierta) y el momento exacto en que se guardó.
   **Estos acuerdos NO se pueden editar ni borrar desde la aplicación — ni siquiera
   Santiago puede hacerlo una vez guardados.** Esto no es solo una regla de la
   pantalla: se configuró también a nivel de la base de datos (tabla
   `junta_acuerdos` solo tiene permiso de "agregar" y "leer", no de "modificar" ni
   "borrar"), así que aunque alguien intente cambiarlo por fuera de la aplicación,
   la base de datos lo rechaza. Es la única parte de todo el sistema con esta
   protección — el resto de los datos (incluidos los perfiles de líderes y las
   tareas del checklist) sigue siendo editable normalmente, como el resto de la app.

**Tercera ronda de ajustes (21 jul 2026)** — solo cambios de código, sin SQL nuevo:
- **Se quitó el concepto de "líder del equipo" fijo** (el botón para marcarlo, la
  insignia, todo). Santiago no le vio utilidad práctica. La columna `lider_equipo`
  en `junta_lideres` queda sin usar en la base de datos (no estorba).
- **Rotación del Monitor: ahora es mensual**, no cada 2 meses.
- **Orden de rotación editable con flechas ▲▼** en "Equipo y perfiles" — antes el
  orden solo se podía definir agregando en el orden correcto; ahora cada tarjeta
  tiene botones para subir o bajar de posición en la lista, y esa posición es
  literalmente el orden de rotación (Líder 1 primero, etc.).
- **"Explicación del rol" rediseñada**: se actualizó el texto a "rota cada mes" y se
  le dio una apariencia más profesional (números en círculos para los 5 momentos,
  cajas verdes/rojas para "sí hace / no hace" en vez de listas con viñetas planas).
- **Objetivo y Procesos macro ahora son campos de texto de varias líneas**: se puede
  dar Enter para hacer una lista numerada o con saltos de línea, y esos saltos se
  respetan al mostrarlo (antes era una sola línea de texto).
- **El texto de "Creado / Actualizado" en cada perfil ahora usa el beige de la
  marca** (`textMuted`) en vez de un gris genérico.

**Cuarta ronda — Indicadores de cumplimiento del Monitor (21 jul 2026)**: nueva
pestaña **"📊 Indicadores"** (entre "Seguimiento semanal" y "Explicación del rol").
Sin SQL nuevo — todo se calcula al vuelo con los datos que ya se estaban guardando:
- **Sesiones hechas**: de los martes que tuvo el mes (normalmente 4), cuántos tienen
  al menos una tarea registrada en el checklist.
- **Cumplimiento de tareas**: de las tareas creadas ese mes, qué % quedó marcado como
  completado.
- Muestra el mes en curso destacado arriba, y abajo un **historial mes a mes** desde
  que arrancó el módulo (julio 2026), con el nombre del monitor de cada mes — así se
  puede comparar el desempeño entre personas con el tiempo.
- La tarjeta "Monitor de turno" se movió de "Explicación del rol" hacia aquí (tiene
  más sentido junto a los indicadores). "Explicación del rol" quedó como manual de
  consulta puro (guion + funciones del Monitor), sin datos dinámicos.

**Quinta ronda (21 jul 2026)** — feedback de Santiago tras mostrárselo a Felipe:

1. **"Monitor de turno" se movió de nuevo**, esta vez a la parte de arriba de
   "Seguimiento semanal" (antes estaba en "Indicadores"). En "Indicadores" el mes en
   curso ahora solo muestra el nombre del monitor en una línea chica junto a las
   métricas, sin la tarjeta grande — el historial de abajo ya lo muestra por mes.

2. **"Equipo y perfiles" ahora tiene dos vistas** (botones arriba: "👤 Por líder" /
   "🗂️ Por área"):
   - **Por líder** (la vista que ya existía, mejorada): al editar un líder, ya no hay
     un solo campo de "procesos macro". Ahora hay un selector de **áreas** (chips que
     se activan/desactivan) y, por cada área que el líder tenga marcada, se abre un
     cuadro de texto propio para escribir los procesos macro que hace en *esa* área
     específica. Se puede crear una área nueva sin salir de la edición.
   - **Por área** (nueva): aquí se crean y administran las áreas (solo el nombre). Por
     cada área, la pantalla junta automáticamente los procesos macro que cada líder
     escribió para esa área — así se arma solo un mapa de "quién hace qué" por área,
     sin tener que definirlo aparte.
   - Un mismo líder puede pertenecer a varias áreas a la vez, y una misma área puede
     tener procesos de varios líderes.
   - El campo `procesos_macro` que antes vivía directo en `junta_lideres` ya no se usa
     (queda huérfano en la base, no estorba) — ahora ese texto vive por combinación
     de líder + área, en la tabla nueva `junta_lider_areas`.

**Datos nuevos en la base**: tabla `junta_areas` (id, nombre) y tabla
`junta_lider_areas` (relación líder↔área, con su propio texto de `procesos_macro` y
timestamps; un líder no puede tener la misma área dos veces — restricción `unique`).

**Sexta ronda (21 jul 2026)** — ajustes finales antes de presentar a la Junta:
- **Logo dentro de la app**: el menú lateral y el encabezado móvil ya no repiten el
  logo completo (el vertical con "OZEN" y la frase, pensado para pantalla de login).
  Ahora usan `public/logo-icon.png` — un ícono redondo compacto que ya existía en el
  proyecto pero no se estaba usando — y se quitó el texto ("REGISTRO DE
  ASISTENCIA"/"JUNTA ADMIN") que iba debajo. El logo completo se queda solo en la
  pantalla de login. Pendiente: Santiago mandó una imagen nueva del logo en el chat;
  si la quiere usar en vez del ícono redondo actual, debe arrastrarla directamente a
  la carpeta `public` del proyecto (Finder) y avisar el nombre del archivo para
  conectarla — desde el chat no es posible guardar imágenes adjuntas directo al
  proyecto.
- **Pestañas de La Junta Admin renombradas**: "Equipo y perfiles" → **"Perfiles y
  áreas"**, "Explicación del rol" → **"Rol de Monitor"**.
- **Orden final de las pestañas**: Seguimiento semanal, Acuerdos y decisiones,
  Perfiles y áreas, Rol de Monitor, Indicadores. Al entrar a "La Junta Admin" ahora
  abre directo en Seguimiento semanal (antes abría en Perfiles y áreas).

**Séptima ronda (21 jul 2026)** — nombre del módulo, rol master y seguridad del login:

- **El módulo se renombró a "La Junta Administrativa"** (antes "La Junta Admin"),
  en el botón del selector de área.

- **Nuevo rol `master`**: Santiago pidió una cuenta superior a `admin` que pueda ver
  y administrar a TODOS los usuarios (incluyendo otros admins), algo que antes solo
  se podía hacer directo en Supabase. Ahora existe un tercer rol, `master`, que:
  - Ve exactamente las mismas áreas que un `admin` (Registro de Asistencia y La
    Junta Administrativa) — el rol master no cambia lo que se ve ahí.
  - Dentro de "Registro de Asistencia", la pestaña "Asesores" es reemplazada por una
    pestaña **"🗝️ Usuarios"**, visible solo para cuentas master, que lista TODOS los
    usuarios (master, admin y asesor) — no solo asesores. Desde ahí se pueden crear
    usuarios de cualquier tipo, editar nombre/documento/tipo, activar/desactivar, y
    **cambiar la contraseña de cualquier usuario** con un botón nuevo (🔑) que abre
    un campo para escribir una contraseña nueva.
  - Los admins normales (no master) siguen viendo la pestaña "Asesores" de siempre,
    limitada a los asesores — no ven ni pueden tocar cuentas admin o master.
  - **Pendiente en Santiago**: convertir su propia cuenta a `master` corriendo el SQL
    de abajo (una vez en práctica, y luego en la real cuando esté aprobado).

- **Seguridad del login**:
  - El formulario de inicio de sesión ahora es un `<form>` real, así que con solo
    presionar Enter se ingresa (antes solo funcionaba el clic en "Ingresar").
  - Se le puso `autoComplete="off"` al campo de documento y `autoComplete="new-password"`
    al de contraseña, para que el navegador deje de ofrecer guardar o autocompletar
    esas credenciales. **Aviso importante**: esto reduce mucho el problema, pero
    ningún truco de código puede garantizar al 100% que un navegador nunca guarde ni
    sugiera una contraseña — cada navegador decide por su cuenta. Como medida
    adicional (fuera del código), conviene que en los computadores compartidos de
    tienda alguien borre de vez en cuando las contraseñas guardadas del navegador
    (Configuración → Contraseñas), sobre todo ahora al inicio mientras el cambio
    toma efecto en los equipos que ya tenían contraseñas guardadas de antes.

**SQL pendiente de correr** (primero en práctica, luego en la real):
```sql
-- Defensivo: por si existiera una restricción vieja que no deje usar 'master'
alter table usuarios drop constraint if exists usuarios_role_check;

-- Sustituye 'TU_DOCUMENTO' por el número de documento con el que Santiago inicia sesión
update usuarios set role = 'master' where documento = 'TU_DOCUMENTO';
```

## Pendiente / roadmap operativo (registro de asistencia)

- Reportes / exportar a Excel.
- Notificaciones de inasistencia (WhatsApp o correo).
- ~~Gestión de más de un admin desde la propia app~~ — resuelto: rol `master` +
  pestaña "Usuarios" (ver "Séptima ronda" arriba).
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
