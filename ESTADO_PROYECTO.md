# Ozen — estado del proyecto

Última actualización: 23 de julio de 2026. **La app ya está en producción (`main`)
con todo lo del rol master, visualizador, La Junta Administrativa y seguridad de
login — práctica y real están sincronizadas.**

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

**Octava ronda (23 jul 2026)** — nuevo rol Visualizador (solo lectura):

- **Nuevo rol `visualizador`**: Santiago pidió un perfil que vea exactamente lo mismo
  que un `admin` (Registro de Asistencia y La Junta Administrativa, con todas sus
  pestañas) pero que **no pueda editar, crear ni borrar absolutamente nada** — solo
  mirar. Pensado para dar acceso a personas que necesitan consultar la información
  sin riesgo de que modifiquen algo sin querer.
  - Técnicamente se hizo con un mecanismo de React llamado "contexto de solo
    lectura": quien entra con rol `visualizador` activa una bandera interna que cada
    pantalla revisa para decidir si muestra o esconde sus botones de crear/editar/
    borrar. No se duplicó ninguna pantalla — es la misma pantalla del admin, solo que
    con esos controles ocultos.
  - Pantallas ya bloqueadas para visualizador (no aparece ningún botón de crear,
    editar, activar/desactivar, borrar, ni campos donde se pueda escribir):
    "Asesores", "Tiendas", "Perfiles y áreas" (vista por líder y por área),
    "Seguimiento semanal" (no puede marcar tareas como hechas, comentar, crear ni
    borrar tareas) y "Acuerdos y decisiones" (no puede crear acuerdos nuevos — los
    acuerdos ya de por sí nadie los puede editar ni borrar, ni siquiera un master).
  - "Indicadores" y "Rol de Monitor" son pantallas de solo consulta para todo el
    mundo, así que no necesitaron ningún cambio.
  - Un visualizador **no** ve la pestaña "🗝️ Usuarios" (esa sigue siendo exclusiva de
    master) — si algún día alguien con perfil visualizador necesita cambiar de
    contraseña, eso lo debe hacer un master desde esa pestaña.
  - **Pendiente en Santiago**: crear o convertir una cuenta de prueba a `visualizador`
    corriendo el SQL de abajo, primero en práctica.

**SQL pendiente de correr** (primero en práctica):
```sql
-- Opción A: convertir un usuario existente a visualizador
update usuarios set role = 'visualizador' where documento = 'TU_DOCUMENTO';

-- Opción B: crear un usuario nuevo directamente como visualizador
insert into usuarios (nombre, documento, password, role, activo)
values ('Nombre Apellido', 'documento_aqui', 'contraseña_temporal', 'visualizador', true);
```

- **Seguridad del login — aviso de Santiago (23 jul 2026)**: Santiago probó el login
  después del cambio anterior y confirmó que el navegador **sí** ofreció guardar la
  contraseña, y al volver a entrar la autocompletó — es decir, el intento anterior
  con `autoComplete="new-password"` no fue suficiente.

- **Refuerzo del bloqueo (mismo día)**: Santiago pidió específicamente que los
  campos de documento y contraseña del login solo acepten caracteres escritos con
  el teclado. Se reforzó así:
  - Los dos campos ahora **ignoran cualquier valor que no venga de una tecla
    presionada de verdad** — si el navegador intenta rellenarlos solo (autocompletar)
    o si alguien pega texto (Ctrl+V) o lo arrastra, el campo lo rechaza y se queda
    como estaba.
  - Se bloqueó explícitamente pegar y arrastrar texto en ambos campos.
  - Se agregó una detección adicional (un truco de CSS) que nota cuando Chrome o
    Safari rellenan un campo con el resaltado amarillo típico del autocompletado, y
    lo vacía al instante.
  - Se agregaron dos campos "señuelo" invisibles antes de los campos reales, para
    que el navegador intente ofrecer guardar/autocompletar ahí y no en los campos
    verdaderos.
  - Se le cambió el nombre interno a los campos reales (ya no dicen "usuario" ni
    "contraseña" por dentro) para que el navegador los reconozca menos como un
    login típico.
  - **Sigue sin ser un 100% garantizado** — ningún truco de código puede asegurar
    eso al 100%, porque la decisión final siempre es del navegador — pero esta
    combinación es mucho más fuerte que el intento anterior y cubre los casos que
    Santiago probó. Falta que Santiago la pruebe en práctica para confirmar. La
    recomendación de borrar de vez en cuando las contraseñas guardadas en los
    computadores compartidos de tienda (Configuración → Contraseñas del navegador)
    sigue siendo una buena medida adicional mientras tanto.

**Novena ronda (23 jul 2026)** — cada usuario puede cambiar su propia contraseña, y se vence cada 90 días:

- **Botón "🔑 Mi contraseña"** disponible para TODOS los roles (asesor, admin, master,
  visualizador), en el menú lateral (computador) y en el encabezado (celular). Pide
  la contraseña actual + la nueva dos veces, valida que la actual sea correcta antes
  de guardar, y no se puede usar para ver o cambiar la contraseña de nadie más — solo
  la propia. Esto no lo bloquea el modo Visualizador, porque es sobre la propia
  cuenta, no sobre los datos de la empresa.
- **Vencimiento automático cada 90 días**: si a un usuario le corresponde cambiar la
  contraseña (pasaron 90 días desde el último cambio, o nunca se ha registrado un
  cambio), al iniciar sesión le aparece una pantalla obligatoria para cambiarla antes
  de poder ver cualquier otra cosa de la app — no se puede omitir, solo cerrar sesión.
- Para que esto funcione hace falta una columna nueva en la base de datos:
  `password_updated_at` en la tabla `usuarios`. El SQL de abajo la crea y, para que
  nadie quede forzado a cambiar su contraseña el primer día, marca a todos los
  usuarios existentes como "cambiada hoy" — el conteo de 90 días empieza a correr
  desde que se publique este cambio, no antes.
- El botón de master en "Usuarios" para cambiar la contraseña de cualquier persona
  (de la Séptima ronda) también se actualizó para que reinicie el contador de 90
  días — si un master le cambia la contraseña a alguien, a esa persona no le vuelve
  a salir la pantalla obligatoria hasta dentro de otros 90 días.

**SQL pendiente de correr** (primero en práctica):
```sql
alter table usuarios add column if not exists password_updated_at timestamptz;
update usuarios set password_updated_at = now() where password_updated_at is null;
```

**Décima ronda (23 jul 2026)** — la pestaña "Usuarios" es ahora el centro de contraseñas para master:

- Santiago notó que no tenía sentido que la cuenta master también tuviera el botón
  "🔑 Mi contraseña", porque esa cuenta ya controla las contraseñas de todos desde la
  pestaña "Usuarios". Se quitó ese botón solo para cuentas master (los demás roles
  —asesor, admin, visualizador— lo siguen teniendo, para cambiar la suya propia).
- La pestaña **"Usuarios"** ahora muestra, debajo de cada persona, su contraseña
  actual (oculta con puntos por defecto, con un botón "👁 Ver" para revelarla) y la
  fecha de la última actualización. Como esa información sale directo de la base de
  datos cada vez que se abre o se refresca la pantalla, siempre refleja lo último que
  haya hecho cada quien — si un asesor cambia su propia contraseña desde "Mi
  contraseña", a Santiago le aparece ahí mismo la nueva, con la fecha del cambio.
- El botón 🔑 junto a cada usuario se mantiene para que master pueda forzar una
  contraseña nueva cuando haga falta (por ejemplo, si alguien la olvidó) — ese cambio
  también actualiza la fecha visible y reinicia el conteo de 90 días para esa
  persona.
- **Corrección el mismo día**: Santiago probó cambiando la contraseña de un asesor
  desde la cuenta de ese asesor, y en la sesión de master (que ya llevaba un rato
  abierta) no aparecía el cambio. La causa: la pantalla de Usuarios usaba los datos
  que se cargaron al entrar a la app, y no se actualizaban solos con lo que pasa en
  otras sesiones (así funcionan casi todas las apps web, no es un error de guardado —
  el dato sí quedó bien guardado en la base de datos). Se corrigió para que la
  pestaña "Usuarios" **siempre traiga los datos más recientes de la base de datos
  apenas se entra a ella**, y además se le agregó un botón "🔄 Actualizar" por si se
  necesita refrescar sin salir y volver a entrar a la pestaña.

**Onceava ronda (23 jul 2026)** — reunión movida de día (miércoles, jueves) o que cruza de mes:

- Santiago preguntó qué pasa si la reunión de la Junta no se puede hacer el martes
  exacto, sino un día después (miércoles o jueves) — y qué pasa si el último día del
  mes es martes y la reunión se corre a miércoles, que ya es del mes siguiente.
- Antes, el campo "Semana del martes" en Seguimiento semanal guardaba literalmente el
  día que se eligiera. Si alguien elegía un miércoles o jueves en vez del martes, esa
  semana quedaba archivada bajo una fecha que no es martes — y como Indicadores solo
  cuenta martes reales de cada mes, esa sesión **desaparecía** de las estadísticas
  (no contaba ni para el mes viejo ni para el nuevo).
- **Corregido**: ahora, sin importar qué día se elija en ese campo, la aplicación lo
  archiva sola bajo el martes real de esa semana — incluso si ese martes queda en el
  mes anterior al de la fecha elegida. Se probó exactamente el caso que Santiago
  planteó (30 de junio de 2026, que es martes, con la reunión corrida a miércoles 1
  de julio) y queda archivada correctamente bajo el 30 de junio. Se le agregó un
  mensaje de ayuda debajo del campo explicando este comportamiento.
- El Monitor del mes no se ve afectado por nada de esto — rota por mes calendario,
  no por martes específicos (ver la conversación anterior sobre meses de 5 martes).

**Doceava ronda (23 jul 2026)** — primer paso a producción:

- Se llevó la base de datos REAL (`OZEN`) al mismo estado que práctica: se borró la
  cuenta de prueba "Admin" (documento 2548, confirmado sin registros asociados), se
  crearon las tablas de La Junta Administrativa con la misma seguridad (Acuerdos
  sigue sin poderse editar ni borrar), se agregó la columna de vencimiento de
  contraseña, y se asignaron los roles: Santiago Rodríguez → master, Shanon Montero
  y Sebastián Montero → visualizador.
- Las dos cuentas de Paolo García (admin + advisor) se dejaron tal cual — es
  intencional, hace turnos de asesor además de su rol admin.
- Se fusionó `staging` a `main` y se publicó en la URL real
  (https://ozen-web-ten.vercel.app). Santiago confirmó que todo quedó funcionando
  correctamente y que no se perdió ningún registro ni usuario existente.
- **Desde ahora, `main` tiene todo lo que tenía `staging`** — los dos ambientes están
  sincronizados. Cualquier cambio nuevo debe seguir el mismo proceso: primero
  `staging`, probar, y solo después fusionar a `main`.

## Módulo "Inducciones y capacitaciones" (29 sep 2026) — en `staging`, sin probar

**Estado**: código listo en `staging` (`src/App.jsx`) + SQL en `sql/capacitaciones.sql`.
Pendiente: correr el SQL en Supabase de PRÁCTICA, probar, y después (SQL en la real +
fusionar a `main`).

- **Área nueva "Capacitación"** (en celular dice "Cursos") para admins, y pestaña
  "Capacitación" para asesores.
- **Cursos → lecciones en orden** (video por link de YouTube/Drive, PDF subido al
  Storage `capacitacion-pdfs`, o texto) → **quiz final** de opción múltiple.
- El quiz se habilita cuando la persona marcó todas las lecciones como vistas. Se
  aprueba con el % mínimo del curso (por defecto 80). Reintentos ilimitados; preguntas y
  opciones salen en orden aleatorio en cada intento; al terminar ve puntaje + correcciones.
- **Fecha de finalización** = primer intento aprobado. Curso sin preguntas = completado al
  ver todas las lecciones.
- **Permisos**: toman cursos asesores y admins (no visualizador ni cuentas de tienda);
  crean/editan cursos master y admin_turnos; ven "Progreso" todos los admins y visualizador.
- Lecciones vistas e intentos solo se agregan (la base no deja editarlos ni borrarlos).
  Un curso con avance no se puede eliminar, solo archivar. `usuario_id` se guarda como
  texto sin relación a `usuarios`, para que borrar un usuario nunca toque este historial.
- **Lecciones tipo "Presentación" (7 oct 2026)**: se pega el link de Canva, Google
  Slides, PowerPoint en línea (código de "Insertar") o un .pptx en Google Drive, y la app
  muestra solo las diapositivas, con botón de pantalla completa. Requiere el SQL
  `sql/capacitaciones_02_presentaciones.sql` (ya incluido en `sql/capacitaciones.sql`
  para cuando se corra en la base real).
- En las pestañas "Mis cursos" y "Administrar cursos" el cierre por inactividad es de 2
  horas (antes, a los 5 min se cerraba la sesión en medio de un video).
- Limitación conocida: como el login no usa Supabase Auth, alguien con conocimientos
  técnicos podría ver las respuestas correctas desde el navegador (igual que hoy puede
  leer cualquier tabla). Solución de fondo: migrar el login a Supabase Auth (proyecto aparte).

- **Quiz por lección (8 oct 2026)**: cada lección puede tener su propio quiz; con
  "en orden" activo, la siguiente lección se desbloquea al aprobar el quiz (80%) o, si la
  lección no tiene preguntas, al marcarla como vista. Preguntas de una o de varias
  respuestas correctas (todas o nada), con imagen (Storage `capacitacion-imagenes`) y
  explicación opcional. SQL: `sql/capacitaciones_03_quiz_por_leccion.sql`.
- **Curso "Inducción Asesor Comercial"**: `sql/capacitaciones_04_curso_induccion.sql`
  crea el curso, 8 lecciones (Presentación, sin link) y las 66 preguntas de la evaluación
  #1 del Forms. Las 14 fotos de tejidos están en `public/capacitacion/tejidos/`. Las 8
  presentaciones (diseño "Momento presente") se entregaron como .pptx para subir a
  Google Drive y pegar el link en cada lección. Pendiente: contenido de la lección 3
  (Siigo, la arma Felipe), quiz de la lección 4, evaluaciones 2 a 5 del Forms.

- **Escuela OZEN y navegación (8 oct 2026)**: el módulo se llama "Escuela OZEN" (en celular,
  "Escuela"); internamente el área sigue siendo `capacitacion`. Todos los admins (master,
  admin, admin finanzas, admin turnos) pueden administrar cursos; el visualizador solo ve
  el progreso. Los asesores ahora también ven la pantalla de módulos al entrar
  (Asistencia y Escuela OZEN) y el selector de áreas arriba. "Firmar documento" dejó de ser
  módulo/pestaña: se abre desde el menú de la cuenta (la inicial, arriba a la derecha),
  para todos menos las cuentas de tienda.

## Módulo "Permisos" (9 nov 2026) — Fase 1 en `staging`, sin probar por Santiago

Tablero SOLO para master que muestra qué puede hacer cada rol y cada persona. Se construye en 4
fases; cada una se cierra confirmando con Santiago antes de seguir.

- **Fase 1 (hecha, solo lectura, no cambia ningún comportamiento):** en `src/App.jsx`, justo antes
  de `TiendasAccesoScreen`, están `PERM_GRUPOS` y `PERMISOS` (59 permisos en 9 grupos, 18
  sensibles), `permDePersona`, `permEtiquetasDe`, `permAvisos`, `PermisosScreen` y
  `UsuariosYPermisos`. Se entra igual que a Usuarios (mantener presionado el logo): ahora hay dos
  pestañas, Usuarios y Permisos. Permisos tiene "Matriz por rol" y "Por persona". No hace ninguna
  consulta nueva a Supabase: usa `users` y `juntaLideres` que ya están cargados.
- **Ojo:** `PERMISOS` es una FOTO de las comprobaciones repartidas por el código
  (`user.role==="master"`, `esAdminDeVentas`, `puedeGestionarTurnos`, `soloLectura`...). Todavía
  ninguna pantalla lee de ahí. Si se cambia una comprobación, hay que actualizar su fila.
- Santiago decidió: el tablero muestra lo que el código HACE (no lo que dice el texto
  `ROLE_PERMISOS`, que en "Administrador" está mal: dice que puede crear/editar asesores y tiendas
  y en realidad solo master y admin_turnos pueden). La entrada va escondida junto a Usuarios.
- Inventario para que Santiago lo revise y comente: documento "Inventario de permisos — OZEN-WEB
  (Fase 1)" → https://claude.ai/artifact/XQpDVq6WPUMC7H3vpnohGa
- **Revisión del inventario por Santiago (9 nov 2026, noche):** subió la Fase 1 a `staging`
  (commit `1f21166`) y corrigió el documento. Ya aplicado en `staging`: el Visualizador ahora VE
  la pestaña Registrar venta en modo solo ver, igual que un Admin (`puedeVerRegistrar`); se
  corrigieron los textos de `ROLE_PERMISOS` (Administrador, Admin Turnos, Visualizador); y el
  inventario quedó al día. Confirmó que quiere dejar así: Admin y Admin Turnos pueden llenar
  Registrar venta sin guardar ("me gusta que vean cómo funciona"), ven Caja sin poder tocar y sí
  reciben recolecciones; el Visualizador marca asistencia y firma documentos.
- **Paolo / "Equipo admin" en Métricas:** el Top junta en una sola fila a los administrativos que
  tienen meta ese mes; Paolo queda por fuera (aparece solo, como un asesor) porque cubre un turno
  completo de asesor. Los otros 4 ya no cubren turnos, así que esa fila ya casi no aparece. Sigue
  escrito por nombre en el código (`FUERA_DE_EQUIPO_ADMIN`); no se cambió nada.
- **Fase 2 (hecha en `staging` el 9 nov 2026, falta que Santiago corra el SQL y la pruebe):**
  - `sql/permisos_fase2.sql` crea `permisos_roles` (una fila = ese rol SÍ tiene ese permiso;
    `condicion` vacía = siempre), `permisos_excepciones` y `permisos_historial`, y siembra
    `permisos_roles` con exactamente lo que dice `PERMISOS` (61 permisos, 200 filas). Los
    `usuario_id` van como texto y sin relación a `usuarios`, igual que en capacitaciones.
    Si se cambia `PERMISOS` hay que regenerar ese archivo (sale del propio código).
  - El tablero consulta `permisos_roles` UNA vez al abrirse y muestra si la base coincide con el
    código (`permCompararConBase`). El código sigue mandando: nada lee todavía de la base.
  - Tablero rediseñado (Santiago lo veía "ladrilludo"): pestañas Roles (tarjetas con nivel de
    acceso por área), Personas, ¿Quién puede…?, Monitor y líderes, y Tabla completa.
  - **Líder ↔ cuenta:** columna `junta_lideres.usuario_id`; se enlaza en Permisos → Monitor y
    líderes (solo master). `liderEsDeUsuario` usa el enlace y, si no hay, compara por nombre como
    antes. Cada enlace deja rastro en `permisos_historial`.
  - **Pedir borrado de tareas:** columnas `borrado_solicitado_por` / `_en` en
    `junta_compromisos`. El monitor pide borrar una tarea vencida o cumplida; master ve los
    pedidos arriba en Seguimiento y aprueba (borra) o rechaza.
- **Fase 3 (en curso — Caja migrada en `staging` el 12 nov 2026, falta que Santiago la pruebe):**
  - Santiago cerró la Fase 2 el 12 nov: base al día (200 de 200), probó enlazar líderes y pedir
    borrado, y el tablero nuevo le gustó.
  - Función única `puede(user, "permiso", hechos?)` en `src/App.jsx` (después de
    `permCompararConBase`). Orden: excepción personal → rol en `permisos_roles` → si la base no se
    pudo leer, última copia buena en el navegador y, si no hay, el código (`PERMISOS`). Un
    permiso desconocido nunca se concede; uno SENSIBLE sin sembrar en la base solo lo tiene
    master; master nunca pierde `cuenta.permisos` ni `cuenta.usuarios`.
  - `permisos_roles` y `permisos_excepciones` entran a `FUENTES` (se cargan al abrir, con el pulso
    de versiones). `sql/permisos_fase3.sql` les instala el disparador del pulso.
  - **Caja ya pregunta con `puede()`**: pestaña, registrar, fecha libre, recolección (registrar y
    quién recibe), aprobar/editar novedades, borrar, pedir y resolver borrados, detalle del
    cálculo. Probado rol por rol contra las comprobaciones viejas: cero diferencias. Lo de "su
    tienda" de la cuenta de tienda sigue amarrado a `esCuentaTienda` (no es un permiso).
  - **Ventas migrada el 13 nov 2026 (en `staging`, falta que Santiago la pruebe):** Registrar,
    Lista y correcciones (dentro de `VentaCard`) y Métricas preguntan con `puede()`; las pestañas
    salen de `PERMISO_DE_TAB_VENTAS`; `esVendedorPosible` usa `ventas.vendedor`. Para "solo hoy"
    se pasa `{ hoy: v.fecha===todayStr }`. Probado rol por rol: cero diferencias. Sigue por rol
    (no es permiso todavía): entrar al área Ventas (`puedeUsarVentasArea`, `areasPara`).
  - Decisión de Santiago (13 nov): seguir migrando en `staging` y pasar TODO a `main` al terminar
    la Fase 3, no por partes.
  - Santiago probó Ventas el 13 nov (revisión rápida con las tres cuentas): bien.
  - **Asistencia y Turnos migrados el 13 nov 2026 (en `staging`, falta que Santiago los pruebe):**
    pestañas con `PERMISO_DE_TAB_ASISTENCIA` (`tabsAsistencia`, `tabsAsesor`); corregir
    marcaciones = `asistencia.registros.corregir`; avisos de marcación = `asistencia.avisos`.
    Turnos ya no usa un solo "puedeGestionar": `permisosTurnos(user)` da editar, publicar,
    asesores, tiendas, especiales, horarios y mallaActivos por separado, y `TurnosScreen`,
    `TurnosEditarScreen` y `TurnosAdminScreen` reciben `permisos`. Cero diferencias rol por rol.
  - Santiago probó Asistencia y Turnos el 13 nov (revisión rápida): bien.
  - **La Junta, Escuela y Cuenta migrados el 13 nov 2026 (en `staging`, falta que los pruebe):**
    `puede()` ahora entiende las condiciones "si es Monitor" y "si es su tarea" con
    `{ monitor:… }` / `{ suTarea:… }`. Perfiles y áreas usa `JuntaEquipoEditarContext`. En el
    menú de la cuenta, "Acceso tiendas" y "Mi contraseña" salen solo si el permiso es sin
    condición (`permCondicion(...)===null`), para que master siga sin verlos (los maneja desde
    Usuarios). El logo abre Usuarios con `cuenta.usuarios` y la pestaña Permisos con
    `cuenta.permisos`. Cero diferencias rol por rol (147 comparaciones).
  - **Lo único que sigue por rol:** la navegación entre áreas (`puedeUsarAreas`, `areasPara`,
    `eligeModulo`, `puedeUsarVentasArea`, `AreaSelector`) y "Operaciones" (su chat). Con eso la
    Fase 3 queda lista para pasar a `main` cuando Santiago lo apruebe: ANTES correr en la base
    real `sql/permisos_fase2.sql` y `sql/permisos_fase3.sql`. El tablero todavía pinta desde `PERMISOS` (código).
  - **13 nov 2026 — Santiago probó Caja en `staging` (11 pasos, 3 tipos de cuenta): equivalente.**
    Ajustes que pidió ese día: (1) quien solo mira Caja (admin, admin turnos, visualizador) ahora
    entra por Registrar, sin el velo transparente ni el aviso: puede llenar los campos pero
    ningún guardar le funciona (`avisoSoloVer`); (2) borrar y pedir/aprobar borrados en Caja usan
    una confirmación propia de la app (`pedirConfirmacion`) en vez de `window.confirm`, porque en
    su navegador la ventanita no salía y borraba sin preguntar; (3) en Registrar venta, el
    "Recibo en curso" muestra la fecha completa en vez de "Hoy".
  - Para probar hay datos falsos en práctica: `sql/staging_datos_prueba.sql` (15 días de ventas y
    caja marcados con [PRUEBA]; se detiene solo si la base tiene movimiento real reciente) y
    `sql/staging_datos_prueba_borrar.sql`. No hace falta subirlos con git.
- **REGLA PARA TODOS LOS CHATS — confirmaciones:** ya NO se usa `window.confirm`. Para preguntar
  "¿seguro?" se usa `confirmar("texto")` (definida antes de `Card` en `src/App.jsx`), dentro de una
  función `async`: `if(!await confirmar("¿Borrar esto?")) return;`. Muestra un recuadro propio de
  la app (`ConfirmacionGlobal`, montado en `App`). Motivo: en el navegador de Santiago la ventanita
  del navegador no salía y la acción seguía sin preguntar. El 13 nov 2026 se cambiaron las 20 que
  había en toda la app (Asistencia, Usuarios, Turnos, La Junta, Escuela) y las 6 de Caja.
  Tampoco se usa `window.prompt`: cuando hay que ESCRIBIR una palabra para confirmar se usa
  `if(!await confirmarEscribiendo("texto", "BORRAR")) return;` (mismo recuadro, con un campo; no
  importan mayúsculas). Así quedaron las 4 de Ventas: reabrir Flexipago (REABRIR), Notacrédito y
  Corregir factura (CORREGIR) y Eliminar venta (BORRAR). Nota: en la máquina de práctica ESLint
  sobre `src/App.jsx` ya tarda unos 3 minutos; si se corta, correrlo otra vez o por fuera.
- **REGLA PARA TODOS LOS CHATS — permisos de módulos nuevos:** un módulo nuevo NO edita la lista
  `PERMISOS`. Declara sus permisos junto a su propio código con
  `registrarPermisos({ grupo, label, ic, permisos:[{ id, label, r:{ rol:1 | "condición" },
  sensible?, soloVer?, pedir?, pasivo?, nota? }] })` (tiene que ir más abajo de donde se define
  esa función) y pregunta con `puede(user, "modulo.accion")` en vez de `user.role===...`. El
  tablero de Permisos los muestra solo y avisa si falta sembrarlos en la base. Operaciones aún
  usa su propio `OPER_PERMISOS`; pasarlo a este formato le toca al chat de Operaciones.
- **Fase 4 (pendiente):** editar con interruptores, "Ver como", historial y alertas. Master nunca
  debe poder quitarse a sí mismo el permiso `cuenta.permisos`.
- Las ramas `main` y `staging` tienen historias distintas (100 y 37 commits propios) aunque el
  código es casi igual: revisar con cuidado antes de pasar este módulo a `main`.

## Módulo "Operaciones" (10 nov 2026) — Parte 1 en `staging`, sin probar por Santiago

Reemplaza al Excel "Operaciones" de Google Sheets (hojas OP EXTERNO, OP INTERNO, ORDEN y Gestión
de garantías). Alcance definido con Santiago el 10 nov 2026; se construye en 4 partes, cada una
probada en práctica antes de seguir.

**Decisiones de Santiago (no cambiar sin preguntarle):**
- Área nueva "Operaciones". Entran las cuentas de tienda y los administradores; el Visualizador
  solo mira; los asesores con su cuenta individual NO entran.
- **Líder de Operaciones: Edwin**, de internas y de externas. No va amarrado al nombre en el
  código: Master lo elige en la pantalla (tabla `operaciones_config`, clave `lider_usuario_id`).
  El líder (y Master) es quien cancela, devuelve una etapa, decide las garantías y cierra internas.
- **Externas** (todo lo que tiene que ver con un cliente): Arreglo, Marcación, Garantía, Traslado
  y Pedido. Separado, Factura y Grabado NO entran: se quedan en Ventas.
- **Toda orden nace en Operaciones** al recibir la pieza. El cobro en Registrar venta se enlazará
  a la orden después (parte 4). Ojo: Registrar venta hoy solo guarda datos del cliente en Flexipago.
- Etapas: arreglo / marcación / garantía = Recibida en tienda → En taller o gestión → Lista en
  tienda → Entregada al cliente. Traslado = Solicitado → Enviado por la tienda de origen →
  Recibido en la tienda destino → Entregado al cliente. Pedido = Solicitado → Pedido en gestión →
  Llegó a tienda → Entregado al cliente. Cualquiera se puede Cancelar (con motivo; no se reabre).
- Garantía: no avanza hasta que el líder marque "Se cubre" o "No se cubre" con su respuesta. Si no
  se cubre, salta de Recibida a Lista en tienda (para devolverle la pieza al cliente).
- Estado de pago: Pago, Debe o No aplica (como en el Excel).
- **Internas** (lo que no tiene que ver con clientes): Insumos, Novedad, Arreglo del inventario,
  Arreglo del punto; tienda o "Global". Estados: Nueva → En gestión → Completada o Rechazada (con
  motivo). Se quitó "En revisión" del Excel. Toda solicitud nace "Nueva" (en el Excel se quedaban
  sin estado y había 26 abiertas desde 2024-2025).
- Primera versión incluye: orden para el cliente (con el aviso de los 60 días y la fecha estimada
  de entrega), indicadores y alertas de atraso. La foto de la pieza quedó para después.
- **Atraso = 5 días hábiles sin moverse** (internas y externas), más el aviso de pieza sin
  reclamar a los 60 días. Falta confirmar con Santiago si el sábado cuenta como hábil.
- Se empezó en limpio: no se pasa el historial del Excel; la numeración sigue desde **1802**.

**Parte 1 — Externas (hecha en `staging`, falta que Santiago corra el SQL y la pruebe):**
- `sql/operaciones.sql` crea `operaciones_externas`, `operaciones_internas` (ya queda lista para
  la parte 2) y `operaciones_config`. Ids de usuario y tienda como texto, sin relación a
  `usuarios`/`tiendas`. A propósito NO hay permiso de borrar: una orden se cancela, no se borra.
- En `src/App.jsx`, justo antes de `export default function App`: bloque "OPERACIONES" con
  `OPER_PERMISOS` / `puedeOper`, `OPER_ETAPAS`, `OperNuevaOrden`, `OperOrdenCard`,
  `OperOrdenCliente`, `OperLider` y `OperacionesExternasScreen`. Área `operaciones` en
  `AREAS_NAV` y `AreaSelector`, pestaña `op_externas`; la cuenta de tienda la ve como una pestaña
  más ("Operaciones") junto a Ventas y Turnos.
- **Permisos por acción con nombre** (para pasarlos luego al tablero de Permisos; hoy NO están en
  `PERMISOS` ni en `permisos_roles`): `operaciones.ver`, `operaciones.externas.crear`,
  `.externas.avanzar`, `.externas.pago`, `.externas.devolver`, `.externas.cancelar`,
  `operaciones.garantias.decidir`, `operaciones.lider.asignar`.
- **Consumo de Supabase:** Operaciones NO va en `loadAll`. `cargarOperaciones` (en `App`) solo
  corre al entrar al área, trae lo abierto + lo cerrado en los últimos 90 días (la cuenta de
  tienda, solo lo suyo y los traslados donde es origen o destino) y no repite si la última carga
  tiene menos de 5 minutos. "Traer todo el historial" usa `traerTodo`.
- Cada cambio se guarda solo si la orden sigue en la etapa que se estaba viendo (evita que dos
  computadores se pisen). Cada movimiento queda en `historial` (jsonb) con quién y cuándo; en la
  cuenta de tienda se elige el nombre de quien hace el movimiento.
- Revisado el 10 nov 2026: parseo con `@babel/parser` OK y `eslint` sin errores de `no-undef`.

**Ajustes tras la primera prueba de Santiago (10 nov 2026, en `staging`, sin SQL nuevo):**
- **Traslado y Pedido salieron del módulo**: ya se manejan en OZEN Club (página de catálogo e
  inventarios, https://catalogo.ozenjoyeria.com/catalogo). Externas = Arreglo, Marcación y
  Garantía. Las etapas de traslado/pedido siguen en `OPER_ETAPAS` solo para mostrar órdenes viejas.
- **Días hábiles = lunes a viernes sin festivos de Colombia** (`festivosColombia`, `esDiaHabil`,
  `sumarDiasHabiles`, `diasHabilesEntre`; los festivos se calculan para cualquier año). La fecha
  estimada de entrega se sugiere a 15 días hábiles; el atraso (parte 3) son 5 días hábiles.
- **Cliente**: solo nombre y teléfono (sin documento). Al escribir 2 o más caracteres en
  cualquiera de los dos se sugieren clientes que ya existen (órdenes cargadas + Flexipagos).
- **Una orden no puede quedar en $0**: o lleva valor (nace "Debe") o se marca "No aplica".
- **Cobro (reemplaza la "parte 4")**: la orden tiene un botón "Cobrar" que lleva a Registrar venta
  con tipo, valor y observación ya puestos (`ordenACobrar` en `App`). Al registrar la venta, el N.º
  de factura queda como `OP-<numero>` (si en el recibo va un producto, manda el de Siigo), y la
  orden pasa sola a "Pago" con `venta_id` y un movimiento "cobro" en su historial. Cobran quienes
  ya pueden guardar ventas: cuentas de tienda, Master y Admin Finanzas
  (`operaciones.externas.cobrar`). El pago a mano solo lo corrige el líder o Master.

**Lo que sigue:** parte 2 = pantalla de Internas (la tabla ya existe). Parte 3 = Indicadores y
alertas de atraso.

## Pendiente / roadmap operativo (registro de asistencia)

- Reportes / exportar a Excel.
- Notificaciones de inasistencia (WhatsApp o correo).
- ~~Gestión de más de un admin desde la propia app~~ — resuelto: rol `master` +
  pestaña "Usuarios" (ver "Séptima ronda" arriba).
- ~~Perfil de solo consulta~~ — resuelto: rol `visualizador` (ver "Octava ronda"
  arriba).
- ~~Reforzar bloqueo de guardar/autocompletar contraseña en el login~~ — reforzado
  (ver "Octava ronda" arriba). Pendiente que Santiago lo pruebe en práctica para
  confirmar que ya no se guarda ni autocompleta.
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
