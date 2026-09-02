import { useState, useRef, useCallback, useEffect, createContext, useContext, Fragment } from "react";
import { supabase } from "./supabase";
import { activarNotificacionesPush, notificacionesSoportadas, pushActivo, requiereInstalarEnIOS } from "./push";
import { sonidoVenta, sonidoEntrada, sonidoSalida, sonidoCierreCaja, sonidoFlexipagoCompletado, sonidoTareaCumplida, sonidoError, sonidoBienvenida } from "./sounds";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).href;

// ── Contexto de solo-lectura (rol "visualizador") ───────────────────────────────
const ReadOnlyContext = createContext(false);
const useReadOnly = () => useContext(ReadOnlyContext);

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  gold: "#265D7F", goldLight: "#E5D5CC", goldDark: "#1A3B52",
  dark: "#0D1117", surface: "#1A3B52",
  surfaceAlt: "#153047", surfaceHover: "#1E4260", border: "#265D7F",
  borderGold: "rgba(229,213,204,0.25)", text: "#E5D5CC",
  textMuted: "#B8A49C", textSub: "#D4C4BB",
  green: "#2ECC71", greenDim: "rgba(46,204,113,0.12)",
  red: "#E74C3C",   redDim: "rgba(231,76,60,0.12)",
  blue: "#3498DB",  blueDim: "rgba(52,152,219,0.12)",
  amber: "#F39C12", amberDim: "rgba(243,156,18,0.12)",
  sidebar: "#112233",
};
const font = { body: "'Josefin Sans', 'Segoe UI', system-ui, sans-serif", mono: "monospace" };

const ORDEN = ["entrada", "inicio_almuerzo", "fin_almuerzo", "salida"];
const EVENT_LABELS = { entrada:"Entrada", inicio_almuerzo:"Inicio Almuerzo", fin_almuerzo:"Fin Almuerzo", salida:"Salida", omitido:"No registrado" };
const EVENT_COLORS = { entrada:C.green, inicio_almuerzo:C.amber, fin_almuerzo:C.blue, salida:C.red, omitido:C.red };

// ── Fechas Colombia ───────────────────────────────────────────────────────────
const toColombiaDate = (d = new Date()) => new Date(d.toLocaleString("en-US", { timeZone: "America/Bogota" }));
const fmt = (d) => { const c = toColombiaDate(d); return `${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-${String(c.getDate()).padStart(2,"0")}`; };
const fmtTime = (d) => { const c = toColombiaDate(d); return `${String(c.getHours()).padStart(2,"0")}:${String(c.getMinutes()).padStart(2,"0")}`; };
const todayStr = fmt(new Date());
const fmtFechaHora = (iso) => iso ? new Date(iso).toLocaleString("es-CO", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";
// Días de calendario entre dos fechas "YYYY-MM-DD" (fechaFin - fechaIni)
const diasEntre = (fechaIni, fechaFin) => Math.round((new Date(fechaFin+"T00:00:00") - new Date(fechaIni+"T00:00:00")) / 86400000);

// ── Puntualidad ───────────────────────────────────────────────────────────────
// Los horarios esperados de entrada viven en la tabla `turnos_horarios` (editable desde
// Turnos ▸ Administrar ▸ Horarios), versionados por fecha de vigencia — así un cambio de
// horario aplica hacia adelante sin alterar cómo se evaluaron los registros pasados.
// Cada fila es de una "familia" de turno (T1, T2, T3, T4, TOF — la parte que comparten
// UT1/JT1/CT1, etc.) y puede ser genérica (tienda_id null, aplica a todas las tiendas) o
// específica de una tienda (ej. Chipichape T1 entra 1 hora antes que las demás T1).
const familiaDeTurno = (shift) => {
  if (!shift) return null;
  if (shift.toUpperCase().includes("TOF")) return "TOF";
  const match = shift.match(/T(\d)/i);
  return match ? `T${match[1]}` : null;
};

const getExpectedEntry = (shift, date, store, turnosHorarios) => {
  const familia = familiaDeTurno(shift);
  if (!familia) return null;
  const mejor = filaHorarioVigente(familia, store, turnosHorarios, date);
  if (!mejor) return null;
  const dow = new Date(date + "T12:00:00").getDay(); // 0=dom,1=lun,...,5=vie,6=sab
  const isVS = dow === 5 || dow === 6;
  const hhmm = isVS ? mejor.entrada_vs : mejor.entrada_lj;
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h*60+m;
};

// `entradaCustom` ("HH:MM") anula el horario estándar del turno SOLO para ese día/persona —
// se usa para autorizaciones puntuales (ej. entrar más tarde un día por una jornada reducida)
// sin tener que crear un turno nuevo. Viene de `turnos_asignaciones.entrada_custom`.
const calcPuntualidad = (entryTime, shift, date, store, turnosHorarios, entradaCustom) => {
  if (!entryTime) return null;
  let expected;
  if (entradaCustom) {
    const [h, m] = entradaCustom.split(":").map(Number);
    expected = h*60+m;
  } else {
    expected = getExpectedEntry(shift, date, store, turnosHorarios);
  }
  if (expected === null || expected === undefined) return null;
  const [h, m] = entryTime.split(":").map(Number);
  const diff = (h * 60 + m) - expected;
  if (diff <= 5) return { puntual: true, diff: 0 };
  return { puntual: false, diff };
};
// Rango de horario esperado ("11:30am–8:00pm") para mostrar junto a la puntualidad — así se ve
// a qué hora debía entrar y hasta qué hora le tocaba trabajar ese día, sin tener que ir a
// consultar la malla de Turnos aparte. Respeta horarios especiales del día (entrada_custom /
// salida_custom) igual que calcPuntualidad.
const getExpectedRange = (shift, date, store, turnosHorarios, entradaCustom, salidaCustom) => {
  const familia = familiaDeTurno(shift);
  const fila = filaHorarioVigente(familia, store, turnosHorarios, date);
  const dow = new Date(date + "T12:00:00").getDay();
  const isVS = dow === 5 || dow === 6;
  const entradaStd = fila ? (isVS ? fila.entrada_vs : fila.entrada_lj) : null;
  const salidaStd = fila ? (isVS ? fila.salida_vs : fila.salida_lj) : null;
  const entrada = entradaCustom || entradaStd;
  const salida = salidaCustom || salidaStd;
  if (!entrada && !salida) return null;
  return `${fmtHora12(entrada)}–${fmtHora12(salida)}`;
};

// ── Junta Admin — rotación del Monitor ───────────────────────────────────────
// El Monitor rota cada mes entre los líderes, en el orden de la lista
// (se edita desde la pestaña Equipo y perfiles, con las flechas ▲▼).
// Arranca oficialmente en agosto de 2026 — el primero de la lista es monitor ese mes.
const JUNTA_ROTATION_EPOCH = "2026-08-01";
const mesesEntre = (ini, fin) => {
  const a = new Date(ini + "T12:00:00"), b = new Date(fin + "T12:00:00");
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};
const getMonitorDeMes = (lideres, anio, mes) => {
  if (!lideres.length) return null;
  const ordenados = [...lideres].sort((x, y) => (x.orden ?? 999) - (y.orden ?? 999));
  const fechaMes = `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
  const ciclo = Math.max(0, mesesEntre(JUNTA_ROTATION_EPOCH, fechaMes));
  return ordenados[ciclo % ordenados.length];
};
const getMonitorActual = (lideres) => {
  const hoy = toColombiaDate();
  return getMonitorDeMes(lideres, hoy.getFullYear(), hoy.getMonth());
};
// Compara nombres sin importar mayúsculas/tildes/espacios — para saber si la cuenta que inició
// sesión es la misma persona que el líder configurado como Monitor de turno (no hay un vínculo
// directo entre "líderes" de la Junta y las cuentas de usuario, así que se compara por nombre).
const normalizarNombre = (s) => (s||"").trim().toLowerCase();
const esMonitorActual = (user, lideres) => {
  const monitor = getMonitorActual(lideres);
  if (!monitor?.nombre || !user?.name) return false;
  // sensitivity:"base" ignora mayúsculas y tildes, así que "José" y "jose" cuentan como el mismo nombre.
  return normalizarNombre(monitor.nombre).localeCompare(normalizarNombre(user.name), "es", { sensitivity:"base" }) === 0;
};
// Suma (o resta, con n negativo) n días de calendario a una fecha "aaaa-mm-dd".
const sumarDias = (fechaStr, n) => fmt(new Date(new Date(fechaStr+"T12:00:00").getTime() + n*86400000));
// Fechas (aaaa-mm-dd) de todos los martes de un mes calendario dado.
const martesDelMes = (anio, mes) => {
  const dias = [];
  const d = new Date(anio, mes, 1, 12);
  while (d.getMonth() === mes) {
    if (d.getDay() === 2) dias.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return dias;
};
// Una tarea vence en su fecha_estimada (por defecto el martes de la siguiente semana, editable
// a una fecha más lejana) — es cuando se revisa en la siguiente reunión si se cumplió o no. Si
// pasa ese día y no se marcó completada, queda cerrada como "no realizada" sin poder marcarse.
const tareaVencidaNoRealizada = (t) => !t.completado && !!t.fecha_estimada && todayStr > t.fecha_estimada;
// Al marcar una tarea como hecha hay 5 minutos de gracia para desmarcarla por si fue un error
// (típico durante la reunión en vivo). Pasado ese tiempo queda fija.
const GRACIA_DESMARCAR_MS = 5 * 60 * 1000;
const dentroDeGracia = (t) => !!t.completado_en && (Date.now() - new Date(t.completado_en).getTime()) < GRACIA_DESMARCAR_MS;
// El monitor de turno solo puede gestionar (marcar, reabrir, borrar) las tareas de su mes en
// curso. La última semana del monitor anterior queda editable un poco más — durante la semana 1
// y la semana 2 del mes nuevo — por si la reunión de traspaso se corrió de fecha. A partir de la
// semana 3 del mes nuevo, esa última semana también se congela: todo el mes anterior queda de
// solo lectura (salvo para master), para que el indicador de un mes ya cerrado no se pueda
// alterar después de que ese monitor entregó el turno.
const fronteraCongelamiento = () => {
  const hoy = toColombiaDate();
  const anio = hoy.getFullYear(), mes = hoy.getMonth();
  const semanasMes = martesDelMes(anio, mes);
  const terceraSemana = semanasMes[2];
  if (terceraSemana && todayStr >= terceraSemana) {
    // Ya empezó la semana 3 del mes en curso: el mes anterior queda congelado por completo.
    return semanasMes[0] || null;
  }
  // Semana 1 o 2 del mes en curso: todavía se puede tocar la última semana del mes anterior.
  let anioPrev = anio, mesPrev = mes - 1;
  if (mesPrev < 0) { mesPrev = 11; anioPrev -= 1; }
  const semanasMesAnterior = martesDelMes(anioPrev, mesPrev);
  return semanasMesAnterior.length ? semanasMesAnterior[semanasMesAnterior.length - 1] : null;
};
const semanaCongelada = (semanaTarea) => {
  const frontera = fronteraCongelamiento();
  return !!frontera && !!semanaTarea && semanaTarea < frontera;
};
// Mes al que se le "atribuye" una tarea ya cerrada, para efectos de indicadores — no es el mes en
// que se asignó (c.semana), sino el mes en que de verdad se resolvió: para una cumplida, el mes en
// que se marcó (completado_en); para una vencida, el mes en que venció (fecha_estimada, que es
// cuando pasa a vencida sola, sin que nadie la marque). Así una tarea de la última semana de un mes
// que se revisa ya en el mes siguiente (o con el Monitor nuevo) cuenta para el mes en que en
// realidad se cumplió o venció, no para el mes en que se creó — "lo que pasó ya pasó". Si faltan
// esos campos por datos antiguos, se usa `semana` como respaldo para no perder el dato.
const mesDeCierre = (t) => {
  if (t.completado) return (t.completado_en ? fmt(new Date(t.completado_en)) : t.semana || "").slice(0,7) || null;
  if (tareaVencidaNoRealizada(t)) return (t.fecha_estimada || t.semana || "").slice(0,7) || null;
  return null; // sigue activa — todavía no se cierra, no cuenta para ningún mes.
};
// Indicadores de un mes: sesiones registradas (martes con al menos una tarea) y % de tareas completadas.
// "Sesiones" y "tareas asignadas" se cuentan por `semana` (cuántas reuniones hubo y cuántas tareas
// salieron de ellas ese mes) — eso no cambió. El % de cumplimiento, en cambio, se calcula sobre las
// tareas CERRADAS EN ese mes (ver mesDeCierre arriba), vengan de la semana que vengan — una tarea
// todavía activa (no completada, dentro de plazo) no cuenta ni a favor ni en contra todavía, porque
// todavía puede completarse. Contarla de una vez castigaba el % de más, de forma injusta.
// "activas" (el aviso de "X todavía activas, no cuentan aún") solo tiene sentido para el MES EN
// CURSO — una vez arranca el mes del siguiente Monitor, ese mes ya quedó atrás: cualquier tarea
// suya que siga sin cerrar no va a contar para ese mes nunca (va a contar para el mes en que
// realmente se cierre, sea cual sea — ver mesDeCierre), así que ya no tiene caso mostrarla como
// "pendiente de este mes". Por eso en un mes ya pasado siempre da 0.
const statsDelMes = (compromisos, anio, mes) => {
  const martes = martesDelMes(anio, mes);
  const mesStr = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  const sesiones = new Set(tareas.map(t => t.semana)).size;
  const cerradas = compromisos.filter(c => mesDeCierre(c) === mesStr);
  const completadas = cerradas.filter(t => t.completado).length;
  const hoy = toColombiaDate();
  const esMesEnCurso = anio===hoy.getFullYear() && mes===hoy.getMonth();
  const activas = esMesEnCurso ? tareas.filter(t => !t.completado && !tareaVencidaNoRealizada(t)).length : 0;
  const pct = cerradas.length ? Math.round((completadas / cerradas.length) * 100) : null;
  return { totalMartes: martes.length, sesiones, totalTareas: tareas.length, completadas, totalCerradas: cerradas.length, activas, pct };
};
// Cumplimiento de tareas, pero desglosado por cada líder — no todos cargan el mismo peso ni la
// misma cantidad de tareas, así que el % se calcula individualmente (completadas ÷ cerradas). Igual
// que en statsDelMes, "total" (cantidad asignada) sigue por semana, pero el cumplimiento (cerradas/
// completadas/pct) se atribuye al mes real de cierre.
const statsPorLiderDelMes = (compromisos, lideres, anio, mes) => {
  const martes = martesDelMes(anio, mes);
  const mesStr = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  const cerradasMes = compromisos.filter(c => mesDeCierre(c) === mesStr);
  return lideres
    .map(l => {
      const deLider = tareas.filter(t => t.lider_id === l.id);
      const cerradasLider = cerradasMes.filter(t => t.lider_id === l.id);
      const completadas = cerradasLider.filter(t => t.completado).length;
      const pct = cerradasLider.length ? Math.round((completadas / cerradasLider.length) * 100) : null;
      return { lider: l, total: deLider.length, completadas, totalCerradas: cerradasLider.length, pct };
    })
    .filter(x => x.total > 0 || x.totalCerradas > 0)
    .sort((a,b) => (a.lider.nombre||"").localeCompare(b.lider.nombre||""));
};
// Indicadores de la Junta: un solo color (azul) para cualquier % cumplido, sin el semáforo
// rojo/ámbar/verde — ahí no se busca presionar, solo mostrar el dato. La única señal que cambia
// con el % es qué tan "lleno" se ve el badge — ver intensidadPct, usada con el prop `intensity`
// de Badge.
const colorCumplimientoTexto = (pct) => pct===null || pct===undefined ? C.textMuted : C.blue;
const intensidadPct = (pct) => pct===null || pct===undefined ? 0.15 : Math.max(0, Math.min(1, pct/100));
// IDC de Ventas: aquí sí se busca presión visual sobre asesores/tiendas, así que se queda el
// semáforo clásico. Sin datos = gris. 100% o más = verde. 70-99% = ámbar. Menos de 70% = rojo.
const colorSemaforoIDC = (pct) => pct===null || pct===undefined ? C.textMuted : pct>=100 ? C.green : pct>=70 ? C.amber : C.red;
// Devuelve el martes de la semana de una fecha (o la fecha misma si ya es martes)
const martesDeSemana = (dateStr) => {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay(); // 0=dom,1=lun,2=mar...
  const delta = (dow - 2 + 7) % 7;
  d.setDate(d.getDate() - delta);
  return fmt(d);
};

// ── Hook de inactividad ───────────────────────────────────────────────────────
function useInactivityLogout(onTimeout, minutos = 5) {
  useEffect(() => {
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onTimeout, minutos * 60 * 1000);
    };
    const eventos = ["mousedown","keydown","touchstart","scroll"];
    eventos.forEach(ev => window.addEventListener(ev, reset));
    reset();
    return () => {
      clearTimeout(timer);
      eventos.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [onTimeout, minutos]);
}

// Exige mantener presionado (mouse o dedo) durante un rato antes de ejecutar la acción — sin
// ningún aviso visual de que hay que hacerlo, a propósito. Un clic/toque rápido no hace nada.
function useLongPress(callback, duracionMs = 700) {
  const timerRef = useRef(null);
  const empezar = () => { timerRef.current = setTimeout(callback, duracionMs); };
  const cancelar = () => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = null; };
  return { onMouseDown: empezar, onMouseUp: cancelar, onMouseLeave: cancelar, onTouchStart: empezar, onTouchEnd: cancelar, onTouchCancel: cancelar };
}

// ── Responsive ────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

// ── UI Primitives ─────────────────────────────────────────────────────────────
// `intensity` (0 a 1, opcional) controla qué tan lleno se ve el relleno/borde del badge, sin
// cambiar el color en sí ni el texto (siempre sólido y legible) — se usa para indicadores de %
// donde se quiere una señal suave de "más alto = más lleno" en vez de cambiar de color entero
// (rojo/ámbar/verde), que se sentía como un semáforo castigador. Si no se pasa, se comporta igual
// que antes (relleno fijo).
const alphaHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const Badge = ({ color, children, sm, title, intensity }) => {
  const bgAlpha = intensity==null ? 32 : (14 + intensity*46);
  const borderAlpha = intensity==null ? 64 : (35 + intensity*80);
  return (
    <span title={title} style={{ display:"inline-flex", alignItems:"center", padding: sm?"2px 8px":"3px 10px", borderRadius:99, fontSize:sm?10:11, fontWeight:600, background:`${color}${alphaHex(bgAlpha)}`, color, border:`1px solid ${color}${alphaHex(borderAlpha)}`, fontFamily:font.body, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap", cursor:title?"help":"default" }}>{children}</span>
  );
};

const Btn = ({ onClick, children, variant="primary", sm, disabled, full, style={} }) => {
  const [hov, setHov] = useState(false);
  const base = { display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6, padding:sm?"6px 14px":"9px 18px", borderRadius:8, border:"none", cursor:disabled?"not-allowed":"pointer", fontSize:sm?12:13, fontWeight:600, fontFamily:font.body, transition:"all 0.15s", opacity:disabled?0.4:1, width:full?"100%":undefined };
  const styles = {
    primary: { background:hov?"#1e4d6b":C.gold, color:"#fff" },
    ghost:   { background:hov?C.surfaceHover:"transparent", color:C.textSub, border:`1px solid ${C.border}` },
    danger:  { background:hov?"rgba(231,76,60,0.22)":C.redDim, color:C.red, border:`1px solid ${C.red}44` },
    success: { background:hov?"rgba(46,204,113,0.22)":C.greenDim, color:C.green, border:`1px solid ${C.green}44` },
  };
  return <button style={{...base,...styles[variant],...style}} onClick={disabled?undefined:onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>{children}</button>;
};

// "Minimalista plano" — es el componente base con el que están armadas las fichas/burbujas de
// cada módulo (~55 pantallas), así que este único cambio se propaga a toda la app. Se probaron
// dos intentos con profundidad (vidrio esmerilado, luego sombra de elevación) y ninguno se notó
// bien o se sintió acertado — este va en la dirección opuesta a propósito: sin sombra, sin
// transparencia, sin intentar simular profundidad. Solo un fondo sólido y un borde discreto que
// define el contorno, dejando que el propio contenido sea lo que se note. Caja sigue siendo la
// única pantalla con su propio look a color (CajaCard, sin tocar).
const Card = ({ children, style={}, glow, p="20px" }) => (
  <div style={{
    background: C.surface,
    borderRadius: 12,
    border: `1px solid ${glow ? C.borderGold : `${C.border}60`}`,
    boxShadow: "none",
    padding: p,
    ...style,
  }}>{children}</div>
);

// Envoltorio para desplegar/ocultar contenido con animación (menús, filas expandibles, "ver más").
// Usa el truco de grid-template-rows 0fr↔1fr: anima suavemente a la altura real del contenido sin
// tener que medirla con JS. El contenido solo se monta la primera vez que se abre (así una fila que
// nunca se despliega no gasta cómputo de más) pero se queda montado después para que el cierre
// también se vea animado, no de golpe.
function Collapse({ open, children }) {
  const [montado, setMontado] = useState(open);
  useEffect(()=>{ if(open) setMontado(true); }, [open]);
  return (
    <div className="ozen-collapse" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
      <div style={{ overflow:"hidden", minHeight:0 }}>{montado ? children : null}</div>
    </div>
  );
}

// Campo de valor en pesos colombianos: mientras se escribe muestra $000.000,
// pero guarda (y entrega vía onChange) solo los dígitos, como los demás campos numéricos.
const CurrencyField = ({ label, value, onChange, placeholder, disabled, noMargin }) => {
  const digits = String(value||"").replace(/[^\d]/g,"");
  const mostrado = digits ? `$${Number(digits).toLocaleString("es-CO")}` : "";
  return (
    <div style={{ marginBottom: noMargin?0:14 }}>
      {label && <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>}
      <input
        type="text"
        inputMode="numeric"
        value={mostrado}
        onChange={e=>onChange(e.target.value.replace(/[^\d]/g,""))}
        placeholder={placeholder||"$0"}
        disabled={disabled}
        style={{ width:"100%", background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box", cursor:disabled?"not-allowed":"text" }}
      />
    </div>
  );
};

const Field = ({ label, value, onChange, type="text", placeholder, options, disabled, multiline, rows=4, autoComplete }) => (
  <div style={{ marginBottom:14, minWidth:0 }}>
    {label && <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>}
    {options ? (
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{ width:"100%", minWidth:0, background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}>
        {/* El navegador dibuja el desplegable de <option> con su propio fondo (casi siempre
            blanco), no con el fondo oscuro del <select> — así que sin un color explícito acá el
            texto claro pensado para fondo oscuro (C.text) queda casi ilegible sobre ese blanco.
            Fijar background/color directo en cada <option> lo corrige en Chrome/Edge/Firefox. */}
        {options.map(o=><option key={o.value} value={o.value} style={{ background:C.surface, color:C.text }}>{o.label}</option>)}
      </select>
    ) : multiline ? (
      <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} rows={rows} style={{ width:"100%", minWidth:0, background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box", resize:"vertical", lineHeight:1.5 }} />
    ) : (
      // `minWidth:0` es necesario porque dentro de un grid/flex, un input (sobre todo
      // type="date") no se encoge por debajo de su ancho de contenido por defecto — eso hacía
      // que la casilla de Fecha se saliera por la derecha de su tarjeta en celular, aunque tenga
      // width:100%. WebkitAppearance:"none" en el de fecha quita el tamaño nativo extra que
      // agrega iOS Safari al calendario, que era la otra causa de que se viera más alto/ancho
      // que los demás campos.
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} autoComplete={autoComplete} style={{ width:"100%", minWidth:0, background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box", ...(type==="date"?{WebkitAppearance:"none", appearance:"none"}:{}) }} />
    )}
  </div>
);

// Texto que aparece al pasar el mouse (o al tocar, en celular) sobre una etiqueta — para
// explicaciones cortas (IDC, MDA) o avisos largos (términos del Flexipago) sin ocupar espacio fijo.
// clickOnly: en algunos dispositivos el hover titila o la nube sale cortada — con clickOnly
// se abre/cierra solo al dar clic, sin depender del hover.
const HoverTooltip = ({ label, labelStyle={}, width=280, align="left", clickOnly=false, children }) => {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-block" }}>
      <span
        onMouseEnter={clickOnly?undefined:()=>setShow(true)}
        onMouseLeave={clickOnly?undefined:()=>setShow(false)}
        onClick={()=>setShow(s=>!s)}
        style={{ textDecoration:"underline dotted", textUnderlineOffset:3, cursor:"help", fontFamily:font.body, ...labelStyle }}
      >{label}</span>
      {show && (
        <div style={{ position:"absolute", zIndex:80, top:"130%", [align]:0, width, maxWidth:"80vw", background:C.dark, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", boxShadow:"0 6px 24px rgba(0,0,0,0.5)", textAlign:"left" }}>
          {children}
        </div>
      )}
    </span>
  );
};

const StatCard = ({ label, value, icon, color }) => (
  <Card style={{ display:"flex", alignItems:"center", gap:16 }}>
    <div style={{ width:44, height:44, borderRadius:10, background:`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{icon}</div>
    <div>
      <div style={{ fontFamily:font.mono, fontSize:24, fontWeight:700, color, lineHeight:1 }}>{value}</div>
      <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>{label}</div>
    </div>
  </Card>
);

const Divider = () => <div style={{ height:1, background:C.border, margin:"12px 0" }} />;
const PageHeader = ({ title, subtitle, action }) => (
  <div style={{ display:"flex", flexWrap:"wrap", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, gap:10 }}>
    <div>
      <h1 style={{ margin:0, fontFamily:font.body, fontSize:20, fontWeight:700, color:C.text }}>{title}</h1>
      {subtitle && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:3 }}>{subtitle}</div>}
    </div>
    {action}
  </div>
);

// ── Camera Modal ──────────────────────────────────────────────────────────────
function CameraModal({ eventLabel, onCapture, onCancel }) {
  const videoRef = useRef(null), canvasRef = useRef(null), streamRef = useRef(null);
  const [ready, setReady] = useState(false), [captured, setCaptured] = useState(null), [error, setError] = useState(null), [countdown, setCountdown] = useState(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, facingMode:"user" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); }; }
    } catch { setError("No se pudo acceder a la cámara. Verifica los permisos."); }
  }, []);
  const stopCamera = useCallback(() => { streamRef.current?.getTracks().forEach(t=>t.stop()); }, []);
  useEffect(() => { startCamera(); return () => stopCamera(); }, []);

  const takePhoto = () => {
    let c = 3; setCountdown(c);
    const iv = setInterval(() => {
      c--;
      if (c > 0) setCountdown(c);
      else {
        clearInterval(iv); setCountdown(null);
        const canvas = canvasRef.current, video = videoRef.current;
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        setCaptured(canvas.toDataURL("image/jpeg", 0.4));
        stopCamera();
      }
    }, 1000);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:16 }}>
      <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, width:"100%", maxWidth:520, overflow:"hidden" }}>
        <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:font.body, fontWeight:600, fontSize:14, color:C.text }}>📸 Foto de verificación</div>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:2 }}>Evento: <span style={{ color:C.amber, fontWeight:600 }}>{eventLabel}</span></div>
          </div>
          <Btn onClick={()=>{ stopCamera(); onCancel(); }} variant="ghost" sm>✕</Btn>
        </div>
        <div style={{ padding:16 }}>
          {error ? (
            <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:8, padding:16, textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>📵</div>
              <div style={{ fontFamily:font.body, fontSize:13, color:C.red, fontWeight:600 }}>Sin acceso a la cámara</div>
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:4 }}>{error}</div>
            </div>
          ) : (
            <div style={{ position:"relative", borderRadius:10, overflow:"hidden", background:C.dark, aspectRatio:"4/3" }}>
              {!captured && <video ref={videoRef} autoPlay muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)", display:ready?"block":"none" }} />}
              {!ready && !captured && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Iniciando cámara...</div>}
              {countdown !== null && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.5)" }}><div style={{ fontFamily:font.mono, fontSize:80, fontWeight:700, color:"#fff" }}>{countdown}</div></div>}
              {captured && <img src={captured} alt="Captura" style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)" }} />}
              <canvas ref={canvasRef} style={{ display:"none" }} />
              {!captured && ready && countdown===null && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}><div style={{ width:140, height:180, border:"2px dashed rgba(255,255,255,0.4)", borderRadius:"50%" }} /></div>}
            </div>
          )}
          {!error && (
            <div style={{ marginTop:12, display:"flex", gap:8, justifyContent:"flex-end" }}>
              {!captured ? (
                <Btn onClick={takePhoto} disabled={!ready||countdown!==null} full>📷 {countdown!==null?`Fotografiando en ${countdown}...`:"Tomar foto (3s)"}</Btn>
              ) : (
                <><Btn onClick={()=>{ setCaptured(null); startCamera(); }} variant="ghost">↩ Repetir</Btn><Btn onClick={()=>onCapture(captured)} variant="success">✓ Confirmar</Btn></>
              )}
            </div>
          )}
          <div style={{ marginTop:10, fontFamily:font.body, fontSize:11, color:C.textMuted, textAlign:"center" }}>Ubica tu rostro dentro del óvalo.</div>
        </div>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────
const ADMIN_TABS_ASISTENCIA = [{ id:"dashboard",icon:"📊",label:"Panel" },{ id:"records",icon:"📋",label:"Registros" },{ id:"turnos",icon:"📅",label:"Turnos" },{ id:"mi_asistencia",icon:"📍",label:"Marcar Asistencia" },{ id:"reports",icon:"📈",label:"Informes" }];
// Las pestañas "Asesores" y "Tiendas" ya no van sueltas — ahora viven dentro de Turnos ▸
// Administrar (ver TurnosAdminScreen), junto con los códigos de turno especiales.
// Usuarios (control total de contraseñas) ya no va en esta lista de pestañas — es solo para
// master, y se abre aparte con un ícono discreto en el pie del menú (ver Sidebar/MobileHeader).
const ADMIN_TABS_JUNTA      = [{ id:"seguimiento",icon:"✅",label:"Seguimiento semanal" },{ id:"acuerdos",icon:"🔒",label:"Acuerdos y decisiones" },{ id:"equipo",icon:"👥",label:"Perfiles y áreas" },{ id:"guion",icon:"📖",label:"Rol de Monitor" },{ id:"indicadores",icon:"📊",label:"Indicadores" }];
const ADVISOR_TABS          = [{ id:"checkin",icon:"📍",label:"Marcar Asistencia" },{ id:"history",icon:"📋",label:"Mi Historial" },{ id:"schedule",icon:"📅",label:"Turnos" },{ id:"firmar",icon:"✍️",label:"Firmar documento" }];
const ADMIN_TABS_VENTAS     = [{ id:"registrar",icon:"🧾",label:"Registrar venta" },{ id:"lista",icon:"📋",label:"Lista de ventas" },{ id:"metricas",icon:"📊",label:"Métricas" },{ id:"caja",icon:"💰",label:"Caja" }];
const ADMIN_TABS_FIRMAS     = [{ id:"firmar",icon:"✍️",label:"Firmar documento" }];
const puedeUsarAreas = (user) => user.role==="admin" || user.role==="master" || user.role==="visualizador" || user.role==="admin_finanzas" || user.role==="admin_turnos";
// Quién puede elegir el área "Ventas" desde el selector. Admin y Visualizador entran en modo
// solo lectura (ver ventasSoloLectura); master y admin_finanzas entran completo.
const puedeUsarVentasArea = (user) => user.role==="master" || user.role==="admin_finanzas" || user.role==="admin" || user.role==="visualizador" || user.role==="admin_turnos";
// Quién solo puede VER Ventas (lista, métricas, caja) sin registrar ni corregir nada.
const ventasSoloLectura = (user) => user.role==="admin" || user.role==="visualizador" || user.role==="admin_turnos";
// Admin (no admin_finanzas) sí puede ENTRAR a la pantalla de Registrar venta para verla, pero
// en modo solo lectura — no puede guardar. Visualizador ni siquiera ve esa pestaña.
const puedeVerRegistrar = (user) => user.role!=="visualizador";
const puedeRegistrarVenta = (user) => user.role==="master" || user.role==="admin_finanzas";
// Cuentas de tienda: login compartido, van directo a Ventas sin selector de área
const esCuentaTienda = (user) => user.role==="tienda";
// Turnos: además de los asesores, los admin (master/admin/admin_finanzas/visualizador) también
// pueden aparecer como columna en la malla y que se les asigne un turno propio para marcar
// asistencia — no se fusiona su cuenta con ninguna de asesor, solo se les habilita la malla.
const esAdminAsignableATurnos = (u) => ["master","admin","admin_finanzas","admin_turnos","visualizador"].includes(u.role);
// Quién puede EDITAR el Borrador o entrar a Administrar (asesores/tiendas/horarios) en Turnos —
// master y admin_turnos (un admin normal con acceso completo a Turnos, y solo a eso). admin_finanzas
// es un admin normal con acceso extra a VENTAS, no a Turnos, así que ahí se comporta igual que
// "admin"/"visualizador": solo puede ver la rejilla.
const puedeGestionarTurnos = (user) => user.role==="master" || user.role==="admin_turnos";
const ROLE_ORDEN_TURNOS = ["master","admin","admin_finanzas","admin_turnos","visualizador"];
const esUsuarioDeTurnos = (u) => u.role==="advisor" || esAdminAsignableATurnos(u);
// Los asesores usan el campo general `active` (ya existente). Los admin usan un campo propio
// `activo_en_turnos` para no interferir con el `active` general que ya se usa en otras pantallas
// (ej. Caja, para elegir quién recibe una recolección). Si la columna aún no existe o es null,
// se trata como activo por defecto.
const activoEnMallaTurnos = (u) => u.role==="advisor" ? !!u.active : u.activo_en_turnos!==false;
// Orden manual de columnas en la rejilla (ver botones ◀▶ en el Borrador) — campo `orden_turnos`
// en usuarios, null si nunca se ha movido a nadie (esos quedan al final, ordenados por nombre).
const advisorsOrdenTurnos = (users) => users
  .filter(u=>esUsuarioDeTurnos(u) && activoEnMallaTurnos(u))
  .sort((a,b)=> (a.orden_turnos??9999)-(b.orden_turnos??9999) || a.name.localeCompare(b.name));
// Admin Finanzas: hace todo lo de un Administrador normal (Asistencia/Junta), más Ventas completo
// (registrar, lista, métricas, asignar metas, aprobar notas crédito y corregir por error).
const esAdminFinanzas = (user) => user.role==="admin_finanzas";
// Cualquier admin (master, admin, admin finanzas, admin turnos) puede vender cuando está en una
// tienda, aunque su cuenta no tenga permiso para REGISTRAR la venta desde Ventas (ej. un Admin
// normal, que ahí solo puede ver) — por eso también aparecen como opción de "quién hizo la venta"
// / asesor en Registrar venta, Lista de ventas, Métricas y Caja, sin importar su rol en Ventas.
const ROLES_ADMIN_VENDEDOR = ["master","admin","admin_finanzas","admin_turnos"];
const esVendedorPosible = (u) => (u.role==="advisor" || ROLES_ADMIN_VENDEDOR.includes(u.role)) && u.active;
// Quién puede aprobar/rechazar notas crédito dentro de Ventas
const esAdminDeVentas = (user) => user.role==="master" || user.role==="admin_finanzas";
// Quién puede asignar las metas mensuales en Métricas
const puedeAsignarMetas = (user) => user.role==="master" || user.role==="admin_finanzas";
// Quién puede registrar una recolección de efectivo: master/admin finanzas, y la cuenta de la
// tienda (porque son quienes ven la caja físicamente y confirman si estaba completa o no).
// Ojo: NO incluye a los usuarios individuales de "advisor" (esos son solo para Asistencia).
const puedeHacerRecoleccion = (user) => user.role==="master" || user.role==="admin_finanzas" || user.role==="tienda";
// Qué pestañas le corresponden a cada quien, según su rol y el área elegida
const tabsPara = (user, area) => !puedeUsarAreas(user)
  ? (esCuentaTienda(user) ? ADMIN_TABS_VENTAS : ADVISOR_TABS)
  : (area==="junta" ? ADMIN_TABS_JUNTA : area==="ventas" ? (puedeVerRegistrar(user) ? ADMIN_TABS_VENTAS : ADMIN_TABS_VENTAS.filter(t=>t.id!=="registrar")) : area==="firmas" ? ADMIN_TABS_FIRMAS : ADMIN_TABS_ASISTENCIA);

// ── Vencimiento de contraseña ────────────────────────────────────────────────
const DIAS_EXPIRACION_PASSWORD = 90;
const passwordVencida = (u) => {
  if (!u.password_updated_at) return true;
  const dias = (Date.now() - new Date(u.password_updated_at).getTime()) / 86400000;
  return dias >= DIAS_EXPIRACION_PASSWORD;
};

function Sidebar({ tab, setTab, user, area, onChangeArea, onLogout, onRefresh, refreshing, onCambiarPassword, onAbrirUsuarios, onAbrirAccesoTiendas, onActivarNotificaciones }) {
  const tabs = tabsPara(user, area);
  const presionarLogo = useLongPress(onAbrirUsuarios);
  return (
    <div style={{ width:220, flexShrink:0, background:C.sidebar, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"18px 16px", borderBottom:`1px solid ${C.border}`, textAlign:"center" }}>
        {/* El logo, para master, también es la entrada a Usuarios — a propósito no lleva ningún
            aviso visual, y hay que mantenerlo presionado (no un clic normal) para entrar. */}
        <img src="/logo-icon.png" alt="OZEN" draggable={false} onContextMenu={e=>user.role==="master"&&e.preventDefault()} {...(user.role==="master"?presionarLogo:{})} style={{ width:44, height:44, borderRadius:"50%", cursor:user.role==="master"?"pointer":"default", userSelect:"none", WebkitTouchCallout:"none" }} />
      </div>
      <nav style={{ flex:1, padding:"12px 10px", display:"flex", flexDirection:"column", gap:2 }}>
        {tabs.map(t => { const active=tab===t.id; return (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:8, border:"none", background:active?`${C.gold}18`:"transparent", borderLeft:active?`3px solid ${C.goldLight}`:"3px solid transparent", color:active?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:13, fontWeight:active?600:400, cursor:"pointer", textAlign:"left", transition:"all 0.15s" }}>
            <span style={{ fontSize:16 }}>{t.icon}</span>{t.label}
          </button>
        ); })}
      </nav>
      <div style={{ padding:"14px 16px", borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{user.name[0]}</div>
          <div>
            <div style={{ fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600, textTransform:esCuentaTienda(user)?"uppercase":"none" }}>{esCuentaTienda(user) ? user.name : user.name.split(" ")[0]}</div>
            {!esCuentaTienda(user) && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>{ROLE_LABEL[user.role] || "Asesor"}</div>}
          </div>
          <button onClick={onRefresh} disabled={refreshing} title="Actualizar" style={{ marginLeft:"auto", background:"none", border:"none", cursor:refreshing?"not-allowed":"pointer", fontSize:16, opacity:refreshing?0.4:1, transition:"transform 0.4s", transform:refreshing?"rotate(180deg)":"rotate(0deg)" }}>🔄</button>
        </div>
        {puedeUsarAreas(user) && <Btn onClick={onChangeArea} variant="ghost" full sm style={{ marginBottom:8 }}>🔀 Cambiar de área</Btn>}
        {esAdminFinanzas(user) && <Btn onClick={onAbrirAccesoTiendas} variant="ghost" full sm style={{ marginBottom:8 }}>🏬 Acceso tiendas</Btn>}
        {puedeGestionarTurnos(user) && notificacionesSoportadas() && (!pushActivo()||requiereInstalarEnIOS()) && <Btn onClick={onActivarNotificaciones} variant="ghost" full sm style={{ marginBottom:8 }}>🔔 Activar notificaciones</Btn>}
        {user.role!=="master" && !esCuentaTienda(user) && <Btn onClick={onCambiarPassword} variant="ghost" full sm style={{ marginBottom:8 }}>🔑 Mi contraseña</Btn>}
        <Btn onClick={onLogout} variant="ghost" full sm>Cerrar sesión</Btn>
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab, user, area }) {
  const tabs = tabsPara(user, area);
  return (
    <div style={{ display:"flex", borderTop:`1px solid ${C.border}`, background:C.sidebar, paddingBottom:"env(safe-area-inset-bottom, 8px)", flexShrink:0 }}>
      {tabs.map(t => { const active=tab===t.id; return (
        <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, padding:"10px 4px 8px", background:"none", border:"none", display:"flex", flexDirection:"column", alignItems:"center", gap:3, cursor:"pointer" }}>
          <div style={{ fontSize:18 }}>{t.icon}</div>
          <div style={{ fontSize:9, fontFamily:font.body, fontWeight:600, color:active?C.goldLight:C.textMuted }}>{t.label}</div>
          {active && <div style={{ width:4, height:4, borderRadius:99, background:C.goldLight }} />}
        </button>
      ); })}
    </div>
  );
}

function MobileHeader({ user, onLogout, onRefresh, refreshing, onChangeArea, onCambiarPassword, onAbrirUsuarios, onAbrirAccesoTiendas, onActivarNotificaciones }) {
  const presionarLogo = useLongPress(onAbrirUsuarios);
  return (
    <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${C.border}`, background:C.sidebar, flexShrink:0 }}>
      {/* El logo, para master, también es la entrada a Usuarios — sin ningún aviso visual, y hay
          que mantenerlo presionado (no un toque normal) para entrar. */}
      <img src="/logo-icon.png" alt="OZEN" draggable={false} onContextMenu={e=>user.role==="master"&&e.preventDefault()} {...(user.role==="master"?presionarLogo:{})} style={{ width:34, height:34, borderRadius:"50%", userSelect:"none", WebkitTouchCallout:"none" }} />
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {puedeUsarAreas(user) && <button onClick={onChangeArea} title="Cambiar de área" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔀</button>}
        {esAdminFinanzas(user) && <button onClick={onAbrirAccesoTiendas} title="Acceso tiendas" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🏬</button>}
        {puedeGestionarTurnos(user) && notificacionesSoportadas() && (!pushActivo()||requiereInstalarEnIOS()) && <button onClick={onActivarNotificaciones} title="Activar notificaciones" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔔</button>}
        {user.role!=="master" && !esCuentaTienda(user) && <button onClick={onCambiarPassword} title="Mi contraseña" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔑</button>}
        <button onClick={onRefresh} disabled={refreshing} style={{ background:"none", border:"none", cursor:refreshing?"not-allowed":"pointer", fontSize:18, opacity:refreshing?0.4:1 }}>🔄</button>
        <div style={{ fontFamily:font.body, fontSize:12, color:C.text, textTransform:esCuentaTienda(user)?"uppercase":"none" }}>{esCuentaTienda(user) ? user.name : user.name.split(" ")[0]}</div>
        <button onClick={onLogout} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"5px 10px", color:C.textMuted, fontSize:11, cursor:"pointer", fontFamily:font.body }}>Salir</button>
      </div>
    </div>
  );
}

// ── SCREEN: Dashboard ─────────────────────────────────────────────────────────
function DashboardScreen({ records, stores, isMobile }) {
  const todayRecs  = records.filter(r=>r.date===todayStr);
  const conEntrada = new Set(todayRecs.filter(r=>r.event==="entrada").map(r=>r.user_id));
  const conCierre  = new Set(todayRecs.filter(r=>r.event==="salida"||(r.event==="omitido"&&r.time==="salida")).map(r=>r.user_id));
  const trabajaronHoy = conEntrada.size;
  const enTurnoAhora  = [...conEntrada].filter(id=>!conCierre.has(id)).length;
  const incompletas   = new Set(todayRecs.filter(r=>r.event==="omitido").map(r=>r.user_id)).size;
  const recent = [...records].filter(r=>r.event!=="omitido").sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time)).slice(0,8);
  const activosAhora = todayRecs.filter(r=>r.event==="entrada"&&!conCierre.has(r.user_id)).reduce((acc,r)=>{ if(!acc.find(x=>x.user_id===r.user_id))acc.push(r); return acc; },[]);

  return (
    <div>
      <PageHeader title="Panel General" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} />
      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,1fr)", gap:10, marginBottom:16 }}>
        <StatCard label="Trabajaron hoy"       value={trabajaronHoy} icon="👥" color={C.green} />
        <StatCard label="En turno ahora"       value={enTurnoAhora}  icon="🟢" color={enTurnoAhora>0?C.blue:C.textMuted} />
        <StatCard label="Jornadas incompletas" value={incompletas}   icon="⚠️" color={incompletas>0?C.red:C.textMuted} />
      </div>

      {activosAhora.length > 0 && (
        <Card style={{ marginBottom:16 }}>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>🟢 En turno ahora</div>
          {activosAhora.map((r,i)=>(
            <div key={r.user_id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:i<activosAhora.length-1?`1px solid ${C.border}`:"none" }}>
              <div>
                <div style={{ fontFamily:font.body, fontSize:13, color:C.text }}>{r.user_name}</div>
                <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{stores[r.store]?.name}</div>
              </div>
              <div style={{ fontFamily:font.mono, fontSize:12, color:C.green }}>Entrada {r.time}</div>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>Últimos eventos</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {recent.map(r=>(
            <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:8, height:8, borderRadius:99, background:EVENT_COLORS[r.event], flexShrink:0 }} />
              <div style={{ flex:1, fontFamily:font.body, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.user_name}</div>
              <Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge>
              <div style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted, flexShrink:0, minWidth:40, textAlign:"right" }}>{r.time}</div>
            </div>
          ))}
          {recent.length===0 && <div style={{ fontFamily:font.body, fontSize:13, color:C.textMuted, textAlign:"center", padding:"12px 0" }}>Sin eventos hoy.</div>}
        </div>
      </Card>
    </div>
  );
}

// ── SCREEN: Records ───────────────────────────────────────────────────────────
function RecordsScreen({ records, stores, users, isMobile, turnosHorarios, turnosAsignaciones }) {
  const [storeFilter, setStoreFilter] = useState("all");
  const [userFilter, setUserFilter]   = useState("all");
  const [dateFrom, setDateFrom]       = useState(todayStr);
  const [dateTo, setDateTo]           = useState(todayStr);
  const [viewPhoto, setViewPhoto]     = useState(null);

  const advisors = users.filter(u=>u.role==="advisor");

  const filtered = records
    .filter(r=>storeFilter==="all"||r.store===storeFilter)
    .filter(r=>userFilter==="all"||r.user_id===userFilter)
    .filter(r=>(!dateFrom||r.date>=dateFrom)&&(!dateTo||r.date<=dateTo));

  const jornadasMap = {};
  filtered.forEach(r=>{
    const key=`${r.user_id}_${r.date}`;
    if(!jornadasMap[key]) jornadasMap[key]={ key, userId:r.user_id, userName:r.user_name, store:r.store, shift:r.shift, date:r.date, entrada:null, inicio_almuerzo:null, fin_almuerzo:null, salida:null };
    if(r.event!=="omitido") jornadasMap[key][r.event]=r;
    else jornadasMap[key][r.time+"_omitido"]=true;
  });
  const jornadas = Object.values(jornadasMap).sort((a,b)=>b.date.localeCompare(a.date)||a.userName.localeCompare(b.userName));

  const EventBlock = ({ label, registro, omitido, color }) => {
    const isOmitido = !registro && omitido;
    return (
      <div style={{ flex:1, minWidth:0, borderRadius:8, padding:"8px 4px", background:isOmitido?`${C.red}18`:C.surfaceAlt, border:`1px solid ${isOmitido?C.red+"44":C.border}`, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
        <div style={{ fontFamily:font.body, fontSize:9, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em", textAlign:"center", lineHeight:1.2 }}>{label}</div>
        <div style={{ fontFamily:font.mono, fontSize:12, color:isOmitido?C.red:registro?color:C.border, fontWeight:700 }}>{registro?registro.time:isOmitido?"N/R":"—"}</div>
        <div style={{ width:36, height:36, borderRadius:6, overflow:"hidden", border:`1px solid ${C.border}`, background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          {registro?.photo_url
            ? <img src={registro.photo_url} onClick={()=>setViewPhoto(registro.photo_url)} alt="foto" style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"pointer", display:"block" }} />
            : <span style={{ fontSize:12, opacity:0.25 }}>📷</span>
          }
        </div>
      </div>
    );
  };

  return (
    <div>
      {viewPhoto && (
        <div onClick={()=>setViewPhoto(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, cursor:"pointer", padding:16 }}>
          <img src={viewPhoto} alt="Foto" style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:10 }} />
        </div>
      )}
      <PageHeader title="Registros" subtitle={`${jornadas.length} jornadas`} />
      <Card style={{ marginBottom:12, overflow:"hidden" }} p="12px">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8, width:"100%" }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:10, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Desde</div>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ width:"100%", minWidth:0, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 8px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box", WebkitAppearance:"none", appearance:"none" }} />
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:10, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Hasta</div>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{ width:"100%", minWidth:0, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 8px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box", WebkitAppearance:"none", appearance:"none" }} />
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8 }}>
          <select value={userFilter} onChange={e=>setUserFilter(e.target.value)} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 8px", color:C.text, fontSize:11, fontFamily:font.body, outline:"none", width:"100%" }}>
            <option value="all">Todos los asesores</option>
            {advisors.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={storeFilter} onChange={e=>setStoreFilter(e.target.value)} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 8px", color:C.text, fontSize:11, fontFamily:font.body, outline:"none", width:"100%" }}>
            <option value="all">Todas las tiendas</option>
            {Object.values(stores).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Btn onClick={()=>{ setDateFrom(todayStr); setDateTo(todayStr); setUserFilter("all"); setStoreFilter("all"); }} variant="ghost" sm>Hoy</Btn>
        </div>
      </Card>

      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {jornadas.map(j=>{
          const asigDia=(turnosAsignaciones||[]).find(a=>a.asesor_id===j.userId&&a.fecha===j.date);
          // Si hay un turno oficial asignado en el Borrador para ese día, la puntualidad se
          // evalúa contra ESE (aunque la persona haya marcado otro por error) — no contra lo
          // autorreportado. Si no hay asignación (o es un turno especial sin tienda), se usa lo
          // que quedó en el registro, como antes.
          const shiftReal = asigDia?.tienda_id ? (asigDia.shift||j.shift) : j.shift;
          const storeReal = asigDia?.tienda_id || j.store;
          const punt=calcPuntualidad(j.entrada?.time,shiftReal,j.date,storeReal,turnosHorarios,asigDia?.entrada_custom);
          const rango=getExpectedRange(shiftReal,j.date,storeReal,turnosHorarios,asigDia?.entrada_custom,asigDia?.salida_custom);
          return (
            <Card key={j.key} p="14px">
              <div style={{ marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{j.userName}</div>
                  {punt && (punt.puntual ? <Badge color={C.green} sm>🟢 Puntual</Badge> : <Badge color={C.red} sm>🔴 Tarde {punt.diff} min</Badge>)}
                </div>
                <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{stores[j.store]?.name} · {j.shift} · {j.date}{rango?` - ${rango}`:""}</div>
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <EventBlock label="Entrada"       registro={j.entrada}        omitido={j["entrada_omitido"]}        color={C.green} />
                <EventBlock label="Ini. Almuerzo" registro={j.inicio_almuerzo} omitido={j["inicio_almuerzo_omitido"]} color={C.amber} />
                <EventBlock label="Fin Almuerzo"  registro={j.fin_almuerzo}   omitido={j["fin_almuerzo_omitido"]}   color={C.blue}  />
                <EventBlock label="Salida"        registro={j.salida}         omitido={j["salida_omitido"]}         color={C.red}   />
              </div>
            </Card>
          );
        })}
        {jornadas.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin registros para los filtros seleccionados.</div>}
      </div>
    </div>
  );
}

// ── SCREEN: Users ─────────────────────────────────────────────────────────────
function UsersScreen({ users, setUsers }) {
  const soloLectura = useReadOnly();
  const [showForm,setShowForm]=useState(false),[form,setForm]=useState({name:"",documento:""}),[editing,setEditing]=useState(null),[editVal,setEditVal]=useState({}),[loading,setLoading]=useState(false);
  const advisors=users.filter(u=>u.role==="advisor");
  const add=async()=>{ if(!form.name.trim()||!form.documento.trim())return; setLoading(true); const{data,error}=await supabase.from("usuarios").insert({name:form.name.trim(),documento:form.documento.trim(),password:form.documento.trim(),role:"advisor",active:true}).select().single(); if(!error){setUsers(prev=>[...prev,data]);setForm({name:"",documento:""});setShowForm(false);} setLoading(false); };
  const toggle=async(u)=>{ const{data}=await supabase.from("usuarios").update({active:!u.active}).eq("id",u.id).select().single(); if(data)setUsers(prev=>prev.map(x=>x.id===u.id?data:x)); };
  const saveEdit=async(id)=>{ if(!editVal.name.trim()||!editVal.documento.trim())return; const{data}=await supabase.from("usuarios").update({name:editVal.name.trim(),documento:editVal.documento.trim()}).eq("id",id).select().single(); if(data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setEditing(null);} };
  const deleteUser=async(id)=>{
    const { count } = await supabase.from("registros").select("id", { count: "exact", head: true }).eq("user_id", id);
    if (count > 0) { alert(`Este asesor tiene ${count} registro(s) de asistencia. Eliminarlo borraría ese historial para siempre. Usa el botón "✕" para desactivarlo en su lugar — así deja de aparecer como activo pero conserva sus registros.`); return; }
    if (!window.confirm("Este asesor no tiene registros de asistencia. ¿Eliminarlo de todas formas? Esto no se puede deshacer.")) return;
    await supabase.from("usuarios").delete().eq("id",id); setUsers(prev=>prev.filter(u=>u.id!==id));
  };
  return (
    <div>
      <PageHeader title="Asesores" subtitle={`${advisors.length} asesores`} action={soloLectura?null:<Btn onClick={()=>{setShowForm(!showForm);setEditing(null);}} sm>{showForm?"Cancelar":"+ Nuevo"}</Btn>} />
      {!soloLectura && showForm&&(<Card glow style={{marginBottom:16}}><div style={{fontFamily:font.body,fontSize:13,fontWeight:600,color:C.goldLight,marginBottom:14}}>Nuevo asesor</div><Field label="Nombre completo" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="Nombre Apellido" /><Field label="N.º de documento" value={form.documento} onChange={v=>setForm(f=>({...f,documento:v}))} placeholder="Número de documento" /><div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginBottom:12}}>💡 La contraseña inicial será el número de documento.</div><Btn onClick={add} disabled={loading} full>{loading?"Guardando...":"Crear asesor"}</Btn></Card>)}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {advisors.map(u=>(
          <Card key={u.id} p="14px" style={{opacity:u.active?1:0.6}}>
            {!soloLectura && editing===u.id?(
              <div><Field label="Nombre" value={editVal.name} onChange={v=>setEditVal(p=>({...p,name:v}))} /><Field label="Documento" value={editVal.documento} onChange={v=>setEditVal(p=>({...p,documento:v}))} /><div style={{display:"flex",gap:8}}><Btn onClick={()=>saveEdit(u.id)} variant="success" sm full>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm full>Cancelar</Btn></div></div>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,fontWeight:700,color:"#fff",flexShrink:0}}>{u.name[0]}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontFamily:font.body,fontSize:13,color:C.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div><div style={{fontFamily:font.mono,fontSize:11,color:C.textMuted}}>{u.documento}</div></div>
                <Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge>
                {!soloLectura && <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <Btn onClick={()=>{setEditing(u.id);setEditVal({name:u.name,documento:u.documento});}} variant="ghost" sm>✏</Btn>
                  <Btn onClick={()=>toggle(u)} variant={u.active?"danger":"success"} sm>{u.active?"✕":"✓"}</Btn>
                  <Btn onClick={()=>deleteUser(u.id)} variant="danger" sm>🗑</Btn>
                </div>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN: Usuarios (solo master) ─────────────────────────────────────────────
const ROLE_LABEL = { master:"Master", admin:"Administrador", admin_finanzas:"Admin Finanzas", admin_turnos:"Admin Turnos", visualizador:"Visualizador", advisor:"Asesor", tienda:"Cuenta de tienda" };
const ROLE_COLOR = { master:C.red, admin:C.gold, admin_finanzas:C.blue, admin_turnos:C.green, visualizador:C.amber, advisor:C.blue, tienda:C.textMuted };
const ROLE_PERMISOS = {
  master: "Acceso total: Asistencia, Junta, Ventas y el módulo de Usuarios (ve y cambia todas las contraseñas).",
  admin: "Asistencia y Junta completos (panel, registros, turnos —incluye crear/editar/eliminar asesores y tiendas—, informes). En Ventas solo puede ver (lista, métricas, caja) — no puede registrar ni corregir nada.",
  admin_finanzas: "Todo lo de un Administrador (Asistencia y Junta), más Ventas completo: registrar, lista, métricas, asignar metas, aprobar notas crédito y corregir por error.",
  admin_turnos: "Todo lo de un Administrador (Asistencia y Junta, Ventas solo lectura), más acceso completo a Turnos: editar el Borrador y entrar a Administrar (asesores, tiendas, turnos especiales, horarios).",
  visualizador: "Puede ver Asistencia, Junta y Ventas, sin poder editar ni registrar nada en ninguno de los tres.",
  advisor: "Marca su propia asistencia y ve su historial/malla. Si se usa para vender, aparece para elegir como quién hizo la venta.",
  tienda: "Login compartido de una tienda: solo entra a Ventas (Registrar, Lista, Métricas, Caja) de esa tienda, con la fecha fija en hoy.",
};
function UsuariosScreen({ users, setUsers, stores }) {
  const [showForm,setShowForm]=useState(false),[form,setForm]=useState({name:"",documento:"",role:"advisor",tienda_id:""}),[editing,setEditing]=useState(null),[editVal,setEditVal]=useState({}),[cambiandoPass,setCambiandoPass]=useState(null),[nuevaPass,setNuevaPass]=useState(""),[loading,setLoading]=useState(false);
  const tiendaOptions=[{value:"",label:"Selecciona una tienda..."}, ...tiendasVenta(stores).map(s=>({value:s.id,label:s.name}))];
  const [passVisible,setPassVisible]=useState({});
  const [sincronizando,setSincronizando]=useState(false);
  const traerFrescos=async()=>{ setSincronizando(true); const{data}=await supabase.from("usuarios").select("*"); if(data)setUsers(data); setSincronizando(false); };
  // Cada vez que se entra a esta pestaña, trae los datos más recientes de la base de
  // datos — así si alguien cambió su propia contraseña desde otra sesión, aparece
  // aquí sin que master tenga que adivinar o darle refrescar manualmente.
  useEffect(()=>{ traerFrescos(); },[]);
  const ordenRol = (r) => r==="master"?0 : (r==="admin"||r==="admin_turnos")?1 : 2;
  const ordenados=[...users].sort((a,b)=>ordenRol(a.role)-ordenRol(b.role) || a.name.localeCompare(b.name));
  const roleOptions=[{value:"advisor",label:"Asesor"},{value:"admin",label:"Administrador"},{value:"admin_finanzas",label:"Admin Finanzas"},{value:"admin_turnos",label:"Admin Turnos"},{value:"visualizador",label:"Visualizador"},{value:"tienda",label:"Cuenta de tienda"},{value:"master",label:"Master"}];
  const add=async()=>{ if(!form.name.trim()||!form.documento.trim())return; if(form.role==="tienda"&&!form.tienda_id)return; setLoading(true); const{data,error}=await supabase.from("usuarios").insert({name:form.name.trim(),documento:form.documento.trim(),password:form.documento.trim(),role:form.role,tienda_id:form.role==="tienda"?form.tienda_id:null,active:true}).select().single(); if(!error&&data){setUsers(prev=>[...prev,data]);setForm({name:"",documento:"",role:"advisor",tienda_id:""});setShowForm(false);} setLoading(false); };
  const toggle=async(u)=>{ const{data}=await supabase.from("usuarios").update({active:!u.active}).eq("id",u.id).select().single(); if(data)setUsers(prev=>prev.map(x=>x.id===u.id?data:x)); };
  const saveEdit=async(id)=>{ if(!editVal.name.trim()||!editVal.documento.trim())return; if(editVal.role==="tienda"&&!editVal.tienda_id)return; const{data}=await supabase.from("usuarios").update({name:editVal.name.trim(),documento:editVal.documento.trim(),role:editVal.role,tienda_id:editVal.role==="tienda"?(editVal.tienda_id||null):null}).eq("id",id).select().single(); if(data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setEditing(null);} };
  const deleteUsuario=async(id)=>{
    const { count } = await supabase.from("registros").select("id", { count: "exact", head: true }).eq("user_id", id);
    const mensaje = count > 0
      ? `Este usuario tiene ${count} registro(s) de asistencia. Si lo eliminas, también se borra ese historial para siempre (y cualquier turno asignado o meta de ventas que tenga). Esto no se puede deshacer. ¿Eliminarlo de todas formas?`
      : "¿Eliminar este usuario? Esto no se puede deshacer.";
    if (!window.confirm(mensaje)) return;
    // Antes de borrar el usuario hay que borrar lo que depende de él (si no, la base de datos
    // rechaza el borrado por las llaves foráneas) — registros de asistencia, turnos que se le
    // hayan asignado en la malla, y su meta personal de ventas si tenía.
    await supabase.from("registros").delete().eq("user_id", id);
    await supabase.from("turnos_asignaciones").delete().eq("asesor_id", id);
    await supabase.from("ventas_metas_asesor").delete().eq("vendedor_id", id);
    const { error } = await supabase.from("usuarios").delete().eq("id", id);
    if (error) { alert(`No se pudo eliminar: ${error.message}`); return; }
    setUsers(prev=>prev.filter(u=>u.id!==id));
  };
  const guardarPassword=async(id)=>{ if(!nuevaPass.trim())return; const{data,error}=await supabase.from("usuarios").update({password:nuevaPass.trim(),password_updated_at:new Date().toISOString()}).eq("id",id).select().single(); if(!error&&data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setCambiandoPass(null);setNuevaPass("");alert("Contraseña actualizada.");} };
  const liberarDispositivo=async(u)=>{ if(!window.confirm(`¿Liberar el dispositivo autorizado de "${u.name}"? El próximo dispositivo que ingrese con esta cuenta quedará autorizado.`))return; const{data}=await supabase.from("usuarios").update({device_token:null}).eq("id",u.id).select().single(); if(data)setUsers(prev=>prev.map(x=>x.id===u.id?data:x)); };
  return (
    <div>
      <PageHeader title="Usuarios" subtitle={`${users.length} usuarios · solo visible para cuentas master · aquí se ve y controla la contraseña de todos`} action={
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={traerFrescos} variant="ghost" sm disabled={sincronizando}>{sincronizando?"Actualizando...":"🔄 Actualizar"}</Btn>
          <Btn onClick={()=>{setShowForm(!showForm);setEditing(null);setCambiandoPass(null);}} sm>{showForm?"Cancelar":"+ Nuevo usuario"}</Btn>
        </div>
      } />
      {showForm&&(
        <Card glow style={{marginBottom:16}}>
          <div style={{fontFamily:font.body,fontSize:13,fontWeight:600,color:C.goldLight,marginBottom:14}}>Nuevo usuario</div>
          <Field label="Nombre completo" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="Nombre Apellido" />
          <Field label="N.º de documento" value={form.documento} onChange={v=>setForm(f=>({...f,documento:v}))} placeholder="Número de documento" />
          <Field label="Tipo de usuario" value={form.role} onChange={v=>setForm(f=>({...f,role:v}))} options={roleOptions} />
          <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginTop:-10,marginBottom:12}}>🔎 {ROLE_PERMISOS[form.role]}</div>
          {form.role==="tienda" && <Field label="Tienda de esta cuenta" value={form.tienda_id} onChange={v=>setForm(f=>({...f,tienda_id:v}))} options={tiendaOptions} />}
          <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginBottom:12}}>💡 La contraseña inicial será el número de documento.</div>
          <Btn onClick={add} disabled={loading || (form.role==="tienda" && !form.tienda_id)} full>{loading?"Guardando...":"Crear usuario"}</Btn>
        </Card>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {ordenados.map(u=>(
          <Card key={u.id} p="14px" style={{opacity:u.active?1:0.6}}>
            {editing===u.id?(
              <div>
                <Field label="Nombre" value={editVal.name} onChange={v=>setEditVal(p=>({...p,name:v}))} />
                <Field label="Documento" value={editVal.documento} onChange={v=>setEditVal(p=>({...p,documento:v}))} />
                <Field label="Tipo de usuario" value={editVal.role} onChange={v=>setEditVal(p=>({...p,role:v}))} options={roleOptions} />
                <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginTop:-10,marginBottom:12}}>🔎 {ROLE_PERMISOS[editVal.role]}</div>
                {editVal.role==="tienda" && <Field label="Tienda de esta cuenta" value={editVal.tienda_id||""} onChange={v=>setEditVal(p=>({...p,tienda_id:v}))} options={tiendaOptions} />}
                <div style={{display:"flex",gap:8}}><Btn onClick={()=>saveEdit(u.id)} disabled={editVal.role==="tienda" && !editVal.tienda_id} variant="success" sm full>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm full>Cancelar</Btn></div>
              </div>
            ):cambiandoPass===u.id?(
              <div>
                <Field label={`Nueva contraseña para ${u.name}`} type="password" value={nuevaPass} onChange={setNuevaPass} placeholder="Nueva contraseña" autoComplete="new-password" />
                <div style={{display:"flex",gap:8}}><Btn onClick={()=>guardarPassword(u.id)} variant="success" sm full>Guardar contraseña</Btn><Btn onClick={()=>{setCambiandoPass(null);setNuevaPass("");}} variant="ghost" sm full>Cancelar</Btn></div>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{width:36,height:36,borderRadius:8,background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,fontWeight:700,color:"#fff",flexShrink:0}}>{u.name[0]}</div>
                <div style={{flex:1,minWidth:120}}><div style={{fontFamily:font.body,fontSize:13,color:C.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div><div style={{fontFamily:font.mono,fontSize:11,color:C.textMuted}}>{u.documento}</div></div>
                <Badge color={ROLE_COLOR[u.role]||C.textMuted} sm title={ROLE_PERMISOS[u.role]}>{ROLE_LABEL[u.role]||u.role}</Badge>
                {u.role==="tienda" && <Badge color={C.textMuted} sm>{stores[u.tienda_id]?.name || "Sin tienda asignada"}</Badge>}
                <Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  {u.role==="tienda" && (u.device_token ? <Btn onClick={()=>liberarDispositivo(u)} variant="ghost" sm>📱 Liberar</Btn> : <Badge color={C.textMuted} sm>📱 Sin vincular</Badge>)}
                  <Btn onClick={()=>{setEditing(u.id);setEditVal({name:u.name,documento:u.documento,role:u.role,tienda_id:u.tienda_id||""});}} variant="ghost" sm>✏</Btn>
                  <Btn onClick={()=>{setCambiandoPass(u.id);setNuevaPass("");}} variant="ghost" sm>🔑</Btn>
                  <Btn onClick={()=>toggle(u)} variant={u.active?"danger":"success"} sm>{u.active?"✕":"✓"}</Btn>
                  <Btn onClick={()=>deleteUsuario(u.id)} variant="danger" sm>🗑</Btn>
                </div>
              </div>
            )}
            {editing!==u.id && cambiandoPass!==u.id && (
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                <span style={{fontFamily:font.body,fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Contraseña actual</span>
                <span style={{fontFamily:font.mono,fontSize:12,color:C.text,letterSpacing:"0.05em"}}>{passVisible[u.id]?(u.password||"—"):"•".repeat(Math.max((u.password||"").length,6))}</span>
                <button onClick={()=>setPassVisible(p=>({...p,[u.id]:!p[u.id]}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.goldLight,fontFamily:font.body,padding:0}}>{passVisible[u.id]?"🙈 Ocultar":"👁 Ver"}</button>
                <span style={{fontFamily:font.body,fontSize:10,color:C.textMuted,marginLeft:"auto"}}>{u.password_updated_at?`Actualizada: ${fmtFechaHora(u.password_updated_at)}`:"Sin registro de actualización"}</span>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN: Acceso de tiendas (admin_finanzas) ─────────────────────────────────
// Versión reducida de UsuariosScreen: solo cuentas de tienda, y solo lo que admin_finanzas
// necesita para resolver problemas de acceso sin tener el panel completo de Usuarios (que
// sigue siendo exclusivo de master — ahí sí se puede crear/borrar gente y cambiar roles).
function TiendasAccesoScreen({ users, setUsers, stores }) {
  const [editing,setEditing]=useState(null),[editVal,setEditVal]=useState({}),[cambiandoPass,setCambiandoPass]=useState(null),[nuevaPass,setNuevaPass]=useState("");
  const [passVisible,setPassVisible]=useState({});
  const [sincronizando,setSincronizando]=useState(false);
  const traerFrescos=async()=>{ setSincronizando(true); const{data}=await supabase.from("usuarios").select("*").eq("role","tienda"); if(data)setUsers(prev=>[...prev.filter(u=>u.role!=="tienda"),...data]); setSincronizando(false); };
  useEffect(()=>{ traerFrescos(); },[]);
  const tiendas=users.filter(u=>u.role==="tienda").sort((a,b)=>a.name.localeCompare(b.name));
  const saveEdit=async(id)=>{ if(!editVal.name.trim()||!editVal.documento.trim())return; const{data}=await supabase.from("usuarios").update({name:editVal.name.trim(),documento:editVal.documento.trim()}).eq("id",id).select().single(); if(data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setEditing(null);} };
  const guardarPassword=async(id)=>{ if(!nuevaPass.trim())return; const{data,error}=await supabase.from("usuarios").update({password:nuevaPass.trim(),password_updated_at:new Date().toISOString()}).eq("id",id).select().single(); if(!error&&data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setCambiandoPass(null);setNuevaPass("");alert("Contraseña actualizada.");} };
  const liberarDispositivo=async(u)=>{ if(!window.confirm(`¿Liberar el dispositivo autorizado de "${u.name}"? El próximo dispositivo que ingrese con esta cuenta quedará autorizado.`))return; const{data}=await supabase.from("usuarios").update({device_token:null}).eq("id",u.id).select().single(); if(data)setUsers(prev=>prev.map(x=>x.id===u.id?data:x)); };
  return (
    <div>
      <PageHeader title="Acceso de tiendas" subtitle={`${tiendas.length} cuentas de tienda · liberar dispositivo, usuario y contraseña`} action={
        <Btn onClick={traerFrescos} variant="ghost" sm disabled={sincronizando}>{sincronizando?"Actualizando...":"🔄 Actualizar"}</Btn>
      } />
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {tiendas.map(u=>(
          <Card key={u.id} p="14px" style={{opacity:u.active?1:0.6}}>
            {editing===u.id?(
              <div>
                <Field label="Nombre" value={editVal.name} onChange={v=>setEditVal(p=>({...p,name:v}))} />
                <Field label="N.º de documento (usuario)" value={editVal.documento} onChange={v=>setEditVal(p=>({...p,documento:v}))} />
                <div style={{display:"flex",gap:8}}><Btn onClick={()=>saveEdit(u.id)} variant="success" sm full>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm full>Cancelar</Btn></div>
              </div>
            ):cambiandoPass===u.id?(
              <div>
                <Field label={`Nueva contraseña para ${u.name}`} type="password" value={nuevaPass} onChange={setNuevaPass} placeholder="Nueva contraseña" autoComplete="new-password" />
                <div style={{display:"flex",gap:8}}><Btn onClick={()=>guardarPassword(u.id)} variant="success" sm full>Guardar contraseña</Btn><Btn onClick={()=>{setCambiandoPass(null);setNuevaPass("");}} variant="ghost" sm full>Cancelar</Btn></div>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <div style={{width:36,height:36,borderRadius:8,background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,fontWeight:700,color:"#fff",flexShrink:0}}>{u.name[0]}</div>
                <div style={{flex:1,minWidth:120}}><div style={{fontFamily:font.body,fontSize:13,color:C.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div><div style={{fontFamily:font.mono,fontSize:11,color:C.textMuted}}>{u.documento}</div></div>
                <Badge color={C.textMuted} sm>{stores[u.tienda_id]?.name || "Sin tienda asignada"}</Badge>
                <Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  {u.device_token ? <Btn onClick={()=>liberarDispositivo(u)} variant="ghost" sm>📱 Liberar</Btn> : <Badge color={C.textMuted} sm>📱 Sin vincular</Badge>}
                  <Btn onClick={()=>{setEditing(u.id);setEditVal({name:u.name,documento:u.documento});}} variant="ghost" sm>✏ Usuario</Btn>
                  <Btn onClick={()=>{setCambiandoPass(u.id);setNuevaPass("");}} variant="ghost" sm>🔑 Contraseña</Btn>
                </div>
              </div>
            )}
            {editing!==u.id && cambiandoPass!==u.id && (
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,flexWrap:"wrap"}}>
                <span style={{fontFamily:font.body,fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Contraseña actual</span>
                <span style={{fontFamily:font.mono,fontSize:12,color:C.text,letterSpacing:"0.05em"}}>{passVisible[u.id]?(u.password||"—"):"•".repeat(Math.max((u.password||"").length,6))}</span>
                <button onClick={()=>setPassVisible(p=>({...p,[u.id]:!p[u.id]}))} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:C.goldLight,fontFamily:font.body,padding:0}}>{passVisible[u.id]?"🙈 Ocultar":"👁 Ver"}</button>
              </div>
            )}
          </Card>
        ))}
        {tiendas.length===0 && <Card><div style={{textAlign:"center",padding:20,color:C.textMuted,fontFamily:font.body,fontSize:13}}>No hay cuentas de tienda todavía.</div></Card>}
      </div>
    </div>
  );
}

// ── SCREEN: Stores ────────────────────────────────────────────────────────────
const TIENDA_COLOR_PRESETS = [
  { label:"Rojo",        value:"#e0433e" },
  { label:"Verde",       value:"#3fa15e" },
  { label:"Azul",        value:"#3d7ee0" },
  { label:"Azul oscuro", value:"#1e3a5f" },
  { label:"Ámbar",       value:"#d99a2b" },
  { label:"Gris",        value:"#6b7280" },
];
function ColorPicker({ value, onChange }) {
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Color</div>
      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
        {TIENDA_COLOR_PRESETS.map(p=>(
          <button key={p.value} type="button" title={p.label} onClick={()=>onChange(p.value)} style={{ width:24, height:24, borderRadius:6, background:p.value, border:value===p.value?`2px solid ${C.text}`:"2px solid transparent", cursor:"pointer", padding:0 }}/>
        ))}
        <input type="color" value={value||"#6b7280"} onChange={e=>onChange(e.target.value)} style={{ width:28, height:24, border:"none", background:"none", cursor:"pointer", padding:0 }}/>
      </div>
    </div>
  );
}
function StoresScreen({ stores, setStores }) {
  const soloLectura = useReadOnly();
  const [showForm,setShowForm]=useState(false),[newName,setNewName]=useState(""),[newColor,setNewColor]=useState("#6b7280"),[newVende,setNewVende]=useState(true),[editing,setEditing]=useState(null),[editVal,setEditVal]=useState({}),[newShift,setNewShift]=useState({});
  const addStore=async()=>{ if(!newName.trim())return; const id=newName.trim().toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,""); if(stores[id])return; const{data,error}=await supabase.from("tiendas").insert({id,name:newName.trim(),shifts:[],color:newColor,vende:newVende}).select().single(); if(data){setStores(prev=>({...prev,[data.id]:data}));setNewName("");setNewColor("#6b7280");setNewVende(true);setShowForm(false);} else if(error){ alert(`No se pudo crear la tienda: ${error.message}`); } };
  const deleteStore=async(id)=>{
    const { count } = await supabase.from("registros").select("id", { count: "exact", head: true }).eq("store", id);
    if (count > 0) { alert(`Esta tienda tiene ${count} registro(s) de asistencia asociados. Eliminarla podría borrar ese historial para siempre. Si ya no está operando, simplemente deja de asignarle turnos nuevos en vez de eliminarla.`); return; }
    if (!window.confirm("Esta tienda no tiene registros de asistencia. ¿Eliminarla de todas formas? Esto no se puede deshacer.")) return;
    await supabase.from("tiendas").delete().eq("id",id); setStores(prev=>{const c={...prev};delete c[id];return c;});
  };
  const saveEdit=async(id)=>{ if(!editVal.name.trim())return; const{data,error}=await supabase.from("tiendas").update({name:editVal.name.trim(),color:editVal.color||"#6b7280"}).eq("id",id).select().single(); if(data){setStores(prev=>({...prev,[id]:data}));setEditing(null);} else if(error){ alert(`No se pudo guardar: ${error.message}`); } };
  const toggleVende=async(s)=>{ const{data}=await supabase.from("tiendas").update({vende:!(s.vende!==false)}).eq("id",s.id).select().single(); if(data)setStores(prev=>({...prev,[s.id]:data})); };
  const [editShiftId,setEditShiftId]=useState(null),[editShiftNombre,setEditShiftNombre]=useState("");
  const removeShift=async(sid,shId)=>{ const shifts=stores[sid].shifts.filter(x=>x.id!==shId); const{data,error}=await supabase.from("tiendas").update({shifts}).eq("id",sid).select().single(); if(data)setStores(prev=>({...prev,[sid]:data})); else if(error) alert(`No se pudo quitar el turno: ${error.message}`); };
  const addShift=async(sid)=>{ const nombre=(newShift[sid]||"").trim(); if(!nombre||stores[sid].shifts.some(x=>x.nombre===nombre))return; const id=nombre.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"")||`turno_${Date.now()}`; const shifts=[...stores[sid].shifts,{id,nombre,activo:true}]; const{data,error}=await supabase.from("tiendas").update({shifts}).eq("id",sid).select().single(); if(data){setStores(prev=>({...prev,[sid]:data}));setNewShift(p=>({...p,[sid]:""}));} else if(error) alert(`No se pudo agregar el turno: ${error.message}`); };
  const toggleShiftActivo=async(sid,shId)=>{ const shifts=stores[sid].shifts.map(x=>x.id===shId?{...x,activo:x.activo===false}:x); const{data,error}=await supabase.from("tiendas").update({shifts}).eq("id",sid).select().single(); if(data)setStores(prev=>({...prev,[sid]:data})); else if(error) alert(`No se pudo actualizar: ${error.message}`); };
  const saveShiftNombre=async(sid,shId)=>{ if(!editShiftNombre.trim())return; const shifts=stores[sid].shifts.map(x=>x.id===shId?{...x,nombre:editShiftNombre.trim()}:x); const{data,error}=await supabase.from("tiendas").update({shifts}).eq("id",sid).select().single(); if(data){setStores(prev=>({...prev,[sid]:data}));setEditShiftId(null);} else if(error) alert(`No se pudo renombrar: ${error.message}`); };
  return (
    <div>
      <PageHeader title="Tiendas" subtitle="Puntos de venta y turnos" action={soloLectura?null:<Btn onClick={()=>setShowForm(!showForm)} sm>{showForm?"Cancelar":"+ Nueva"}</Btn>} />
      {!soloLectura && showForm&&(<Card glow style={{marginBottom:16}}><Field label="Nombre de la tienda" value={newName} onChange={setNewName} placeholder="Ej: Centenario" /><ColorPicker value={newColor} onChange={setNewColor}/><div style={{marginBottom:12}}><label style={{display:"flex",alignItems:"center",gap:8,fontFamily:font.body,fontSize:12,color:C.text,cursor:"pointer"}}><input type="checkbox" checked={newVende} onChange={e=>setNewVende(e.target.checked)}/> Vende — aparece en Ventas</label></div><Btn onClick={addStore} full>Crear tienda</Btn></Card>)}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {Object.values(stores).map(s=>(
          <Card key={s.id} glow={editing===s.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flex:1,minWidth:0}}>
                <span style={{width:12,height:12,borderRadius:4,background:s.color||"#6b7280",flexShrink:0}}/>
                {!soloLectura && editing===s.id?<input value={editVal.name} onChange={e=>setEditVal(p=>({...p,name:e.target.value}))} style={{flex:1,background:C.surfaceAlt,border:`1px solid ${C.gold}`,borderRadius:7,padding:"7px 10px",color:C.text,fontSize:15,fontFamily:font.body,outline:"none",fontWeight:700}}/>:<div style={{fontFamily:font.body,fontSize:15,fontWeight:700,color:C.goldLight}}>{s.name}</div>}
              </div>
              {!soloLectura && <div style={{display:"flex",gap:6,marginLeft:10,flexShrink:0}}>
                {editing===s.id?<><Btn onClick={()=>saveEdit(s.id)} sm>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm>✕</Btn></>:<><Btn onClick={()=>{setEditing(s.id);setEditVal({name:s.name,color:s.color||"#6b7280"});}} variant="ghost" sm>✏</Btn><Btn onClick={()=>deleteStore(s.id)} variant="danger" sm>🗑</Btn></>}
              </div>}
            </div>
            {!soloLectura && editing===s.id && <ColorPicker value={editVal.color} onChange={c=>setEditVal(p=>({...p,color:c}))}/>}
            <div style={{marginBottom:10}}>
              {soloLectura ? (
                <Badge color={s.vende!==false?C.green:C.textMuted} sm>{s.vende!==false?"Vende":"No vende (no aparece en Ventas)"}</Badge>
              ) : (
                <Btn onClick={()=>toggleVende(s)} variant="ghost" sm>{s.vende!==false ? "✓ Vende — aparece en Ventas" : "✕ No vende — oculta en Ventas"}</Btn>
              )}
            </div>
            <Divider />
            <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Turnos ({s.shifts.length})</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {s.shifts.length===0&&<span style={{fontFamily:font.body,fontSize:12,color:C.border}}>Sin turnos</span>}
              {s.shifts.map(sh=>(
                <div key={sh.id} style={{display:"flex",alignItems:"center",gap:4}}>
                  {!soloLectura && editShiftId===sh.id ? (
                    <>
                      <input autoFocus value={editShiftNombre} onChange={e=>setEditShiftNombre(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveShiftNombre(s.id,sh.id)} style={{width:100,background:C.surfaceAlt,border:`1px solid ${C.gold}`,borderRadius:5,padding:"3px 6px",color:C.text,fontSize:11,fontFamily:font.body,outline:"none"}}/>
                      <button onClick={()=>saveShiftNombre(s.id,sh.id)} style={{background:"none",border:"none",color:C.green,cursor:"pointer",fontSize:12}}>✓</button>
                      <button onClick={()=>setEditShiftId(null)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:12}}>✕</button>
                    </>
                  ) : (
                    <>
                      <Badge color={sh.activo===false?C.textMuted:C.goldLight} sm>{sh.nombre}{sh.activo===false?" · inactivo":""}</Badge>
                      {!soloLectura && <>
                        <button onClick={()=>{setEditShiftId(sh.id);setEditShiftNombre(sh.nombre);}} title="Renombrar" style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:11}}>✏</button>
                        <button onClick={()=>toggleShiftActivo(s.id,sh.id)} title={sh.activo===false?"Activar":"Desactivar"} style={{background:"none",border:"none",color:sh.activo===false?C.green:C.amber,cursor:"pointer",fontSize:11}}>{sh.activo===false?"✓":"⏸"}</button>
                        <button onClick={()=>removeShift(s.id,sh.id)} style={{background:C.redDim,border:`1px solid ${C.red}33`,color:C.red,borderRadius:4,width:16,height:16,cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>🗑</button>
                      </>}
                    </>
                  )}
                </div>
              ))}
            </div>
            {!soloLectura && <div style={{display:"flex",gap:8}}>
              <input value={newShift[s.id]||""} onChange={e=>setNewShift(p=>({...p,[s.id]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addShift(s.id)} placeholder="Nuevo turno" style={{flex:1,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 10px",color:C.text,fontSize:12,fontFamily:font.body,outline:"none"}}/>
              <Btn onClick={()=>addShift(s.id)} sm>+ Agregar</Btn>
            </div>}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN: Turnos especiales (códigos sin tienda: descanso, incapacidad, vacaciones...) ──
function TurnosEspecialesScreen({ turnosGlobales, setTurnosGlobales }) {
  const soloLectura = useReadOnly();
  const [showForm,setShowForm]=useState(false),[newNombre,setNewNombre]=useState(""),[newColor,setNewColor]=useState("#9ca3af"),[editing,setEditing]=useState(null),[editVal,setEditVal]=useState({});
  const addGlobal=async()=>{ if(!newNombre.trim())return; const id=newNombre.trim().toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,""); if(!id||turnosGlobales.some(t=>t.id===id))return; const{data,error}=await supabase.from("turnos_globales").insert({id,nombre:newNombre.trim(),color:newColor}).select().single(); if(!error&&data){setTurnosGlobales(prev=>[...prev,data]);setNewNombre("");setNewColor("#9ca3af");setShowForm(false);} else if(error){ alert(`No se pudo crear el código: ${error.message}`); } };
  const saveEdit=async(id)=>{ if(!editVal.nombre.trim())return; const{data,error}=await supabase.from("turnos_globales").update({nombre:editVal.nombre.trim(),color:editVal.color||"#9ca3af"}).eq("id",id).select().single(); if(!error&&data){setTurnosGlobales(prev=>prev.map(t=>t.id===id?data:t));setEditing(null);} else if(error){ alert(`No se pudo guardar: ${error.message}`); } };
  const deleteGlobal=async(id)=>{
    const { count } = await supabase.from("turnos_asignaciones").select("id",{ count:"exact", head:true }).eq("turno_global_id",id);
    if(count>0){ alert(`Este código está asignado en ${count} día(s) de la rejilla. Quítalo de esas asignaciones antes de eliminarlo.`); return; }
    if(!window.confirm("¿Eliminar este código? Esto no se puede deshacer.")) return;
    await supabase.from("turnos_globales").delete().eq("id",id); setTurnosGlobales(prev=>prev.filter(t=>t.id!==id));
  };
  return (
    <div>
      <PageHeader title="Turnos especiales" subtitle="Códigos sin tienda: descanso, incapacidad, vacaciones..." action={soloLectura?null:<Btn onClick={()=>setShowForm(!showForm)} sm>{showForm?"Cancelar":"+ Nuevo"}</Btn>} />
      {!soloLectura && showForm&&(<Card glow style={{marginBottom:16}}><Field label="Nombre / código" value={newNombre} onChange={setNewNombre} placeholder="Ej: Descanso" /><ColorPicker value={newColor} onChange={setNewColor}/><Btn onClick={addGlobal} full>Crear código</Btn></Card>)}
      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
        {turnosGlobales.map(t=>(
          <Card key={t.id} p="10px 14px" glow={editing===t.id} style={{minWidth:180}}>
            {!soloLectura && editing===t.id ? (
              <div>
                <input value={editVal.nombre} onChange={e=>setEditVal(p=>({...p,nombre:e.target.value}))} style={{width:"100%",background:C.surfaceAlt,border:`1px solid ${C.gold}`,borderRadius:7,padding:"6px 8px",color:C.text,fontSize:13,fontFamily:font.body,outline:"none",marginBottom:8}}/>
                <ColorPicker value={editVal.color} onChange={c=>setEditVal(p=>({...p,color:c}))}/>
                <div style={{display:"flex",gap:6}}><Btn onClick={()=>saveEdit(t.id)} sm full>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm full>✕</Btn></div>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:12,height:12,borderRadius:4,background:t.color,flexShrink:0}}/>
                <span style={{fontFamily:font.body,fontSize:13,color:C.text,fontWeight:600,flex:1}}>{t.nombre}</span>
                {!soloLectura && <div style={{display:"flex",gap:4}}>
                  <Btn onClick={()=>{setEditing(t.id);setEditVal({nombre:t.nombre,color:t.color});}} variant="ghost" sm>✏</Btn>
                  <Btn onClick={()=>deleteGlobal(t.id)} variant="danger" sm>🗑</Btn>
                </div>}
              </div>
            )}
          </Card>
        ))}
        {turnosGlobales.length===0 && <div style={{fontFamily:font.body,fontSize:12,color:C.textMuted}}>Sin códigos especiales todavía.</div>}
      </div>
    </div>
  );
}

// ── SCREEN: Turnos · Horarios (fecha de vigencia por familia de turno T1-T4/TOF) ──
const FAMILIAS_TURNO = ["T1","T2","T3","T4","TOF"];
function TurnosHorariosScreen({ stores, turnosHorarios, setTurnosHorarios }) {
  const soloLectura = useReadOnly();
  const [showForm,setShowForm]=useState(false);
  const vacio = { familia:"T1", tienda_id:"", vigente_desde:todayStr, entrada_lj:"", entrada_vs:"", salida_lj:"", salida_vs:"" };
  const [form,setForm]=useState(vacio);
  const [editingId,setEditingId]=useState(null);
  const [editForm,setEditForm]=useState(vacio);
  const [historialAbierto,setHistorialAbierto]=useState(null); // id de la fila cuyo historial se está mostrando
  const [historial,setHistorial]=useState({}); // { [horarioId]: [...filas] }
  const guardar=async()=>{
    if(!form.familia.trim()){ alert("Falta el nombre del turno (familia), ej. T5."); return; }
    if(!form.entrada_lj||!form.entrada_vs){ alert("Falta la hora de entrada L-J y V-S."); return; }
    const payload={ familia:form.familia.trim().toUpperCase(), tienda_id:form.tienda_id||null, vigente_desde:form.vigente_desde, entrada_lj:form.entrada_lj, entrada_vs:form.entrada_vs, salida_lj:form.salida_lj||null, salida_vs:form.salida_vs||null };
    const{data,error}=await supabase.from("turnos_horarios").insert(payload).select().single();
    if(!error&&data){ setTurnosHorarios(prev=>[...prev,data]); setForm(vacio); setShowForm(false); } else if(error){ alert(`No se pudo guardar: ${error.message}`); }
  };
  const eliminar=async(id)=>{
    if(!window.confirm("¿Eliminar este cambio de horario? Los registros ya evaluados no cambian, pero deja de aplicar hacia adelante.")) return;
    const{error}=await supabase.from("turnos_horarios").delete().eq("id",id);
    if(!error) setTurnosHorarios(prev=>prev.filter(h=>h.id!==id)); else alert(`No se pudo eliminar: ${error.message}`);
  };
  const empezarEdicion=(h)=>{ setEditingId(h.id); setEditForm({ familia:h.familia, tienda_id:h.tienda_id||"", vigente_desde:h.vigente_desde, entrada_lj:h.entrada_lj||"", entrada_vs:h.entrada_vs||"", salida_lj:h.salida_lj||"", salida_vs:h.salida_vs||"" }); };
  const guardarEdicion=async(id)=>{
    if(!editForm.entrada_lj||!editForm.entrada_vs){ alert("Falta la hora de entrada L-J y V-S."); return; }
    const original = turnosHorarios.find(h=>h.id===id);
    if(original){
      // Deja rastro: guarda cómo estaba ANTES de aplicar el cambio.
      await supabase.from("turnos_horarios_historial").insert({ horario_id:id, familia:original.familia, tienda_id:original.tienda_id, vigente_desde:original.vigente_desde, entrada_lj:original.entrada_lj, entrada_vs:original.entrada_vs, salida_lj:original.salida_lj, salida_vs:original.salida_vs });
    }
    const payload={ familia:editForm.familia, tienda_id:editForm.tienda_id||null, vigente_desde:editForm.vigente_desde, entrada_lj:editForm.entrada_lj, entrada_vs:editForm.entrada_vs, salida_lj:editForm.salida_lj||null, salida_vs:editForm.salida_vs||null };
    const{data,error}=await supabase.from("turnos_horarios").update(payload).eq("id",id).select().single();
    if(!error&&data){ setTurnosHorarios(prev=>prev.map(h=>h.id===id?data:h)); setEditingId(null); setHistorial(prev=>{ const c={...prev}; delete c[id]; return c; }); } else if(error){ alert(`No se pudo guardar: ${error.message}`); }
  };
  const verHistorial=async(id)=>{
    if(historialAbierto===id){ setHistorialAbierto(null); return; }
    setHistorialAbierto(id);
    if(!historial[id]){ const{data}=await supabase.from("turnos_horarios_historial").select("*").eq("horario_id",id).order("reemplazado_en",{ascending:false}); setHistorial(prev=>({...prev,[id]:data||[]})); }
  };
  const familiasPresentes = [...new Set([...FAMILIAS_TURNO, ...turnosHorarios.map(h=>h.familia)])];
  const porFamilia = familiasPresentes.map(fam=>({ familia:fam, filas:turnosHorarios.filter(h=>h.familia===fam).sort((a,b)=>b.vigente_desde.localeCompare(a.vigente_desde)) })).filter(f=>f.filas.length>0 || FAMILIAS_TURNO.includes(f.familia));
  return (
    <div>
      <PageHeader title="Horarios" subtitle="Hora de entrada esperada por turno — define si un registro cuenta como puntual" action={soloLectura?null:<Btn onClick={()=>setShowForm(!showForm)} sm>{showForm?"Cancelar":"+ Nuevo cambio"}</Btn>}/>
      {!soloLectura && showForm && (
        <Card glow style={{marginBottom:16}}>
          <Field label="Turno (familia)" value={form.familia} onChange={v=>setForm(f=>({...f,familia:v.toUpperCase()}))} placeholder="T1, T2... o uno nuevo como T5"/>
          <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginTop:-10,marginBottom:12}}>💡 Es la parte que comparten UT1/JT1/CT1, etc. Si creas un turno nuevo (ej. T5), ponlo aquí igual que en el código de la tienda (UT5, CT5...) para que quede vinculado.</div>
          <Field label="Tienda (opcional — vacío aplica a todas)" value={form.tienda_id} onChange={v=>setForm(f=>({...f,tienda_id:v}))} options={[{value:"",label:"Todas las tiendas"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]}/>
          <Field label="Vigente desde" type="date" value={form.vigente_desde} onChange={v=>setForm(f=>({...f,vigente_desde:v}))}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Entrada Lun-Jue" type="time" value={form.entrada_lj} onChange={v=>setForm(f=>({...f,entrada_lj:v}))}/>
            <Field label="Entrada Vie-Sáb" type="time" value={form.entrada_vs} onChange={v=>setForm(f=>({...f,entrada_vs:v}))}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Salida Lun-Jue (referencia)" type="time" value={form.salida_lj} onChange={v=>setForm(f=>({...f,salida_lj:v}))}/>
            <Field label="Salida Vie-Sáb (referencia)" type="time" value={form.salida_vs} onChange={v=>setForm(f=>({...f,salida_vs:v}))}/>
          </div>
          <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginBottom:12}}>💡 Desde la fecha que pongas, este horario aplica hacia adelante. Los registros de días anteriores siguen evaluándose con el horario que regía antes — no cambian.</div>
          <Btn onClick={guardar} full>Guardar</Btn>
        </Card>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {porFamilia.map(({familia,filas})=>(
          <Card key={familia} p="12px 14px">
            <div style={{fontFamily:font.body,fontSize:13,fontWeight:700,color:C.goldLight,marginBottom:8}}>{familia}</div>
            {filas.length===0 && <div style={{fontFamily:font.body,fontSize:12,color:C.border}}>Sin horario definido.</div>}
            {filas.map(h=>(
              <div key={h.id} style={{padding:"6px 0",borderTop:`1px solid ${C.border}`}}>
                {editingId===h.id ? (
                  <div>
                    <Field label="Tienda (opcional — vacío aplica a todas)" value={editForm.tienda_id} onChange={v=>setEditForm(f=>({...f,tienda_id:v}))} options={[{value:"",label:"Todas las tiendas"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]}/>
                    <Field label="Vigente desde" type="date" value={editForm.vigente_desde} onChange={v=>setEditForm(f=>({...f,vigente_desde:v}))}/>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <Field label="Entrada L-J" type="time" value={editForm.entrada_lj} onChange={v=>setEditForm(f=>({...f,entrada_lj:v}))}/>
                      <Field label="Entrada V-S" type="time" value={editForm.entrada_vs} onChange={v=>setEditForm(f=>({...f,entrada_vs:v}))}/>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <Field label="Salida L-J" type="time" value={editForm.salida_lj} onChange={v=>setEditForm(f=>({...f,salida_lj:v}))}/>
                      <Field label="Salida V-S" type="time" value={editForm.salida_vs} onChange={v=>setEditForm(f=>({...f,salida_vs:v}))}/>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <Btn onClick={()=>guardarEdicion(h.id)} variant="success" sm full>Guardar cambio</Btn>
                      <Btn onClick={()=>setEditingId(null)} variant="ghost" sm full>Cancelar</Btn>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <Badge color={C.textMuted} sm>{h.tienda_id ? (stores[h.tienda_id]?.name||h.tienda_id) : "Todas las tiendas"}</Badge>
                    <span style={{fontFamily:font.body,fontSize:12,color:C.text}}>desde {h.vigente_desde}</span>
                    <span style={{fontFamily:font.mono,fontSize:12,color:C.text}}>Entra {h.entrada_lj} (L-J) · {h.entrada_vs} (V-S)</span>
                    <span style={{fontFamily:font.mono,fontSize:12,color:C.textMuted}}>Sale {h.salida_lj||"—"} (L-J) · {h.salida_vs||"—"} (V-S)</span>
                    <button onClick={()=>verHistorial(h.id)} style={{background:"none",border:"none",color:C.goldLight,cursor:"pointer",fontSize:11,fontFamily:font.body}}>{historialAbierto===h.id?"Ocultar historial":"Ver historial"}</button>
                    {!soloLectura && <div style={{marginLeft:"auto",display:"flex",gap:8}}>
                      <button onClick={()=>empezarEdicion(h)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:12}}>✏</button>
                      <button onClick={()=>eliminar(h.id)} style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:12}}>🗑</button>
                    </div>}
                  </div>
                )}
                {historialAbierto===h.id && (
                  <div style={{marginTop:8,paddingLeft:8,borderLeft:`2px solid ${C.border}`,display:"flex",flexDirection:"column",gap:4}}>
                    {(historial[h.id]||[]).length===0 && <span style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>Sin cambios anteriores registrados.</span>}
                    {(historial[h.id]||[]).map(v=>(
                      <div key={v.id} style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>
                        Antes: desde {v.vigente_desde} · entra {v.entrada_lj} (L-J) / {v.entrada_vs} (V-S) — reemplazado el {fmtFechaHora(v.reemplazado_en)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN: Turnos · Administrar (asesores + tiendas + turnos especiales + horarios) ──
function TurnosAdminScreen({ users, setUsers, stores, setStores, turnosGlobales, setTurnosGlobales, turnosHorarios, setTurnosHorarios }) {
  const [sub,setSub]=useState("asesores");
  const subTabs=[{id:"asesores",label:"Asesores"},{id:"tiendas",label:"Tiendas"},{id:"especiales",label:"Turnos especiales"},{id:"horarios",label:"Horarios"}];
  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {subTabs.map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)} style={{padding:"6px 14px",borderRadius:99,border:`1px solid ${sub===t.id?C.gold:C.border}`,background:sub===t.id?`${C.gold}18`:"transparent",color:sub===t.id?C.goldLight:C.textMuted,fontFamily:font.body,fontSize:12,fontWeight:600,cursor:"pointer"}}>{t.label}</button>
        ))}
      </div>
      <div key={sub} className="ozen-pane-anim-tab">
        {sub==="asesores"   && <UsersScreen users={users} setUsers={setUsers}/>}
        {sub==="tiendas"    && <StoresScreen stores={stores} setStores={setStores}/>}
        {sub==="especiales" && <TurnosEspecialesScreen turnosGlobales={turnosGlobales} setTurnosGlobales={setTurnosGlobales}/>}
        {sub==="horarios"   && <TurnosHorariosScreen stores={stores} turnosHorarios={turnosHorarios} setTurnosHorarios={setTurnosHorarios}/>}
      </div>
    </div>
  );
}

// ── Turnos: helpers compartidos por la rejilla (ver/editar) y por "Mis turnos" ─
const MESES_LARGO = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const fechasDelMesTurnos = (anio, mes) => { const n = new Date(anio, mes+1, 0).getDate(); return Array.from({length:n},(_,i)=>`${anio}-${String(mes+1).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`); };
const addDiasFecha = (fechaStr, n) => { const d=new Date(fechaStr+"T12:00:00"); d.setDate(d.getDate()+n); return fmt(d); };
const primerNombre = (n) => (n||"").trim().split(" ")[0];
const nombreDia = (fechaStr) => { const d=new Date(fechaStr+"T12:00:00"); const l=d.toLocaleDateString("es-CO",{weekday:"long"}); return l.charAt(0).toUpperCase()+l.slice(1); };
const nombreDiaCorto = (fechaStr) => nombreDia(fechaStr).slice(0,3);
const esDomingo = (fechaStr) => new Date(fechaStr+"T12:00:00").getDay()===0;
const resolverTurno = (asig, stores, turnosGlobales) => {
  if(!asig) return null;
  if(asig.turno_global_id){ const g=turnosGlobales.find(t=>t.id===asig.turno_global_id); return g?{ label:g.nombre, color:g.color }:null; }
  if(asig.tienda_id){ const s=stores[asig.tienda_id]; return s?{ label:asig.shift||s.name, color:s.color||"#6b7280" }:null; }
  return null;
};
const valorCelda = (asig) => { if(!asig) return ""; if(asig.turno_global_id) return `g:${asig.turno_global_id}`; if(asig.tienda_id) return `t:${asig.tienda_id}|${encodeURIComponent(asig.shift||"")}`; return ""; };
// Elige texto blanco o azul oscuro según qué tan claro sea el color de fondo, para que
// siempre haya contraste legible (ej. un turno especial en blanco/amarillo pálido).
const colorTextoContraste = (hex) => {
  if(!hex) return "#fff";
  const h = hex.replace("#","");
  if(h.length!==6) return "#fff";
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  const luminancia = (0.299*r + 0.587*g + 0.114*b)/255;
  return luminancia > 0.65 ? C.goldDark : "#fff";
};
// Oscurece un hex un % dado (para el segundo stop del degradado de los badges de turno).
const oscurecerColor = (hex, pct=16) => {
  if(!hex) return hex;
  const h = hex.replace("#","");
  if(h.length!==6) return hex;
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  const f = (c) => Math.max(0, Math.round(c*(1-pct/100)));
  return `#${[f(r),f(g),f(b)].map(n=>n.toString(16).padStart(2,"0")).join("")}`;
};
const hexToRgba = (hex, alpha) => {
  if(!hex) return `rgba(0,0,0,${alpha})`;
  const h = hex.replace("#","");
  if(h.length!==6) return `rgba(0,0,0,${alpha})`;
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
};
function TurnoBadgeCelda({ turno, size }) {
  if(!turno) return <div style={{ width:"100%", minHeight:size==="sm"?24:28 }}/>;
  const txt = colorTextoContraste(turno.color);
  return (
    <div style={{
      width:"100%", minHeight:size==="sm"?24:28, borderRadius:8, boxSizing:"border-box",
      background:`linear-gradient(135deg, ${turno.color}, ${oscurecerColor(turno.color,18)})`,
      color:txt, display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:font.body, fontSize:size==="sm"?10.5:11.5, fontWeight:700, letterSpacing:"0.01em",
      padding:"3px 6px", textShadow:txt==="#fff"?"0 1px 2px rgba(0,0,0,0.3)":"none",
      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      boxShadow:"0 1px 3px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.22)",
      border:`1px solid ${hexToRgba(oscurecerColor(turno.color,30),0.55)}`,
      transition:"transform .12s ease, box-shadow .12s ease",
    }}>{turno.label}</div>
  );
}
// Busca, para una familia de turno + tienda + fecha dadas, la fila de `turnos_horarios` que
// aplica (la más reciente vigente_desde<=fecha; prioriza una fila específica de esa tienda
// sobre la genérica). Se usa tanto para calcular puntualidad como para mostrar la leyenda.
const filaHorarioVigente = (familia, store, turnosHorarios, fecha=todayStr) => {
  if(!familia) return null;
  const candidatos = (turnosHorarios||[]).filter(h => h.familia===familia && h.vigente_desde<=fecha);
  if(!candidatos.length) return null;
  const especificas = candidatos.filter(h=>h.tienda_id===store);
  const pool = especificas.length ? especificas : candidatos.filter(h=>!h.tienda_id);
  if(!pool.length) return null;
  return pool.reduce((a,b)=> b.vigente_desde > a.vigente_desde ? b : a);
};
const fmtHora12 = (hhmm) => { if(!hhmm) return "?"; const [h,m]=hhmm.split(":").map(Number); const per=h>=12?"pm":"am"; const h12=h%12===0?12:h%12; return m? `${h12}:${String(m).padStart(2,"0")}${per}` : `${h12}${per}`; };
const formatearHorarioFila = (fila) => {
  if(!fila) return null;
  const lj = `${fmtHora12(fila.entrada_lj)}–${fmtHora12(fila.salida_lj)}`;
  const vs = `${fmtHora12(fila.entrada_vs)}–${fmtHora12(fila.salida_vs)}`;
  return lj===vs ? lj : `${lj} (L-J) / ${vs} (V-S)`;
};
// Líneas de horario al estilo de tu Excel: una línea si L-J y V-S son iguales,
// dos líneas ("L-J (COD) hora" / "V-S (COD) hora") si son distintas.
const lineasHorarioTurno = (sh, fila) => {
  if(!fila) return [`(${sh.nombre}) sin horario`];
  const lj = `${fmtHora12(fila.entrada_lj)}–${fmtHora12(fila.salida_lj)}`;
  const vs = `${fmtHora12(fila.entrada_vs)}–${fmtHora12(fila.salida_vs)}`;
  if(lj===vs) return [`(${sh.nombre}) ${lj}`];
  return [`L-J (${sh.nombre}) ${lj}`, `V-S (${sh.nombre}) ${vs}`];
};
// ── Turnos: leyenda — un bloque de color por tienda, lado a lado, igual que el Excel ──
function TurnosLeyenda({ stores, turnosGlobales, turnosHorarios }) {
  const [abierta,setAbierta]=useState(true);
  const tiendasConTurnos = Object.values(stores).filter(s=>(s.shifts||[]).some(sh=>sh.activo!==false));
  if(tiendasConTurnos.length===0 && turnosGlobales.length===0) return null;
  const totalTurnos = tiendasConTurnos.reduce((n,s)=>n+s.shifts.filter(sh=>sh.activo!==false).length,0) + turnosGlobales.length;
  return (
    <Card p="10px 14px" style={{ marginBottom:16 }}>
      <button onClick={()=>setAbierta(!abierta)} style={{ background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:8, width:"100%" }}>
        <span style={{ fontFamily:font.body, fontSize:12.5, fontWeight:600, color:C.text }}>Horarios ({totalTurnos})</span>
        <span style={{ marginLeft:"auto", fontFamily:font.body, fontSize:11, color:C.goldLight }}>{abierta?"Ocultar ▲":"Ver ▾"}</span>
      </button>
      <Collapse open={abierta}>
        <div style={{ display:"flex", marginTop:10, overflowX:"auto", whiteSpace:"nowrap" }}>
          {tiendasConTurnos.map((s,si)=>{
            const activos=s.shifts.filter(sh=>sh.activo!==false);
            const txt = colorTextoContraste(s.color);
            const lineas = activos.flatMap(sh=>{
              const fila = filaHorarioVigente(familiaDeTurno(sh.nombre), s.id, turnosHorarios);
              return lineasHorarioTurno(sh, fila);
            });
            const anchoTexto = Math.max(s.name.length, ...lineas.map(l=>l.length), 8) * 6 + 14;
            return (
              <div key={s.id} style={{ flex:`0 0 ${anchoTexto}px`, background:s.color, padding:"4px 5px", borderRight:si<tiendasConTurnos.length-1?"1px solid rgba(0,0,0,0.15)":"none" }}>
                <div style={{ fontFamily:font.body, fontSize:12.5, fontWeight:700, color:txt, textAlign:"center", marginBottom:2, whiteSpace:"nowrap" }}>{s.name}</div>
                {lineas.map((linea,i)=>(
                  <div key={s.id+"_"+i} style={{ fontFamily:font.body, fontSize:11, color:txt, textAlign:"center", lineHeight:1.25, whiteSpace:"nowrap" }}>{linea}</div>
                ))}
              </div>
            );
          })}
        </div>
        {turnosGlobales.length>0 && (
          <div style={{ marginTop:10, fontFamily:font.body, fontSize:12, lineHeight:1.6 }}>
            <span style={{ color:C.text, fontWeight:700 }}>Especiales: </span>
            <span style={{ color:C.textMuted }}>{turnosGlobales.map(g=>g.nombre).join("  ·  ")}</span>
          </div>
        )}
      </Collapse>
    </Card>
  );
}

// ── Turnos: mini formulario para autorizar un horario especial de entrada/salida, un solo día ──
function ModalHorarioCustom({ info, turnosHorarios, onGuardar, onCerrar }) {
  const [entrada,setEntrada]=useState(info.asig?.entrada_custom||"");
  const [salida,setSalida]=useState(info.asig?.salida_custom||"");
  const [nota,setNota]=useState(info.asig?.nota_custom||"");
  const familia = familiaDeTurno(info.shiftLabel);
  const filaEstandar = filaHorarioVigente(familia, info.asig?.tienda_id, turnosHorarios, info.fecha);
  const dow = new Date(info.fecha+"T12:00:00").getDay();
  const esVS = dow===5||dow===6;
  const estandarTxt = filaEstandar ? `${fmtHora12(esVS?filaEstandar.entrada_vs:filaEstandar.entrada_lj)}–${fmtHora12(esVS?filaEstandar.salida_vs:filaEstandar.salida_lj)}` : "sin definir";
  const yaTieneCustom = !!(info.asig?.entrada_custom || info.asig?.salida_custom);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:16 }}>
      <Card glow style={{ maxWidth:360, width:"100%" }}>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color:C.goldLight, marginBottom:4 }}>Horario especial — solo este día</div>
        <div style={{ fontFamily:font.body, fontSize:11.5, color:C.textMuted, marginBottom:6 }}>{info.nombreAsesor} · {info.fecha}. Sigue siendo su turno de siempre ({info.shiftLabel}), solo cambia la hora ese día — para autorizaciones puntuales (ej. jornada reducida).</div>
        <div style={{ fontFamily:font.body, fontSize:11.5, color:C.text, marginBottom:14, background:C.surfaceAlt, borderRadius:7, padding:"7px 10px" }}>Horario normal de {info.shiftLabel}: <strong>{estandarTxt}</strong></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Field label="Entrada especial" type="time" value={entrada} onChange={setEntrada}/>
          <Field label="Salida especial" type="time" value={salida} onChange={setSalida}/>
        </div>
        <Field label="Nota (opcional)" value={nota} onChange={setNota} placeholder="Ej: autorizado 4 horas"/>
        <div style={{ display:"flex", gap:8, marginTop:4 }}>
          <Btn onClick={()=>onGuardar(entrada,salida,nota)} variant="success" sm full>Guardar</Btn>
          {yaTieneCustom && <Btn onClick={()=>onGuardar("","","")} variant="danger" sm full>Quitar</Btn>}
          <Btn onClick={onCerrar} variant="ghost" sm full>Cancelar</Btn>
        </div>
      </Card>
    </div>
  );
}

// ── Turnos: rejilla mensual (asesores en columnas, días en filas) ─────────────
function TurnosRejilla({ dias, advisors, asigMap, stores, turnosGlobales, turnosHorarios, editable, onCambiarCelda, onGuardarCustom, onMoverAsesor }) {
  // Lo más compacto posible en ancho y alto (pedido de Santiago) — Día angosto (solo cabe el
  // número + 2 letras del día), columnas de asesor más ceñidas al nombre, menos padding en filas.
  const colWidth = Math.max(52, ...advisors.map(a=>primerNombre(a.name).length*7.5+(editable?34:14)), 52);
  const diaColWidth = 46;
  const storeGroups = Object.values(stores).filter(s=>(s.shifts||[]).some(sh=>sh.activo!==false));
  const [modalInfo,setModalInfo]=useState(null);
  const flechaStyle = { background:"none", border:"none", cursor:"pointer", color:C.textMuted, fontSize:10, padding:"0 1px", lineHeight:1, flexShrink:0 };
  return (
    // text-align:center + la tabla en "inline-table" hace que se centre sola cuando es más
    // angosta que el contenedor (pocos asesores), y si es más ancha simplemente aparece el
    // scroll normal — a diferencia de centrar con flex, esto no corta el borde izquierdo.
    <div style={{ overflow:"auto", maxHeight:"78vh", border:`1px solid ${C.border}`, borderRadius:10, textAlign:"center" }}>
      {modalInfo && <ModalHorarioCustom info={modalInfo} turnosHorarios={turnosHorarios} onCerrar={()=>setModalInfo(null)} onGuardar={(entrada,salida,nota)=>{ onGuardarCustom(modalInfo.asesorId, modalInfo.fecha, entrada, salida, nota); setModalInfo(null); }}/>}
      <table style={{ borderCollapse:"separate", borderSpacing:0, display:"inline-table", width:diaColWidth+advisors.length*colWidth, textAlign:"left" }}>
        <thead>
          <tr>
            <th style={{ position:"sticky", left:0, top:0, zIndex:4, background:C.surfaceAlt, boxShadow:`0 1px 0 ${C.border}, 1px 0 0 ${C.border}`, padding:"6px 4px", width:diaColWidth, minWidth:diaColWidth, textAlign:"left", fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.03em" }}>Día</th>
            {advisors.map((a,i)=>(
              <th key={a.id} style={{ position:"sticky", top:0, zIndex:3, background:C.surfaceAlt, boxShadow:`0 1px 0 ${C.border}, -1px 0 0 ${C.border}`, padding:"6px 2px", width:colWidth, minWidth:colWidth, textAlign:"center", fontFamily:font.body, fontSize:11, fontWeight:700, color:C.text }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:1 }}>
                  {editable && <button onClick={()=>onMoverAsesor(a.id,-1)} disabled={i===0} title="Mover a la izquierda" style={{...flechaStyle, opacity:i===0?0.25:1, cursor:i===0?"default":"pointer"}}>◀</button>}
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{primerNombre(a.name)}</span>
                  {editable && <button onClick={()=>onMoverAsesor(a.id,1)} disabled={i===advisors.length-1} title="Mover a la derecha" style={{...flechaStyle, opacity:i===advisors.length-1?0.25:1, cursor:i===advisors.length-1?"default":"pointer"}}>▶</button>}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dias.map(fecha=>{ const dom=esDomingo(fecha); return (
            <tr key={fecha}>
              <td style={{ position:"sticky", left:0, zIndex:1, background:C.surface, boxShadow:`0 -1px 0 ${C.border}, 1px 0 0 ${C.border}`, padding:"3px 4px", width:diaColWidth, minWidth:diaColWidth, fontFamily:font.body, fontSize:10.5, whiteSpace:"nowrap" }}>
                <span title={nombreDia(fecha)} style={{ color:dom?C.green:C.textMuted, fontWeight:dom?700:400 }}>{nombreDiaCorto(fecha).slice(0,2)}</span>{" "}
                <span style={{ color:C.text }}>{Number(fecha.slice(8,10))}</span>
              </td>
              {advisors.map(a=>{
                const asig = asigMap.get(`${a.id}|${fecha}`);
                const turno = resolverTurno(asig, stores, turnosGlobales);
                return (
                  <td key={a.id} style={{ borderBottom:`1px solid ${C.border}`, borderLeft:`1px solid ${C.border}`, padding:2 }}>
                    {editable ? (
                      <div style={{ display:"flex", alignItems:"center", gap:2 }}>
                        <select value={valorCelda(asig)} onChange={e=>onCambiarCelda(a.id,fecha,e.target.value)} style={{ flex:1, minWidth:0, minHeight:24, borderRadius:6, boxSizing:"border-box", border:`1px solid ${turno?hexToRgba(oscurecerColor(turno.color,30),0.55):C.border}`, background:turno?`linear-gradient(135deg, ${turno.color}, ${oscurecerColor(turno.color,18)})`:C.surfaceAlt, color:turno?colorTextoContraste(turno.color):C.textMuted, fontFamily:font.body, fontSize:10.5, fontWeight:turno?700:400, padding:"2px 1px", cursor:"pointer", outline:"none", boxShadow:turno?"0 1px 3px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.22)":"none", textShadow:turno&&colorTextoContraste(turno.color)==="#fff"?"0 1px 2px rgba(0,0,0,0.3)":"none", transition:"transform .12s ease, box-shadow .12s ease" }}>
                          <option value="">—</option>
                          <optgroup label="Especiales">{turnosGlobales.map(g=><option key={g.id} value={`g:${g.id}`}>{g.nombre}</option>)}</optgroup>
                          {storeGroups.map(s=>(<optgroup key={s.id} label={s.name}>{s.shifts.filter(sh=>sh.activo!==false).map(sh=><option key={sh.id} value={`t:${s.id}|${encodeURIComponent(sh.nombre)}`}>{sh.nombre}</option>)}</optgroup>))}
                        </select>
                        {asig?.tienda_id && (
                          <button onClick={()=>setModalInfo({ asesorId:a.id, fecha, asig, nombreAsesor:a.name, shiftLabel:asig.shift||"" })} title={(asig.entrada_custom||asig.salida_custom)?`Horario especial: ${asig.entrada_custom||"?"}–${asig.salida_custom||"?"}`:"Autorizar horario especial este día"} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, flexShrink:0, opacity:(asig.entrada_custom||asig.salida_custom)?1:0.45 }}>⏰</button>
                        )}
                      </div>
                    ) : <TurnoBadgeCelda turno={turno}/>}
                  </td>
                );
              })}
            </tr>
          );})}
        </tbody>
      </table>
    </div>
  );
}

// ── Turnos: mini resumen ayer / hoy / mañana ───────────────────────────────────
function TurnosMiniResumen({ advisors, asigMap, stores, turnosGlobales }) {
  const filas = [{ label:"Ayer", fecha:addDiasFecha(todayStr,-1) },{ label:"Hoy", fecha:todayStr },{ label:"Mañana", fecha:addDiasFecha(todayStr,1) }];
  return (
    <Card glow style={{ marginBottom:16, overflowX:"auto" }}>
      <table style={{ borderCollapse:"collapse", width:"100%" }}>
        <thead><tr>
          <th style={{ textAlign:"left", padding:"4px 10px 8px 0", fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em" }}>Día</th>
          {advisors.map(a=><th key={a.id} style={{ padding:"4px 8px 8px", fontFamily:font.body, fontSize:11.5, fontWeight:700, color:C.text, textAlign:"center" }}>{primerNombre(a.name)}</th>)}
        </tr></thead>
        <tbody>
          {filas.map(f=>(
            <tr key={f.label}>
              <td style={{ padding:"4px 10px 4px 0", fontFamily:font.body, fontSize:12, fontWeight:600, color:f.fecha===todayStr?C.goldLight:C.text, whiteSpace:"nowrap" }}>{f.label}</td>
              {advisors.map(a=>{ const turno=resolverTurno(asigMap.get(`${a.id}|${f.fecha}`), stores, turnosGlobales); return (
                <td key={a.id} style={{ padding:4, minWidth:76 }}><TurnoBadgeCelda turno={turno} size="sm"/></td>
              );})}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function useMesSeleccionado() {
  const hoy = toColombiaDate();
  const [anio,setAnio]=useState(hoy.getFullYear()), [mes,setMes]=useState(hoy.getMonth());
  const prev=()=>{ if(mes===0){setMes(11);setAnio(a=>a-1);} else setMes(m=>m-1); };
  const next=()=>{ if(mes===11){setMes(0);setAnio(a=>a+1);} else setMes(m=>m+1); };
  return { anio, mes, prev, next };
}
function SelectorMes({ anio, mes, prev, next }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
      <Btn onClick={prev} variant="ghost" sm>← Anterior</Btn>
      <div style={{ fontFamily:font.body, fontSize:14, fontWeight:700, color:C.goldLight, minWidth:150, textAlign:"center" }}>{MESES_LARGO[mes]} {anio}</div>
      <Btn onClick={next} variant="ghost" sm>Siguiente →</Btn>
    </div>
  );
}

// ── Turnos: quién aparece como columna en la malla — activar/desactivar sin salir de Editar ──
// Diseñado como si hubiera cientos de personas: buscador + filtro por rol + tabla con scroll
// (encabezado fijo) en vez de una nube de cápsulas — eso último se vuelve ilegible apenas hay
// más de 10-15 personas, sin importar cómo se agrupe.
function GestionAsesoresActivosTurnos({ users, setUsers }) {
  const [abierto,setAbierto]=useState(false);
  const [busqueda,setBusqueda]=useState("");
  const [filtroRol,setFiltroRol]=useState("todos"); // todos | advisor | admin

  // Incluye asesores Y admin (master/admin/admin_finanzas/visualizador) — estos últimos con su
  // propio campo `activo_en_turnos` para no interferir con el `active` general que ya usan otras
  // pantallas (ej. Caja). Algunas personas tienen cuenta de asesor Y de admin a propósito (son
  // cuentas distintas, no se fusionan) — la columna "Rol" deja claro cuál es cuál.
  const personas=[...users].filter(u=>esUsuarioDeTurnos(u))
    .sort((a,b)=> (a.role==="advisor"?0:1)-(b.role==="advisor"?0:1) || ROLE_ORDEN_TURNOS.indexOf(a.role)-ROLE_ORDEN_TURNOS.indexOf(b.role) || a.name.localeCompare(b.name));
  const activos=personas.filter(a=>activoEnMallaTurnos(a)).length;

  const q = busqueda.trim().toLowerCase();
  const filtradas = personas
    .filter(u => filtroRol==="todos" || (filtroRol==="advisor" ? u.role==="advisor" : u.role!=="advisor"))
    .filter(u => !q || u.name.toLowerCase().includes(q));

  // Optimista: cambia el color al instante (no espera la respuesta del servidor) y solo
  // revierte si de verdad falla — así se siente inmediato en vez de esperar la red.
  const toggle=async(u)=>{
    const campo = u.role==="advisor" ? "active" : "activo_en_turnos";
    const valorActual = activoEnMallaTurnos(u);
    setUsers(prev=>prev.map(x=>x.id===u.id?{...x,[campo]:!valorActual}:x));
    const{data,error}=await supabase.from("usuarios").update({[campo]:!valorActual}).eq("id",u.id).select().single();
    if(data) setUsers(prev=>prev.map(x=>x.id===u.id?data:x));
    else if(error){ setUsers(prev=>prev.map(x=>x.id===u.id?{...x,[campo]:valorActual}:x)); alert(`No se pudo actualizar: ${error.message}`); }
  };

  const FILTROS_ROL = [{ id:"todos", label:"Todos" },{ id:"advisor", label:"Asesores" },{ id:"admin", label:"Administradores" }];

  return (
    <Card p="10px 14px" style={{ marginBottom:16 }}>
      <button onClick={()=>setAbierto(!abierto)} style={{ background:"none", border:"none", padding:0, cursor:"pointer", display:"flex", alignItems:"center", gap:8, width:"100%" }}>
        <span style={{ fontFamily:font.body, fontSize:12.5, fontWeight:600, color:C.text }}>👥 Personas activas en la malla ({activos}/{personas.length})</span>
        <span style={{ marginLeft:"auto", fontFamily:font.body, fontSize:11, color:C.goldLight }}>{abierto?"Ocultar ▲":"Gestionar ▾"}</span>
      </button>
      <Collapse open={abierto}>
        <div style={{ marginTop:12 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center", marginBottom:10 }}>
            <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar por nombre..." style={{ flex:1, minWidth:160, boxSizing:"border-box", padding:"8px 11px", borderRadius:7, border:`1px solid ${C.border}`, background:C.surfaceAlt, color:C.text, fontFamily:font.body, fontSize:12.5, outline:"none" }}/>
            <div style={{ display:"flex", gap:4 }}>
              {FILTROS_ROL.map(f=>(
                <button key={f.id} onClick={()=>setFiltroRol(f.id)} style={{ padding:"7px 11px", borderRadius:7, border:`1px solid ${filtroRol===f.id?C.gold:C.border}`, background:filtroRol===f.id?`${C.gold}18`:"transparent", color:filtroRol===f.id?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:11.5, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>{f.label}</button>
              ))}
            </div>
          </div>
          <div style={{ maxHeight:340, overflowY:"auto", border:`1px solid ${C.border}`, borderRadius:8 }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  <th style={{ position:"sticky", top:0, zIndex:1, textAlign:"left", padding:"7px 10px", background:C.surfaceAlt, fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em", boxShadow:`0 1px 0 ${C.border}` }}>Nombre</th>
                  <th style={{ position:"sticky", top:0, zIndex:1, textAlign:"left", padding:"7px 10px", background:C.surfaceAlt, fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em", boxShadow:`0 1px 0 ${C.border}` }}>Rol</th>
                  <th style={{ position:"sticky", top:0, zIndex:1, textAlign:"right", padding:"7px 10px", background:C.surfaceAlt, fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em", boxShadow:`0 1px 0 ${C.border}` }}>En malla</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((a,i)=>{
                  const act = activoEnMallaTurnos(a);
                  return (
                    <tr key={a.id} style={{ background: i%2===0 ? "transparent" : `${C.surfaceAlt}80` }}>
                      <td style={{ padding:"7px 10px", borderTop:`1px solid ${C.border}`, fontFamily:font.body, fontSize:12.5, color:C.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:180 }}>{a.name}</td>
                      <td style={{ padding:"7px 10px", borderTop:`1px solid ${C.border}`, fontFamily:font.body, fontSize:11.5, color:C.textMuted, whiteSpace:"nowrap" }}>{ROLE_LABEL[a.role]||a.role}</td>
                      <td style={{ padding:"7px 10px", borderTop:`1px solid ${C.border}`, textAlign:"right" }}>
                        <button onClick={()=>toggle(a)} title={act?"Desactivar":"Activar"} style={{ width:38, height:21, borderRadius:99, border:"none", background:act?C.green:C.border, position:"relative", cursor:"pointer", padding:0, transition:"background .15s ease" }}>
                          <span style={{ position:"absolute", top:2, left:act?18:2, width:17, height:17, borderRadius:99, background:"#fff", transition:"left .15s ease", boxShadow:"0 1px 2px rgba(0,0,0,0.3)" }}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filtradas.length===0 && <tr><td colSpan={3} style={{ padding:20, textAlign:"center", fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin resultados.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </Collapse>
    </Card>
  );
}

// ── SCREEN: Turnos · Ver (esta es la que ven también los asesores, como "Turnos") ──
function TurnosVerScreen({ users, stores, turnosGlobales, turnosHorarios, asignaciones }) {
  const { anio, mes, prev, next } = useMesSeleccionado();
  const advisors = advisorsOrdenTurnos(users);
  const dias = fechasDelMesTurnos(anio, mes);
  const asigMap = new Map(asignaciones.map(a=>[`${a.asesor_id}|${a.fecha}`,a]));
  return (
    <div>
      <PageHeader title="Rejilla del mes" subtitle="Solo consulta"/>
      <TurnosLeyenda stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios}/>
      <TurnosMiniResumen advisors={advisors} asigMap={asigMap} stores={stores} turnosGlobales={turnosGlobales}/>
      <SelectorMes anio={anio} mes={mes} prev={prev} next={next}/>
      {advisors.length===0 ? <div style={{fontFamily:font.body,fontSize:13,color:C.textMuted}}>No hay personas activas en la malla. Actívalas en Turnos ▸ Borrador ▸ "Personas activas en la malla".</div> :
        <TurnosRejilla dias={dias} advisors={advisors} asigMap={asigMap} stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios} editable={false}/>}
    </div>
  );
}

// ── SCREEN: Turnos · Borrador (antes "Editar") ─────────────────────────────────
function TurnosEditarScreen({ users, setUsers, stores, turnosGlobales, turnosHorarios, asignaciones, setAsignaciones }) {
  const { anio, mes, prev, next } = useMesSeleccionado();
  const advisors = advisorsOrdenTurnos(users);
  const dias = fechasDelMesTurnos(anio, mes);
  const asigMap = new Map(asignaciones.map(a=>[`${a.asesor_id}|${a.fecha}`,a]));
  // Mover una columna a la izq/der (dirección -1/1) — reindexa TODOS los visibles a un orden
  // secuencial (por si nunca se habían movido a mano) e intercambia los dos que cambian de lugar.
  // Optimista en pantalla; si falla el guardado en algún registro no revierte solo (poco probable
  // y de bajo impacto — el orden es solo visual, no afecta ningún cálculo).
  const moverAsesor = async (advisorId, direccion) => {
    const idx = advisors.findIndex(a=>a.id===advisorId);
    const idx2 = idx + direccion;
    if(idx<0 || idx2<0 || idx2>=advisors.length) return;
    const reindexado = advisors.map((a,i)=>({ id:a.id, orden_anterior:a.orden_turnos, orden_turnos:i }));
    const tmp = reindexado[idx].orden_turnos;
    reindexado[idx].orden_turnos = reindexado[idx2].orden_turnos;
    reindexado[idx2].orden_turnos = tmp;
    setUsers(prev=>prev.map(u=>{ const r = reindexado.find(x=>x.id===u.id); return r ? {...u, orden_turnos:r.orden_turnos} : u; }));
    for(const r of reindexado){
      if(r.orden_anterior===r.orden_turnos) continue;
      const { error } = await supabase.from("usuarios").update({ orden_turnos:r.orden_turnos }).eq("id", r.id);
      if(error){ alert(`No se pudo guardar el orden de alguien: ${error.message}`); }
    }
  };
  const onCambiarCelda = async (asesorId, fecha, valor) => {
    const existing = asigMap.get(`${asesorId}|${fecha}`);
    if(!valor){
      if(existing){ const{error}=await supabase.from("turnos_asignaciones").delete().eq("id",existing.id); if(error){ alert(`No se pudo borrar: ${error.message}`); return; } setAsignaciones(prev=>prev.filter(a=>a.id!==existing.id)); }
      return;
    }
    let payload;
    if(valor.startsWith("g:")) payload={ asesor_id:asesorId, fecha, turno_global_id:valor.slice(2), tienda_id:null, shift:null };
    else { const [sid,encShift]=valor.slice(2).split("|"); payload={ asesor_id:asesorId, fecha, tienda_id:sid, shift:decodeURIComponent(encShift||""), turno_global_id:null }; }
    if(existing){
      const{data,error}=await supabase.from("turnos_asignaciones").update(payload).eq("id",existing.id).select().single();
      if(!error&&data) setAsignaciones(prev=>prev.map(a=>a.id===data.id?data:a));
      else if(error) alert(`No se pudo guardar el turno: ${error.message}`);
    } else {
      const{data,error}=await supabase.from("turnos_asignaciones").insert(payload).select().single();
      if(!error&&data) setAsignaciones(prev=>[...prev,data]);
      else if(error) alert(`No se pudo guardar el turno: ${error.message}`);
    }
  };
  const onGuardarCustom = async (asesorId, fecha, entradaCustom, salidaCustom, notaCustom) => {
    const existing = asigMap.get(`${asesorId}|${fecha}`);
    if(!existing) return;
    const{data,error}=await supabase.from("turnos_asignaciones").update({ entrada_custom:entradaCustom||null, salida_custom:salidaCustom||null, nota_custom:notaCustom||null }).eq("id",existing.id).select().single();
    if(!error&&data) setAsignaciones(prev=>prev.map(a=>a.id===data.id?data:a));
    else if(error) alert(`No se pudo guardar: ${error.message}`);
  };
  return (
    <div>
      <PageHeader title="Borrador de turnos" subtitle="Los cambios se guardan al instante"/>
      <TurnosLeyenda stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios}/>
      <GestionAsesoresActivosTurnos users={users} setUsers={setUsers}/>
      <SelectorMes anio={anio} mes={mes} prev={prev} next={next}/>
      {advisors.length===0 ? <div style={{fontFamily:font.body,fontSize:13,color:C.textMuted}}>No hay personas activas en la malla. Actívalas arriba, en "Personas activas en la malla".</div> :
        <TurnosRejilla dias={dias} advisors={advisors} asigMap={asigMap} stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios} editable onCambiarCelda={onCambiarCelda} onGuardarCustom={onGuardarCustom} onMoverAsesor={moverAsesor}/>}
    </div>
  );
}

// ── SCREEN: Turnos (contenedor con sub-pestañas Ver / Editar / Administrar) ────
function TurnosScreen({ users, setUsers, stores, setStores, turnosGlobales, setTurnosGlobales, asignaciones, setAsignaciones, turnosHorarios, setTurnosHorarios, puedeGestionar, onSubChange }) {
  const [sub,setSub]=useState("ver");
  // Avisa hacia arriba en qué sub-pestaña está (App la usa para alargar el cierre de sesión por
  // inactividad mientras se edita el Borrador o Administrar, que puede tomar rato).
  useEffect(()=>{ onSubChange?.(sub); return ()=>onSubChange?.(null); },[sub]);
  // Borrador y Administrar son solo para quien puede GESTIONAR turnos (master/admin_finanzas) —
  // "admin" y "visualizador" solo ven la rejilla, igual que "admin" en Ventas.
  const subTabs=[
    { id:"ver", label:"📅 Turnos" },
    ...(puedeGestionar?[{ id:"editar", label:"📝 Borrador" }]:[]),
    ...(puedeGestionar?[{ id:"administrar", label:"⚙️ Administrar" }]:[]),
  ];
  useEffect(()=>{ if(!subTabs.some(t=>t.id===sub)) setSub("ver"); },[puedeGestionar]);
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {subTabs.map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)} style={{ padding:"7px 16px", borderRadius:99, border:`1px solid ${sub===t.id?C.gold:C.border}`, background:sub===t.id?`${C.gold}18`:"transparent", color:sub===t.id?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12.5, fontWeight:600, cursor:"pointer" }}>{t.label}</button>
        ))}
      </div>
      <div key={sub} className="ozen-pane-anim-tab">
        {sub==="ver"         && <TurnosVerScreen users={users} stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios} asignaciones={asignaciones}/>}
        {sub==="editar"      && puedeGestionar && <TurnosEditarScreen users={users} setUsers={setUsers} stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios} asignaciones={asignaciones} setAsignaciones={setAsignaciones}/>}
        {sub==="administrar" && puedeGestionar && <TurnosAdminScreen users={users} setUsers={setUsers} stores={stores} setStores={setStores} turnosGlobales={turnosGlobales} setTurnosGlobales={setTurnosGlobales} turnosHorarios={turnosHorarios} setTurnosHorarios={setTurnosHorarios}/>}
      </div>
    </div>
  );
}

// ── SCREEN: Mi Asistencia (para cuentas de líder/admin) — agrupa Marcar + Mi Historial ──
function MiAsistenciaScreen({ user, records, onRecord, onRefresh, stores, asignaciones, turnosHorarios, turnosAsignaciones }) {
  const [sub,setSub]=useState("marcar");
  const subTabs=[{ id:"marcar", label:"📍 Marcar" },{ id:"historial", label:"📋 Mi Historial" }];
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {subTabs.map(t=>(
          <button key={t.id} onClick={()=>setSub(t.id)} style={{ padding:"7px 16px", borderRadius:99, border:`1px solid ${sub===t.id?C.gold:C.border}`, background:sub===t.id?`${C.gold}18`:"transparent", color:sub===t.id?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12.5, fontWeight:600, cursor:"pointer" }}>{t.label}</button>
        ))}
      </div>
      <div key={sub} className="ozen-pane-anim-tab">
        {sub==="marcar"    && <CheckInScreen user={user} records={records} onRecord={onRecord} onRefresh={onRefresh} stores={stores} asignaciones={asignaciones} turnosHorarios={turnosHorarios}/>}
        {sub==="historial" && <HistoryScreen user={user} records={records} stores={stores} turnosHorarios={turnosHorarios} turnosAsignaciones={turnosAsignaciones}/>}
      </div>
    </div>
  );
}

// ── SCREEN: CheckIn ───────────────────────────────────────────────────────────
function CheckInScreen({ user, records, onRecord, onRefresh, stores, asignaciones, turnosHorarios }) {
  const [selStore,setSelStore]=useState(""),[selShift,setSelShift]=useState(""),[locked,setLocked]=useState(false),[showCamera,setShowCamera]=useState(false),[recording,setRecording]=useState(false),[toast,setToast]=useState(null);
  useEffect(()=>{ const h=records.filter(r=>r.user_id===user.id&&r.date===todayStr&&r.event!=="omitido"); if(h.length>0){setSelStore(h[0].store);setSelShift(h[0].shift);setLocked(true);} },[records]);
  // Si hoy ya tiene un turno asignado en la rejilla de Turnos (incluye apoyo en pareja — ambos
  // quedan con el mismo tienda+turno ese día), se precarga y queda fijo — ya no lo elige a mano.
  // Solo puede elegir libremente si ese día no tiene ninguna asignación en la rejilla.
  const asigHoy = (asignaciones||[]).find(a=>a.asesor_id===user.id && a.fecha===todayStr && a.tienda_id);
  useEffect(()=>{ if(locked||selStore) return; if(asigHoy){ setSelStore(asigHoy.tienda_id); setSelShift(asigHoy.shift||""); } },[asigHoy, locked, selStore]);
  const todayRecs=records.filter(r=>r.user_id===user.id&&r.date===todayStr);
  const eventosReales=todayRecs.filter(r=>r.event!=="omitido").map(r=>r.event);
  const ultimoReal=[...ORDEN].reverse().find(e=>eventosReales.includes(e));
  const nextEvent=!ultimoReal?"entrada":ultimoReal==="entrada"?"inicio_almuerzo":ultimoReal==="inicio_almuerzo"?"fin_almuerzo":ultimoReal==="fin_almuerzo"?"salida":null;
  const refreshTodayRecs=async()=>{ const{data}=await supabase.from("registros").select("*").eq("user_id",user.id).eq("date",todayStr); if(data)onRefresh(data); };
  const handleCapture=async(photoBase64)=>{ setShowCamera(false);setRecording(true); let photo_url=null; try{ const blob=await fetch(photoBase64).then(r=>r.blob()); const fileName=`${user.id}_${Date.now()}.jpg`; const{data:up}=await supabase.storage.from("fotos-registro").upload(fileName,blob,{contentType:"image/jpeg"}); if(up){const{data:ud}=supabase.storage.from("fotos-registro").getPublicUrl(fileName);photo_url=ud.publicUrl;} }catch(e){console.error(e);} const{data,error}=await supabase.from("registros").insert({user_id:user.id,user_name:user.name,store:selStore,shift:selShift,event:nextEvent,date:todayStr,time:fmtTime(new Date()),photo_url}).select().single();
    if(!error){
      onRecord(data);setLocked(true);await refreshTodayRecs();
      // Avisa a los admins de Turnos (push real, aunque tengan la app cerrada) en CADA marcación
      // — así ven en tiempo real en qué está su equipo (entrada, almuerzo, salida), no solo
      // cuándo llegan. Si falla el envío (sin suscriptores, Edge Function no desplegada, etc.) no
      // debe frenar el registro.
      supabase.functions.invoke("notificar-entrada", { body:{
        title:`${EVENT_LABELS[nextEvent]} marcada`,
        body:`${user.name} marcó ${EVENT_LABELS[nextEvent].toLowerCase()} en ${stores[selStore]?.name||selStore}${selShift?` · ${selShift}`:""} · ${fmtTime(new Date())}`,
        url:"/",
      }}).catch(()=>{});
      if(nextEvent==="entrada"){
        sonidoEntrada();
      } else if(nextEvent==="salida"){
        sonidoSalida();
      }
    } else { sonidoError(); }
    setRecording(false);setToast(`✓ ${EVENT_LABELS[nextEvent]} registrada`);setTimeout(()=>setToast(null),3000); };

  const puntHoy = calcPuntualidad(todayRecs.find(r=>r.event==="entrada")?.time, selShift, todayStr, selStore, turnosHorarios, asigHoy?.entrada_custom);
  const rangoHoy = getExpectedRange(selShift, todayStr, selStore, turnosHorarios, asigHoy?.entrada_custom, asigHoy?.salida_custom);

  return (
    <div>
      {showCamera&&<CameraModal eventLabel={EVENT_LABELS[nextEvent]} onCapture={handleCapture} onCancel={()=>setShowCamera(false)}/>}
      {toast&&<div style={{position:"fixed",top:16,right:16,left:16,background:C.greenDim,border:`1px solid ${C.green}`,borderRadius:10,padding:"12px 16px",color:C.green,fontFamily:font.body,fontSize:13,fontWeight:600,zIndex:200,textAlign:"center"}}>{toast}</div>}
      <PageHeader title="Marcar Asistencia" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})} />
      <Card style={{marginBottom:12}}>
        <Field label="Tienda" value={selStore} onChange={v=>{setSelStore(v);setSelShift("");}} disabled={locked||!!asigHoy} options={[{value:"",label:"Selecciona tienda"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]}/>
        {selStore&&stores[selStore]?.shifts?.some(s=>s.activo!==false)&&<Field label="Turno" value={selShift} onChange={setSelShift} disabled={locked||!!asigHoy} options={[{value:"",label:"Selecciona turno"},...(stores[selStore]?.shifts||[]).filter(s=>s.activo!==false).map(s=>({value:s.nombre,label:s.nombre===selShift&&rangoHoy?`${s.nombre} - ${rangoHoy}`:s.nombre}))]}/>}
      </Card>

      {nextEvent ? (
        <Card style={{marginBottom:12}}>
          <div style={{fontFamily:font.body,fontSize:12,color:C.textMuted,marginBottom:4}}>Próximo evento</div>
          <div style={{fontFamily:font.body,fontSize:18,fontWeight:700,color:EVENT_COLORS[nextEvent],marginBottom:14}}>{EVENT_LABELS[nextEvent]}</div>
          <div style={{background:`${C.gold}10`,border:`1px solid ${C.borderGold}`,borderRadius:8,padding:"10px 12px",marginBottom:14,fontFamily:font.body,fontSize:12,color:C.textSub}}>📸 Se abrirá la cámara y se tomará una foto. Asegúrate de que tu rostro sea visible.</div>
          <Btn onClick={()=>setShowCamera(true)} disabled={!selStore||!selShift||recording} full>{recording?"Registrando...":"📸 Abrir cámara y registrar"}</Btn>
        </Card>
      ):(
        <Card style={{marginBottom:12}}><div style={{textAlign:"center",padding:"16px 0"}}><div style={{fontSize:36,marginBottom:8}}>✅</div><div style={{fontFamily:font.body,fontSize:15,fontWeight:600,color:C.text}}>Jornada completa</div><div style={{fontFamily:font.body,fontSize:12,color:C.textMuted,marginTop:4}}>Todos los eventos del día registrados.</div></div></Card>
      )}

      <Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontFamily:font.body,fontSize:12,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Registro de hoy</div>
          {puntHoy && (puntHoy.puntual ? <Badge color={C.green} sm>🟢 Puntual hoy</Badge> : <Badge color={C.red} sm title={rangoHoy?`Debía entrar ${rangoHoy.split("–")[0]}`:undefined}>🔴 Tarde {puntHoy.diff} min hoy</Badge>)}
        </div>
        {ORDEN.map((ev,i)=>{ const rec=todayRecs.find(r=>r.event===ev); const isNext=ev===nextEvent; return (
          <div key={ev} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<3?`1px solid ${C.border}`:"none"}}>
            <div style={{width:12,height:12,borderRadius:99,background:rec?EVENT_COLORS[ev]:C.border,boxShadow:rec?`0 0 8px ${EVENT_COLORS[ev]}`:"none",flexShrink:0}}/>
            <div style={{flex:1,fontFamily:font.body,fontSize:13,color:rec?C.text:C.textMuted}}>{EVENT_LABELS[ev]}</div>
            {isNext&&!rec&&<Badge color={C.blue} sm>Pendiente</Badge>}
            {rec?.photo_url&&<img src={rec.photo_url} alt="foto" style={{width:28,height:28,borderRadius:6,objectFit:"cover"}}/>}
            <div style={{fontFamily:font.mono,fontSize:13,color:rec?EVENT_COLORS[ev]:C.border,fontWeight:700}}>{rec?rec.time:"--:--"}</div>
          </div>
        );})}
      </Card>
    </div>
  );
}

// ── SCREEN: History ───────────────────────────────────────────────────────────
function HistoryScreen({ user, records, stores, turnosHorarios, turnosAsignaciones }) {
  const [viewPhoto,setViewPhoto]=useState(null);
  const myRecs=records.filter(r=>r.user_id===user.id);
  const jornadasMap = {};
  myRecs.forEach(r=>{
    const key=`${r.user_id}_${r.date}`;
    if(!jornadasMap[key]) jornadasMap[key]={ key, userId:r.user_id, userName:r.user_name, store:r.store, shift:r.shift, date:r.date, entrada:null, inicio_almuerzo:null, fin_almuerzo:null, salida:null };
    if(r.event!=="omitido") jornadasMap[key][r.event]=r;
    else jornadasMap[key][r.time+"_omitido"]=true;
  });
  const jornadas = Object.values(jornadasMap).sort((a,b)=>b.date.localeCompare(a.date));

  const EventBlock = ({ label, registro, omitido, color }) => {
    const isOmitido = !registro && omitido;
    return (
      <div style={{ flex:1, minWidth:0, borderRadius:8, padding:"8px 4px", background:isOmitido?`${C.red}18`:C.surfaceAlt, border:`1px solid ${isOmitido?C.red+"44":C.border}`, display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
        <div style={{ fontFamily:font.body, fontSize:9, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em", textAlign:"center", lineHeight:1.2 }}>{label}</div>
        <div style={{ fontFamily:font.mono, fontSize:12, color:isOmitido?C.red:registro?color:C.border, fontWeight:700 }}>{registro?registro.time:isOmitido?"N/R":"—"}</div>
        <div style={{ width:36, height:36, borderRadius:6, overflow:"hidden", border:`1px solid ${C.border}`, background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          {registro?.photo_url
            ? <img src={registro.photo_url} onClick={()=>setViewPhoto(registro.photo_url)} alt="foto" style={{ width:"100%", height:"100%", objectFit:"cover", cursor:"pointer", display:"block" }} />
            : <span style={{ fontSize:12, opacity:0.25 }}>📷</span>
          }
        </div>
      </div>
    );
  };

  return (
    <div>
      {viewPhoto&&<div onClick={()=>setViewPhoto(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,cursor:"pointer",padding:16}}><img src={viewPhoto} alt="Foto" style={{maxWidth:"100%",maxHeight:"90vh",borderRadius:10}}/></div>}
      <PageHeader title="Mi Historial" subtitle="Mis registros de asistencia"/>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {jornadas.map(j => {
          const asigDia = (turnosAsignaciones||[]).find(a=>a.asesor_id===j.userId&&a.fecha===j.date);
          // Igual que en Registros: si hay turno oficial asignado, manda sobre lo autorreportado.
          const shiftReal = asigDia?.tienda_id ? (asigDia.shift||j.shift) : j.shift;
          const storeReal = asigDia?.tienda_id || j.store;
          const punt = calcPuntualidad(j.entrada?.time, shiftReal, j.date, storeReal, turnosHorarios, asigDia?.entrada_custom);
          const rango = getExpectedRange(shiftReal, j.date, storeReal, turnosHorarios, asigDia?.entrada_custom, asigDia?.salida_custom);
          return (
          <Card key={j.key} p="14px">
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{new Date(j.date+"T12:00:00").toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})}</div>
                {punt && (punt.puntual ? <Badge color={C.green} sm>🟢 Puntual</Badge> : <Badge color={C.red} sm>🔴 Tarde {punt.diff} min</Badge>)}
              </div>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{stores[j.store]?.name} · {j.shift}{rango?` - ${rango}`:""}</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <EventBlock label="Entrada"       registro={j.entrada}        omitido={j["entrada_omitido"]}        color={C.green} />
              <EventBlock label="Ini. Almuerzo" registro={j.inicio_almuerzo} omitido={j["inicio_almuerzo_omitido"]} color={C.amber} />
              <EventBlock label="Fin Almuerzo"  registro={j.fin_almuerzo}   omitido={j["fin_almuerzo_omitido"]}   color={C.blue}  />
              <EventBlock label="Salida"        registro={j.salida}         omitido={j["salida_omitido"]}         color={C.red}   />
            </div>
          </Card>
        );})}
        {jornadas.length===0&&<div style={{textAlign:"center",padding:60,color:C.textMuted,fontFamily:font.body}}>Sin registros aún.</div>}
      </div>
    </div>
  );
}

// ── SCREEN: Reports ───────────────────────────────────────────────────────────
function ReportsScreen({ records, users, stores, isMobile }) {
  const now = toColombiaDate();
  const [mes, setMes]   = useState(now.getMonth());
  const [anio, setAnio] = useState(now.getFullYear());
  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const prefix = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const recsMes = records.filter(r=>r.date.startsWith(prefix));
  const advisors = users.filter(u=>u.role==="advisor"&&u.active);

  const toHM = (min) => min<=0?"—":`${Math.floor(min/60)}h ${String(min%60).padStart(2,"0")}m`;

  const calcHorasAsesor = (userId) => {
    const dias=[...new Set(recsMes.filter(r=>r.user_id===userId&&r.event==="entrada").map(r=>r.date))];
    let brutas=0,almuerzo=0;
    dias.forEach(d=>{
      const rDia=recsMes.filter(r=>r.user_id===userId&&r.date===d);
      const entrada=rDia.find(r=>r.event==="entrada")?.time, salida=rDia.find(r=>r.event==="salida")?.time;
      const iniA=rDia.find(r=>r.event==="inicio_almuerzo")?.time, finA=rDia.find(r=>r.event==="fin_almuerzo")?.time;
      if(entrada&&salida){ const[eh,em]=entrada.split(":").map(Number),[sh,sm]=salida.split(":").map(Number); brutas+=(sh*60+sm)-(eh*60+em); }
      if(iniA&&finA){ const[ih,im]=iniA.split(":").map(Number),[fh,fm]=finA.split(":").map(Number); almuerzo+=(fh*60+fm)-(ih*60+im); }
    });
    return { brutas:toHM(brutas), almuerzo:toHM(almuerzo), netas:toHM(brutas-almuerzo) };
  };

  const porAsesor = advisors.map(u=>{
    const recs=recsMes.filter(r=>r.user_id===u.id);
    const dias=new Set(recs.filter(r=>r.event==="entrada").map(r=>r.date));
    const completas=[...dias].filter(d=>{ const ev=recs.filter(r=>r.date===d&&r.event!=="omitido").map(r=>r.event); return ORDEN.every(e=>ev.includes(e)); });
    const incompletas=[...dias].filter(d=>recs.some(r=>r.date===d&&r.event==="omitido"));
    const entradas=recs.filter(r=>r.event==="entrada").sort((a,b)=>b.date.localeCompare(a.date));
    const horas=calcHorasAsesor(u.id);
    return { id:u.id, nombre:u.name, dias:dias.size, completas:completas.length, incompletas:incompletas.length, ultimoDia:entradas[0]?.date||null, ...horas };
  }).sort((a,b)=>b.dias-a.dias);

  let totalNetasMin=0,totalAlmuerzoMin=0,jornadasConHoras=0,jornadasConAlmuerzo=0,totalDias=0;
  porAsesor.forEach(a=>{
    totalDias+=a.dias;
    const dias=[...new Set(recsMes.filter(r=>r.user_id===a.id&&r.event==="entrada").map(r=>r.date))];
    dias.forEach(d=>{
      const rDia=recsMes.filter(r=>r.user_id===a.id&&r.date===d);
      const entrada=rDia.find(r=>r.event==="entrada")?.time,salida=rDia.find(r=>r.event==="salida")?.time;
      const iniA=rDia.find(r=>r.event==="inicio_almuerzo")?.time,finA=rDia.find(r=>r.event==="fin_almuerzo")?.time;
      let b=0,al=0;
      if(entrada&&salida){ const[eh,em]=entrada.split(":").map(Number),[sh,sm]=salida.split(":").map(Number); b=(sh*60+sm)-(eh*60+em); }
      if(iniA&&finA){ const[ih,im]=iniA.split(":").map(Number),[fh,fm]=finA.split(":").map(Number); al=(fh*60+fm)-(ih*60+im); totalAlmuerzoMin+=al; jornadasConAlmuerzo++; }
      if(b>0){ totalNetasMin+=b-al; jornadasConHoras++; }
    });
  });
  const promNetasHM    = toHM(jornadasConHoras>0?Math.round(totalNetasMin/jornadasConHoras):0);
  const promAlmuerzoHM = toHM(jornadasConAlmuerzo>0?Math.round(totalAlmuerzoMin/jornadasConAlmuerzo):0);

  const jornadasIncompletas=[];
  recsMes.filter(r=>r.event==="omitido").forEach(r=>{ if(!jornadasIncompletas.find(j=>j.userId===r.user_id&&j.date===r.date&&j.evento===r.time)) jornadasIncompletas.push({userId:r.user_id,nombre:r.user_name,date:r.date,evento:r.time,tienda:stores[r.store]?.name}); });
  jornadasIncompletas.sort((a,b)=>b.date.localeCompare(a.date));

  const exportCSV = () => {
    const BOM = "\uFEFF";
    const sep = ";";
    const rows = [];
    rows.push([`INFORME DE ASISTENCIA - ${meses[mes].toUpperCase()} ${anio}`]);
    rows.push([]);
    rows.push(["RESUMEN GENERAL"]);
    rows.push(["Días trabajados total", totalDias]);
    rows.push(["Promedio horas netas por jornada", promNetasHM]);
    rows.push(["Promedio tiempo de almuerzo", promAlmuerzoHM]);
    rows.push([]);
    rows.push(["DETALLE POR ASESOR"]);
    rows.push(["Asesor","Días trabajados","Jornadas completas","Jornadas incompletas","Horas brutas","Horas almuerzo","Horas netas","Último día"]);
    porAsesor.forEach(a=>rows.push([a.nombre,a.dias,a.completas,a.incompletas,a.brutas,a.almuerzo,a.netas,a.ultimoDia||"—"]));
    rows.push([]);
    rows.push(["JORNADAS INCOMPLETAS"]);
    rows.push(["Asesor","Tienda","Fecha","Evento no registrado"]);
    jornadasIncompletas.forEach(j=>rows.push([j.nombre,j.tienda||"—",j.date,EVENT_LABELS[j.evento]||j.evento]));
    const csv = BOM + rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(sep)).join("\n");
    const blob = new Blob([csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`informe-${prefix}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const thStyle={padding:"10px 14px",textAlign:"left",fontFamily:font.body,fontSize:11,color:C.textMuted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em",borderBottom:`1px solid ${C.border}`};
  const tdStyle={padding:"11px 14px",fontFamily:font.body,fontSize:13,borderBottom:`1px solid ${C.border}`};

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,gap:10,flexWrap:"wrap"}}>
        <div><h1 style={{margin:0,fontFamily:font.body,fontSize:20,fontWeight:700,color:C.text}}>Informes</h1><div style={{fontFamily:font.body,fontSize:12,color:C.textMuted,marginTop:3}}>Análisis de asistencia del equipo</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={mes} onChange={e=>setMes(Number(e.target.value))} style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 12px",color:C.text,fontSize:13,fontFamily:font.body,outline:"none"}}>
            {meses.map((m,i)=><option key={i} value={i}>{m}</option>)}
          </select>
          <select value={anio} onChange={e=>setAnio(Number(e.target.value))} style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 12px",color:C.text,fontSize:13,fontFamily:font.body,outline:"none"}}>
            {[2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <Btn onClick={exportCSV} variant="ghost" sm>⬇ Exportar Excel</Btn>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr",gap:10,marginBottom:20}}>
        <StatCard label="Promedio horas netas por jornada" value={promNetasHM}    icon="⏱" color={C.green}/>
        <StatCard label="Promedio tiempo de almuerzo"      value={promAlmuerzoHM} icon="🍽" color={C.amber}/>
      </div>

      <Card p="0" style={{marginBottom:16}}>
        <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,fontFamily:font.body,fontSize:13,fontWeight:600,color:C.text}}>Resumen por asesor — {meses[mes]} {anio}</div>
        {isMobile?(
          <div>
            {porAsesor.map((a,i)=>(
              <div key={a.id} style={{padding:"12px 16px",borderBottom:i<porAsesor.length-1?`1px solid ${C.border}`:"none"}}>
                <div style={{fontFamily:font.body,fontSize:13,color:C.text,fontWeight:600,marginBottom:6}}>{a.nombre}</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:4}}>
                  <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>Días: <span style={{color:C.text,fontFamily:font.mono}}>{a.dias}</span></div>
                  <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>Completas: <Badge color={a.completas>0?C.green:C.textMuted} sm>{a.completas}</Badge></div>
                  <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>Incompletas: <Badge color={a.incompletas>0?C.red:C.textMuted} sm>{a.incompletas}</Badge></div>
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>Horas netas: <span style={{color:C.green,fontFamily:font.mono,fontWeight:600}}>{a.netas}</span></div>
                  <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>Almuerzo: <span style={{color:C.amber,fontFamily:font.mono}}>{a.almuerzo}</span></div>
                </div>
                {a.ultimoDia&&<div style={{fontFamily:font.mono,fontSize:11,color:C.textMuted,marginTop:4}}>Último día: {a.ultimoDia}</div>}
              </div>
            ))}
            {porAsesor.length===0&&<div style={{padding:20,textAlign:"center",color:C.textMuted,fontFamily:font.body,fontSize:13}}>Sin registros para este mes.</div>}
          </div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Asesor","Días","Completas","Incompletas","Horas brutas","Almuerzo","Horas netas","Último día"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
            <tbody>
              {porAsesor.map((a,i)=>(
                <tr key={a.id} style={{background:i%2===0?"transparent":`${C.surfaceAlt}44`}}>
                  <td style={{...tdStyle,color:C.text,fontWeight:500}}>{a.nombre}</td>
                  <td style={{...tdStyle,color:C.text,fontFamily:font.mono}}>{a.dias}</td>
                  <td style={tdStyle}><Badge color={a.completas>0?C.green:C.textMuted} sm>{a.completas}</Badge></td>
                  <td style={tdStyle}><Badge color={a.incompletas>0?C.red:C.textMuted} sm>{a.incompletas}</Badge></td>
                  <td style={{...tdStyle,fontFamily:font.mono,fontSize:12,color:C.textMuted}}>{a.brutas}</td>
                  <td style={{...tdStyle,fontFamily:font.mono,fontSize:12,color:C.amber}}>{a.almuerzo}</td>
                  <td style={{...tdStyle,fontFamily:font.mono,fontSize:13,color:C.green,fontWeight:600}}>{a.netas}</td>
                  <td style={{...tdStyle,color:C.textMuted,fontFamily:font.mono,fontSize:12}}>{a.ultimoDia||"—"}</td>
                </tr>
              ))}
              {porAsesor.length===0&&<tr><td colSpan={8} style={{...tdStyle,textAlign:"center",color:C.textMuted}}>Sin registros para este mes.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Card p="0">
        <div style={{padding:"14px 16px",borderBottom:`1px solid ${C.border}`,fontFamily:font.body,fontSize:13,fontWeight:600,color:C.text}}>Detalle jornadas incompletas</div>
        <div style={{maxHeight:300,overflowY:"auto"}}>
          {jornadasIncompletas.length===0&&<div style={{padding:"20px",textAlign:"center",color:C.textMuted,fontFamily:font.body,fontSize:12}}>Sin jornadas incompletas este mes. ✅</div>}
          {jornadasIncompletas.map((j,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:`${C.red}06`}}>
              <div style={{flex:1}}><div style={{fontFamily:font.body,fontSize:12,color:C.text,fontWeight:500}}>{j.nombre}</div><div style={{fontFamily:font.body,fontSize:11,color:C.textMuted}}>{j.tienda} · {j.date}</div></div>
              <Badge color={C.red} sm>{EVENT_LABELS[j.evento]||j.evento}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── SCREEN: Junta Admin — Equipo y perfiles ──────────────────────────────────
function JuntaEquipoTab({ lideres, setLideres, areas, setAreas, liderAreas, setLiderAreas, isMobile }) {
  const [vista, setVista] = useState("lideres");
  return (
    <div>
      <PageHeader title="Perfiles y áreas" subtitle="Los liderazgos que componen la Junta Admin y las áreas de trabajo que cubren" />
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        <Btn onClick={()=>setVista("lideres")} variant={vista==="lideres"?"primary":"ghost"} sm>👤 Por líder</Btn>
        <Btn onClick={()=>setVista("areas")} variant={vista==="areas"?"primary":"ghost"} sm>🗂️ Por área</Btn>
      </div>
      <div key={vista} className="ozen-pane-anim-tab">
        {vista==="lideres"
          ? <JuntaVistaPorLider lideres={lideres} setLideres={setLideres} areas={areas} setAreas={setAreas} liderAreas={liderAreas} setLiderAreas={setLiderAreas} isMobile={isMobile}/>
          : <JuntaVistaPorArea areas={areas} setAreas={setAreas} lideres={lideres} liderAreas={liderAreas}/>}
      </div>
    </div>
  );
}

function JuntaVistaPorLider({ lideres, setLideres, areas, setAreas, liderAreas, setLiderAreas, isMobile }) {
  const soloLectura = useReadOnly();
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState({ nombre:"", objetivo:"" });
  const [editAreas, setEditAreas] = useState({}); // { [areaId]: texto de procesos macro }
  const [nuevaAreaTexto, setNuevaAreaTexto] = useState("");

  const ordenados = [...lideres].sort((a,b)=>(a.orden??999)-(b.orden??999));

  const agregar = async () => {
    const siguienteOrden = lideres.length ? Math.max(...lideres.map(l=>l.orden??0)) + 1 : 1;
    const { data, error } = await supabase.from("junta_lideres").insert({ orden:siguienteOrden, nombre:"", objetivo:"" }).select().single();
    if (!error && data) setLideres(prev=>[...prev, data]);
  };
  const quitar = async (id) => {
    if (!window.confirm("¿Quitar este liderazgo de la Junta? Esto no se puede deshacer.")) return;
    await supabase.from("junta_lideres").delete().eq("id", id);
    setLideres(prev=>prev.filter(l=>l.id!==id));
    setLiderAreas(prev=>prev.filter(la=>la.lider_id!==id));
  };
  const mover = async (id, direccion) => {
    const idx = ordenados.findIndex(l=>l.id===id);
    const otroIdx = idx + direccion;
    if (otroIdx<0 || otroIdx>=ordenados.length) return;
    const a = ordenados[idx], b = ordenados[otroIdx];
    const [{data:da},{data:db}] = await Promise.all([
      supabase.from("junta_lideres").update({ orden:b.orden }).eq("id", a.id).select().single(),
      supabase.from("junta_lideres").update({ orden:a.orden }).eq("id", b.id).select().single(),
    ]);
    if (da && db) setLideres(prev=>prev.map(l=> l.id===da.id?da : l.id===db.id?db : l));
  };

  const abrirEdicion = (l) => {
    setEditingId(l.id);
    setEditVal({ nombre:l.nombre||"", objetivo:l.objetivo||"" });
    const asociadas = {};
    liderAreas.filter(la=>la.lider_id===l.id).forEach(la=>{ asociadas[la.area_id] = la.procesos_macro||""; });
    setEditAreas(asociadas);
  };
  const toggleArea = (areaId) => {
    setEditAreas(prev => {
      const next = { ...prev };
      if (areaId in next) delete next[areaId]; else next[areaId] = "";
      return next;
    });
  };
  const agregarAreaNueva = async () => {
    const nombre = nuevaAreaTexto.trim();
    if (!nombre) return;
    const { data, error } = await supabase.from("junta_areas").insert({ nombre }).select().single();
    if (!error && data) { setAreas(prev=>[...prev, data]); setEditAreas(prev=>({ ...prev, [data.id]:"" })); setNuevaAreaTexto(""); }
  };

  const guardar = async (id) => {
    const { data: liderData, error: liderErr } = await supabase.from("junta_lideres").update({ nombre:editVal.nombre.trim(), objetivo:editVal.objetivo.trim(), updated_at:new Date().toISOString() }).eq("id", id).select().single();
    if (liderErr || !liderData) return;

    const existentes = liderAreas.filter(la=>la.lider_id===id);
    const idsNuevos = Object.keys(editAreas);
    const aBorrar = existentes.filter(la=>!idsNuevos.includes(la.area_id));
    const filas = idsNuevos.map(areaId=>({ lider_id:id, area_id:areaId, procesos_macro:(editAreas[areaId]||"").trim(), updated_at:new Date().toISOString() }));

    if (aBorrar.length) await supabase.from("junta_lider_areas").delete().in("id", aBorrar.map(a=>a.id));
    let nuevasFilas = [];
    if (filas.length) {
      const { data } = await supabase.from("junta_lider_areas").upsert(filas, { onConflict:"lider_id,area_id" }).select();
      nuevasFilas = data || [];
    }

    setLideres(prev=>prev.map(l=>l.id===id?liderData:l));
    setLiderAreas(prev=>[...prev.filter(la=>la.lider_id!==id), ...nuevasFilas]);
    setEditingId(null);
  };

  return (
    <div>
      {!soloLectura && <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:14 }}>
        <Btn onClick={agregar} sm>+ Agregar líder</Btn>
      </div>}
      {ordenados.map((l,i)=>{
        const misAreas = liderAreas.filter(la=>la.lider_id===l.id).map(la=>({ ...la, areaNombre: areas.find(a=>a.id===la.area_id)?.nombre || "— área eliminada" }));
        return (
        <Card key={l.id} style={{ marginBottom:14 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
            <div style={{ width:42, height:42, borderRadius:10, background:C.surfaceAlt, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, fontSize:16, fontWeight:700, color:C.textSub, flexShrink:0 }}>
              {l.nombre ? l.nombre[0].toUpperCase() : "?"}
            </div>
            <div style={{ flex:1, minWidth:140 }}>
              <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.text }}>{l.nombre || "— sin nombre asignado"}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:2 }}>Líder {i+1} en la rotación</div>
            </div>
            {!soloLectura && <div style={{ display:"flex", gap:6, flexShrink:0 }}>
              <Btn onClick={()=>mover(l.id,-1)} disabled={i===0} variant="ghost" sm>▲</Btn>
              <Btn onClick={()=>mover(l.id,1)} disabled={i===ordenados.length-1} variant="ghost" sm>▼</Btn>
              <Btn onClick={()=>abrirEdicion(l)} variant="ghost" sm>✏</Btn>
              <Btn onClick={()=>quitar(l.id)} variant="danger" sm>🗑</Btn>
            </div>}
          </div>

          {!soloLectura && editingId===l.id ? (
            <div>
              <Field label="Nombre de quien ocupa este liderazgo" value={editVal.nombre} onChange={v=>setEditVal(p=>({...p,nombre:v}))} placeholder="Nombre Apellido"/>
              <Field label="Objetivo" value={editVal.objetivo} onChange={v=>setEditVal(p=>({...p,objetivo:v}))} placeholder="¿Cuál es su objetivo dentro del equipo?" multiline rows={3}/>

              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.07em" }}>Áreas a las que pertenece</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:10 }}>
                  {areas.map(a=>{
                    const activa = a.id in editAreas;
                    return (
                      <button key={a.id} onClick={()=>toggleArea(a.id)} style={{ padding:"6px 12px", borderRadius:99, border:`1px solid ${activa?C.gold:C.border}`, background:activa?`${C.gold}20`:"transparent", color:activa?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12, cursor:"pointer" }}>
                        {activa?"✓ ":""}{a.nombre}
                      </button>
                    );
                  })}
                  {areas.length===0 && <span style={{ fontFamily:font.body, fontSize:12, color:C.border }}>Sin áreas creadas todavía — crea una abajo.</span>}
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  <input value={nuevaAreaTexto} onChange={e=>setNuevaAreaTexto(e.target.value)} onKeyDown={e=>e.key==="Enter"&&agregarAreaNueva()} placeholder="Nueva área (ej: Ventas)" style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}/>
                  <Btn onClick={agregarAreaNueva} variant="ghost" sm>+ Crear</Btn>
                </div>
                {Object.keys(editAreas).map(areaId=>{
                  const area = areas.find(a=>a.id===areaId);
                  return (
                    <Field key={areaId} label={`Procesos macro en ${area?.nombre||"esta área"}`} value={editAreas[areaId]} onChange={v=>setEditAreas(prev=>({...prev,[areaId]:v}))} placeholder={"1. ...\n2. ..."} multiline rows={3}/>
                  );
                })}
              </div>

              <div style={{ display:"flex", gap:8 }}><Btn onClick={()=>guardar(l.id)} sm full>Guardar</Btn><Btn onClick={()=>setEditingId(null)} variant="ghost" sm full>Cancelar</Btn></div>
            </div>
          ):(
            <div>
              <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", marginBottom:10 }}>
                <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>🎯 Objetivo</div>
                <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{l.objetivo || "— sin definir"}</div>
              </div>
              {misAreas.length===0 ? (
                <div style={{ fontFamily:font.body, fontSize:12, color:C.border, marginBottom:10 }}>Sin áreas asignadas todavía.</div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:10, marginBottom:10 }}>
                  {misAreas.map(a=>(
                    <div key={a.area_id} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px" }}>
                      <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:5 }}>🗂️ {a.areaNombre}</div>
                      <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{a.procesos_macro || "— sin definir"}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8, display:"flex", gap:14, flexWrap:"wrap", fontFamily:font.body, fontSize:10, color:C.textMuted }}>
                <span>🕒 Creado {fmtFechaHora(l.created_at)}</span>
                <span>✎ Actualizado {fmtFechaHora(l.updated_at||l.created_at)}</span>
              </div>
            </div>
          )}
        </Card>
      );})}
      {ordenados.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin líderes agregados todavía. Usa "+ Agregar líder" para empezar.</div>}
    </div>
  );
}

function JuntaVistaPorArea({ areas, setAreas, lideres, liderAreas }) {
  const soloLectura = useReadOnly();
  const [nuevaArea, setNuevaArea] = useState("");
  const [editingAreaId, setEditingAreaId] = useState(null);
  const [editAreaNombre, setEditAreaNombre] = useState("");

  const crearArea = async () => {
    if (!nuevaArea.trim()) return;
    const { data, error } = await supabase.from("junta_areas").insert({ nombre:nuevaArea.trim() }).select().single();
    if (!error && data) { setAreas(prev=>[...prev, data]); setNuevaArea(""); }
  };
  const guardarNombreArea = async (id) => {
    if (!editAreaNombre.trim()) return;
    const { data, error } = await supabase.from("junta_areas").update({ nombre:editAreaNombre.trim() }).eq("id", id).select().single();
    if (!error && data) { setAreas(prev=>prev.map(a=>a.id===id?data:a)); setEditingAreaId(null); }
  };
  const quitarArea = async (id) => {
    if (!window.confirm("¿Quitar esta área? También se quitará de los líderes que la tengan asignada. Esto no se puede deshacer.")) return;
    await supabase.from("junta_areas").delete().eq("id", id);
    setAreas(prev=>prev.filter(a=>a.id!==id));
  };

  return (
    <div>
      {!soloLectura && <Card glow style={{ marginBottom:16 }}>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.goldLight, marginBottom:10 }}>Nueva área</div>
        <div style={{ display:"flex", gap:8 }}>
          <input value={nuevaArea} onChange={e=>setNuevaArea(e.target.value)} onKeyDown={e=>e.key==="Enter"&&crearArea()} placeholder="Ej: Ventas, Recursos Humanos, Operaciones..." style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none" }}/>
          <Btn onClick={crearArea} sm>+ Crear área</Btn>
        </div>
      </Card>}

      {areas.map(area=>{
        const contribuciones = liderAreas.filter(la=>la.area_id===area.id).map(la=>({ ...la, liderNombre: lideres.find(l=>l.id===la.lider_id)?.nombre || "— sin nombre" }));
        return (
          <Card key={area.id} style={{ marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
              {!soloLectura && editingAreaId===area.id ? (
                <input value={editAreaNombre} onChange={e=>setEditAreaNombre(e.target.value)} style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.gold}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:15, fontFamily:font.body, outline:"none", fontWeight:700 }}/>
              ) : (
                <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.goldLight }}>🗂️ {area.nombre}</div>
              )}
              {!soloLectura && <div style={{ display:"flex", gap:6 }}>
                {editingAreaId===area.id ? (
                  <><Btn onClick={()=>guardarNombreArea(area.id)} sm>Guardar</Btn><Btn onClick={()=>setEditingAreaId(null)} variant="ghost" sm>✕</Btn></>
                ):(
                  <><Btn onClick={()=>{ setEditingAreaId(area.id); setEditAreaNombre(area.nombre); }} variant="ghost" sm>✏</Btn><Btn onClick={()=>quitarArea(area.id)} variant="danger" sm>🗑</Btn></>
                )}
              </div>}
            </div>
            {contribuciones.length===0 ? (
              <div style={{ fontFamily:font.body, fontSize:12, color:C.border }}>Ningún líder tiene procesos asignados en esta área todavía.</div>
            ) : contribuciones.map(c=>(
              <div key={c.id} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px", marginBottom:8 }}>
                <div style={{ fontFamily:font.body, fontSize:11, fontWeight:700, color:C.text, marginBottom:4 }}>{c.liderNombre}</div>
                <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{c.procesos_macro || "— sin definir"}</div>
              </div>
            ))}
          </Card>
        );
      })}
      {areas.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin áreas creadas todavía. Usa "+ Crear área" para empezar.</div>}
    </div>
  );
}

// ── SCREEN: Junta Admin — Acuerdos y decisiones (registro permanente) ───────
function JuntaAcuerdosTab({ user, acuerdos, setAcuerdos }) {
  const soloLectura = useReadOnly();
  const [showNuevo, setShowNuevo] = useState(false);
  const [f, setF] = useState({ fecha: todayStr, texto: "" });

  const guardar = async () => {
    if (!f.texto.trim()) return;
    const { data, error } = await supabase.from("junta_acuerdos").insert({ fecha:f.fecha, texto:f.texto.trim(), registrado_por:user.name }).select().single();
    if (!error && data) { setAcuerdos(prev=>[data, ...prev]); setF({ fecha: todayStr, texto:"" }); setShowNuevo(false); }
    else if (error) alert("No se pudo guardar. Revisa que el SQL de esta pestaña ya se haya corrido en Supabase.");
  };

  const ordenados = [...acuerdos].sort((a,b)=> b.fecha.localeCompare(a.fecha) || (b.created_at||"").localeCompare(a.created_at||""));

  return (
    <div>
      <PageHeader title="Acuerdos y decisiones" subtitle="Registro permanente de la Junta — una vez guardado, no se puede editar ni borrar" action={!soloLectura && <Btn onClick={()=>setShowNuevo(true)} sm>+ Nuevo acuerdo</Btn>} />
      {!soloLectura && showNuevo && (
        <Card glow style={{ marginBottom:16 }}>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.goldLight, marginBottom:6 }}>Nuevo acuerdo</div>
          <div style={{ background:`${C.amber}10`, border:`1px solid ${C.amber}44`, borderRadius:8, padding:"10px 12px", marginBottom:14, fontFamily:font.body, fontSize:11, color:C.amber }}>⚠️ Revisa bien antes de guardar: una vez guardado, este acuerdo queda fijo — no se podrá editar ni eliminar desde la aplicación.</div>
          <Field label="Fecha del acuerdo" type="date" value={f.fecha} onChange={v=>setF(p=>({...p,fecha:v}))}/>
          <Field label="¿Qué se acordó?" value={f.texto} onChange={v=>setF(p=>({...p,texto:v}))} placeholder='Ej: "A partir de la semana del 4 de agosto, la Junta será a las 8:00am."'/>
          <div style={{ display:"flex", gap:8 }}><Btn onClick={guardar} full>Guardar acuerdo (definitivo)</Btn><Btn onClick={()=>setShowNuevo(false)} variant="ghost" full>Cancelar</Btn></div>
        </Card>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {ordenados.map(a=>(
          <Card key={a.id} p="0" style={{ overflow:"hidden" }}>
            <div style={{ display:"flex" }}>
              <div style={{ width:5, flexShrink:0, background:C.gold }} />
              <div style={{ flex:1, padding:"14px 16px" }}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, marginBottom:10 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, lineHeight:1.5 }}>{a.texto}</div>
                  <Badge color={C.blue} sm>🔒 Fijo</Badge>
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <Badge color={C.textMuted} sm>📅 {a.fecha}</Badge>
                  {a.registrado_por && <Badge color={C.textMuted} sm>✍️ {a.registrado_por}</Badge>}
                  <Badge color={C.textMuted} sm>🕒 {fmtFechaHora(a.created_at)}</Badge>
                </div>
              </div>
            </div>
          </Card>
        ))}
        {ordenados.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin acuerdos registrados todavía.</div>}
      </div>
    </div>
  );
}

// ── SCREEN: Junta Admin — Seguimiento semanal (checklist) ───────────────────
function JuntaSeguimientoScreen({ user, lideres, compromisos, setCompromisos, isMobile }) {
  const soloLectura = useReadOnly();
  // Por defecto se ve todo el mes junto (semanaFiltro=""); si se quiere, se puede acotar a una
  // sola semana con el segundo selector.
  const [mesSel, setMesSel] = useState(() => martesDeSemana(todayStr).slice(0,7));
  const [semanaFiltro, setSemanaFiltro] = useState("");
  const [filtroLider, setFiltroLider] = useState("");
  // Refresca la pantalla cada tanto para que los 5 minutos de gracia de "desmarcar" se venzan
  // solos en pantalla, sin necesidad de recargar la página.
  const [, tick] = useState(0);
  useEffect(() => { const iv = setInterval(() => tick(x => x + 1), 15000); return () => clearInterval(iv); }, []);
  const [vistaEstado, setVistaEstado] = useState("activas"); // 'activas' | 'todas' | 'cumplidas' | 'vencidas'
  const [orden, setOrden] = useState("cronologico"); // 'cronologico' (más vieja primero) | 'lider'
  const [showNueva, setShowNueva] = useState(false);
  const [nueva, setNueva] = useState({ descripcion:"", lider_ids:[], fecha_estimada:"", comentarios:"" });
  // La descripción se muestra truncada en una línea con un "ver más" que la deja crecer y
  // hacer wrap en el mismo lugar (sin duplicar el texto en otro bloque aparte).
  const [expandidas, setExpandidas] = useState(new Set());
  const toggleExpandida = (id) => setExpandidas(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });

  const nombreLider = (id) => lideres.find(l=>l.id===id)?.nombre || "— sin asignar";
  const monitor = getMonitorActual(lideres);
  const esMonitor = esMonitorActual(user, lideres);
  // Solo el monitor de turno puede crear tareas y marcarlas completadas. Master queda como
  // respaldo por si el nombre del líder no coincide exactamente con el de la cuenta que entra.
  const puedeGestionar = !soloLectura && (user.role==="master" || esMonitor);

  // ── Mes → semanas del mes (martes) ─────────────────────────────────────────────
  const [anioSel, mesNumSel] = mesSel.split("-").map(Number);
  const martesDelMesSel = martesDelMes(anioSel, mesNumSel-1);
  const cambiarMes = (valorMes) => { setMesSel(valorMes); setSemanaFiltro(""); };
  const irAEstaSemana = () => { const t = martesDeSemana(todayStr); setMesSel(t.slice(0,7)); setSemanaFiltro(t); };
  const etiquetaSemana = (mt) => new Date(mt+"T12:00:00").toLocaleDateString("es-CO",{day:"numeric",month:"short"});

  const tareasDelMes = compromisos.filter(c=>martesDelMesSel.includes(c.semana));
  const tareasVista = semanaFiltro ? tareasDelMes.filter(c=>c.semana===semanaFiltro) : tareasDelMes;

  // ── Agrupa tareas compartidas (mismo grupo_id) en un solo bloque visual ────────
  const agrupar = (lista) => {
    const vistos = new Set(); const grupos = [];
    lista.forEach(t=>{
      if (vistos.has(t.id)) return;
      const miembros = t.grupo_id ? lista.filter(x=>x.grupo_id===t.grupo_id) : [t];
      miembros.forEach(m=>vistos.add(m.id));
      grupos.push(miembros);
    });
    return grupos;
  };
  const esGrupoVencido = (g) => tareaVencidaNoRealizada(g[0]);
  const esGrupoCompletado = (g) => g.every(m=>m.completado);

  const gruposMes = agrupar(tareasVista);
  const gruposFiltrados = gruposMes.filter(g => !filtroLider || g.some(m=>m.lider_id===filtroLider));
  const gruposCumplidos = gruposFiltrados.filter(esGrupoCompletado);
  const gruposVencidos = gruposFiltrados.filter(esGrupoVencido);
  // "Activas" NUNCA se acota al mes que se esté navegando en el selector de arriba — una tarea
  // sigue viva en el checklist hasta que se marca cumplida o vence, sin importar si su semana quedó
  // del lado del mes anterior por el simple corte de calendario (p. ej. la última semana de agosto,
  // que se revisa ya con el Monitor de septiembre). El selector de mes/semana solo acota el
  // histórico (Todas/Cumplidas/Vencidas); "Activas" mira TODOS los compromisos, y solo se acota si
  // el usuario elige explícitamente una semana puntual.
  const tareasActivasBase = semanaFiltro ? compromisos.filter(c=>c.semana===semanaFiltro) : compromisos;
  const gruposActivosBase = agrupar(tareasActivasBase).filter(g => !filtroLider || g.some(m=>m.lider_id===filtroLider));
  // Una tarea recién marcada como hecha no desaparece de "Activas" de una — se queda ahí, ya con
  // su check verde, mientras dure la gracia de 5 minutos para desmarcar por error (dentroDeGracia,
  // arriba). Así no toca ir a buscarla entre todas las cumplidas si se marcó sin querer. También
  // sigue apareciendo en "Cumplidas" desde el primer momento — es solo una copia visual temporal.
  const gruposActivos = gruposActivosBase.filter(g => !esGrupoVencido(g) && (!esGrupoCompletado(g) || dentroDeGracia(g[0])));
  const gruposMostrados = vistaEstado==="activas" ? gruposActivos : vistaEstado==="cumplidas" ? gruposCumplidos : vistaEstado==="vencidas" ? gruposVencidos : gruposFiltrados;
  // Orden cronológico: la más vieja primero, la más nueva de última — así el monitor revisa de
  // arriba hacia abajo en la reunión, y cuando llega a la última (la que se creó más reciente)
  // sabe que ya terminó de repasarlas todas.
  const gruposOrdenados = [...gruposMostrados].sort((a,b)=> orden==="lider"
    ? nombreLider(a[0].lider_id).localeCompare(nombreLider(b[0].lider_id))
    : new Date(a[0].created_at||0) - new Date(b[0].created_at||0));

  // ── Crear tarea (uno o varios líderes a la vez) ────────────────────────────────
  // La fecha sugerida siempre es "el próximo martes desde hoy" — sin importar qué se esté
  // viendo/filtrando en pantalla — para que agregar una tarea fuera de la reunión (por ejemplo
  // días después) no herede una semana equivocada.
  const abrirNueva = () => { setNueva({ descripcion:"", lider_ids:[], fecha_estimada: sumarDias(martesDeSemana(todayStr),7), comentarios:"" }); setShowNueva(true); };
  const toggleLiderNueva = (id) => setNueva(p => ({...p, lider_ids: p.lider_ids.includes(id) ? p.lider_ids.filter(x=>x!==id) : [...p.lider_ids, id]}));
  const todosMarcados = lideres.length>0 && nueva.lider_ids.length===lideres.length;
  const toggleTodosNueva = () => setNueva(p => ({...p, lider_ids: todosMarcados ? [] : lideres.map(l=>l.id)}));

  const crear = async () => {
    if (!nueva.descripcion.trim() || nueva.lider_ids.length===0) return;
    // Si se está viendo una semana específica, la tarea nueva queda ahí; si se está viendo
    // "todo el mes", queda en la semana real de hoy.
    const semanaTarea = semanaFiltro || martesDeSemana(todayStr);
    // No se pueden crear tareas retroactivas en un período ya congelado (eso permitiría inflar
    // el indicador de un mes que ya se cerró).
    if (semanaCongelada(semanaTarea) && user.role!=="master") { alert("Ese período ya quedó congelado — no se pueden agregar tareas ahí."); return; }
    const grupoId = nueva.lider_ids.length>1 ? crypto.randomUUID() : null;
    const filas = nueva.lider_ids.map(lid=>({
      semana:semanaTarea, descripcion:nueva.descripcion.trim(), lider_id:lid,
      fecha_estimada:nueva.fecha_estimada||null, comentarios:nueva.comentarios.trim(), completado:false, grupo_id:grupoId,
    }));
    const { data, error } = await supabase.from("junta_compromisos").insert(filas).select();
    if (!error && data) { setCompromisos(prev=>[...data, ...prev]); setShowNueva(false); }
    else if (error) alert(`No se pudo crear la tarea: ${error.message||"error desconocido"}`);
  };
  const actualizar = async (id, patch) => {
    const { data, error } = await supabase.from("junta_compromisos").update(patch).eq("id", id).select().single();
    if (!error && data) setCompromisos(prev=>prev.map(c=>c.id===id?data:c));
    // Antes esto fallaba en silencio — si faltaba una columna en la base de datos (por ejemplo, si
    // no se corrió una migración) el clic no hacía nada visible y parecía un bug en vez de un
    // aviso claro. Ahora se avisa qué pasó.
    else if (error) alert(`No se pudo guardar el cambio: ${error.message||"error desconocido"}`);
  };
  const actualizarComentarioGrupo = (g, valor) => g.forEach(m=>{ if (valor!==m.comentarios) actualizar(m.id, {comentarios:valor}); });
  // Una tarea compartida se marca como un solo bloque (se hizo o no se hizo entre todos los
  // responsables), no persona por persona — pero cada fila individual sigue guardando su propio
  // completado=true/false para que los indicadores por líder sigan contando el crédito de cada uno.
  // Queda registrado quién marcó la tarea como hecha (y quién la desmarcó), no solo cuándo —
  // así se puede revisar después si alguien se marcó tareas propias de forma sospechosa.
  const actualizarCompletadoGrupo = (g, valor) => {
    const patch = valor ? { completado:true, completado_en:new Date().toISOString(), completado_por:user.name } : { completado:false, completado_en:null, completado_por:null };
    g.forEach(m => actualizar(m.id, patch));
    if (valor) sonidoTareaCumplida();
  };
  // "Check visual": quien no es el monitor de turno (pero sí es responsable de la tarea) puede
  // marcarla como que ya la hizo — pero es solo un autorreporte, no cuenta para Indicadores hasta
  // que el monitor la confirme con su propio clic (ver actualizarCompletadoGrupo arriba). Mismo
  // botón de check para los dos casos, sin cuadrito aparte — lo que cambia es qué campo se toca.
  const actualizarAutorreportadoGrupo = (g, valor) => {
    const patch = valor ? { autorreportado:true, autorreportado_en:new Date().toISOString(), autorreportado_por:user.name } : { autorreportado:false, autorreportado_en:null, autorreportado_por:null };
    g.forEach(m => actualizar(m.id, patch));
  };
  // ¿El usuario logueado es uno de los responsables de esta tarea? Se compara por nombre (igual
  // que esMonitorActual) porque no hay un vínculo directo entre cuentas de usuario y líderes.
  const esTareaDelUsuario = (g) => g.some(m => {
    const nombreLid = nombreLider(m.lider_id);
    return !!nombreLid && !!user?.name && normalizarNombre(nombreLid).localeCompare(normalizarNombre(user.name), "es", { sensitivity:"base" })===0;
  });
  // Si la reunión no se hizo el día previsto (se corrió a otro día), una tarea puede vencer
  // antes de que alcancen a revisarla. El monitor/master puede "reabrirla" con una nueva fecha
  // para poder marcarla en la reunión real. Queda registrado quién la reabrió y cuándo — y a
  // diferencia de antes, se guarda el HISTORIAL completo (no solo la última vez), para poder ver
  // si una tarea se ha ido aplazando varias veces en vez de resolverse.
  const reabrirVencida = (g) => {
    const nueva = window.prompt("Esta tarea venció antes de poder revisarla. ¿Hasta qué fecha le damos más tiempo? (aaaa-mm-dd)", sumarDias(todayStr, 1));
    if (!nueva) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nueva)) { alert("Fecha inválida — usa el formato aaaa-mm-dd."); return; }
    const ahora = new Date().toISOString();
    g.forEach(m => {
      const historial = [...(m.reaperturas||[]), { fecha_anterior:m.fecha_estimada||null, fecha_nueva:nueva, por:user.name, en:ahora }];
      actualizar(m.id, { fecha_estimada:nueva, reabierta_por:user.name, reabierta_en:ahora, reaperturas:historial });
    });
  };
  const eliminarGrupo = async (g) => {
    if (!window.confirm(g.length>1 ? "¿Eliminar esta tarea compartida? Se borra para todos los asignados. Esto no se puede deshacer." : "¿Eliminar esta tarea? Esto no se puede deshacer.")) return;
    await supabase.from("junta_compromisos").delete().in("id", g.map(m=>m.id));
    setCompromisos(prev=>prev.filter(c=>!g.some(m=>m.id===c.id)));
  };
  // El monitor solo puede borrar tareas activas de un período no congelado; lo cerrado o lo de
  // meses ya entregados queda solo para master.
  const puedeBorrarGrupo = (g) => {
    if (soloLectura) return false;
    if (user.role==="master") return true;
    const cerrada = esGrupoVencido(g) || esGrupoCompletado(g);
    return esMonitor && !cerrada && !semanaCongelada(g[0].semana);
  };

  const selectStyle = { background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" };

  return (
    <div>
      <PageHeader title="Seguimiento semanal" subtitle="Checklist de tareas de la Junta" />

      <Card glow style={{ marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:44, height:44, borderRadius:10, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, flexShrink:0 }}>🎯</div>
          <div>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:2 }}>Monitor de turno · rota cada mes{esMonitor && " · eres tú"}</div>
            <div style={{ fontFamily:font.body, fontSize:17, fontWeight:700, color:C.goldLight }}>{monitor ? (monitor.nombre || "— sin nombre") : "— sin líderes configurados"}</div>
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <input type="month" value={mesSel} onChange={e=>cambiarMes(e.target.value)} style={selectStyle}/>
          <select value={semanaFiltro} onChange={e=>setSemanaFiltro(e.target.value)} style={selectStyle}>
            <option value="">Todo el mes</option>
            {martesDelMesSel.map((mt,i)=><option key={mt} value={mt}>Semana {i+1} · {etiquetaSemana(mt)}</option>)}
          </select>
          <Btn onClick={irAEstaSemana} variant="ghost" sm>Esta semana</Btn>
          {puedeGestionar && <Btn onClick={abrirNueva} sm style={{ marginLeft:"auto" }}>+ Nueva tarea</Btn>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginTop:8, paddingTop:8, borderTop:`1px solid ${C.border}` }}>
          <select value={filtroLider} onChange={e=>setFiltroLider(e.target.value)} style={selectStyle}>
            <option value="">Todos los líderes</option>
            {lideres.map(l=><option key={l.id} value={l.id}>{l.nombre||"(sin nombre)"}</option>)}
          </select>
          <select value={orden} onChange={e=>setOrden(e.target.value)} style={selectStyle}>
            <option value="cronologico">Ordenar: más vieja primero</option>
            <option value="lider">Ordenar: por líder</option>
          </select>
          <div style={{ display:"flex", marginLeft:"auto" }}>
            <button onClick={()=>setVistaEstado("activas")} style={{ ...selectStyle, borderRadius:"7px 0 0 7px", background:vistaEstado==="activas"?C.gold:C.surfaceAlt, color:vistaEstado==="activas"?"#fff":C.text, cursor:"pointer", fontWeight:600 }}>Activas ({gruposActivos.length})</button>
            <button onClick={()=>setVistaEstado("todas")} style={{ ...selectStyle, borderRadius:0, borderLeft:"none", background:vistaEstado==="todas"?C.gold:C.surfaceAlt, color:vistaEstado==="todas"?"#fff":C.text, cursor:"pointer", fontWeight:600 }}>Todas ({gruposFiltrados.length})</button>
            <button onClick={()=>setVistaEstado("cumplidas")} style={{ ...selectStyle, borderRadius:0, borderLeft:"none", background:vistaEstado==="cumplidas"?C.gold:C.surfaceAlt, color:vistaEstado==="cumplidas"?"#fff":C.text, cursor:"pointer", fontWeight:600 }}>Cumplidas ({gruposCumplidos.length})</button>
            <button onClick={()=>setVistaEstado("vencidas")} style={{ ...selectStyle, borderRadius:"0 7px 7px 0", borderLeft:"none", background:vistaEstado==="vencidas"?C.gold:C.surfaceAlt, color:vistaEstado==="vencidas"?"#fff":C.text, cursor:"pointer", fontWeight:600 }}>Vencidas ({gruposVencidos.length})</button>
          </div>
        </div>
        {!puedeGestionar && !soloLectura && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:8 }}>Solo el monitor de turno puede crear tareas nuevas.</div>}
      </Card>

      {puedeGestionar && showNueva && (
        <Card style={{ marginBottom:16 }} p="10px">
          <input value={nueva.descripcion} onChange={e=>setNueva(p=>({...p,descripcion:e.target.value}))} placeholder="¿Qué hay que hacer?" style={{ width:"100%", marginBottom:6, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>¿Quién la hace? (una o varias personas)</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:6 }}>
            <button onClick={toggleTodosNueva} style={{ padding:"5px 10px", borderRadius:99, border:`1px solid ${todosMarcados?C.gold:C.border}`, background:todosMarcados?C.gold:C.surfaceAlt, color:todosMarcados?"#fff":C.textSub, fontSize:11, fontFamily:font.body, cursor:"pointer", fontWeight:600 }}>Todos</button>
            {lideres.map(l=>{ const marcado = nueva.lider_ids.includes(l.id); return (
              <button key={l.id} onClick={()=>toggleLiderNueva(l.id)} style={{ padding:"5px 10px", borderRadius:99, border:`1px solid ${marcado?C.gold:C.border}`, background:marcado?C.gold:C.surfaceAlt, color:marcado?"#fff":C.textSub, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{l.nombre||"(sin nombre)"}</button>
            );})}
          </div>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.3fr", gap:6, marginBottom:6 }}>
            <input type="date" value={nueva.fecha_estimada} onChange={e=>setNueva(p=>({...p,fecha_estimada:e.target.value}))} style={{ width:"100%", minWidth:0, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box", WebkitAppearance:"none", appearance:"none" }}/>
            <input value={nueva.comentarios} onChange={e=>setNueva(p=>({...p,comentarios:e.target.value}))} placeholder="Comentario (opcional)" style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
          </div>
          <div style={{ display:"flex", gap:6 }}><Btn onClick={crear} sm disabled={!nueva.descripcion.trim()||nueva.lider_ids.length===0}>Guardar</Btn><Btn onClick={()=>setShowNueva(false)} variant="ghost" sm>Cancelar</Btn></div>
        </Card>
      )}

      <div key={vistaEstado} className="ozen-pane-anim-tab" style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {gruposOrdenados.map(g=>{
          const base = g[0];
          const vencida = esGrupoVencido(g);
          const compartida = g.length>1;
          const puedeBorrar = puedeBorrarGrupo(g);
          const completadoGrupo = esGrupoCompletado(g);
          const autorreportadoGrupo = !completadoGrupo && g.every(m=>m.autorreportado);
          const enGracia = completadoGrupo && dentroDeGracia(base);
          // El mes ya entregado por el monitor anterior queda congelado (salvo su última semana,
          // por si la reunión de traspaso se corrió de fecha) — master siempre puede entrar.
          const puedeEditarPeriodo = user.role==="master" || !semanaCongelada(base.semana);
          // Se marca como un solo bloque (no por persona) — pero cada fila individual sigue
          // guardando su propio completado=true/false para que el crédito en Indicadores por
          // líder siga contando igual que antes. Hay 5 minutos de gracia para desmarcar por error.
          // El check REAL (cuenta para Indicadores) solo lo puede dar el monitor de turno — si la
          // tarea ya venía autorreportada por su responsable, este mismo clic la confirma.
          const puedeConfirmar = puedeGestionar && puedeEditarPeriodo && (completadoGrupo ? enGracia : !vencida);
          // Quien no es el monitor, pero sí es responsable de la tarea, puede prender/apagar su
          // propio "check visual" — es solo un autorreporte, no el check real.
          const puedeAutorreportar = !soloLectura && !puedeGestionar && puedeEditarPeriodo && !completadoGrupo && !vencida && esTareaDelUsuario(g);
          const puedeMarcar = puedeConfirmar || puedeAutorreportar;
          const expandida = expandidas.has(compartida ? base.grupo_id : base.id);
          const toggleId = compartida ? base.grupo_id : base.id;
          const marcar = () => {
            if (puedeConfirmar) actualizarCompletadoGrupo(g, !completadoGrupo);
            else if (puedeAutorreportar) actualizarAutorreportadoGrupo(g, !autorreportadoGrupo);
          };
          const nombresLideres = g.map(m=>nombreLider(m.lider_id)).join(", ");
          // Mensaje del check según quién está viendo y en qué estado quedó — mismo botón para
          // autorreportar (responsable) y confirmar (monitor), así que el texto es el que explica
          // qué hace el clic en cada caso.
          const checkTitle = !puedeEditarPeriodo
            ? "Período congelado — ya se cerró el turno del monitor anterior, solo master puede editarlo"
            : completadoGrupo
            ? (enGracia ? "Marcada como hecha — se puede desmarcar unos minutos más" : "Ya marcada como hecha — no se puede desmarcar")
            : vencida
            ? (autorreportadoGrupo ? `Vencida — ${base.autorreportado_por} la había autorreportado, pero no se confirmó a tiempo. Reábrela para poder confirmarla.` : "Vencida — ya pasó el plazo, no se puede marcar")
            : puedeConfirmar
            ? (autorreportadoGrupo ? `Autorreportada por ${base.autorreportado_por} — clic para confirmarla` : "Marcar como hecha")
            : puedeAutorreportar
            ? (autorreportadoGrupo ? "Ya la marcaste — falta que el monitor la confirme. Clic para quitar tu marca." : "Marca aquí cuando ya la hiciste — el monitor debe confirmarla para que cuente en Indicadores.")
            : autorreportadoGrupo
            ? `Autorreportada por ${base.autorreportado_por} — falta que el monitor la confirme`
            : "Solo el monitor de turno (o el responsable de la tarea) puede marcarla";
          return (
            <div key={toggleId} style={{ padding:"7px 10px", background:C.surface, borderRadius:9, borderTop:`1px solid ${C.border}`, borderRight:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, borderLeft:`3px solid ${compartida?C.blue:C.border}`, display:"flex", flexDirection:"column", gap:4 }}>
              {/* Línea 1: líder(es), fecha, estado (vencida/cumplida), reabrir */}
              <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <div style={{ fontFamily:font.body, fontSize:11, color:C.textSub, fontWeight:600 }}>👤 {nombresLideres}</div>
                {base.fecha_estimada && <div style={{ fontFamily:font.mono, fontSize:10.5, color:vencida?C.amber:C.textMuted }}>📅 {base.fecha_estimada}</div>}
                {completadoGrupo && <Badge color={C.green} sm>Cumplida</Badge>}
                {autorreportadoGrupo && <Badge color={C.blue} sm title="Marcada por su responsable, falta que el monitor la confirme">Autorreportada</Badge>}
                {vencida && <Badge color={C.amber} sm>Vencida</Badge>}
                {!puedeEditarPeriodo && <Badge color={C.textMuted} sm>Congelada</Badge>}
                {vencida && puedeGestionar && puedeEditarPeriodo && <button onClick={()=>reabrirVencida(g)} title="La reunión se corrió de fecha — reabrir con nuevo plazo" style={{ background:"none", border:`1px solid ${C.amber}`, borderRadius:5, color:C.amber, cursor:"pointer", fontSize:10, padding:"2px 7px", fontFamily:font.body }}>Reabrir</button>}
                {completadoGrupo && base.completado_por && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted }}>· marcada por {base.completado_por}</div>}
                {autorreportadoGrupo && base.autorreportado_por && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted }}>· por {base.autorreportado_por}</div>}
                {base.reabierta_por && (
                  <HoverTooltip label={`· reabierta ${(base.reaperturas?.length||1)>1 ? `${base.reaperturas.length}×` : "1×"}`} labelStyle={{ fontFamily:font.body, fontSize:10, color:(base.reaperturas?.length||1)>2?C.amber:C.textMuted }} width={280} clickOnly>
                    <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginBottom:6 }}>Creada el {fmtFechaHora(base.created_at)}.</div>
                    {(base.reaperturas?.length ? base.reaperturas : [{ fecha_anterior:null, fecha_nueva:base.fecha_estimada, por:base.reabierta_por, en:base.reabierta_en }]).map((r,i)=>(
                      <div key={i} style={{ fontFamily:font.body, fontSize:11, color:C.text, lineHeight:1.45, marginBottom:5 }}>
                        <b>{i+1}.</b> {r.fecha_anterior ? `${r.fecha_anterior} → ` : ""}{r.fecha_nueva} · {r.por||"—"} · {fmtFechaHora(r.en)}
                      </div>
                    ))}
                  </HoverTooltip>
                )}
              </div>
              {/* Línea 2: check + tarea (ancho libre) + ver más al final */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <button onClick={puedeMarcar?marcar:undefined} disabled={!puedeMarcar} title={checkTitle} style={{ width:20, height:20, borderRadius:5, border:`2px solid ${completadoGrupo?C.green:vencida?C.amber:autorreportadoGrupo?C.blue:C.border}`, background:completadoGrupo?C.green:autorreportadoGrupo?`${C.blue}30`:"transparent", cursor:puedeMarcar?"pointer":"default", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:completadoGrupo?"#fff":vencida?C.amber:C.blue, fontSize:11 }}>{completadoGrupo?"✓":vencida?"✕":autorreportadoGrupo?"✓":""}</button>
                <div style={{ flex:1, minWidth:0, textAlign:"left", fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, textDecoration:completadoGrupo?"line-through":"none", whiteSpace:expandida?"normal":"nowrap", overflow:expandida?"visible":"hidden", textOverflow:expandida?"clip":"ellipsis", lineHeight:1.5 }} title={!expandida?base.descripcion:undefined}>{base.descripcion}</div>
                <button onClick={()=>toggleExpandida(toggleId)} style={{ flexShrink:0, background:"none", border:"none", color:C.blue, cursor:"pointer", fontSize:11, fontFamily:font.body, textDecoration:"underline", padding:0 }}>{expandida?"ver menos":"ver más"}</button>
              </div>
              {/* Línea 3: comentario (ancho libre) + eliminar */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input placeholder="Comentario..." defaultValue={base.comentarios||""} disabled={soloLectura} onBlur={e=>{ if(e.target.value!==base.comentarios) (compartida?actualizarComentarioGrupo(g,e.target.value):actualizar(base.id,{comentarios:e.target.value})); }} style={{ flex:1, minWidth:0, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 8px", color:C.text, fontSize:11, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
                {puedeBorrar && <button onClick={()=>eliminarGrupo(g)} title="Eliminar" style={{ background:"none", border:"none", color:C.red, cursor:"pointer", flexShrink:0, fontSize:13 }}>🗑</button>}
              </div>
            </div>
          );
        })}
        {gruposOrdenados.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>{vistaEstado==="activas" ? "Sin tareas activas." : vistaEstado==="cumplidas" ? "Sin tareas cumplidas todavía." : vistaEstado==="vencidas" ? "Sin tareas vencidas." : "Sin tareas para este período."}</div>}
      </div>
    </div>
  );
}

// ── SCREEN: Junta Admin — Indicadores (cumplimiento del Monitor) ────────────
function JuntaIndicadoresTab({ lideres, compromisos, isMobile }) {
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const listaMeses = () => {
    const meses = [];
    const inicio = new Date(JUNTA_ROTATION_EPOCH + "T12:00:00");
    let anio = inicio.getFullYear(), mes = inicio.getMonth();
    const hoy = toColombiaDate();
    const anioActual = hoy.getFullYear(), mesActual = hoy.getMonth();
    while (anio < anioActual || (anio === anioActual && mes <= mesActual)) {
      meses.push({ anio, mes });
      mes++; if (mes > 11) { mes = 0; anio++; }
    }
    return meses.reverse();
  };

  const meses = listaMeses();
  const actual = meses[0];
  // El cuadro de arriba muestra por defecto el mes en curso, pero se puede elegir cualquier mes
  // anterior desde el selector — selMesIdx es el índice dentro de `meses` (0 = mes en curso, ya
  // que `meses` viene ordenado del más reciente al más antiguo).
  const [selMesIdx, setSelMesIdx] = useState(0);
  const seleccionado = meses[selMesIdx] || actual;
  const monitorSel = seleccionado ? getMonitorDeMes(lideres, seleccionado.anio, seleccionado.mes) : null;
  const statsSel = seleccionado ? statsDelMes(compromisos, seleccionado.anio, seleccionado.mes) : null;
  const statsLideresSel = seleccionado ? statsPorLiderDelMes(compromisos, lideres, seleccionado.anio, seleccionado.mes) : [];
  // Cumplimiento (%) y cantidad de tareas son cosas distintas — alguien puede tener pocas
  // tareas con 100% de cumplimiento, y otra persona muchas tareas con menor %. Se muestran
  // como dos rankings separados en vez de una sola lista. pct puede ser null (sin tareas
  // cerradas todavía) — se manda al final del ranking, no se trata como 0.
  const topCumplimiento = [...statsLideresSel].sort((a,b)=> (b.pct??-1) - (a.pct??-1) || b.total - a.total);
  const topCantidad = [...statsLideresSel].sort((a,b)=> b.total - a.total || (b.pct??-1) - (a.pct??-1));

  return (
    <div>
      <PageHeader title="Indicadores" subtitle="Cumplimiento del Monitor, mes a mes" />

      {!actual ? (
        <Card><div style={{ textAlign:"center", padding:20, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Aún no hay meses para mostrar.</div></Card>
      ) : (
        <Card glow style={{ marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:14 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <select value={selMesIdx} onChange={e=>setSelMesIdx(Number(e.target.value))} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 9px", color:C.text, fontFamily:font.body, fontSize:12, fontWeight:600, outline:"none", cursor:"pointer" }}>
                {meses.map((m,i)=><option key={`${m.anio}-${m.mes}`} value={i}>{MESES[m.mes]} {m.anio}</option>)}
              </select>
              {selMesIdx===0 && <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>· mes en curso</div>}
            </div>
            <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub }}>Monitor: <span style={{ color:C.goldLight, fontWeight:700 }}>{monitorSel ? (monitorSel.nombre || "— sin nombre") : "—"}</span></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12 }}>
            <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Sesiones hechas</div>
              <div style={{ fontFamily:font.mono, fontSize:24, fontWeight:700, color:statsSel.sesiones>=statsSel.totalMartes?C.green:C.amber }}>{statsSel.sesiones} / {statsSel.totalMartes}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>martes con checklist registrado</div>
            </div>
            <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Cumplimiento de tareas (todos)</div>
              <div style={{ fontFamily:font.mono, fontSize:24, fontWeight:700, color:colorCumplimientoTexto(statsSel.pct) }}>{statsSel.pct===null?"—":`${statsSel.pct}%`}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>{statsSel.completadas} de {statsSel.totalCerradas} tareas cerradas completadas</div>
              {statsSel.activas>0 && <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginTop:2 }}>{statsSel.activas} todavía activa{statsSel.activas===1?"":"s"} — no cuenta{statsSel.activas===1?"":"n"} aún</div>}
            </div>
          </div>
          {statsLideresSel.length>0 && (
            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:16 }}>
              <div>
                <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", margin:"16px 0 8px" }}>Porcentaje cumplimiento</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {topCumplimiento.map((s,i)=>(
                    <div key={s.lider.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7 }}>
                      <div style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, width:14, flexShrink:0 }}>{i+1}</div>
                      <div style={{ flex:1, fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600 }}>{s.lider.nombre || "— sin nombre"}</div>
                      <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{s.completadas} de {s.totalCerradas}</div>
                      <Badge color={C.blue} intensity={intensidadPct(s.pct)} sm>{s.pct===null?"Sin cierres aún":`${s.pct}% cumplido`}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", margin:"16px 0 8px" }}>Total tareas del mes</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {topCantidad.map((s,i)=>{
                    const shareTareas = statsSel.totalTareas>0 ? Math.round((s.total/statsSel.totalTareas)*100) : 0;
                    return (
                      <div key={s.lider.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7 }}>
                        <div style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, width:14, flexShrink:0 }}>{i+1}</div>
                        <div style={{ flex:1, fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600 }}>{s.lider.nombre || "— sin nombre"}</div>
                        <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{s.total} tareas</div>
                        <Badge color={C.blue} sm>{shareTareas}% del total</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card p="0">
        <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, fontFamily:font.body, fontSize:13, fontWeight:700, color:C.text }}>Historial por mes</div>
        {meses.map(({ anio, mes }, idx) => {
          const monitor = getMonitorDeMes(lideres, anio, mes);
          const s = statsDelMes(compromisos, anio, mes);
          return (
            <div key={`${anio}-${mes}`} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderBottom:idx<meses.length-1?`1px solid ${C.border}`:"none", flexWrap:"wrap" }}>
              <div style={{ minWidth:120 }}>
                <div style={{ fontFamily:font.body, fontSize:12, fontWeight:600, color:C.text }}>{MESES[mes]} {anio}</div>
                <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{monitor ? (monitor.nombre || "— sin nombre") : "—"}</div>
              </div>
              <div style={{ flex:1, minWidth:160, display:"flex", gap:8, flexWrap:"wrap" }}>
                <Badge color={s.sesiones>=s.totalMartes?C.green:C.amber} sm>{s.sesiones}/{s.totalMartes} sesiones</Badge>
                <Badge color={C.blue} intensity={intensidadPct(s.pct)} sm>{s.pct===null?"Sin tareas registradas":`${s.pct}% cumplido`}</Badge>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ── SCREEN: Junta Admin — Explicación del rol ────────────────────────────────
function JuntaGuionTab({ monitor, isMobile }) {
  const guion = [
    { t:"Revisión de la semana anterior", qs:["¿Qué te comprometiste a hacer la semana pasada?","¿Qué quedó hecho y qué no?","¿Cuál es la evidencia de lo hecho?"] },
    { t:"Planeación individual de la semana", qs:["¿Qué vas a hacer esta semana?","¿Cómo, día por día?","¿Qué queda como resultado verificable de cada tarea?"] },
    { t:"Operacionalización (cuando una tarea llega vaga)", qs:["Eso concretamente, ¿es hacer qué? ¿Cuánto tiempo toma? ¿Con quién/dónde/con qué?","¿Qué evidencia deja? Si no deja nada, ¿cómo sabremos que se hizo?"] },
    { t:"Trabajo grupal", qs:["¿Quién toma qué parte?","¿De qué o de quién depende cada parte?","¿Acuerdo concreto y para cuándo? → queda registrado."] },
    { t:"Cierre — lo no previsto", qs:["Además de lo planeado, ¿qué te cayó la semana pasada que no estaba previsto?","Mucho del trabajo real es reactivo — esta pregunta existe para que también cuente y sea visible."] },
  ];
  const siHace = [
    "Garantiza que la reunión pase siempre el martes 9:00am; si hay que reprogramar, lo resuelve el mismo día.",
    "Conduce la sesión con el guion fijo de 5 momentos, sin improvisar.",
    "Operacionaliza tareas vagas: qué es exactamente, cómo, cuánto tiempo, qué resultado queda.",
    "Registra todo (plan de cada uno, cumplimiento, evidencia, acuerdos) — aquí, en este módulo.",
    "Ante algo incumplido, ayuda a destrabarlo (\"¿cómo lo resolvemos?\"), no pregunta el porqué.",
  ];
  const noHace = [
    "No juzga ni reprocha.",
    "No lidera al equipo — solo hace seguimiento de la semana.",
    "No ejecuta el trabajo de otros, solo lo hace visible.",
    "No reporta hacia arriba ni interpreta — el reporte es a la propia Junta, en vivo.",
  ];
  return (
    <div>
      <PageHeader title="Rol de Monitor" subtitle="Monitor y guion de la reunión semanal" />

      <Card glow style={{ marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
          <div style={{ width:52, height:52, borderRadius:12, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>🎯</div>
          <div>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Monitor de turno · rota cada mes</div>
            <div style={{ fontFamily:font.body, fontSize:22, fontWeight:700, color:C.goldLight }}>{monitor ? (monitor.nombre || "— sin nombre") : "— sin líderes configurados"}</div>
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom:16 }}>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color:C.text, marginBottom:14 }}>Funciones del Monitor</div>
        <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12 }}>
          <div style={{ background:C.greenDim, border:`1px solid ${C.green}33`, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontFamily:font.body, fontSize:11, fontWeight:700, color:C.green, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>Sí hace</div>
            {siHace.map((t,i)=>(
              <div key={i} style={{ display:"flex", gap:8, marginBottom:i<siHace.length-1?9:0 }}>
                <span style={{ color:C.green, fontSize:12, flexShrink:0 }}>✓</span>
                <span style={{ fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.5 }}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{ background:C.redDim, border:`1px solid ${C.red}33`, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontFamily:font.body, fontSize:11, fontWeight:700, color:C.red, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>No hace</div>
            {noHace.map((t,i)=>(
              <div key={i} style={{ display:"flex", gap:8, marginBottom:i<noHace.length-1?9:0 }}>
                <span style={{ color:C.red, fontSize:12, flexShrink:0 }}>✕</span>
                <span style={{ fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.5 }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color:C.text, marginBottom:16 }}>Guion fijo de cada martes</div>
        {guion.map((m,i)=>(
          <div key={i} style={{ display:"flex", gap:14, marginBottom:i<guion.length-1?18:0 }}>
            <div style={{ width:26, height:26, borderRadius:99, background:C.gold, color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.mono, fontSize:12, fontWeight:700, flexShrink:0 }}>{i+1}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color:C.goldLight, marginBottom:6 }}>{m.t}</div>
              <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 12px" }}>
                {m.qs.map((q,j)=>(
                  <div key={j} style={{ fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.5, marginBottom:j<m.qs.length-1?6:0 }}>{q}</div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [documento,setDocumento]=useState(""),[pass,setPass]=useState(""),[err,setErr]=useState(""),[loading,setLoading]=useState(false);
  const docRef=useRef(null), passRef=useRef(null);

  // Solo acepta cambios que vengan de escritura real de teclado (letra por letra o
  // borrar). Si el cambio viene de pegar, arrastrar texto, o de que el navegador
  // autocompletó el campo solo, se ignora y se revierte al valor anterior.
  const soloTeclado = (valorActual, setValor) => (e) => {
    const tipo = e.nativeEvent && e.nativeEvent.inputType;
    const esEscrituraReal = tipo==="insertText" || tipo==="deleteContentBackward" || tipo==="deleteContentForward" || tipo==="deleteByCut" || tipo==="deleteWordBackward" || tipo==="deleteWordForward" || tipo==="historyUndo" || tipo==="historyRedo";
    if (esEscrituraReal) setValor(e.target.value);
    else e.target.value = valorActual;
  };
  const bloquear = (e) => e.preventDefault();
  // Detecta cuando Chrome/Safari rellenan el campo solos (el resaltado amarillo de
  // "autocompletar") y lo vacía de inmediato.
  const siAutocompletaLimpiar = (setValor) => () => setValor("");

  const handle=async(e)=>{
    if(e)e.preventDefault();
    if(!documento.trim()||!pass){setErr("Completa todos los campos.");return;}
    setLoading(true);setErr("");
    const{data}=await supabase.from("usuarios").select("*").eq("documento",documento.trim()).eq("password",pass).eq("active",true).single();
    if(!data){ setErr("Documento o contraseña incorrecta, o cuenta inactiva."); setLoading(false); return; }
    // Cuentas de tienda (login compartido): quedan autorizadas solo en el primer
    // dispositivo/navegador donde se usen. Si alguien intenta entrar desde otro
    // dispositivo, se bloquea hasta que un master la libere desde Usuarios.
    if(data.role==="tienda"){
      const storageKey = `ozen_device_${data.id}`;
      const miToken = localStorage.getItem(storageKey);
      if(data.device_token){
        if(miToken !== data.device_token){
          setErr("Esta cuenta de tienda ya está autorizada en otro dispositivo. Pide a un administrador que la libere desde Usuarios para poder entrar desde aquí.");
          setLoading(false);
          return;
        }
      } else {
        // Reclamo atómico: el update solo aplica si device_token SIGUE siendo null justo en
        // este instante. Si dos dispositivos llegan aquí casi al mismo tiempo (los dos ven
        // null antes de que el otro alcance a guardar), solo uno gana la carrera — el otro
        // queda sin filas afectadas y se bloquea, en vez de quedar ambos con sesión abierta.
        const nuevoToken = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const { data:actualizado, error:errorClaim } = await supabase.from("usuarios").update({ device_token:nuevoToken }).eq("id",data.id).is("device_token",null).select().single();
        if(!actualizado){
          // Si de verdad otro dispositivo ganó la carrera, esto es normal y no hay error.
          // Pero si "errorClaim" trae algo (permisos, RLS, etc.), es un problema distinto —
          // se muestra el detalle para poder diagnosticarlo en vez de confundirlo con el bloqueo.
          setErr(errorClaim ? `No se pudo vincular este dispositivo: ${errorClaim.message}` : "Esta cuenta de tienda ya está autorizada en otro dispositivo. Pide a un administrador que la libere desde Usuarios para poder entrar desde aquí.");
          setLoading(false);
          return;
        }
        localStorage.setItem(storageKey, nuevoToken);
        data.device_token = actualizado.device_token;
      }
    }
    onLogin(data);
    setLoading(false);
  };
  return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <style>{`
        @keyframes ozenNoAutofill { from {} to {} }
        input.ozen-anti-autofill:-webkit-autofill { animation-name: ozenNoAutofill; }
      `}</style>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <img src="/logo-horizontal.png" alt="OZEN" style={{width:300,height:"auto"}}/>
        </div>
        <Card glow>
          <form onSubmit={handle} autoComplete="off">
            <div style={{fontFamily:font.body,fontSize:17,fontWeight:600,color:C.text,marginBottom:18,textAlign:"center"}}>Iniciar sesión</div>

            {/* Campos señuelo ocultos: distraen al navegador para que no ofrezca
                guardar la contraseña de los campos reales de abajo */}
            <input type="text" name="username" autoComplete="username" style={{position:"absolute",width:1,height:1,opacity:0,pointerEvents:"none"}} tabIndex={-1} aria-hidden="true" />
            <input type="password" name="password" autoComplete="new-password" style={{position:"absolute",width:1,height:1,opacity:0,pointerEvents:"none"}} tabIndex={-1} aria-hidden="true" />

            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em", textAlign:"center" }}>N.º de documento</div>
              <input
                ref={docRef}
                className="ozen-anti-autofill"
                type="text"
                name="ozen_doc_x1"
                value={documento}
                placeholder="Número de documento"
                autoComplete="off"
                onChange={soloTeclado(documento, setDocumento)}
                onPaste={bloquear}
                onDrop={bloquear}
                onAnimationStart={siAutocompletaLimpiar(setDocumento)}
                style={{ width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}
              />
            </div>

            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em", textAlign:"center" }}>Contraseña</div>
              <input
                ref={passRef}
                className="ozen-anti-autofill"
                type="password"
                name="ozen_pwd_x1"
                value={pass}
                placeholder="••••••••"
                autoComplete="new-password"
                onChange={soloTeclado(pass, setPass)}
                onPaste={bloquear}
                onDrop={bloquear}
                onAnimationStart={siAutocompletaLimpiar(setPass)}
                style={{ width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}
              />
            </div>

            {err&&<div style={{background:C.redDim,border:`1px solid ${C.red}44`,borderRadius:7,padding:"9px 12px",color:C.red,fontSize:12,marginBottom:12,fontFamily:font.body}}>{err}</div>}
            <Btn disabled={loading} full style={{marginTop:4}}>{loading?"Verificando...":"Ingresar"}</Btn>
          </form>
        </Card>
        <div style={{textAlign:"center",marginTop:18,fontFamily:font.body,fontSize:10.5,color:C.textMuted,opacity:0.6}}>Creado por Santiago Rodríguez</div>
      </div>
    </div>
  );
}

// ── SELECTOR DE ÁREA (solo admin) ───────────────────────────────────────────
function AreaSelector({ user, onChoose, onLogout }) {
  const modulos = [
    { id:"junta", icon:"🗓️", titulo:"La Junta Administrativa", desc:"Equipo, seguimiento semanal y guion de la reunión", accent:C.goldLight, mostrar:true },
    { id:"asistencia", icon:"📋", titulo:"Registro de Asistencia", desc:"Panel, registros, turnos, asesores, tiendas e informes", accent:"#6ea8fe", mostrar:true },
    { id:"ventas", icon:"💰", titulo:"Ventas", desc:ventasSoloLectura(user) ? "Solo para ver — no se puede registrar ni corregir nada" : "Registro de ventas, metas y métricas por tienda", accent:C.green, mostrar:puedeUsarVentasArea(user) },
    { id:"firmas", icon:"✍️", titulo:"Firmar Documentos", desc:"Sube un PDF, ubica tu firma y descárgalo — nada queda guardado", accent:"#c084fc", mostrar:true },
  ].filter(m=>m.mostrar);
  return (
    <div style={{ minHeight:"100vh", background:`radial-gradient(1100px 520px at 50% -10%, ${C.goldLight}14, transparent 60%), ${C.dark}`, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <style>{`
        @keyframes ozenPopIn { from { opacity:0; transform:translateY(16px) scale(0.94); } to { opacity:1; transform:translateY(0) scale(1); } }
        .ozen-modulo-card { animation:ozenPopIn .48s cubic-bezier(.34,1.56,.64,1) both; transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .ozen-modulo-card:hover { transform:translateY(-3px) scale(1.01); }
        .ozen-modulo-card:active { transform:translateY(-1px) scale(0.995); }
        .ozen-modulo-arrow { transition:transform .18s ease, opacity .18s ease; opacity:0.4; }
        .ozen-modulo-card:hover .ozen-modulo-arrow { transform:translateX(4px); opacity:1; }
        .ozen-modulo-icon { transition:transform .18s ease; }
        .ozen-modulo-card:hover .ozen-modulo-icon { transform:scale(1.08) rotate(-2deg); }
      `}</style>
      <div style={{ width:"100%", maxWidth:540 }}>
        <div style={{ textAlign:"center", marginBottom:32, animation:"ozenPopIn .5s cubic-bezier(.34,1.56,.64,1) both" }}>
          <img src="/logo-horizontal.png" alt="OZEN" style={{ width:260, height:"auto", marginBottom:14 }} />
          <div style={{ fontFamily:font.body, fontSize:13.5, color:C.textMuted }}>Hola, {user.name.split(" ")[0]} — ¿qué quieres abrir?</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {modulos.map((m,i)=>(
            <button key={m.id} onClick={()=>onChoose(m.id)} className="ozen-modulo-card" style={{
              animationDelay:`${i*70}ms`, width:"100%", textAlign:"left", cursor:"pointer",
              background:`linear-gradient(135deg, ${C.surface}, ${C.surfaceAlt})`,
              border:`1px solid ${C.border}`, borderRadius:16, padding:"20px 22px",
              display:"flex", alignItems:"center", gap:18,
              boxShadow:`0 1px 2px rgba(0,0,0,0.2)`,
            }}>
              <div className="ozen-modulo-icon" style={{
                fontSize:26, flexShrink:0, width:52, height:52, borderRadius:14,
                display:"flex", alignItems:"center", justifyContent:"center",
                background:`linear-gradient(135deg, ${hexToRgba(m.accent,0.22)}, ${hexToRgba(m.accent,0.06)})`,
                border:`1px solid ${hexToRgba(m.accent,0.35)}`,
              }}>{m.icon}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:font.body, fontSize:15.5, fontWeight:700, color:m.accent }}>{m.titulo}</div>
                <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:3 }}>{m.desc}</div>
              </div>
              <div className="ozen-modulo-arrow" style={{ fontSize:18, color:m.accent, flexShrink:0 }}>→</div>
            </button>
          ))}
        </div>
        <div style={{ textAlign:"center", marginTop:24 }}>
          <Btn onClick={onLogout} variant="ghost" sm>Cerrar sesión</Btn>
        </div>
      </div>
    </div>
  );
}


// ── FIRMAS: un cuadro de firma arrastrable/redimensionable sobre la página del PDF ──
function FirmaOverlay({ placement, tamPagina, firmaSrc, aspecto, onChange, onRemove }) {
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const anchoPx = placement.widthPct * tamPagina.w;
  const altoPx = anchoPx * aspecto;
  const leftPx = placement.xPct * tamPagina.w;
  const topPx = placement.yPct * tamPagina.h;

  const onDragStart = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: leftPx, origY: topPx };
  };
  const onDragMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY;
    let nx = Math.max(0, Math.min(tamPagina.w - anchoPx, dragRef.current.origX + dx));
    let ny = Math.max(0, Math.min(tamPagina.h - altoPx, dragRef.current.origY + dy));
    onChange({ ...placement, xPct: nx / tamPagina.w, yPct: ny / tamPagina.h });
  };
  const onDragEnd = () => { dragRef.current = null; };

  const onResizeStart = (e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { startX: e.clientX, startWidth: anchoPx };
  };
  const onResizeMove = (e) => {
    if (!resizeRef.current) return;
    const dx = e.clientX - resizeRef.current.startX;
    const nuevoAncho = Math.max(36, Math.min(tamPagina.w - leftPx, resizeRef.current.startWidth + dx));
    onChange({ ...placement, widthPct: nuevoAncho / tamPagina.w });
  };
  const onResizeEnd = () => { resizeRef.current = null; };

  return (
    <div
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      style={{ position: "absolute", left: leftPx, top: topPx, width: anchoPx, height: altoPx, cursor: "move", touchAction: "none" }}
    >
      <img src={firmaSrc} draggable={false} style={{ width: "100%", height: "100%", pointerEvents: "none", userSelect: "none" }} />
      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        title="Arrastra para cambiar el tamaño"
        style={{ position: "absolute", right: -7, bottom: -7, width: 15, height: 15, borderRadius: "50%", background: C.gold, border: "2px solid #fff", cursor: "nwse-resize", touchAction: "none" }}
      />
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(placement.id); }}
        title="Quitar esta firma"
        style={{ position: "absolute", top: -10, right: -10, width: 18, height: 18, borderRadius: "50%", background: C.red, color: "#fff", border: "2px solid #fff", fontSize: 10, lineHeight: "14px", cursor: "pointer", padding: 0 }}
      >×</button>
    </div>
  );
}

// ── FIRMAS: dibujar la firma en el momento — vive solo en memoria del navegador,
// nunca se envía ni se guarda en ningún lado (ni Supabase ni localStorage). Se pierde
// al recargar o salir de la pantalla, por diseño — es exclusivamente para ese documento.
function FirmaPadModal({ onListo, onCancelar }) {
  const canvasRef = useRef(null);
  const dibujando = useRef(false);
  const [tieneTrazo, setTieneTrazo] = useState(false);

  const posDesdeEvento = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };
  const onDown = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const { x, y } = posDesdeEvento(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const onMove = (e) => {
    if (!dibujando.current) return;
    const { x, y } = posDesdeEvento(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = "#15202b"; ctx.lineWidth = 2.8; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.lineTo(x, y); ctx.stroke();
    setTieneTrazo(true);
  };
  const onUp = () => { dibujando.current = false; };
  const limpiar = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setTieneTrazo(false);
  };
  // Recorta al recuadro real del trazo (por canal alfa) para que la firma no quede con
  // un montón de espacio transparente alrededor.
  const recortarYUsar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width, minY = height, maxX = 0, maxY = 0, tiene = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 10) {
          tiene = true;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (!tiene) return;
    const pad = 6;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    onListo(out.toDataURL("image/png"));
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <Card glow style={{ maxWidth: 400, width: "100%" }}>
        <div style={{ fontFamily: font.body, fontSize: 13, fontWeight: 700, color: C.goldLight, marginBottom: 4 }}>Dibuja tu firma</div>
        <div style={{ fontFamily: font.body, fontSize: 11.5, color: C.textMuted, marginBottom: 10 }}>Es solo para este documento — no se guarda en ningún lado, ni siquiera aquí. Al salir de esta pantalla desaparece.</div>
        <canvas
          ref={canvasRef}
          width={340}
          height={150}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          style={{ width: "100%", height: 150, background: "#fff", borderRadius: 10, border: `1px solid ${C.border}`, touchAction: "none", cursor: "crosshair", display: "block" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Btn onClick={recortarYUsar} disabled={!tieneTrazo} full>Usar esta firma</Btn>
          <Btn onClick={limpiar} variant="ghost" full>Borrar</Btn>
          <Btn onClick={onCancelar} variant="ghost" full>Cancelar</Btn>
        </div>
      </Card>
    </div>
  );
}

// ── FIRMAS: subir un PDF, dibujar la firma ahí mismo y descargar — nada se sube ni se guarda ──
function FirmarDocumentoScreen() {
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfBytesFinalRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPaginas, setNumPaginas] = useState(0);
  const [paginaActual, setPaginaActual] = useState(0);
  const [tamPagina, setTamPagina] = useState({ w: 0, h: 0 });
  const [firmas, setFirmas] = useState([]);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  // La firma dibujada vive solo en memoria de este componente (useState normal, sin
  // Supabase ni localStorage) — se pierde al salir de la pantalla, por diseño.
  const [firmaSesion, setFirmaSesion] = useState(null);
  const [aspecto, setAspecto] = useState(0.35);
  const [dibujando, setDibujando] = useState(false);
  const [err, setErr] = useState("");

  const renderPagina = useCallback(async (doc, num) => {
    if (!doc || !canvasRef.current) return;
    const page = await doc.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const contW = containerRef.current?.clientWidth || 640;
    const scale = Math.min((contW - 32) / base.width, 1.6);
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    setTamPagina({ w: viewport.width, h: viewport.height });
  }, []);

  useEffect(() => { if (pdfDoc) renderPagina(pdfDoc, paginaActual + 1); }, [pdfDoc, paginaActual, renderPagina]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(""); setCargando(true); setFirmas([]); setPdfDoc(null);
    try {
      const buf = await file.arrayBuffer();
      const paraVer = new Uint8Array(buf.slice(0));
      pdfBytesFinalRef.current = new Uint8Array(buf.slice(0));
      const doc = await pdfjsLib.getDocument({ data: paraVer }).promise;
      setNumPaginas(doc.numPages);
      setPaginaActual(0);
      setNombreArchivo(file.name);
      setPdfDoc(doc);
    } catch (e2) {
      setErr("No se pudo abrir ese PDF. Verifica que el archivo no esté dañado.");
    }
    setCargando(false);
    e.target.value = "";
  };

  const agregarPlacement = (src) => {
    const img = new Image();
    img.onload = () => {
      setAspecto(img.naturalHeight / img.naturalWidth);
      setFirmas(prev => [...prev, { id: Date.now() + Math.random(), pageIndex: paginaActual, xPct: 0.6, yPct: 0.78, widthPct: 0.22 }]);
    };
    img.src = src;
  };
  const agregarFirma = () => {
    if (!firmaSesion) { setDibujando(true); return; }
    agregarPlacement(firmaSesion);
  };
  const onFirmaLista = (dataUrl) => {
    setFirmaSesion(dataUrl);
    setDibujando(false);
    agregarPlacement(dataUrl);
  };
  const actualizarFirma = (nueva) => setFirmas(prev => prev.map(f => f.id === nueva.id ? nueva : f));
  const quitarFirma = (id) => setFirmas(prev => prev.filter(f => f.id !== id));

  const descargar = async () => {
    if (!pdfBytesFinalRef.current || firmas.length === 0 || !firmaSesion) return;
    setDescargando(true);
    try {
      const doc = await PDFDocument.load(pdfBytesFinalRef.current);
      const png = await doc.embedPng(firmaSesion);
      const paginas = doc.getPages();
      firmas.forEach(f => {
        const pagina = paginas[f.pageIndex];
        if (!pagina) return;
        const { width, height } = pagina.getSize();
        const imgW = f.widthPct * width;
        const imgH = imgW * aspecto;
        pagina.drawImage(png, { x: f.xPct * width, y: height - f.yPct * height - imgH, width: imgW, height: imgH });
      });
      const bytes = await doc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `firmado-${nombreArchivo || "documento.pdf"}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e2) {
      alert(`No se pudo generar el PDF firmado: ${e2.message}`);
    }
    setDescargando(false);
  };

  const firmasPagina = firmas.filter(f => f.pageIndex === paginaActual);

  return (
    <div>
      {dibujando && <FirmaPadModal onListo={onFirmaLista} onCancelar={() => setDibujando(false)} />}
      <PageHeader title="Firmar documento" subtitle="Firma exclusiva para este documento — no se sube ni se guarda en ningún lado" />
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: `${C.gold}12`, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 16, lineHeight: 1 }}>🔒</div>
        <div style={{ fontFamily: font.body, fontSize: 12, color: C.textSub, lineHeight: 1.55 }}>
          <strong style={{ color: C.text }}>Este PDF y tu firma se procesan solo en tu navegador.</strong> No se suben ni se guardan en ningún servidor ni base de datos — nadie más los ve. La firma que dibujas es exclusiva para este documento: no queda asociada a tu usuario, no se puede reutilizar después, y desaparece por completo si recargas la página o sales de esta pantalla. Lo único que se genera es el PDF firmado que tú mismo descargas al final.
        </div>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFile} style={{ display: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Btn onClick={() => fileInputRef.current?.click()} variant={pdfDoc ? "ghost" : "primary"}>{pdfDoc ? "Cambiar PDF" : "Subir PDF"}</Btn>
          {firmaSesion && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", borderRadius: 8, padding: "4px 10px" }}>
              <img src={firmaSesion} alt="Tu firma" style={{ height: 26, display: "block" }} />
              <button onClick={() => setDibujando(true)} title="Redibujar firma" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0 }}>✏️</button>
            </div>
          )}
        </div>
        {nombreArchivo && <span style={{ marginTop: 8, display: "inline-block", fontFamily: font.body, fontSize: 12, color: C.textMuted }}>{nombreArchivo}</span>}
        {cargando && <span style={{ marginLeft: 10, fontFamily: font.body, fontSize: 12, color: C.textMuted }}>Abriendo...</span>}
        {err && <div style={{ marginTop: 10, fontFamily: font.body, fontSize: 12, color: C.red }}>{err}</div>}
      </Card>

      {pdfDoc && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <Btn onClick={() => setPaginaActual(p => Math.max(0, p - 1))} variant="ghost" sm disabled={paginaActual === 0}>← Anterior</Btn>
            <div style={{ fontFamily: font.body, fontSize: 12.5, color: C.text }}>Página {paginaActual + 1} de {numPaginas}</div>
            <Btn onClick={() => setPaginaActual(p => Math.min(numPaginas - 1, p + 1))} variant="ghost" sm disabled={paginaActual >= numPaginas - 1}>Siguiente →</Btn>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <Btn onClick={agregarFirma} variant="success" sm>+ {firmaSesion ? "Agregar firma aquí" : "Dibujar y agregar firma"}</Btn>
              <Btn onClick={descargar} disabled={firmas.length === 0 || descargando} sm>{descargando ? "Generando..." : "⬇ Descargar PDF firmado"}</Btn>
            </div>
          </div>
          <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted, marginBottom: 10 }}>
            Arrastra la firma para ubicarla y usa el punto dorado de la esquina para cambiar su tamaño.
            {firmasPagina.length > 0 ? ` ${firmasPagina.length} firma(s) en esta página.` : ""}
            {firmas.length > firmasPagina.length ? ` ${firmas.length} en total.` : ""}
          </div>
          <div ref={containerRef} style={{ overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 10, background: "#525659", padding: 16, textAlign: "center" }}>
            <div style={{ position: "relative", display: "inline-block", width: tamPagina.w || "auto", height: tamPagina.h || "auto" }}>
              <canvas ref={canvasRef} style={{ display: "block", boxShadow: "0 2px 10px rgba(0,0,0,0.4)" }} />
              {firmasPagina.map(f => (
                <FirmaOverlay key={f.id} placement={f} tamPagina={tamPagina} firmaSrc={firmaSesion} aspecto={aspecto} onChange={actualizarFirma} onRemove={quitarFirma} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── CAMBIAR MI CONTRASEÑA (autoservicio, cualquier rol) ─────────────────────
function CambiarPasswordForm({ user, onUpdated, onCancel, obligatorio }) {
  const [actual,setActual]=useState("");
  const [nueva,setNueva]=useState("");
  const [confirmar,setConfirmar]=useState("");
  const [err,setErr]=useState("");
  const [ok,setOk]=useState(false);
  const [loading,setLoading]=useState(false);

  const guardar = async () => {
    setErr("");
    if(!actual||!nueva||!confirmar){ setErr("Completa todos los campos."); return; }
    if(nueva.length<4){ setErr("La contraseña nueva debe tener al menos 4 caracteres."); return; }
    if(nueva!==confirmar){ setErr("La nueva contraseña no coincide en los dos campos."); return; }
    if(nueva===actual){ setErr("La contraseña nueva debe ser diferente a la actual."); return; }
    setLoading(true);
    const { data:chk } = await supabase.from("usuarios").select("id").eq("id",user.id).eq("password",actual).single();
    if(!chk){ setErr("La contraseña actual no es correcta."); setLoading(false); return; }
    const { data, error } = await supabase.from("usuarios").update({ password:nueva, password_updated_at:new Date().toISOString() }).eq("id",user.id).select().single();
    setLoading(false);
    if(error||!data){ setErr("No se pudo actualizar. Intenta de nuevo."); return; }
    setOk(true);
    setTimeout(()=>onUpdated(data), 600);
  };

  return (
    <Card glow style={{ maxWidth:380, width:"100%" }}>
      <div style={{ fontFamily:font.body, fontSize:17, fontWeight:600, color:C.text, marginBottom:6 }}>Cambiar mi contraseña</div>
      {obligatorio && <div style={{ background:`${C.amber}10`, border:`1px solid ${C.amber}44`, borderRadius:8, padding:"10px 12px", marginBottom:14, fontFamily:font.body, fontSize:11, color:C.amber }}>⚠️ Por seguridad, debes actualizar tu contraseña antes de continuar. Ya pasaron {DIAS_EXPIRACION_PASSWORD} días o más desde el último cambio.</div>}
      <Field label="Contraseña actual" type="password" value={actual} onChange={setActual} placeholder="••••••••" autoComplete="off"/>
      <Field label="Contraseña nueva" type="password" value={nueva} onChange={setNueva} placeholder="••••••••" autoComplete="new-password"/>
      <Field label="Confirmar contraseña nueva" type="password" value={confirmar} onChange={setConfirmar} placeholder="••••••••" autoComplete="new-password"/>
      {err && <div style={{background:C.redDim,border:`1px solid ${C.red}44`,borderRadius:7,padding:"9px 12px",color:C.red,fontSize:12,marginBottom:12,fontFamily:font.body}}>{err}</div>}
      {ok && <div style={{background:`${C.green}18`,border:`1px solid ${C.green}44`,borderRadius:7,padding:"9px 12px",color:C.green,fontSize:12,marginBottom:12,fontFamily:font.body}}>Contraseña actualizada ✓</div>}
      <div style={{ display:"flex", gap:8 }}>
        <Btn onClick={guardar} disabled={loading||ok} full>{loading?"Guardando...":"Guardar contraseña"}</Btn>
        {!obligatorio && <Btn onClick={onCancel} variant="ghost" full>Cancelar</Btn>}
      </div>
    </Card>
  );
}

// ── VENTAS ────────────────────────────────────────────────────────────────────
// Tiendas que sí venden (excluye lugares como la oficina, que no procesan ventas).
// Se controla con el switch "Vende" en la pantalla de Tiendas.
const tiendasVenta = (stores) => Object.values(stores).filter(s=>s.vende!==false);
const VENTAS_MEDIOS_PAGO = [
  { value:"efectivo", label:"Efectivo" },
  { value:"tarjeta", label:"Tarjeta (débito/crédito)" },
  { value:"transferencia", label:"Transferencia" },
  { value:"addi", label:"ADDI" },
];
const VENTAS_MEDIOS_TARJETA = ["tarjeta"];
// Flexipago ya no es un medio de pago: es su propio Tipo. Este alias se deja
// porque se usa para elegir el medio de los abonos (que sí ingresan dinero real).
const VENTAS_MEDIOS_REALES = VENTAS_MEDIOS_PAGO;
// Un abono puede pagarse con varios medios a la vez (ej. mitad efectivo, mitad tarjeta) — se
// guarda en `pagos` (igual que los renglones de venta). Los abonos de antes de este cambio solo
// tienen un medio único en las columnas `medio_pago`/`valor`/`numero_autorizacion`; este helper
// normaliza cualquier abono (viejo o nuevo) a una lista de {medio_pago, valor, numero_autorizacion}
// para que todo el resto del código (Caja, recibos, badges) no tenga que preguntar cuál es cuál.
const mediosDeAbono = (a) => (a && a.pagos && a.pagos.length)
  ? a.pagos
  : [{ medio_pago:a?.medio_pago, valor:a?.valor, numero_autorizacion:a?.numero_autorizacion }];
const textoMediosAbono = (a) => mediosDeAbono(a).map(p=>`${VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label||p.medio_pago}${p.numero_autorizacion?` (AUT ${p.numero_autorizacion})`:""}`).join(" + ");

const VENTAS_TIPOS = [
  { value:"producto", label:"Venta" },
  { value:"arreglo", label:"Arreglo" },
  { value:"marcacion", label:"Marcación" },
  { value:"grabado", label:"Grabado" },
  { value:"flexipago", label:"Flexipago" },
];
const VENTAS_TIPO_ICONOS = { producto:"🛍️", arreglo:"🔧", marcacion:"🖊️", grabado:"✒️", flexipago:"📦" };
const VENTAS_TIPO_COLORES = { producto:C.blue, arreglo:C.amber, marcacion:C.blue, grabado:C.blue, flexipago:C.gold };
const VENTAS_MEDIO_ICONOS = { efectivo:"💵", tarjeta:"💳", transferencia:"🏦", addi:"📱" };
const VENTAS_DESCUENTO_TIPOS = [
  { value:"valor", label:"$" },
  { value:"porcentaje", label:"%" },
];

const SeccionVenta = ({ icon, titulo, subtitulo, children }) => (
  <Card style={{ marginBottom:16 }}>
    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
      <div style={{ width:36, height:36, borderRadius:9, background:`${C.gold}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{icon}</div>
      <div>
        <div style={{ fontFamily:font.body, fontSize:12, fontWeight:700, color:C.goldLight, textTransform:"uppercase", letterSpacing:"0.05em" }}>{titulo}</div>
        {subtitulo && <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:1 }}>{subtitulo}</div>}
      </div>
    </div>
    {children}
  </Card>
);

const VENTAS_TIPOS_DOC = [{value:"CC",label:"CC"},{value:"CE",label:"CE"},{value:"TI",label:"TI"},{value:"NIT",label:"NIT"},{value:"PA",label:"PA"},{value:"PPT",label:"PPT"}];

// Reglas del plan Flexipago — se muestran tal cual al crear la venta y en el recibo para imprimir.
const FLEXIPAGO_AVISO_TITULO = "AVISO LEGAL – PLAN FLEXIPAGO";
const FLEXIPAGO_PLAZO_DIAS = 60;
// El texto es tal cual el aviso legal — el título/número en negrilla es solo para que se lea más fácil.
const FLEXIPAGO_AVISO_ITEMS = [
  { texto:"El presente documento corresponde a un acuerdo de separación o reserva de producto. Al realizar el pago inicial, el cliente declara haber leído y aceptado las condiciones aquí establecidas." },
  { n:1, titulo:"Plazo", texto:`El cliente dispone de un plazo máximo de sesenta (${FLEXIPAGO_PLAZO_DIAS}) días calendario contados a partir de la fecha del primer abono para cancelar la totalidad del valor del producto.` },
  { n:2, titulo:"Pago total", texto:"El producto será entregado únicamente una vez se haya efectuado el pago completo del valor acordado." },
  { n:3, titulo:"Incumplimiento", texto:"En caso de no completarse el pago dentro del plazo establecido, el establecimiento podrá dar por terminado el acuerdo y disponer libremente del producto. Los valores abonados podrán ser retenidos total o parcialmente a título de compensación por gastos administrativos y perjuicios." },
  { n:4, titulo:"Cambios y devoluciones", texto:"Aplican las políticas del establecimiento y lo dispuesto en la Ley 1480 de 2011 (Estatuto del Consumidor)." },
  { n:5, titulo:"Aceptación", texto:"El pago realizado constituye aceptación expresa de las condiciones del presente acuerdo." },
  { texto:"Este acuerdo se rige por las normas comerciales y civiles vigentes en Colombia." },
];

// Flexipagos abiertos de una tienda que están vencidos, urgentes (5 días o menos) o a mitad de
// plazo (30+ días) — mismos umbrales que ya se usan en la tarjeta de cada venta (VentaCard), acá
// solo se recopilan en una lista para poder avisar de todos de una, sin tener que buscarlos uno
// por uno en Lista de ventas. Ordenados: vencidos primero, luego por menos días restantes.
const flexipagosPorVencer = (tiendaId, ventas, ventasItems, ventasAbonos, todayStr) => {
  const items = [];
  (ventas||[]).filter(v=>v.es_flexipago && v.tienda_id===tiendaId).forEach(v=>{
    const abonosVenta = (ventasAbonos||[]).filter(a=>a.venta_id===v.id).sort((p,q)=> new Date(p.created_at||p.fecha) - new Date(q.created_at||q.fecha) || String(p.id).localeCompare(String(q.id)));
    const totalAbonado = abonosVenta.reduce((a,x)=>a+Number(x.valor||0),0);
    const valorFlexipago = (ventasItems||[]).filter(i=>i.venta_id===v.id && i.tipo==="flexipago").reduce((a,i)=>a+Number(i.valor||0)-Number(i.descuento||0),0);
    const saldoPendiente = valorFlexipago - totalAbonado;
    if(saldoPendiente<=0) return; // ya completo
    const primerAbonoFecha = abonosVenta.length>0 ? abonosVenta[0].fecha : null;
    const diasDesdeAbono = primerAbonoFecha ? diasEntre(primerAbonoFecha, todayStr) : null;
    const fechaLimite = primerAbonoFecha ? sumarDias(primerAbonoFecha, FLEXIPAGO_PLAZO_DIAS) : null;
    const vencido = diasDesdeAbono!==null && diasDesdeAbono>FLEXIPAGO_PLAZO_DIAS && !v.flexipago_reabierto_en;
    const diasRestantes60 = diasDesdeAbono!==null ? FLEXIPAGO_PLAZO_DIAS - diasDesdeAbono : null;
    const urgente = !vencido && diasRestantes60!==null && diasRestantes60<=5;
    const aviso30 = !vencido && !urgente && diasDesdeAbono!==null && diasDesdeAbono>=30;
    if(!vencido && !urgente && !aviso30) return;
    items.push({ venta:v, saldoPendiente, diasRestantes60, vencido, urgente, aviso30, fechaLimite });
  });
  items.sort((a,b)=> a.vencido!==b.vencido ? (a.vencido?-1:1) : (a.diasRestantes60??999)-(b.diasRestantes60??999));
  return items;
};

// Tarjeta de un registro de Nota crédito (el "espejo" del excedente, con su propio N.º de
// factura) — usada tanto en "Ventas de hoy" como en "Lista de ventas". En Lista de ventas es
// desplegable: colapsada solo muestra la etiqueta "🧾 Notacrédito" (para identificarla a simple
// vista), y el tipo/medio de pago y de qué factura original viene solo se ven al abrirla — con la
// misma estructura y paddings de una tarjeta de venta normal, para que todos los registros de la
// lista tengan el mismo grosor. En Ventas de hoy no se despliega: se ve todo de una, igual que
// las demás tarjetas de esa pantalla (que tampoco se despliegan).
function NotaCreditoCard({ ajuste, venta, ventasItems, desplegable = true }) {
  const [abierto, setAbierto] = useState(false);
  const valorOriginalFactura = Number(venta.valor_original ?? venta.total);
  // El o los renglones que componen ESTA Notacrédito específica: los que quedaron marcados como
  // no-originales con la fecha real de este ajuste.
  const itemsDelAjuste = (ventasItems||[]).filter(i=>i.venta_id===ajuste.venta_id && i.es_original===false && i.fecha_item===ajuste.fecha);
  const tiposRaw = [...new Set(itemsDelAjuste.map(i=>i.tipo))];
  const tiposTexto = tiposRaw.map(t=>VENTAS_TIPOS.find(x=>x.value===t)?.label||t).join(", ");
  const mediosTexto = [...new Set(itemsDelAjuste.flatMap(i=>(i.pagos||[]).map(p=>VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label||p.medio_pago)))].join(", ");
  const tipoColor = VENTAS_TIPO_COLORES[tiposRaw[0]] || C.blue;
  const tipoIcon = VENTAS_TIPO_ICONOS[tiposRaw[0]] || "🛍️";
  const medioIcon = VENTAS_MEDIO_ICONOS[itemsDelAjuste[0]?.pagos?.[0]?.medio_pago] || "💰";

  const infoFacturaOriginal = (
    <div style={{ fontFamily:font.body, fontSize:11.5, color:C.textMuted, lineHeight:1.5 }}>
      Viene de una Nota crédito sobre la factura original <strong style={{ color:C.text }}>#{venta.numero_factura||"—"}</strong> del {venta.fecha} — valor original de esa factura: <strong style={{ color:C.text }}>${valorOriginalFactura.toLocaleString("es-CO")}</strong>.
    </div>
  );

  if(!desplegable){
    return (
      <Card p="10px 14px" style={{ borderLeft:`3px solid ${tipoColor}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"baseline", gap:6, overflow:"hidden" }}>
            <span style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, flexShrink:0 }}>{ajuste.numero_factura?`#${ajuste.numero_factura}`:"—"}</span>
            <span style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              {venta.vendedor_nombre}{venta.cliente_nombre?` · ${venta.cliente_nombre}`:""}
            </span>
          </div>
          {tiposTexto && <Badge color={tipoColor} sm title={tiposTexto}>{tipoIcon} {tiposTexto}</Badge>}
          {mediosTexto && <Badge color={C.blue} sm title={mediosTexto}>{medioIcon} {mediosTexto}</Badge>}
          <Badge color={C.amber} sm>🧾 Notacrédito</Badge>
          <div style={{ fontFamily:font.mono, fontSize:15, fontWeight:700, color:C.goldLight, flexShrink:0 }}>${Number(ajuste.diferencia||0).toLocaleString("es-CO")}</div>
        </div>
        <div style={{ marginTop:5 }}>{infoFacturaOriginal}</div>
      </Card>
    );
  }

  return (
    <Card p="0" style={{ overflow:"hidden" }}>
      <button onClick={()=>setAbierto(a=>!a)} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"7px 12px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", textAlign:"left" }}>
        <Badge color={C.blue} sm>{ajuste.numero_factura?`#${ajuste.numero_factura}`:"—"}</Badge>
        <div style={{ flex:1, minWidth:140, minHeight:30, display:"flex", alignItems:"center", overflow:"hidden" }}>
          <span style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {venta.vendedor_nombre}{venta.cliente_nombre?` · ${venta.cliente_nombre}`:""}
          </span>
        </div>
        <Badge color={C.amber} sm>🧾 Notacrédito</Badge>
        <div style={{ fontFamily:font.mono, fontSize:15, fontWeight:700, color:C.goldLight, flexShrink:0 }}>${Number(ajuste.diferencia||0).toLocaleString("es-CO")}</div>
        <span style={{ color:C.textMuted, fontSize:11, flexShrink:0 }}>{abierto?"▲":"▼"}</span>
      </button>
      <Collapse open={abierto}>
        <div style={{ padding:"0 12px 12px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", margin:"8px 0" }}>
            {tiposTexto && <Badge color={tipoColor} sm title={tiposTexto}>{tipoIcon} {tiposTexto}</Badge>}
            {mediosTexto && <Badge color={C.blue} sm title={mediosTexto}>{medioIcon} {mediosTexto}</Badge>}
          </div>
          {infoFacturaOriginal}
        </div>
      </Collapse>
    </Card>
  );
}

// Tarjeta simple (no editable) para un abono de Flexipago que entró en un día distinto al de la
// venta original — mismo caso que ya se resolvía en "Ventas de hoy" (VentasRegistrarScreen): el
// dinero se recibió ese día aunque la factura se haya creado antes, así que en Lista de ventas
// filtrada por esa fecha también debe aparecer un registro (antes solo se veía en Caja).
function AbonoFlexipagoCard({ venta, abonos }) {
  const totalDia = abonos.reduce((s,a)=>s+Number(a.valor||0),0);
  const mediosTexto = [...new Set(abonos.flatMap(a=>mediosDeAbono(a).map(p=>VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label||p.medio_pago)))].join(", ");
  return (
    <Card p="10px 14px" style={{ borderLeft:`3px solid ${C.blue}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"baseline", gap:6, overflow:"hidden" }}>
          <span style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, flexShrink:0 }}>{venta.numero_factura?`#${venta.numero_factura}`:"—"}</span>
          <span style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {venta.vendedor_nombre}{venta.cliente_nombre?` · ${venta.cliente_nombre}`:""}
          </span>
        </div>
        {mediosTexto && <Badge color={C.blue} sm>{mediosTexto}</Badge>}
        <Badge color={C.blue} sm>💳 Abono Flexipago</Badge>
        <div style={{ fontFamily:font.mono, fontSize:15, fontWeight:700, color:C.goldLight, flexShrink:0 }}>${totalDia.toLocaleString("es-CO")}</div>
      </div>
      <div style={{ marginTop:5, fontFamily:font.body, fontSize:11.5, color:C.textMuted, lineHeight:1.5 }}>
        Abono a un Flexipago de la factura <strong style={{ color:C.text }}>#{venta.numero_factura||"—"}</strong> del {venta.fecha}.
      </div>
    </Card>
  );
}

// Tarjeta completa de una venta: header desplegable + detalle con toda la edición (Notacrédito
// Siigo, Corregir factura, abonos, corrección de medio de pago, solicitudes, borrar, reabrir
// Flexipago vencido). Es el MISMO componente en Lista de ventas y en "Ventas de hoy" — así ambos
// lados se ven y funcionan exactamente igual, con detalle desplegable al hacer click en los dos.
function VentaCard({ venta, stores, user, esAdmin, soloLectura, isMobile, setVentas, ventasItems, setVentasItems, ventasAbonos, setVentasAbonos, ajustes, setAjustes }) {
  const v = venta; // alias — el resto de esta lógica viene tal cual de Lista de ventas

  const [expandido, setExpandido] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const d = detalle;

  const [mostrarSolicitud, setMostrarSolicitud] = useState(false);
  const [motivoSolicitud, setMotivoSolicitud] = useState("");

  const [editando, setEditando] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [editItemTipo, setEditItemTipo] = useState("producto");
  const [editItemValor, setEditItemValor] = useState("");
  const [editItemDescuento, setEditItemDescuento] = useState("");
  const [editItemDescuentoTipo, setEditItemDescuentoTipo] = useState("valor");
  const [editItemPagos, setEditItemPagos] = useState([]); // [{medio_pago, valor, numero_autorizacion}]
  const [editItemMedioNuevo, setEditItemMedioNuevo] = useState("");
  // Nota crédito: fecha real de un renglón nuevo (excedente) que se está agregando o editando —
  // en un renglón original la fecha queda fija (la de la venta), no aplica este campo.
  const [editItemFecha, setEditItemFecha] = useState(todayStr);
  // null = componiendo un renglón nuevo para agregar; número = editando en el puesto ese índice
  // de editItems (reemplaza en vez de agregar al guardar).
  const [editingItemIdx, setEditingItemIdx] = useState(null);
  const [editObservacion, setEditObservacion] = useState("");
  const [editNumeroFactura, setEditNumeroFactura] = useState("");

  // Notacrédito aprobada (no confundir con "corregir por error", que sigue siendo libre): el
  // piso es siempre venta.valor_original — el nuevo valor nunca puede quedar por debajo de eso.
  const [ncItems, setNcItems] = useState([]); // venta normal: [{id, tipo, valor, descuento}]
  const [ncCliente, setNcCliente] = useState({ tipoDoc:"CC", documento:"", nombre:"", telefono:"" }); // flexipago
  const [ncCodigos, setNcCodigos] = useState([{ codigo:"", valor:"" }]); // flexipago
  const [ncAbonoMedio, setNcAbonoMedio] = useState("efectivo"); // flexipago
  // Fecha real del excedente/ajuste (puede ser distinta a hoy: ej. dinero que entró hace unos
  // días y se está registrando apenas ahora). Solo master/admin_finanzas pueden cambiarla —
  // igual que con abonoFecha — el resto siempre queda con la fecha de hoy.
  const [ajusteFecha, setAjusteFecha] = useState(todayStr);
  const puedeEditarFechaAjuste = ["master","admin_finanzas"].includes(user.role);

  // Cambio de producto, mismo valor: para Siigo ESTO ES una Notacrédito (mismo mecanismo, genera
  // un N.º de factura nuevo), así que vive DENTRO del flujo de "Notacrédito Siigo" — un check que
  // simplifica el formulario porque acá no hay nada que editar en los renglones (mismo valor, no
  // cambia ni el total ni los medios de pago). No toca ni la venta ni ventas_items — es un registro
  // puramente informativo (tabla ventas_ajustes, es_cambio_producto) para poder contrastar contra
  // Siigo: aparece en la factura original y en el Cierre de caja del día, sin sumar ni restar nada
  // de Ventas/Ingreso.
  const [modoCambioProducto, setModoCambioProducto] = useState(false);
  const [ccFecha, setCcFecha] = useState(todayStr);
  const [ccNumeroFactura, setCcNumeroFactura] = useState("");
  const [ccGuardando, setCcGuardando] = useState(false);
  // El valor es siempre el de la factura (mismo valor, por definición) — no se pregunta, se toma
  // directo de lo ya registrado.
  const guardarCambioProducto = async () => {
    const valorNum = Number(v.valor_original ?? v.total ?? 0);
    if(valorNum<=0 || !ccNumeroFactura.trim()) return;
    setCcGuardando(true);
    const { data, error } = await supabase.from("ventas_ajustes").insert({
      // valor_anterior/valor_nuevo no pueden ser null en la tabla — como es "mismo valor", los dos
      // quedan iguales (sin diferencia real, diferencia:0).
      venta_id:v.id, fecha:ccFecha, valor_anterior:valorNum, valor_nuevo:valorNum, diferencia:0,
      motivo:"Cambio de producto, mismo valor", aplicado_por:user.name,
      es_correccion_error:false, es_cambio_producto:true, valor_informativo:valorNum,
      numero_factura:ccNumeroFactura.trim(),
    }).select().single();
    setCcGuardando(false);
    if(data){
      setAjustes(prev=>[...prev, data]);
      setCcNumeroFactura(""); setCcFecha(todayStr);
      setModoCambioProducto(false); setEditando(false); setModoErrorId(false);
    }
    else if(error){ alert(`No se pudo guardar: ${error.message}`); }
  };

  const [abonoForm, setAbonoForm] = useState(false);
  const [abonoValor, setAbonoValor] = useState("");
  // Un abono se puede dividir entre varios medios de pago (ej. mitad efectivo, mitad tarjeta) —
  // mismo patrón que los medios de pago de un renglón de venta (itemPagos): se van agregando
  // renglones de {medio_pago, valor, numero_autorizacion} y deben sumar el "Valor del abono".
  const [abonoPagos, setAbonoPagos] = useState([]);
  const [abonoMedioNuevo, setAbonoMedioNuevo] = useState("");
  // Solo master/admin_finanzas pueden cambiar la fecha del abono (para registrar abonos
  // atrasados con su fecha real) — el resto siempre abona con la fecha de hoy.
  const [abonoFecha, setAbonoFecha] = useState(todayStr);
  const [guardando, setGuardando] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState("");

  // Dos botones, dos cosas distintas:
  // - "Notacrédito Siigo": cuando la corrección SÍ genera un número de factura nuevo en Siigo —
  //   tiene piso (no baja del valor original), pide el N.º de factura nuevo, y deja un registro
  //   espejo aparte. Solo master/admin_finanzas.
  // - "Corregir factura": cuando fue un error al REGISTRAR (nada cambió en Siigo) — sube o baja
  //   libremente, sin necesitar número de factura nuevo, sin registro espejo, sin necesitar
  //   solicitud aprobada. Master/admin_finanzas en cualquier fecha, o la cuenta de tienda para lo
  //   registrado hoy mismo.
  const puedeCorregirError = !soloLectura && ["master","admin_finanzas"].includes(user.role);
  const [modoErrorId, setModoErrorId] = useState(false);
  // true = la sesión de corrección abierta ahora mismo es "Notacrédito Siigo"; false = es
  // "Corregir factura". Se fija al abrir cada sesión (según qué botón se usó), no por rol solo.
  const [modoNotacredito, setModoNotacredito] = useState(false);

  // Reabrir un Flexipago vencido (pasados los 60 días) — solo si la tienda decide honrarlo con
  // el cliente igual. Deja rastro de quién lo reabrió y cuándo, igual que en Junta.
  const puedeReabrirVencido = !soloLectura && ["master","admin_finanzas"].includes(user.role);
  const reabrirFlexipagoVencido = async (venta) => {
    const confirmacion = window.prompt(`Vas a REABRIR el Flexipago vencido de la factura #${venta.numero_factura||"—"}${venta.cliente_nombre?` (cliente: ${venta.cliente_nombre})`:""}.\n\nEsto permite seguir abonando y completar la venta aunque ya pasaron los ${FLEXIPAGO_PLAZO_DIAS} días. Úsalo solo si la tienda decidió honrarlo con el cliente.\n\nEscribe REABRIR para confirmar.`);
    if(confirmacion!=="REABRIR") return;
    const { data } = await supabase.from("ventas").update({ flexipago_reabierto_por:user.name, flexipago_reabierto_en:new Date().toISOString() }).eq("id",venta.id).select().single();
    if(data) setVentas(prev=>prev.map(v2=>v2.id===venta.id?data:v2));
  };

  // Corrección directa de un abono ya registrado (solo master) — para cuando quedó con la fecha,
  // el valor o el medio de pago equivocado y no hay forma de arreglarlo desde el flujo normal.
  const [editandoAbonoId, setEditandoAbonoId] = useState(null);
  const [eaFecha, setEaFecha] = useState("");
  const [eaValor, setEaValor] = useState("");
  const [eaMedio, setEaMedio] = useState("efectivo");
  const [guardandoEa, setGuardandoEa] = useState(false);

  // Corregir SOLO el medio de pago de un renglón ya registrado (ej: el asesor marcó tarjeta
  // pero fue efectivo) — el valor no se toca nunca aquí, solo cómo se pagó. Requiere la misma
  // solicitud de corrección aprobada que el resto de correcciones.
  const [corrigiendoPago, setCorrigiendoPago] = useState(null); // {itemId, pagoIdx}
  const [cpMedio, setCpMedio] = useState("efectivo");
  const [cpAutorizacion, setCpAutorizacion] = useState("");
  const [guardandoCp, setGuardandoCp] = useState(false);
  const iniciarCorreccionMedio = (item, pagoIdx) => {
    const p = (item.pagos||[])[pagoIdx];
    setCorrigiendoPago({ itemId:item.id, pagoIdx });
    setCpMedio(p?.medio_pago||"efectivo");
    setCpAutorizacion(p?.numero_autorizacion||"");
  };
  const guardarCorreccionMedio = async (venta) => {
    if(!corrigiendoPago) return;
    const item = (d?.items||[]).find(i=>i.id===corrigiendoPago.itemId);
    if(!item) return;
    setGuardandoCp(true);
    const nuevosPagos = (item.pagos||[]).map((p,idx)=> idx===corrigiendoPago.pagoIdx ? { ...p, medio_pago:cpMedio, numero_autorizacion:VENTAS_MEDIOS_TARJETA.includes(cpMedio)?(cpAutorizacion||"").trim():null } : p);
    const { data } = await supabase.from("ventas_items").update({ pagos:nuevosPagos }).eq("id",item.id).select().single();
    if(data){
      setDetalle(prev=>({...prev, items:(prev?.items||[]).map(i=>i.id===data.id?data:i)}));
      const aprobadasSinAplicar = (d?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);
      for(const s of aprobadasSinAplicar){
        await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
      }
      if(aprobadasSinAplicar.length>0){
        setDetalle(prev=>({...prev, solicitudes:(prev?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s) }));
      }
    }
    setGuardandoCp(false);
    setCorrigiendoPago(null);
  };

  const iniciarEdicionAbono = (a) => { setEditandoAbonoId(a.id); setEaFecha(a.fecha); setEaValor(String(a.valor)); setEaMedio(a.medio_pago); };
  const guardarEdicionAbono = async () => {
    if(!eaFecha || !eaValor){ return; }
    setGuardandoEa(true);
    const { data, error } = await supabase.from("ventas_abonos").update({ fecha:eaFecha, valor:Number(eaValor), medio_pago:eaMedio }).eq("id", editandoAbonoId).select().single();
    setGuardandoEa(false);
    if(data){
      setDetalle(prev=>({ ...prev, abonos:(prev?.abonos||[]).map(x=>x.id===data.id?data:x) }));
      if(setVentasAbonos) setVentasAbonos(prev=>prev.map(a=>a.id===data.id?data:a));
      setEditandoAbonoId(null);
    }
  };

  const fetchDetalle = async () => {
    setDetalle(prev=>({...(prev||{}), cargando:true}));
    const [{data:items},{data:abonos},{data:solicitudes}] = await Promise.all([
      supabase.from("ventas_items").select("*").eq("venta_id",venta.id),
      supabase.from("ventas_abonos").select("*").eq("venta_id",venta.id).order("fecha",{ascending:true}),
      supabase.from("ventas_solicitudes_correccion").select("*").eq("venta_id",venta.id).order("fecha_solicitud",{ascending:false}),
    ]);
    setDetalle({ items:items||[], abonos:abonos||[], solicitudes:solicitudes||[], cargando:false });
  };
  const toggleExpand = () => {
    if(expandido){ setExpandido(false); return; }
    setExpandido(true);
    if(!detalle) fetchDetalle();
  };

  const enviarSolicitud = async () => {
    if(!motivoSolicitud.trim()) return;
    const { data } = await supabase.from("ventas_solicitudes_correccion").insert({ venta_id:venta.id, solicitado_por:user.name, motivo:motivoSolicitud.trim(), estado:"pendiente" }).select().single();
    if(data){
      setDetalle(prev=>({...prev, solicitudes:[data, ...(prev?.solicitudes||[])]}));
      setMostrarSolicitud(false); setMotivoSolicitud("");
    }
  };

  const resolverSolicitud = async (solicitud, nuevoEstado) => {
    const { data } = await supabase.from("ventas_solicitudes_correccion").update({ estado:nuevoEstado, resuelto_por:user.name, fecha_resolucion:new Date().toISOString() }).eq("id",solicitud.id).select().single();
    if(data){
      setDetalle(prev=>({...prev, solicitudes:prev.solicitudes.map(s=>s.id===data.id?data:s)}));
    }
  };

  const iniciarEdicion = (venta) => {
    // Aplicar una Notacrédito ya aprobada. Para flexipago: solo se pueden cambiar los datos del
    // cliente, los códigos de producto/valores y el medio del abono inicial (el tipo se queda
    // fijo en Flexipago). Para ventas normales: solo se pueden cambiar tipo+valor de lo ya
    // registrado — no se agregan renglones nuevos. En ambos casos el piso es valor_original.
    setEditando(true);
    setEditErrorMsg("");
    setAjusteFecha(todayStr);
    if(venta.es_flexipago){
      const itemFlex = (d?.items||[]).find(i=>i.tipo==="flexipago");
      setNcCliente({ tipoDoc: venta.cliente_tipo_doc||"CC", documento: venta.cliente_documento||"", nombre: venta.cliente_nombre||"", telefono: venta.cliente_telefono||"" });
      setNcCodigos(itemFlex?.codigos_producto?.length ? itemFlex.codigos_producto.map(c=>({ codigo:c.codigo||"", valor:String(c.valor||"") })) : [{ codigo:"", valor:"" }]);
      const primerAbono = (d?.abonos||[])[0];
      setNcAbonoMedio(primerAbono?.medio_pago || "efectivo");
    } else {
      setNcItems((d?.items||[]).map(i=>({ id:i.id, tipo:i.tipo, valor:String(i.valor), descuento:Number(i.descuento||0) })));
    }
  };

  const abrirModoCorreccion = (venta, esNotacredito) => {
    setModoNotacredito(esNotacredito);
    setModoErrorId(true);
    setEditando(true);
    setModoCambioProducto(false);
    setCcFecha(todayStr); setCcNumeroFactura("");
    // es_original/fecha_item quedan guardados en la fila desde la vez que se creó ese renglón —
    // así un excedente sigue siendo excedente (editable, con fecha propia) en futuras Notas
    // crédito, no solo en la sesión donde se agregó. Filas viejas (antes de esta columna) caen
    // en es_original=true por el default de la base, que es el comportamiento correcto para ellas.
    setEditItems((d?.items||[]).map(i=>{
      const esOriginal = i.es_original!==false;
      return { id:i.id, tipo:i.tipo, valorTotal:Number(i.valor), descuento:Number(i.descuento||0), pagos:i.pagos||[], esOriginal, valorOriginalItem: esOriginal?Number(i.valor):0, fecha: !esOriginal ? (i.fecha_item||todayStr) : undefined };
    }));
    setEditObservacion(venta.observacion||"");
    // Notacrédito Siigo: siempre se pide un N.º de factura NUEVO, así que arranca vacío (no se
    // prellena con el de la factura original, que nunca se toca). En Corregir factura sí se
    // prellena, porque ahí se sigue editando el mismo N.º de la venta.
    setEditNumeroFactura(esNotacredito ? "" : (venta.numero_factura||""));
    setEditErrorMsg("");
    setEditItemTipo("producto");
    setEditItemValor("");
    setEditItemDescuento("");
    setEditItemDescuentoTipo("valor");
    setEditItemPagos([]);
    setEditItemMedioNuevo("");
    setEditItemFecha(todayStr);
    setEditingItemIdx(null);
  };
  const iniciarNotacredito = (venta) => {
    const confirmacion = window.prompt(`Vas a hacer una Notacrédito Siigo sobre la factura #${venta.numero_factura||"—"} (hoy dice $${Number(venta.total).toLocaleString("es-CO")}).\n\nUsa esto SOLO si en Siigo la corrección genera un número de factura nuevo. Puedes corregir el tipo, valor y medio de pago de cada renglón, o agregar un renglón nuevo con su propia fecha. El valor total no puede quedar por debajo de lo ya registrado, y vas a necesitar el N.º de factura (Siigo) NUEVO — es obligatorio, la factura original no cambia.\n\nEscribe CORREGIR para confirmar.`);
    if(confirmacion!=="CORREGIR") return;
    abrirModoCorreccion(venta, true);
  };
  const iniciarCorregirFactura = (venta) => {
    const confirmacion = window.prompt(`Vas a corregir la factura #${venta.numero_factura||"—"} (hoy dice $${Number(venta.total).toLocaleString("es-CO")}).\n\nUsa esto cuando NO cambió nada en Siigo — fue un error al registrar en nuestro sistema. El valor puede subir o bajar libremente, sin necesitar un número de factura nuevo ni aprobación.\n\nEscribe CORREGIR para confirmar.`);
    if(confirmacion!=="CORREGIR") return;
    abrirModoCorreccion(venta, false);
  };

  // Abre el formulario de arriba en modo edición sobre un renglón ya en la lista (original o
  // recién agregado). En uno original la fecha queda fija en la de la venta; en uno nuevo se
  // puede cambiar libremente.
  const iniciarEdicionItem = (idx, venta) => {
    const it = editItems[idx];
    if(!it) return;
    setEditingItemIdx(idx);
    setEditItemTipo(it.tipo);
    setEditItemValor(String(it.valorTotal));
    setEditItemDescuento(String(it.descuento||0));
    setEditItemDescuentoTipo("valor");
    setEditItemPagos(it.pagos||[]);
    setEditItemMedioNuevo("");
    setEditItemFecha(it.esOriginal ? venta.fecha : (it.fecha||todayStr));
  };
  const cancelarEdicionItem = () => {
    setEditingItemIdx(null);
    setEditItemTipo("producto");
    setEditItemValor("");
    setEditItemDescuento("");
    setEditItemDescuentoTipo("valor");
    setEditItemPagos([]);
    setEditItemMedioNuevo("");
    setEditItemFecha(todayStr);
  };

  const editItemEsFlexipago = editItemTipo === "flexipago";
  const editItemValorNum = Number(editItemValor||0);
  const editItemDescuentoInput = Number(editItemDescuento||0);
  const editItemDescuentoNum = editItemDescuentoTipo==="porcentaje" ? Math.round(editItemValorNum*editItemDescuentoInput/100) : editItemDescuentoInput;
  const editItemNeto = editItemValorNum - editItemDescuentoNum;
  const editItemSumaMedios = editItemPagos.reduce((a,p)=>a+Number(p.valor||0),0);
  const editItemFalta = editItemNeto - editItemSumaMedios;
  const editItemFaltaAUT = editItemPagos.some(p=>VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && !(p.numero_autorizacion||"").trim());

  const agregarMedioAEditItem = (medio) => {
    const m = medio || editItemMedioNuevo;
    if(!m) return;
    setEditItemPagos(prev=>[...prev, { medio_pago:m, valor:"", numero_autorizacion:"" }]);
    setEditItemMedioNuevo("");
  };
  const quitarMedioDeEditItem = (idx) => setEditItemPagos(prev=>prev.filter((_,i)=>i!==idx));
  const setEditItemPagoValor = (idx, v2) => setEditItemPagos(prev=>prev.map((p,i)=>i===idx?{...p,valor:v2}:p));
  const setEditItemPagoAutorizacion = (idx, v2) => setEditItemPagos(prev=>prev.map((p,i)=>i===idx?{...p,numero_autorizacion:v2}:p));

  // Renglón original: si master/admin_finanzas está haciendo la Nota crédito, no puede bajar del
  // valor bruto con el que se registró. La corrección libre del mismo día (cuenta tienda) no
  // tiene este piso — sigue pudiendo subir o bajar sin límite.
  const editItemEditandoOriginal = editingItemIdx!==null && editItems[editingItemIdx]?.esOriginal;
  const editItemPisoOriginal = editItemEditandoOriginal ? editItems[editingItemIdx].valorOriginalItem : 0;
  const editItemBajoPiso = modoNotacredito && editItemEditandoOriginal && editItemValorNum < editItemPisoOriginal;

  const agregarEditItem = () => {
    if(editItemValorNum<=0 || editItemPagos.length===0 || Math.abs(editItemFalta)>=1 || editItemFaltaAUT || editItemBajoPiso) return;
    const pagos = editItemPagos.map(p=>({ medio_pago:p.medio_pago, valor:Number(p.valor||0), numero_autorizacion:VENTAS_MEDIOS_TARJETA.includes(p.medio_pago)?(p.numero_autorizacion||"").trim():null }));
    if(editingItemIdx!==null){
      const original = editItems[editingItemIdx];
      const actualizado = { ...original, tipo:editItemTipo, valorTotal:editItemValorNum, descuento:editItemDescuentoNum, pagos, ...(original.esOriginal ? {} : { fecha:editItemFecha }) };
      setEditItems(prev=>prev.map((it,i)=>i===editingItemIdx?actualizado:it));
    } else {
      setEditItems(prev=>[...prev, { id:`nuevo_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, tipo:editItemTipo, valorTotal:editItemValorNum, descuento:editItemDescuentoNum, pagos, esOriginal:false, fecha:editItemFecha }]);
    }
    cancelarEdicionItem();
  };
  const quitarEditItem = (idx) => {
    // El renglón original nunca se elimina en Notacrédito Siigo (solo se edita). En Corregir
    // factura no hay distinción entre renglones — cualquiera se puede quitar, como antes.
    if(modoNotacredito && editItems[idx]?.esOriginal) return;
    setEditItems(prev=>prev.filter((_,i)=>i!==idx));
    if(idx===editingItemIdx) cancelarEdicionItem();
  };

  const guardarEdicion = async (venta) => {
    const esModoError = modoErrorId;
    // "Corregir por error" se edita completo, como antes (se reemplazan todos los renglones).
    // Es el único modo donde el valor puede subir O bajar libremente.
    if(esModoError){
      if(editItems.length===0) return;
      const bruto = editItems.reduce((a,i)=>a+i.valorTotal,0);
      const desc = editItems.reduce((a,i)=>a+i.descuento,0);
      const total = bruto - desc;
      const valorAnterior = Number(venta.total);
      // Notacrédito Siigo: el piso es siempre lo ya registrado. Corregir factura no tiene piso —
      // sube o baja libremente, como antes.
      const piso = Number(venta.valor_original ?? venta.total);
      if(modoNotacredito && total < piso){
        setEditErrorMsg(`El nuevo valor ($${total.toLocaleString("es-CO")}) no puede quedar por debajo de lo ya registrado ($${piso.toLocaleString("es-CO")}).`);
        return;
      }
      // Notacrédito Siigo: la factura original NUNCA se toca desde aquí — el N.º de Siigo que se
      // escribe en el renglón es obligatorio y siempre queda como el de la Notacrédito (registro
      // espejo aparte), sin importar si al final hay diferencia de valor o no. Corregir factura
      // sigue editando el N.º de factura de la misma venta directamente, como antes.
      if(modoNotacredito && !editNumeroFactura.trim()){
        setEditErrorMsg("Falta el N.º de factura (Siigo) — es obligatorio para guardar la Notacrédito.");
        return;
      }
      setEditErrorMsg("");
      setGuardando(true);
      const payload = { observacion:editObservacion.trim(), valor_bruto:bruto, descuento_total:desc, total, updated_at:new Date().toISOString() };
      // La factura original solo se edita en Corregir factura. En Notacrédito Siigo nunca se
      // toca — el N.º nuevo va aparte, en el ajuste.
      if(!modoNotacredito) payload.numero_factura = editNumeroFactura.trim() || venta.numero_factura || null;
      // Solo en Corregir factura se resetea valor_original, para que el valor corregido quede
      // como si siempre hubiera sido el original (es un typo, no plata real que entró después).
      // En Notacrédito Siigo NO se resetea: el piso original se conserva para siempre.
      if(!modoNotacredito) payload.valor_original = total;
      const { data:ventaAct } = await supabase.from("ventas").update(payload).eq("id",venta.id).select().single();
      await supabase.from("ventas_items").delete().eq("venta_id",venta.id);
      // En Corregir factura no hay concepto de renglón original/nuevo con fecha propia — se
      // reemplaza todo plano, como antes de la Notacrédito Siigo.
      const filasItems = modoNotacredito
        ? editItems.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valorTotal, descuento:i.descuento, pagos:i.pagos, es_original:i.esOriginal!==false, fecha_item:i.esOriginal===false?(i.fecha||todayStr):null }))
        : editItems.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valorTotal, descuento:i.descuento, pagos:i.pagos, es_original:true, fecha_item:null }));
      const { data:itemsNuevos } = await supabase.from("ventas_items").insert(filasItems).select();
      const aprobadasSinAplicar = (d?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);
      for(const s of aprobadasSinAplicar){
        await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
      }
      const primerNuevo = editItems.find(i=>!i.esOriginal);
      const fechaAjuste = modoNotacredito ? (primerNuevo?.fecha || todayStr) : todayStr;
      if(modoNotacredito){
        // El valor de ESTA Notacrédito es lo que sumen los renglones nuevos con esta fecha
        // específica (no total-valorAnterior de la sesión) — así, si se reedita solo para
        // corregir el N.º de Siigo sin tocar el valor, el registro sigue existiendo y el número
        // no se pierde (antes, si el total no cambiaba frente al de la venta, no se tocaba nada).
        const itemsDeEstaFecha = editItems.filter(i=>!i.esOriginal && (i.fecha||todayStr)===fechaAjuste);
        const diferenciaFecha = itemsDeEstaFecha.reduce((s,i)=>s+i.valorTotal-i.descuento,0);
        const motivo = `Nota crédito${editObservacion.trim()?": "+editObservacion.trim():""}`;
        const ajusteExistente = (ajustes||[]).find(a=>a.venta_id===venta.id && a.fecha===fechaAjuste && !a.es_correccion_error);
        if(ajusteExistente){
          const { data:ajusteAct } = await supabase.from("ventas_ajustes").update({ valor_nuevo:piso+diferenciaFecha, diferencia:diferenciaFecha, motivo, numero_factura:editNumeroFactura.trim(), aplicado_por:user.name }).eq("id",ajusteExistente.id).select().single();
          if(ajusteAct) setAjustes(prev=>prev.map(a=>a.id===ajusteAct.id?ajusteAct:a));
        } else if(diferenciaFecha!==0){
          const { data:ajusteNuevo } = await supabase.from("ventas_ajustes").insert({ venta_id:venta.id, fecha:fechaAjuste, valor_anterior:piso, valor_nuevo:piso+diferenciaFecha, diferencia:diferenciaFecha, motivo, aplicado_por:user.name, es_correccion_error:false, numero_factura:editNumeroFactura.trim() }).select().single();
          if(ajusteNuevo) setAjustes(prev=>[...prev, ajusteNuevo]);
        }
      } else if(total!==valorAnterior){
        // Corregir factura: el ajuste es solo una nota de auditoría del cambio de valor, no un
        // registro espejo — se sigue creando solo si el total realmente cambió.
        const motivo = `Corrección por error${editObservacion.trim()?": "+editObservacion.trim():""}`;
        const { data:ajusteNuevo } = await supabase.from("ventas_ajustes").insert({ venta_id:venta.id, fecha:fechaAjuste, valor_anterior:valorAnterior, valor_nuevo:total, diferencia:total-valorAnterior, motivo, aplicado_por:user.name, es_correccion_error:true, numero_factura:null }).select().single();
        if(ajusteNuevo) setAjustes(prev=>[...prev, ajusteNuevo]);
      }
      setGuardando(false);
      if(ventaAct){
        setVentas(prev=>prev.map(v2=>v2.id===venta.id?ventaAct:v2));
        setDetalle(prev=>({...prev, items:itemsNuevos||[], solicitudes:(prev?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s) }));
        if(setVentasItems) setVentasItems(prev=>[...prev.filter(i=>i.venta_id!==venta.id), ...(itemsNuevos||[])]);
      }
      setEditando(false);
      setModoErrorId(false);
      return;
    }

    // Notacrédito ya aprobada. El piso siempre es venta.valor_original: el nuevo valor nunca
    // puede quedar por debajo de lo que ya se había registrado.
    const piso = Number(venta.valor_original ?? venta.total);
    const aprobadasSinAplicar = (d?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);

    if(venta.es_flexipago){
      // Flexipago: el tipo se queda fijo. Solo se cambian los datos del cliente, los códigos de
      // producto (y sus valores, cuya suma no puede bajar del piso) y el medio del abono inicial.
      const codigosLimpios = ncCodigos.filter(c=>c.codigo.trim()||c.valor.trim());
      if(codigosLimpios.length===0){ setEditErrorMsg("Agrega al menos un código de producto."); return; }
      const nuevaSuma = ncCodigos.reduce((s,c)=>s+Number(c.valor||0),0);
      if(nuevaSuma < piso){ setEditErrorMsg(`La suma de los productos ($${nuevaSuma.toLocaleString("es-CO")}) no puede quedar por debajo de lo ya registrado ($${piso.toLocaleString("es-CO")}).`); return; }
      if(!ncCliente.documento.trim() || !ncCliente.nombre.trim()){ setEditErrorMsg("Faltan los datos del cliente."); return; }
      setEditErrorMsg("");
      setGuardando(true);
      const { data:ventaAct } = await supabase.from("ventas").update({
        cliente_tipo_doc:ncCliente.tipoDoc, cliente_documento:ncCliente.documento.trim(), cliente_nombre:ncCliente.nombre.trim(), cliente_telefono:ncCliente.telefono.trim(),
        valor_bruto:nuevaSuma, total:nuevaSuma, observacion:editObservacion.trim(), updated_at:new Date().toISOString(),
      }).eq("id",venta.id).select().single();
      const itemFlex = (d?.items||[]).find(i=>i.tipo==="flexipago");
      let itemAct = null;
      if(itemFlex){
        const { data } = await supabase.from("ventas_items").update({ valor:nuevaSuma, codigos_producto:codigosLimpios }).eq("id",itemFlex.id).select().single();
        itemAct = data;
      }
      const primerAbono = (d?.abonos||[])[0];
      let abonoAct = null;
      // Si el primer abono ya se pagó con varios medios (pagos.length>1), este selector de un solo
      // medio no alcanza a representarlo bien — se deja intacto en vez de arriesgar corromper el
      // desglose real (para cambiarlo tocaría hacerlo desde el detalle del abono).
      if(primerAbono && (!primerAbono.pagos || primerAbono.pagos.length<=1) && primerAbono.medio_pago!==ncAbonoMedio){
        const { data } = await supabase.from("ventas_abonos").update({ medio_pago:ncAbonoMedio, pagos:null }).eq("id",primerAbono.id).select().single();
        abonoAct = data;
      }
      for(const s of aprobadasSinAplicar){
        await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
      }
      setGuardando(false);
      if(ventaAct){
        setVentas(prev=>prev.map(v2=>v2.id===venta.id?ventaAct:v2));
        setDetalle(prev=>({...prev,
          items:(prev?.items||[]).map(i=>i.id===itemAct?.id?itemAct:i),
          abonos:(prev?.abonos||[]).map(a=>a.id===abonoAct?.id?abonoAct:a),
          solicitudes:(prev?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s),
        }));
        if(itemAct && setVentasItems) setVentasItems(prev=>prev.map(i=>i.id===itemAct.id?itemAct:i));
        if(abonoAct && setVentasAbonos) setVentasAbonos(prev=>prev.map(a=>a.id===abonoAct.id?abonoAct:a));
      }
      setEditando(false);
      return;
    }

    // Venta normal: se edita el tipo y el valor de los renglones ya registrados (no se agregan
    // renglones nuevos). La suma nueva no puede quedar por debajo del piso.
    const nuevoBruto = ncItems.reduce((s,i)=>s+Number(i.valor||0),0);
    const descuentoOriginal = ncItems.reduce((s,i)=>s+Number(i.descuento||0),0);
    const nuevoTotal = nuevoBruto - descuentoOriginal;
    if(nuevoTotal < piso){
      setEditErrorMsg(`El nuevo valor ($${nuevoTotal.toLocaleString("es-CO")}) no puede quedar por debajo de lo ya registrado ($${piso.toLocaleString("es-CO")}).`);
      return;
    }
    setEditErrorMsg("");
    setGuardando(true);
    const valorAnterior = Number(venta.total);
    const { data:ventaAct } = await supabase.from("ventas").update({ observacion:editObservacion.trim(), numero_factura:editNumeroFactura.trim()||null, valor_bruto:nuevoBruto, descuento_total:descuentoOriginal, total:nuevoTotal, updated_at:new Date().toISOString() }).eq("id",venta.id).select().single();
    const itemsActualizados = [];
    for(const it of ncItems){
      const { data } = await supabase.from("ventas_items").update({ tipo:it.tipo, valor:Number(it.valor||0) }).eq("id",it.id).select().single();
      if(data) itemsActualizados.push(data);
    }
    for(const s of aprobadasSinAplicar){
      await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
    }
    // El excedente (lo que subió hoy respecto a lo que ya tenía) queda registrado con la fecha de
    // HOY para Métricas — el valor original se queda contando en su día de venta (no se toca acá,
    // ver recortePorVenta en VentasMetricasScreen). Así "Ventas de hoy" solo ve lo que entró hoy.
    if(nuevoTotal !== valorAnterior){
      const { data:ajusteNuevo } = await supabase.from("ventas_ajustes").insert({ venta_id:venta.id, fecha:(puedeEditarFechaAjuste && ajusteFecha) || todayStr, valor_anterior:valorAnterior, valor_nuevo:nuevoTotal, diferencia:nuevoTotal-valorAnterior, motivo:editObservacion.trim()||null, aplicado_por:user.name }).select().single();
      if(ajusteNuevo) setAjustes(prev=>[...prev, ajusteNuevo]);
    }
    setGuardando(false);
    if(ventaAct){
      setVentas(prev=>prev.map(v2=>v2.id===venta.id?ventaAct:v2));
      setDetalle(prev=>({...prev,
        items:(prev?.items||[]).map(i=>itemsActualizados.find(x=>x.id===i.id)||i),
        solicitudes:(prev?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s),
      }));
      if(setVentasItems && itemsActualizados.length) setVentasItems(prev=>prev.map(i=>itemsActualizados.find(x=>x.id===i.id)||i));
    }
    setEditando(false);
  };

  const eliminarVenta = async (venta) => {
    const confirmacion = window.prompt(`Esto borra para siempre la venta #${venta.numero_factura||"—"} (${venta.vendedor_nombre}, $${Number(venta.total).toLocaleString("es-CO")}) y todo lo que tenga: renglones, abonos y solicitudes. No se puede deshacer.\n\nEscribe BORRAR para confirmar.`);
    if(confirmacion!=="BORRAR") return;
    await supabase.from("ventas_solicitudes_correccion").delete().eq("venta_id",venta.id);
    await supabase.from("ventas_abonos").delete().eq("venta_id",venta.id);
    await supabase.from("ventas_items").delete().eq("venta_id",venta.id);
    const { error } = await supabase.from("ventas").delete().eq("id",venta.id);
    if(!error){
      setVentas(prev=>prev.filter(x=>x.id!==venta.id));
      setDetalle(null);
    }
  };

  const [abonoNumeroFactura, setAbonoNumeroFactura] = useState("");
  // Mismo patrón que agregarMedioAItem/quitarMedioDeItem en VentasRegistrarScreen: los medios
  // agregados deben sumar exactamente el "Valor del abono" (abonoValor) antes de poder guardar.
  const abonoSumaMedios = abonoPagos.reduce((a,p)=>a+Number(p.valor||0),0);
  const abonoFaltaPagos = Number(abonoValor||0) - abonoSumaMedios;
  const abonoFaltaAUT = abonoPagos.some(p=>VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && !(p.numero_autorizacion||"").trim());
  const agregarMedioAAbono = (medio) => {
    const m = medio || abonoMedioNuevo;
    if(!m) return;
    const sugerido = Math.max(0, abonoFaltaPagos);
    setAbonoPagos(prev=>[...prev, { medio_pago:m, valor: sugerido>0?String(sugerido):"", numero_autorizacion:"" }]);
    setAbonoMedioNuevo("");
  };
  const quitarMedioDeAbono = (idx) => setAbonoPagos(prev=>prev.filter((_,i)=>i!==idx));
  const setAbonoPagoValor = (idx, v) => setAbonoPagos(prev=>prev.map((p,i)=>i===idx?{...p,valor:v}:p));
  const setAbonoPagoAutorizacion = (idx, v) => setAbonoPagos(prev=>prev.map((p,i)=>i===idx?{...p,numero_autorizacion:v}:p));
  const resetAbonoForm = () => { setAbonoForm(false); setAbonoValor(""); setAbonoPagos([]); setAbonoMedioNuevo(""); setAbonoNumeroFactura(""); setAbonoFecha(todayStr); };
  const agregarAbono = async (venta, valorFlexipagoVenta, totalAbonadoActual) => {
    if(!abonoValor || Number(abonoValor)<=0 || abonoPagos.length===0 || Math.abs(abonoFaltaPagos)>=1 || abonoFaltaAUT) return;
    // El total abonado que llega por parámetro viene del render (puede quedar desactualizado si
    // se registran varios abonos seguidos muy rápido, antes de que la pantalla alcance a
    // refrescarse). Para decidir si este abono cierra el Flexipago, se vuelve a sumar lo
    // realmente guardado en la base justo antes de insertar — así no se le escapa pedir el N.º
    // de factura cuando sí corresponde, ni queda un saldo fantasma que solo se corrige al recargar.
    const { data: abonosActuales } = await supabase.from("ventas_abonos").select("valor").eq("venta_id", venta.id);
    const totalAbonadoReal = (abonosActuales||[]).reduce((a,x)=>a+Number(x.valor||0), 0);
    const completaPago = (valorFlexipagoVenta - totalAbonadoReal - Number(abonoValor)) <= 0;
    if(completaPago && !venta.numero_factura && !abonoNumeroFactura.trim()){
      alert("Este abono deja el Flexipago completamente pagado — falta el N.º de factura (Siigo) para poder guardarlo. Escríbelo en el campo que apareció y guarda de nuevo.");
      return;
    }
    // Solo master/admin_finanzas pueden poner una fecha distinta a hoy (para abonos atrasados
    // que se registran después de que pasaron). El resto siempre abona con la fecha de hoy.
    const fechaAbono = (esAdmin && abonoFecha) ? abonoFecha : todayStr;
    // `medio_pago`/`numero_autorizacion` (columnas viejas) quedan con el primer medio, solo por
    // compatibilidad con algún código que todavía no lea `pagos` — lo que manda de verdad es
    // `pagos`, el desglose completo por medio.
    const pagosGuardar = abonoPagos.map(p=>({ medio_pago:p.medio_pago, valor:Number(p.valor||0), numero_autorizacion: VENTAS_MEDIOS_TARJETA.includes(p.medio_pago)?(p.numero_autorizacion||"").trim():null }));
    const { data, error } = await supabase.from("ventas_abonos").insert({
      venta_id:venta.id, fecha:fechaAbono, valor:Number(abonoValor), registrado_por:user.name,
      medio_pago:pagosGuardar[0]?.medio_pago, numero_autorizacion:pagosGuardar[0]?.numero_autorizacion,
      pagos: pagosGuardar,
    }).select().single();
    if(error){ alert(`No se pudo guardar el abono: ${error.message}`); sonidoError(); return; }
    if(data){
      setDetalle(prev=>({...prev, abonos:[...(prev?.abonos||[]), data]}));
      if(setVentasAbonos) setVentasAbonos(prev=>[...prev, data]);
      if(completaPago && !venta.numero_factura && abonoNumeroFactura.trim()){
        const { data:ventaAct } = await supabase.from("ventas").update({ numero_factura:abonoNumeroFactura.trim() }).eq("id",venta.id).select().single();
        if(ventaAct) setVentas(prev=>prev.map(v2=>v2.id===venta.id?ventaAct:v2));
      }
      // Un abono cualquiera es rutina; uno que termina de pagar el Flexipago es un logro — se
      // premia con un sonido distinto (más elaborado que el de una venta normal).
      if(completaPago) sonidoFlexipagoCompletado();
      resetAbonoForm();
    }
  };

  const imprimirVenta = (venta, d) => {
    // Comprobante ajustado a impresora térmica 80mm (72.1mm imprimible, 203dpi fijo de
    // hardware — 3nstar RPT005 y similares). @page usa el ancho real del rollo para que el
    // navegador no re-escale una hoja carta/A4 hasta hacerla ilegible, y el layout va en
    // renglones apilados (no tablas anchas) para que quepa sin reducir letra ni desperdiciar
    // papel.
    const tienda = stores[venta.tienda_id]?.name || venta.tienda_id;
    const totalAbonado = (d?.abonos||[]).reduce((a,x)=>a+Number(x.valor),0);
    const valorFlex = (d?.items||[]).filter(i=>i.tipo==="flexipago").reduce((a,i)=>a+Number(i.valor),0);
    const saldo = valorFlex - totalAbonado;
    const itemsHtml = (d?.items||[]).map(i=>{
      const label = VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label||i.tipo;
      const medio = i.tipo==="flexipago" ? (saldo<=0?"Completado":"Pendiente") : (i.pagos||[]).map(p=>VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label||p.medio_pago).join(" + ");
      const detParts = [];
      if(medio) detParts.push(medio);
      if(Number(i.descuento)>0) detParts.push(`Desc. ${fmtCOP(i.descuento)}`);
      const codigos = (i.codigos_producto||[]).filter(c=>c.codigo||c.valor);
      const codigosLine = codigos.length ? `<div class="det">${codigos.map(c=>`Cód. ${c.codigo||"—"}${c.valor?`: ${fmtCOP(Number(c.valor))}`:""}`).join(" · ")}</div>` : "";
      return `<div class="item"><div class="rl"><span>${label}</span><span>${fmtCOP(i.valor)}</span></div>${detParts.length?`<div class="det">${detParts.join(" · ")}</div>`:""}${codigosLine}</div>`;
    }).join("");
    const abonosHtml = (d?.abonos||[]).map(a=>`<div class="rl"><span>${a.fecha} · ${textoMediosAbono(a)}</span><span>${fmtCOP(a.valor)}</span></div>`).join("");
    const avisoHtml = FLEXIPAGO_AVISO_ITEMS.map(it=>`<p>${it.n?`<b>${it.n}. ${it.titulo}:</b> `:""}${it.texto}</p>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Venta ${venta.numero_factura||""}</title>
      <style>
        @page{size:80mm auto;margin:3mm 3mm;}
        *{box-sizing:border-box;}
        body{width:100%;font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;line-height:1.35;color:#000;margin:0;padding:0;}
        .logo-wrap{text-align:center;margin-bottom:2mm;}
        .logo-wrap img{width:38mm;height:auto;}
        h1{font-size:12pt;margin:0 0 1mm;text-align:center;font-weight:700;}
        .sub{font-size:8pt;text-align:center;margin-bottom:1mm;}
        .sep{border-top:1px dashed #000;margin:2mm 0;}
        .rl{display:flex;justify-content:space-between;gap:2mm;font-size:9pt;margin:0.6mm 0;}
        .rl b{font-weight:700;}
        .lbl{font-size:7.5pt;text-transform:uppercase;letter-spacing:0.03em;font-weight:700;margin:0 0 1mm;}
        .item{margin:1mm 0;}
        .item .rl{font-size:9.5pt;font-weight:700;}
        .item .det{font-size:8pt;color:#333;}
        .total{font-size:12pt;font-weight:700;text-align:right;margin-top:1mm;}
        .saldo{font-size:11pt;font-weight:700;text-align:right;}
        .nota{font-size:8pt;margin-top:2mm;}
        .aviso{font-size:6.8pt;line-height:1.35;margin-top:2mm;}
        .aviso .t{font-size:7.5pt;font-weight:700;text-align:center;margin-bottom:1mm;}
        .aviso p{margin:1mm 0;}
      </style></head><body>
      <div class="logo-wrap"><img src="/logo-print.png" alt="OZEN"/></div>
      <h1>Comprobante Flexipago</h1>
      <div class="sub">Factura ${venta.numero_factura||"—"} · ${venta.fecha}</div>
      <div class="rl"><span>Tienda</span><b>${tienda}</b></div>
      <div class="rl"><span>Asesor</span><b>${venta.vendedor_nombre||"—"}</b></div>
      <div class="sep"></div>
      <div class="rl"><span>Cliente</span><b>${venta.cliente_nombre||"—"}</b></div>
      ${venta.cliente_documento?`<div class="rl"><span>${venta.cliente_tipo_doc||"Doc"}</span><b>${venta.cliente_documento}</b></div>`:""}
      ${venta.cliente_telefono?`<div class="rl"><span>Tel</span><b>${venta.cliente_telefono}</b></div>`:""}
      <div class="sep"></div>
      <div class="lbl">Productos</div>
      ${itemsHtml}
      <div class="sep"></div>
      <div class="total">Total: ${fmtCOP(venta.total)}</div>
      <div class="sep"></div>
      <div class="lbl">Abonos</div>
      ${abonosHtml || '<div class="rl"><span>Sin abonos registrados</span></div>'}
      <div class="saldo">Saldo pendiente: ${fmtCOP(saldo)}</div>
      ${venta.observacion?`<div class="nota">Nota: ${venta.observacion}</div>`:""}
      <div class="sep"></div>
      <div class="aviso"><div class="t">${FLEXIPAGO_AVISO_TITULO}</div>${avisoHtml}</div>
    </body></html>`;
    const w = window.open("", "_blank", "width=720,height=900");
    if(!w){ alert("El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio e intenta de nuevo."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    // Espera a que el logo termine de cargar antes de imprimir — si se dispara el print() antes,
    // en algunos navegadores el logo queda en blanco en el PDF/impreso. Con un tope de 1.5s por si
    // la imagen no llega a cargar (no debe dejar la impresión colgada esperando para siempre).
    const logoImg = w.document.querySelector(".logo-wrap img");
    let yaImprimio = false;
    const disparaPrint = () => { if(yaImprimio) return; yaImprimio = true; w.print(); };
    if(logoImg && !logoImg.complete){
      logoImg.addEventListener("load", disparaPrint, { once:true });
      logoImg.addEventListener("error", disparaPrint, { once:true });
      setTimeout(disparaPrint, 1500);
    } else {
      setTimeout(disparaPrint, 300);
    }
  };

  const abiertoEdicion = editando;
  const puedeEditar = !soloLectura && (d?.solicitudes||[]).some(s=>s.estado==="aprobada" && !s.aplicada_at);
  // Los totales/estado del Flexipago se calculan desde ventasItems/ventasAbonos (siempre
  // cargados) en vez del detalle (que solo se carga al abrir la tarjeta) — así el badge de
  // estado y el bloqueo de edición son correctos aunque todavía no se haya abierto.
  const abonosVenta = v.es_flexipago ? (ventasAbonos||[]).filter(a=>a.venta_id===v.id).sort((p,q)=> new Date(p.created_at||p.fecha) - new Date(q.created_at||q.fecha) || String(p.id).localeCompare(String(q.id))) : [];
  const totalAbonado = abonosVenta.reduce((a,x)=>a+Number(x.valor||0),0);
  const valorFlexipago = v.es_flexipago ? (ventasItems||[]).filter(i=>i.venta_id===v.id && i.tipo==="flexipago").reduce((a,i)=>a+Number(i.valor||0)-Number(i.descuento||0),0) : 0;
  const saldoPendiente = valorFlexipago - totalAbonado;
  const flexipagoCompletado = v.es_flexipago && valorFlexipago>0 && saldoPendiente<=0;
  // Regla del aviso legal: 60 días calendario desde el primer abono para completar el pago.
  const primerAbonoFecha = abonosVenta.length>0 ? abonosVenta[0].fecha : null;
  const diasDesdeAbono = primerAbonoFecha ? diasEntre(primerAbonoFecha, todayStr) : null;
  const fechaLimite = primerAbonoFecha ? sumarDias(primerAbonoFecha, FLEXIPAGO_PLAZO_DIAS) : null;
  const fechaLimiteCorta = fechaLimite ? new Date(fechaLimite+"T12:00:00").toLocaleDateString("es-CO",{day:"numeric",month:"short"}) : "";
  const flexipagoVencido = v.es_flexipago && saldoPendiente>0 && diasDesdeAbono!==null && diasDesdeAbono>FLEXIPAGO_PLAZO_DIAS && !v.flexipago_reabierto_en;
  const diasRestantes60 = diasDesdeAbono!==null ? FLEXIPAGO_PLAZO_DIAS - diasDesdeAbono : null;
  // Avisos previos al vencimiento: a los 30 días (mitad del plazo) y en los últimos 5 días, para
  // que el asesor le recuerde al cliente que venga por su pedido antes de perderlo.
  const flexipagoUrgente = v.es_flexipago && saldoPendiente>0 && !flexipagoVencido && diasRestantes60!==null && diasRestantes60<=5;
  const flexipagoAviso30 = v.es_flexipago && saldoPendiente>0 && !flexipagoVencido && !flexipagoUrgente && diasDesdeAbono!==null && diasDesdeAbono>=30;
  // Un solo badge de estado (en vez de varios apilados) para que todas las filas se vean
  // igual de "gruesas" — cambia de color y texto según el estado, pero siempre es uno solo.
  let estadoFlexipago = null;
  if(v.es_flexipago){
    if(flexipagoCompletado) estadoFlexipago = { color:C.green, texto:"✅ Completado" };
    else if(flexipagoVencido) estadoFlexipago = { color:C.red, texto:"⛔ Vencido" };
    else if(v.flexipago_reabierto_en) estadoFlexipago = { color:C.amber, texto:"🔓 Reabierto" };
    else if(saldoPendiente>0 && diasRestantes60!==null) estadoFlexipago = { color: flexipagoUrgente?C.red:flexipagoAviso30?C.amber:C.blue, texto:`📦 Vence en ${diasRestantes60}d · ${fechaLimiteCorta}` };
    else estadoFlexipago = { color:C.blue, texto:"📦 Flexipago" };
  }
  // La cuenta de tienda puede corregir por error y eliminar SIN pedir permiso, pero solo
  // para lo que se registró hoy mismo. Para días anteriores, tiene que pedir Notacrédito.
  const esHoyTienda = esCuentaTienda(user) && v.fecha===todayStr && !soloLectura;
  const puedeCorregirErrorAqui = puedeCorregirError || esHoyTienda;
  const puedeEliminarAqui = esAdmin || esHoyTienda;
  // Lo que realmente ingresó el día de la venta es valor_original — el excedente de una
  // Nota crédito posterior se muestra aparte, sin agrandar la fila (cuenta en Métricas en
  // su propia fecha, no en la fecha de esta venta).
  const valorOriginalMostrar = Number(v.valor_original ?? v.total);
  // Mientras el Flexipago no se ha completado, lo que "realmente ingresó" es lo abonado hasta
  // ahora — no el valor total comprometido, que todavía no ha entrado por completo. Apenas se
  // completa, ahí sí se muestra el valor total de la venta.
  const valorHeaderMostrar = (v.es_flexipago && !flexipagoCompletado) ? totalAbonado : valorOriginalMostrar;
  return (
    <Card p="0" style={{ overflow:"hidden" }}>
      <button onClick={toggleExpand} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"7px 12px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", textAlign:"left" }}>
        <Badge color={C.blue} sm>#{v.numero_factura||"—"}</Badge>
        <div style={{ flex:1, minWidth:140, minHeight:30 }}>
          <div style={{ fontFamily:font.body, fontSize:12.5, color:C.text, fontWeight:600, lineHeight:1.3 }}>{v.vendedor_nombre} <span style={{ color:C.textMuted, fontWeight:400 }}>· {v.fecha} · {stores[v.tienda_id]?.name||v.tienda_id}</span></div>
          {(v.cliente_nombre || v.cliente_documento || v.cliente_telefono) && (
            <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, lineHeight:1.3 }}>
              {v.cliente_nombre||""}{v.cliente_nombre && (v.cliente_documento||v.cliente_telefono) ? " · " : ""}{v.cliente_tipo_doc||""} {v.cliente_documento||""}{v.cliente_documento && v.cliente_telefono ? " · " : ""}{v.cliente_telefono ? `Tel: ${v.cliente_telefono}` : ""}
            </div>
          )}
        </div>
        {estadoFlexipago && (
          <Badge
            color={estadoFlexipago.color}
            sm
            title={
              flexipagoCompletado ? "Ya se pagó completo — no se puede editar más." :
              flexipagoVencido ? `Pasaron ${diasDesdeAbono} días desde el primer abono (máximo ${FLEXIPAGO_PLAZO_DIAS}). No se puede abonar ni editar.` :
              v.flexipago_reabierto_en ? `Reabierto por ${v.flexipago_reabierto_por} el ${fmtFechaHora(v.flexipago_reabierto_en)}` :
              fechaLimite ? `Vence el ${fechaLimiteCorta} (${FLEXIPAGO_PLAZO_DIAS} días desde el primer abono).` : undefined
            }
          >{estadoFlexipago.texto}</Badge>
        )}
        <div style={{ display:"flex", alignItems:"baseline", gap:5, flexShrink:0 }}>
          <div style={{ fontFamily:font.mono, fontSize:14, fontWeight:700, color:C.goldLight }}>${valorHeaderMostrar.toLocaleString("es-CO")}</div>
        </div>
        <span style={{ color:C.textMuted, fontSize:11 }}>{expandido?"▲":"▼"}</span>
      </button>

      <Collapse open={expandido}>
        <div style={{ padding:"0 12px 12px", borderTop:`1px solid ${C.border}` }}>
          {d?.cargando ? (
            <div style={{ padding:14, color:C.textMuted, fontFamily:font.body, fontSize:12 }}>Cargando...</div>
          ) : (
            <>
              {(()=>{
                // Los renglones que vienen de una Notacrédito (con su propio N.º de Siigo
                // nuevo) no se muestran en la factura original — esa factura se queda tal
                // cual quedó registrada. Solo se ven al editar con Notacrédito Siigo.
                const itemsOriginales = (d?.items||[]).filter(i=>i.es_original!==false);
                const brutoOriginal = itemsOriginales.reduce((s,i)=>s+Number(i.valor||0),0);
                const descOriginal = itemsOriginales.reduce((s,i)=>s+Number(i.descuento||0),0);
                return (
                  <div style={{ display:"flex", alignItems:"baseline", gap:6, margin:"4px 0 3px" }}>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Ventas y servicios</div>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>· Bruto ${brutoOriginal.toLocaleString("es-CO")}{descOriginal>0 && ` · Desc $${descOriginal.toLocaleString("es-CO")}`}</div>
                  </div>
                );
              })()}
              {!abiertoEdicion ? (
                <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:4 }}>
                  {(d?.items||[]).filter(i=>i.es_original!==false).map(i=>(
                    <div key={i.id} style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", fontFamily:font.body, fontSize:12, color:C.text, padding:"1px 0" }}>
                        <Badge color={i.tipo==="producto"?C.green:i.tipo==="flexipago"?C.blue:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                        <span style={{ fontFamily:font.mono }}>${Number(i.valor).toLocaleString("es-CO")}{Number(i.descuento)>0 && ` (desc $${Number(i.descuento).toLocaleString("es-CO")})`}</span>
                        {i.tipo==="flexipago" ? (
                          (i.codigos_producto||[]).filter(c=>c.codigo||c.valor).map((c,ci)=>(
                            <Badge key={ci} color={C.textMuted} sm>{c.codigo?`#${c.codigo}`:"—"}{c.valor?` · $${Number(c.valor).toLocaleString("es-CO")}`:""}</Badge>
                          ))
                        ) : (i.pagos||[]).map((p,pidx)=>(
                          corrigiendoPago && corrigiendoPago.itemId===i.id && corrigiendoPago.pagoIdx===pidx ? (
                            <div key={pidx} style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"end", padding:"4px 0", background:C.dark, borderRadius:6 }}>
                              <div style={{ width:150 }}><Field label="Medio correcto" value={cpMedio} onChange={setCpMedio} options={VENTAS_MEDIOS_PAGO}/></div>
                              {VENTAS_MEDIOS_TARJETA.includes(cpMedio) && <div style={{ width:130 }}><Field label="N.º autorización" value={cpAutorizacion} onChange={setCpAutorizacion}/></div>}
                              <Btn onClick={()=>guardarCorreccionMedio(v)} disabled={guardandoCp} sm>{guardandoCp?"...":"Guardar"}</Btn>
                              <Btn onClick={()=>setCorrigiendoPago(null)} variant="ghost" sm>Cancelar</Btn>
                            </div>
                          ) : (
                            <Badge key={pidx} color={C.blue} sm>
                              {VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}{p.numero_autorizacion?` · AUT ${p.numero_autorizacion}`:""}
                              {puedeEditar && !abiertoEdicion && <button onClick={()=>iniciarCorreccionMedio(i,pidx)} title="Corregir solo el medio de pago (el valor no cambia)" style={{ background:"none", border:"none", cursor:"pointer", color:"inherit", marginLeft:6, padding:0 }}>✏️</button>}
                            </Badge>
                          )
                        ))}
                    </div>
                  ))}
                  {(d?.items||[]).filter(i=>i.es_original!==false).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin ventas/servicios registrados.</div>}
                </div>
              ) : modoErrorId ? (
                <div style={{ marginBottom:10 }}>
                  <div style={{ fontFamily:font.body, fontSize:12, margin:"0 0 10px", padding:"8px 10px", borderRadius:7, background:modoNotacredito?`${C.gold}18`:`${C.red}18`, border:`1px solid ${modoNotacredito?C.gold:C.red}` }}>
                    {modoNotacredito
                      ? "🧾 Notacrédito Siigo: puedes corregir tipo, valor, medio de pago, pero el valor no puede ser menor al valor original."
                      : "🛠️ Corregir factura: aquí el valor puede subir o bajar libremente. Úsalo solo si el número se digitó mal — nada cambió en Siigo."}
                  </div>
                  {modoNotacredito && (
                    <label style={{ display:"flex", alignItems:"center", gap:7, fontFamily:font.body, fontSize:12, color:C.text, marginBottom:12, cursor:"pointer" }}>
                      <input type="checkbox" checked={modoCambioProducto} onChange={e=>setModoCambioProducto(e.target.checked)}/>
                      🔄 Cambio de producto (mismo valor) — no cambia el total ni los medios de pago, solo genera un N.º de factura nuevo en Siigo
                    </label>
                  )}
                  {modoCambioProducto ? (
                    <div style={{ display:"flex", gap:8, alignItems:"end", marginBottom:10, flexWrap:"wrap" }}>
                      <div style={{ width:140 }}><Field label="Fecha" type="date" value={ccFecha} onChange={setCcFecha} disabled={!puedeCorregirError}/></div>
                      <div style={{ flex:1, minWidth:150 }}><Field label="N.º de factura (Siigo) nuevo *" value={ccNumeroFactura} onChange={setCcNumeroFactura} placeholder="Ej: FE-1235"/></div>
                    </div>
                  ) : (<>
                  <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
                    {editItems.map((i,idx)=>(
                      <div key={i.id||idx} style={{ display:"flex", flexDirection:"column", gap:4, background:editingItemIdx===idx?`${C.gold}14`:C.surfaceAlt, border:`1px solid ${editingItemIdx===idx?C.gold:C.border}`, borderRadius:7, padding:"8px 10px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                          <Badge color={i.tipo==="producto"?C.green:i.tipo==="flexipago"?C.blue:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                          {modoNotacredito && !i.esOriginal && <Badge color={C.blue} sm>Notacrédito · {i.fecha||todayStr}</Badge>}
                          <div style={{ flex:1, fontFamily:font.mono, fontSize:12, color:C.text, textAlign:"right" }}>${i.valorTotal.toLocaleString("es-CO")}{i.descuento>0 && ` (desc $${i.descuento.toLocaleString("es-CO")})`}</div>
                          <button onClick={()=>iniciarEdicionItem(idx,v)} title="Editar este renglón" style={{ background:"none", border:"none", cursor:"pointer", color:"inherit" }}>✏️</button>
                          {(!modoNotacredito || !i.esOriginal) && <button onClick={()=>quitarEditItem(idx)} title="Quitar este renglón" style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>}
                        </div>
                        {i.tipo!=="flexipago" && (
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                            {i.pagos.map((p,pidx)=>(
                              <Badge key={pidx} color={C.blue} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ border:`1px solid ${editingItemIdx!==null?C.gold:C.border}`, borderRadius:8, padding:"12px", marginBottom:10 }}>
                    {editingItemIdx!==null && (
                      <div style={{ fontFamily:font.body, fontSize:11, color:C.goldLight, marginBottom:8 }}>Editando {!modoNotacredito ? "este renglón" : editItemEditandoOriginal ? "el renglón original" : "un renglón nuevo (Notacrédito)"} — <button onClick={cancelarEdicionItem} style={{ background:"none", border:"none", color:C.textMuted, textDecoration:"underline", cursor:"pointer", padding:0, fontFamily:font.body, fontSize:11 }}>cancelar edición</button></div>
                    )}
                    {modoNotacredito && (
                      <>
                        <Field label="Fecha" type="date" value={editItemFecha} onChange={setEditItemFecha} disabled={editItemEditandoOriginal}/>
                        {editItemEditandoOriginal && <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:-8, marginBottom:10 }}>Es el renglón original — la fecha se queda fija en la de la venta.</div>}
                      </>
                    )}
                    {modoNotacredito && (
                      <Field label="N.º de factura (Siigo) — obligatorio *" value={editNumeroFactura} onChange={setEditNumeroFactura} placeholder="Ej: FE-1235"/>
                    )}
                    {editItemBajoPiso && <div style={{ fontFamily:font.body, fontSize:11, color:C.red, marginTop:-8, marginBottom:10 }}>El valor no puede quedar por debajo de ${editItemPisoOriginal.toLocaleString("es-CO")} (lo ya registrado).</div>}
                    <Field label="Tipo" value={editItemTipo} onChange={setEditItemTipo} options={VENTAS_TIPOS.filter(t=>t.value!=="flexipago")}/>
                    {editItemEsFlexipago ? (
                      <>
                        <CurrencyField label="Valor total" value={editItemValor} onChange={setEditItemValor}/>
                        <div style={{ marginTop:6, marginBottom:4, fontFamily:font.body, fontSize:11, color:C.blue }}>📦 Flexipago no lleva descuento ni medio de pago aquí — se paga con abonos.</div>
                      </>
                    ) : (
                      <>
                        {isMobile ? (
                          <div style={{ marginBottom:4 }}>
                            <CurrencyField label="Valor total" value={editItemValor} onChange={setEditItemValor}/>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                              <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Descuento / Bono</div>
                              <div style={{ display:"flex", gap:4 }}>
                                {VENTAS_DESCUENTO_TIPOS.map(dt=>(
                                  <button key={dt.value} type="button" onClick={()=>setEditItemDescuentoTipo(dt.value)} style={{ width:22, height:20, borderRadius:5, border:`1px solid ${editItemDescuentoTipo===dt.value?C.gold:C.border}`, background:editItemDescuentoTipo===dt.value?`${C.gold}22`:"transparent", color:editItemDescuentoTipo===dt.value?C.goldLight:C.textMuted, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{dt.label}</button>
                                ))}
                              </div>
                            </div>
                            <CurrencyField value={editItemDescuento} onChange={setEditItemDescuento}/>
                          </div>
                        ) : (
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gridTemplateRows:"auto auto", columnGap:10, rowGap:5, marginBottom:4 }}>
                            <div style={{ gridColumn:1, gridRow:1, fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Valor total</div>
                            <div style={{ gridColumn:2, gridRow:1, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                              <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Descuento / Bono</div>
                              <div style={{ display:"flex", gap:4 }}>
                                {VENTAS_DESCUENTO_TIPOS.map(dt=>(
                                  <button key={dt.value} type="button" onClick={()=>setEditItemDescuentoTipo(dt.value)} style={{ width:22, height:20, borderRadius:5, border:`1px solid ${editItemDescuentoTipo===dt.value?C.gold:C.border}`, background:editItemDescuentoTipo===dt.value?`${C.gold}22`:"transparent", color:editItemDescuentoTipo===dt.value?C.goldLight:C.textMuted, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{dt.label}</button>
                                ))}
                              </div>
                            </div>
                            <div style={{ gridColumn:1, gridRow:2 }}><CurrencyField value={editItemValor} onChange={setEditItemValor} noMargin/></div>
                            <div style={{ gridColumn:2, gridRow:2 }}><CurrencyField value={editItemDescuento} onChange={setEditItemDescuento} noMargin/></div>
                          </div>
                        )}
                        <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Medios de pago</div>
                        {editItemPagos.length>0 && (
                          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:8 }}>
                            {editItemPagos.map((p,idx)=>{
                              const m = VENTAS_MEDIOS_PAGO.find(mm=>mm.value===p.medio_pago);
                              return (
                                <div key={idx} style={{ border:`1px solid ${C.gold}`, borderRadius:8, padding:"9px 10px", background:`${C.gold}0d` }}>
                                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                                    <span style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600 }}>{m?.label}</span>
                                    <button onClick={()=>quitarMedioDeEditItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                                  </div>
                                  <div style={{ display:"grid", gridTemplateColumns:VENTAS_MEDIOS_TARJETA.includes(p.medio_pago)?"1fr 1fr":"1fr", gap:10 }}>
                                    <CurrencyField label="Valor pagado" value={p.valor} onChange={v2=>setEditItemPagoValor(idx,v2)}/>
                                    {VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && <Field label="N.º autorización" value={p.numero_autorizacion||""} onChange={v2=>setEditItemPagoAutorizacion(idx,v2)} placeholder="Ej: 056495"/>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"end" }}>
                          <Field value={editItemMedioNuevo} onChange={v2=>{ if(v2) agregarMedioAEditItem(v2); else setEditItemMedioNuevo(v2); }} options={[{value:"",label:"+ Agregar medio de pago"}, ...VENTAS_MEDIOS_PAGO]}/>
                        </div>
                        {editItemPagos.length>0 && (
                          <div style={{ fontFamily:font.body, fontSize:12, marginBottom:10, color:Math.abs(editItemFalta)<1?C.green:C.red }}>
                            {Math.abs(editItemFalta)<1 ? "✓ Los medios cuadran con el valor de este renglón" : editItemFalta>0 ? `Faltan $${editItemFalta.toLocaleString("es-CO")} por asignar` : `Te pasaste por $${Math.abs(editItemFalta).toLocaleString("es-CO")}`}
                          </div>
                        )}
                      </>
                    )}
                    <div style={{ display:"flex", gap:8 }}>
                      <Btn onClick={agregarEditItem} disabled={editItemValorNum<=0 || editItemPagos.length===0 || Math.abs(editItemFalta)>=1 || editItemFaltaAUT || editItemBajoPiso} sm full>{editingItemIdx!==null ? "Guardar cambios del renglón" : "+ Agregar"}</Btn>
                      {editingItemIdx!==null && <Btn onClick={cancelarEdicionItem} variant="ghost" sm>Cancelar</Btn>}
                    </div>
                  </div>
                  </>)}
                  {!modoCambioProducto && <Field label="Observación" value={editObservacion} onChange={setEditObservacion} multiline rows={2}/>}
                  {!modoCambioProducto && editItems.some(i=>i.tipo==="flexipago") && (
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, margin:"6px 0 10px" }}>📦 Esta venta tiene un renglón Flexipago — no factura hasta completar el pago.</div>
                  )}
                  {modoNotacredito && !modoCambioProducto && (
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, margin:"-4px 0 10px" }}>
                      La factura original #{v.numero_factura||"—"} no cambia — el N.º de Siigo que escribas arriba, en el renglón, queda como el de esta Notacrédito.
                    </div>
                  )}
                  {!modoNotacredito && !editItems.some(i=>i.tipo==="flexipago") && (
                    <Field label="N.º de factura (Siigo)" value={editNumeroFactura} onChange={setEditNumeroFactura} placeholder="Ej: FE-1234"/>
                  )}
                  {editErrorMsg && (
                    <div style={{ fontFamily:font.body, fontSize:12, margin:"0 0 10px", padding:"8px 10px", borderRadius:7, background:`${C.red}18`, border:`1px solid ${C.red}`, color:C.red }}>
                      {editErrorMsg}
                    </div>
                  )}
                  <div style={{ display:"flex", gap:8 }}>
                    {modoCambioProducto ? (
                      <Btn onClick={guardarCambioProducto} disabled={ccGuardando || Number(v.valor_original ?? v.total ?? 0)<=0 || !ccNumeroFactura.trim()} sm>{ccGuardando?"Guardando...":"Guardar cambio de producto"}</Btn>
                    ) : (
                      <Btn onClick={()=>guardarEdicion(v)} disabled={guardando || (modoNotacredito && !editNumeroFactura.trim())} sm>{guardando?"Guardando...":"Guardar corrección"}</Btn>
                    )}
                    <Btn onClick={()=>{ setEditando(false); setEditErrorMsg(""); setModoErrorId(false); setModoCambioProducto(false); }} variant="ghost" sm>Cancelar</Btn>
                  </div>
                </div>
              ) : v.es_flexipago ? (
                <div style={{ marginBottom:10 }}>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1.3fr", gap:10 }}>
                    <Field label="Tipo de documento" value={ncCliente.tipoDoc} onChange={v2=>setNcCliente(prev=>({...prev,tipoDoc:v2}))} options={VENTAS_TIPOS_DOC}/>
                    <Field label="N.º de documento" value={ncCliente.documento} onChange={v2=>setNcCliente(prev=>({...prev,documento:v2}))}/>
                  </div>
                  <Field label="Nombre" value={ncCliente.nombre} onChange={v2=>setNcCliente(prev=>({...prev,nombre:v2}))}/>
                  <Field label="Teléfono" value={ncCliente.telefono} onChange={v2=>setNcCliente(prev=>({...prev,telefono:v2}))}/>
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", margin:"10px 0 6px" }}>Códigos de producto</div>
                  {ncCodigos.map((c,idx)=>(
                    <div key={idx} style={{ display:"grid", gridTemplateColumns: ncCodigos.length>1 ? "1fr 1fr auto" : "1fr 1fr", gap:6, marginBottom:6, alignItems:"center" }}>
                      <input value={c.codigo} onChange={e=>setNcCodigos(prev=>prev.map((x,i2)=>i2===idx?{...x,codigo:e.target.value.replace(/\D/g,"").slice(0,6)}:x))} placeholder="#producto" inputMode="numeric" maxLength={6} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
                      <CurrencyField value={c.valor} onChange={v2=>setNcCodigos(prev=>prev.map((x,i2)=>i2===idx?{...x,valor:v2}:x))} noMargin/>
                      {ncCodigos.length>1 && <button onClick={()=>setNcCodigos(prev=>prev.filter((_,i2)=>i2!==idx))} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>}
                    </div>
                  ))}
                  <button onClick={()=>setNcCodigos(prev=>[...prev,{codigo:"",valor:""}])} style={{ background:"none", border:`1px dashed ${C.border}`, borderRadius:7, color:C.textMuted, cursor:"pointer", fontSize:11, fontFamily:font.body, padding:"6px 10px", marginBottom:10, width:"100%" }}>+ Agregar otro código</button>
                  <div style={{ marginBottom:10 }}><Field label="Medio de pago inicial" value={ncAbonoMedio} onChange={setNcAbonoMedio} options={VENTAS_MEDIOS_REALES}/></div>
                  <Field label="Observación" value={editObservacion} onChange={setEditObservacion} multiline rows={2}/>
                  {(() => {
                    const suma = ncCodigos.reduce((s,c)=>s+Number(c.valor||0),0);
                    const piso = Number(v.valor_original ?? v.total);
                    const ok = suma>=piso;
                    return (
                      <>
                        <div style={{ fontFamily:font.body, fontSize:12, margin:"2px 0 10px", color: ok?C.green:C.red }}>
                          Nuevo valor total: <strong>${suma.toLocaleString("es-CO")}</strong> {!ok && `— debe ser al menos $${piso.toLocaleString("es-CO")}`}
                        </div>
                        {editErrorMsg && (
                          <div style={{ fontFamily:font.body, fontSize:12, margin:"0 0 10px", padding:"8px 10px", borderRadius:7, background:`${C.red}18`, border:`1px solid ${C.red}`, color:C.red }}>
                            {editErrorMsg}
                          </div>
                        )}
                        <div style={{ display:"flex", gap:8 }}>
                          <Btn onClick={()=>guardarEdicion(v)} disabled={guardando || !ok || !ncCliente.documento.trim() || !ncCliente.nombre.trim()} sm>{guardando?"Guardando...":"Guardar"}</Btn>
                          <Btn onClick={()=>{ setEditando(false); setEditErrorMsg(""); }} variant="ghost" sm>Cancelar</Btn>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:10 }}>
                    {ncItems.map((it,idx)=>(
                      <div key={it.id} style={{ display:"flex", gap:8, alignItems:"end", flexWrap:"wrap", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px" }}>
                        <div style={{ minWidth:140, flex:1 }}><Field label="Tipo" value={it.tipo} onChange={v2=>setNcItems(prev=>prev.map((x,i2)=>i2===idx?{...x,tipo:v2}:x))} options={VENTAS_TIPOS.filter(t=>t.value!=="flexipago")}/></div>
                        <div style={{ minWidth:120, flex:1 }}><CurrencyField label="Valor" value={it.valor} onChange={v2=>setNcItems(prev=>prev.map((x,i2)=>i2===idx?{...x,valor:v2}:x))}/></div>
                      </div>
                    ))}
                  </div>
                  <Field label="Observación" value={editObservacion} onChange={setEditObservacion} multiline rows={2}/>
                  <Field label="N.º de factura (Siigo)" value={editNumeroFactura} onChange={setEditNumeroFactura} placeholder="Ej: FE-1234"/>
                  {puedeEditarFechaAjuste && (
                    <Field label="Fecha real de la Notacrédito" type="date" value={ajusteFecha} onChange={setAjusteFecha}/>
                  )}
                  {(() => {
                    const nuevoBruto = ncItems.reduce((s,i)=>s+Number(i.valor||0),0);
                    const descuentoOriginal = ncItems.reduce((s,i)=>s+Number(i.descuento||0),0);
                    const nuevoTotal = nuevoBruto - descuentoOriginal;
                    const piso = Number(v.valor_original ?? v.total);
                    const ok = nuevoTotal>=piso;
                    return (
                      <>
                        <div style={{ fontFamily:font.body, fontSize:12, margin:"2px 0 10px", color: ok?C.green:C.red }}>
                          Nuevo total: <strong>${nuevoTotal.toLocaleString("es-CO")}</strong> {!ok && `— debe ser al menos $${piso.toLocaleString("es-CO")}`}
                        </div>
                        {editErrorMsg && (
                          <div style={{ fontFamily:font.body, fontSize:12, margin:"0 0 10px", padding:"8px 10px", borderRadius:7, background:`${C.red}18`, border:`1px solid ${C.red}`, color:C.red }}>
                            {editErrorMsg}
                          </div>
                        )}
                        <div style={{ display:"flex", gap:8 }}>
                          <Btn onClick={()=>guardarEdicion(v)} disabled={guardando || !ok} sm>{guardando?"Guardando...":"Guardar"}</Btn>
                          <Btn onClick={()=>{ setEditando(false); setEditErrorMsg(""); }} variant="ghost" sm>Cancelar</Btn>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {v.es_flexipago && (
                <>
                  <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", margin:"8px 0 3px" }}>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Abonos</div>
                    <div style={{ fontFamily:font.body, fontSize:12, fontWeight:700, color:saldoPendiente>0?C.amber:C.green }}>
                      {saldoPendiente>0 ? `Faltan $${saldoPendiente.toLocaleString("es-CO")}` : "✓ Saldado"}
                    </div>
                  </div>
                  {valorFlexipago>0 && (
                    <div style={{ height:4, borderRadius:2, background:C.border, overflow:"hidden", marginBottom:4 }}>
                      <div style={{ height:"100%", width:`${Math.min(100, Math.round((totalAbonado/valorFlexipago)*100))}%`, background: saldoPendiente<=0?C.green:C.gold, transition:"width 0.4s ease" }}/>
                    </div>
                  )}
                  <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:6 }}>
                    {(d?.abonos||[]).map(a=>(
                      editandoAbonoId===a.id ? (
                        <div key={a.id} style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"end", padding:"4px 0", background:C.dark, borderRadius:6, marginBottom:2 }}>
                          <div style={{ width:130 }}><Field label="Fecha" type="date" value={eaFecha} onChange={setEaFecha}/></div>
                          <div style={{ width:110 }}><Field label="Valor" value={eaValor} onChange={v2=>setEaValor(v2.replace(/[^\d]/g,""))}/></div>
                          <div style={{ width:130 }}><Field label="Medio" value={eaMedio} onChange={setEaMedio} options={VENTAS_MEDIOS_PAGO}/></div>
                          <Btn onClick={guardarEdicionAbono} disabled={guardandoEa} sm>{guardandoEa?"...":"Guardar"}</Btn>
                          <Btn onClick={()=>setEditandoAbonoId(null)} variant="ghost" sm>Cancelar</Btn>
                        </div>
                      ) : (
                        <div key={a.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:font.body, fontSize:12, color:C.text, padding:"2px 0" }}>
                          <span>{a.fecha} — {textoMediosAbono(a)}</span>
                          <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <span style={{fontFamily:font.mono}}>${Number(a.valor).toLocaleString("es-CO")}</span>
                            {/* Corregir en línea solo aplica a abonos de un solo medio — uno dividido
                                entre varios medios se corrige borrando/rehaciendo (no hay forma de
                                editar un desglose completo desde este lápiz sin arriesgar dejarlo mal). */}
                            {esAdmin && (!a.pagos || a.pagos.length<=1) && <button onClick={()=>iniciarEdicionAbono(a)} title="Corregir este abono" style={{ background:"none", border:"none", cursor:"pointer", color:C.textMuted, fontSize:12 }}>✏️</button>}
                          </span>
                        </div>
                      )
                    ))}
                    {(d?.abonos||[]).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin abonos todavía.</div>}
                  </div>
                  {saldoPendiente>0 && !soloLectura && (
                    flexipagoVencido ? (
                      <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:7, padding:"8px 10px", fontFamily:font.body, fontSize:12, color:C.red }}>
                        ⛔ Pasaron {diasDesdeAbono} días desde el primer abono (máximo {FLEXIPAGO_PLAZO_DIAS}, según el aviso legal). No se puede abonar más ni completar esta venta — el cliente pierde lo abonado y el separado.
                        {puedeReabrirVencido && (
                          <div style={{ marginTop:8 }}>
                            <Btn onClick={()=>reabrirFlexipagoVencido(v)} variant="ghost" sm style={{ color:C.amber }}>🔓 Reabrir de todas formas (la tienda lo honra con el cliente)</Btn>
                          </div>
                        )}
                      </div>
                    ) : abonoForm ? (
                      <div style={{ marginBottom:6 }}>
                        <div style={{ display:"flex", gap:8, alignItems:"end", flexWrap:"wrap" }}>
                          <div style={{ flex:1, minWidth:110 }}><CurrencyField label="Valor del abono" value={abonoValor} onChange={setAbonoValor}/></div>
                          {esAdmin && (
                            <div style={{ flex:1, minWidth:130 }}><Field label="Fecha del abono" type="date" value={abonoFecha} onChange={setAbonoFecha}/></div>
                          )}
                        </div>
                        {/* Un abono puede pagarse con varios medios a la vez (ej. mitad efectivo,
                            mitad tarjeta) — mismo patrón que "Medios de pago" al registrar una venta:
                            se van agregando renglones y deben sumar exactamente el valor de arriba. */}
                        {abonoValor && Number(abonoValor)>0 && (
                          <>
                            <div style={{ fontSize:10.5, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.06em", margin:"6px 0 4px" }}>Medios de pago</div>
                            {abonoPagos.length>0 && (
                              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:6 }}>
                                {abonoPagos.map((p,idx)=>{
                                  const m = VENTAS_MEDIOS_PAGO.find(mm=>mm.value===p.medio_pago);
                                  return (
                                    <div key={idx} style={{ border:`1px solid ${C.gold}`, borderRadius:7, padding:"7px 8px", background:`${C.gold}0d` }}>
                                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                                        <span style={{ fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600 }}>{m?.label}</span>
                                        <button onClick={()=>quitarMedioDeAbono(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                                      </div>
                                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                                        <div style={{ flex:1, minWidth:100 }}><CurrencyField label="Valor pagado" value={p.valor} onChange={v2=>setAbonoPagoValor(idx,v2)}/></div>
                                        {VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && <div style={{ flex:1, minWidth:100 }}><Field label="N.º autorización" value={p.numero_autorizacion||""} onChange={v2=>setAbonoPagoAutorizacion(idx,v2)} placeholder="Ej: 056495"/></div>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <Field value={abonoMedioNuevo} onChange={v2=>{ if(v2) agregarMedioAAbono(v2); else setAbonoMedioNuevo(v2); }} options={[{value:"",label:"+ Agregar medio de pago"}, ...VENTAS_MEDIOS_REALES]}/>
                            {abonoPagos.length>0 && (
                              <div style={{ fontFamily:font.body, fontSize:11.5, margin:"4px 0 6px", color:Math.abs(abonoFaltaPagos)<1?C.green:C.red }}>
                                {Math.abs(abonoFaltaPagos)<1 ? "✓ Los medios cuadran con el valor del abono" : abonoFaltaPagos>0 ? `Faltan $${abonoFaltaPagos.toLocaleString("es-CO")} por asignar` : `Te pasaste por $${Math.abs(abonoFaltaPagos).toLocaleString("es-CO")}`}
                              </div>
                            )}
                          </>
                        )}
                        {!v.numero_factura && abonoValor && Number(abonoValor)>0 && (valorFlexipago - totalAbonado - Number(abonoValor)) <= 0 && (
                          <Field label="N.º de factura (Siigo) nuevo — este abono deja el Flexipago pagado por completo *" value={abonoNumeroFactura} onChange={setAbonoNumeroFactura} placeholder="Ej: FE-1234"/>
                        )}
                        <div style={{ display:"flex", gap:6 }}>
                          <Btn onClick={()=>agregarAbono(v, valorFlexipago, totalAbonado)} disabled={!abonoValor || Number(abonoValor)<=0 || abonoPagos.length===0 || Math.abs(abonoFaltaPagos)>=1 || abonoFaltaAUT} sm>Guardar</Btn>
                          <Btn onClick={resetAbonoForm} variant="ghost" sm>Cancelar</Btn>
                        </div>
                      </div>
                    ) : (
                      <Btn onClick={()=>{ setAbonoForm(true); setAbonoFecha(todayStr); }} sm style={{ marginBottom:6 }}>+ Agregar abono</Btn>
                    )
                  )}
                </>
              )}

              {(d?.solicitudes||[]).length>0 && (
                <>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"8px 0 3px" }}>Solicitudes de corrección</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:6 }}>
                    {(d.solicitudes).map(s=>(
                      <div key={s.id} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 8px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                          <div style={{ fontFamily:font.body, fontSize:12, color:C.text }}>{s.motivo}</div>
                          <Badge color={s.estado==="pendiente"?C.amber:s.estado==="aprobada"?C.green:C.red} sm>{s.estado}{s.aplicada_at?" · aplicada":""}</Badge>
                        </div>
                        <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:2 }}>Pidió: {s.solicitado_por} · {fmtFechaHora(s.fecha_solicitud)}{s.resuelto_por?` · Resolvió: ${s.resuelto_por}`:""}</div>
                        {esAdmin && s.estado==="pendiente" && (
                          <div style={{ display:"flex", gap:6, marginTop:6 }}>
                            <Btn onClick={()=>resolverSolicitud(s,"aprobada")} variant="success" sm>Aprobar</Btn>
                            <Btn onClick={()=>resolverSolicitud(s,"rechazada")} variant="danger" sm>Rechazar</Btn>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(ajustes||[]).filter(a=>a.venta_id===v.id && a.es_cambio_producto).length>0 && (
                <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:4, marginBottom:2 }}>
                  {(ajustes||[]).filter(a=>a.venta_id===v.id && a.es_cambio_producto).map(a=>(
                    <div key={a.id} style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>
                      🔄 Cambio de producto (mismo valor) el {a.fecha} — NC Siigo #{a.numero_factura}: <span style={{ color:C.goldLight, fontFamily:font.mono }}>{fmtCOP(a.valor_informativo)}</span>{a.motivo?` · ${a.motivo}`:""}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:6 }}>
                {v.es_flexipago && <Btn onClick={()=>imprimirVenta(v,d)} variant="ghost" sm>🖨️ Imprimir</Btn>}
                {puedeEditar && !abiertoEdicion && !flexipagoVencido && !flexipagoCompletado && <Btn onClick={()=>iniciarEdicion(v)} sm title="Ya te aprobaron el Notacrédito — usa este botón para aplicarlo.">📝 Aplicar Notacrédito</Btn>}
                {puedeCorregirError && !abiertoEdicion && !flexipagoCompletado && <Btn onClick={()=>iniciarNotacredito(v)} variant="ghost" sm style={{ color:C.amber }} title="Usa esto cuando la corrección SÍ genera un número de factura nuevo en Siigo (incluye cambio de producto por el mismo valor). El valor no puede bajar del ya registrado, y necesitas el N.º de factura nuevo.">🧾 Notacrédito Siigo</Btn>}
                {puedeCorregirErrorAqui && !abiertoEdicion && !flexipagoCompletado && <Btn onClick={()=>iniciarCorregirFactura(v)} variant="ghost" sm style={{ color:C.textMuted }} title={esHoyTienda && !puedeCorregirError ? "Puedes corregir libremente lo registrado hoy mismo (sube o baja el valor sin límite). Para días anteriores, pide Notacrédito." : "Usa esto cuando NO cambió nada en Siigo — fue un error al registrar. Sube o baja el valor libremente, sin necesitar número de factura nuevo."}>🛠️ Corregir factura</Btn>}
                {puedeEliminarAqui && <Btn onClick={()=>eliminarVenta(v)} variant="ghost" sm style={{ color:C.red }} title={esHoyTienda && !esAdmin ? "Puedes eliminar lo registrado hoy mismo." : undefined}>🗑️ Eliminar venta</Btn>}
                {!soloLectura && !puedeCorregirErrorAqui && !flexipagoCompletado && (mostrarSolicitud ? (
                  <div style={{ display:"flex", gap:8, flex:1, minWidth:220, alignItems:"end" }}>
                    <div style={{ flex:1 }}><Field label="¿Qué hay que corregir y por qué?" value={motivoSolicitud} onChange={setMotivoSolicitud} multiline rows={2}/></div>
                    <div style={{ marginBottom:14, display:"flex", gap:6 }}>
                      <Btn onClick={enviarSolicitud} sm>Enviar</Btn>
                      <Btn onClick={()=>{setMostrarSolicitud(false);setMotivoSolicitud("");}} variant="ghost" sm>Cancelar</Btn>
                    </div>
                  </div>
                ) : (
                  <Btn onClick={()=>setMostrarSolicitud(true)} variant="ghost" sm title="Pide permiso a master o admin finanzas para corregir algo de un día anterior. Cuando lo aprueben, podrás aplicarlo tú mismo.">🔒 Solicitar Notacrédito</Btn>
                ))}
              </div>
            </>
          )}
        </div>
      </Collapse>
    </Card>
  );
}

function VentasRegistrarScreen({ user, stores, users, ventas, setVentas, ventasItems, setVentasItems, ventasAbonos, setVentasAbonos, ventasAjustes, setVentasAjustes, metas, isMobile, soloLectura, esAdmin }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  // OJO: el valor por defecto debe salir de tiendasVenta() (las que sí venden), no de todas las
  // tiendas — si no, el dropdown solo MUESTRA tiendas válidas pero el valor de por debajo puede
  // quedar en una tienda excluida (ej. Ozen Oficina) sin que se note, y la venta se guarda mal.
  const [tiendaId, setTiendaId] = useState(tiendaFija || tiendasVenta(stores)[0]?.id || "");
  const [fecha, setFecha] = useState(todayStr);
  const [numeroFactura, setNumeroFactura] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [items, setItems] = useState([]); // [{tipo, valorTotal, descuento, pagos:[{medio_pago,valor,numero_autorizacion}]}]
  const [itemTipo, setItemTipo] = useState("producto");
  const [itemValor, setItemValor] = useState("");
  // Códigos de los productos que se separaron en este Flexipago, cada uno con su propio valor —
  // es solo informativo para el comprobante (no suma en ningún cálculo), para que quede claro
  // cuánto costaba cada producto por separado.
  const [itemCodigosFlexipago, setItemCodigosFlexipago] = useState([{ codigo:"", valor:"" }]);
  const setCodigoFlexipago = (idx, campo, v) => setItemCodigosFlexipago(prev => prev.map((c,i)=> i===idx ? {...c,[campo]:v} : c));
  const agregarCodigoFlexipago = () => setItemCodigosFlexipago(prev => [...prev, { codigo:"", valor:"" }]);
  const quitarCodigoFlexipago = (idx) => setItemCodigosFlexipago(prev => prev.filter((_,i)=>i!==idx));
  const [itemDescuento, setItemDescuento] = useState("");
  const [itemDescuentoTipo, setItemDescuentoTipo] = useState("valor");
  const [itemPagos, setItemPagos] = useState([]); // [{medio_pago, valor, numero_autorizacion}] — permite repetir medio (ej. dos tarjetas)
  const [itemMedioNuevo, setItemMedioNuevo] = useState("");
  const [observacion, setObservacion] = useState("");

  const [flexipagoBellOpen, setFlexipagoBellOpen] = useState(false);

  const [clienteTipoDoc, setClienteTipoDoc] = useState("CC");
  const [clienteDocumento, setClienteDocumento] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [clienteEncontrado, setClienteEncontrado] = useState(false);

  const [abonoInicialValor, setAbonoInicialValor] = useState("");
  const [abonoInicialMedio, setAbonoInicialMedio] = useState("efectivo");
  const [abonoInicialAutorizacion, setAbonoInicialAutorizacion] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const asesores = users.filter(esVendedorPosible);

  // Busca si este documento ya compró antes y autocompleta nombre/teléfono
  useEffect(()=>{
    setClienteEncontrado(false);
    const doc = clienteDocumento.trim();
    if(doc.length<5){ setBuscandoCliente(false); return; }
    setBuscandoCliente(true);
    const t = setTimeout(async () => {
      const { data } = await supabase.from("ventas").select("cliente_nombre,cliente_telefono,cliente_tipo_doc").eq("cliente_documento",doc).order("created_at",{ascending:false}).limit(1);
      setBuscandoCliente(false);
      if(data && data[0]){
        setClienteNombre(data[0].cliente_nombre||"");
        setClienteTelefono(data[0].cliente_telefono||"");
        if(data[0].cliente_tipo_doc) setClienteTipoDoc(data[0].cliente_tipo_doc);
        setClienteEncontrado(true);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [clienteDocumento]);

  const itemEsFlexipago = itemTipo === "flexipago";

  // El valor total del Flexipago no se digita: es la suma de los valores de los códigos de
  // producto separados, para obligar al asesor a desglosarlos bien en vez de poner un total a ojo.
  const itemValorCodigosFlexipago = itemCodigosFlexipago.reduce((s,c)=>s+Number(c.valor||0),0);
  const itemValorNum = itemEsFlexipago ? itemValorCodigosFlexipago : Number(itemValor||0);
  const itemDescuentoInput = Number(itemDescuento||0);
  const itemDescuentoNum = itemDescuentoTipo==="porcentaje" ? Math.round(itemValorNum*itemDescuentoInput/100) : itemDescuentoInput;
  const itemNeto = itemValorNum - itemDescuentoNum;
  const itemSumaMedios = itemPagos.reduce((a,p)=>a+Number(p.valor||0),0);
  const itemFalta = itemNeto - itemSumaMedios;
  const itemFaltaAUT = itemPagos.some(p=>VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && !(p.numero_autorizacion||"").trim());
  const itemFlexipagoRestante = itemValorNum - Number(abonoInicialValor||0);
  const itemCodigoFlexipagoValido = itemCodigosFlexipago.some(c=>c.codigo.trim()!=="" && c.valor.trim()!=="");
  const itemFlexipagoValido = itemValorNum>0 && itemCodigoFlexipagoValido && clienteDocumento.trim()!=="" && clienteNombre.trim()!=="" && abonoInicialValor.trim()!=="";

  const agregarMedioAItem = (medio) => {
    const m = medio || itemMedioNuevo;
    if(!m) return;
    // La mayoría de las veces se paga todo con un solo medio, así que se sugiere lo que falta
    // (la primera vez, el valor total del item). Si pagan con varios medios, el asesor lo corrige.
    const sugerido = Math.max(0, itemFalta);
    setItemPagos(prev=>[...prev, { medio_pago:m, valor: sugerido>0?String(sugerido):"", numero_autorizacion:"" }]);
    setItemMedioNuevo(""); // vuelve al placeholder, listo para agregar el siguiente medio
  };
  const quitarMedioDeItem = (idx) => setItemPagos(prev=>prev.filter((_,i)=>i!==idx));
  const setItemPagoValor = (idx, v) => setItemPagos(prev=>prev.map((p,i)=>i===idx?{...p,valor:v}:p));
  const setItemPagoAutorizacion = (idx, v) => setItemPagos(prev=>prev.map((p,i)=>i===idx?{...p,numero_autorizacion:v}:p));

  const agregarItem = () => {
    if(itemEsFlexipago){
      if(!itemFlexipagoValido) return;
      const codigosFlexipago = itemCodigosFlexipago.filter(c=>c.codigo.trim()||c.valor.trim());
      setItems(prev=>[...prev, { tipo:"flexipago", valorTotal:itemValorNum, descuento:0, pagos:[], codigosFlexipago }]);
      setItemValor(""); setItemCodigosFlexipago([{ codigo:"", valor:"" }]);
      return;
    }
    if(itemValorNum<=0 || itemPagos.length===0 || Math.abs(itemFalta)>=1 || itemFaltaAUT) return;
    const pagos = itemPagos.map(p=>({ medio_pago:p.medio_pago, valor:Number(p.valor||0), numero_autorizacion:VENTAS_MEDIOS_TARJETA.includes(p.medio_pago)?(p.numero_autorizacion||"").trim():null }));
    setItems(prev=>[...prev, { tipo:itemTipo, valorTotal:itemValorNum, descuento:itemDescuentoNum, pagos }]);
    setItemValor(""); setItemDescuento(""); setItemDescuentoTipo("valor"); setItemPagos([]);
  };
  const quitarItem = (idx) => setItems(prev=>prev.filter((_,i)=>i!==idx));

  const valorBruto = items.reduce((a,i)=>a+i.valorTotal,0);
  const descuentoNum = items.reduce((a,i)=>a+i.descuento,0);
  const total = valorBruto - descuentoNum;
  const esFlexipago = items.some(i=>i.tipo==="flexipago");
  const valorFlexipago = items.filter(i=>i.tipo==="flexipago").reduce((a,i)=>a+i.valorTotal,0);
  const saldoPendiente = esFlexipago ? valorFlexipago - Number(abonoInicialValor||0) : 0;
  // El N.º de factura (Siigo) solo aplica a ítems tipo "Venta" (producto). Grabado, arreglo,
  // marcación y flexipago no se facturan por Siigo, así que no se pide ni se exige.
  const requiereSiigo = !esFlexipago && items.some(i=>i.tipo==="producto");
  // Flexipago es excluyente con el resto: o estás separando (Flexipago) o estás comprando
  // normal, no las dos cosas en la misma factura. Si ya hay un renglón de un lado, el otro
  // desaparece de las opciones — igual que un "o esto o lo otro", no un checkbox.
  const itemTipoOptions = items.length===0 ? VENTAS_TIPOS : esFlexipago ? VENTAS_TIPOS.filter(t=>t.value==="flexipago") : VENTAS_TIPOS.filter(t=>t.value!=="flexipago");
  useEffect(() => { if(!itemTipoOptions.some(t=>t.value===itemTipo)) setItemTipo(itemTipoOptions[0]?.value||"producto"); }, [esFlexipago, items.length]);

  const limpiarTodo = () => {
    setNumeroFactura(""); setVendedorId(""); setItems([]); setItemTipo("producto"); setItemValor(""); setItemDescuento(""); setItemDescuentoTipo("valor"); setItemPagos([]); setItemMedioNuevo(""); setObservacion(""); setItemCodigosFlexipago([{ codigo:"", valor:"" }]);
    setAbonoInicialValor(""); setAbonoInicialMedio("efectivo"); setAbonoInicialAutorizacion("");
    setClienteTipoDoc("CC"); setClienteDocumento(""); setClienteNombre(""); setClienteTelefono(""); setClienteEncontrado(false);
  };

  const guardar = async () => {
    setMsg("");
    if(soloLectura){ setMsg("No tienes permiso para registrar ventas — solo puedes ver esta pantalla."); return; }
    if(!tiendaId){ setMsg("Falta elegir la tienda."); return; }
    if(!vendedorId){ setMsg("Falta elegir quién hizo la venta."); return; }
    if(items.length===0 || valorBruto<=0){ setMsg("Agrega al menos una venta o servicio."); return; }
    if(requiereSiigo && !numeroFactura.trim()){ setMsg("Falta el número de factura de Siigo."); return; }
    if(esFlexipago){
      if(!clienteDocumento.trim() || !clienteNombre.trim()){ setMsg("Flexipago necesita los datos del cliente para poder contactarlo."); return; }
      if(Number(abonoInicialValor||0)>0 && !abonoInicialMedio){ setMsg("Falta el medio de pago del abono inicial."); return; }
      if(Number(abonoInicialValor||0)>0 && VENTAS_MEDIOS_TARJETA.includes(abonoInicialMedio) && !abonoInicialAutorizacion.trim()){ setMsg("Falta el número de autorización del abono inicial."); return; }
    }
    setGuardando(true);
    const vendedor = users.find(u=>u.id===vendedorId);
    const { data:venta, error } = await supabase.from("ventas").insert({
      fecha, numero_factura:requiereSiigo?numeroFactura.trim():(numeroFactura.trim()||null), tienda_id:tiendaId, vendedor_id:vendedorId, vendedor_nombre:vendedor?.name||"",
      registrado_por:user.name,
      cliente_tipo_doc:esFlexipago?clienteTipoDoc:null, cliente_documento:esFlexipago?clienteDocumento.trim():null,
      cliente_nombre:esFlexipago?clienteNombre.trim():null, cliente_telefono:esFlexipago?clienteTelefono.trim():null,
      observacion:observacion.trim(), valor_bruto:valorBruto, descuento_total:descuentoNum, total, valor_original:total, es_flexipago:esFlexipago,
    }).select().single();
    if(error || !venta){ setGuardando(false); setMsg("No se pudo guardar. Intenta de nuevo."); sonidoError(); return; }
    const filasItems = items.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valorTotal, descuento:i.descuento, pagos:i.pagos, codigos_producto:(i.codigosFlexipago&&i.codigosFlexipago.length)?i.codigosFlexipago:null }));
    const { data:itemsGuardados, error:errorItems } = await supabase.from("ventas_items").insert(filasItems).select();
    if(errorItems){ setGuardando(false); setMsg("La venta se guardó, pero hubo un problema guardando las ventas/servicios."); sonidoError(); return; }
    if(itemsGuardados && setVentasItems) setVentasItems(prev=>[...prev, ...itemsGuardados]);
    if(esFlexipago && Number(abonoInicialValor||0) > 0){
      await supabase.from("ventas_abonos").insert({ venta_id:venta.id, fecha, valor:Number(abonoInicialValor), registrado_por:user.name, medio_pago:abonoInicialMedio, numero_autorizacion:VENTAS_MEDIOS_TARJETA.includes(abonoInicialMedio)?abonoInicialAutorizacion.trim():null });
    }
    setGuardando(false);
    setVentas(prev=>[venta, ...prev]);
    const numeroMsg = venta.numero_factura ? ` #${venta.numero_factura}` : "";
    limpiarTodo();
    setMsg(`✓ Venta${numeroMsg} registrada`);
    sonidoVenta();
    setTimeout(()=>setMsg(""), 3000);
  };

  const ventasHoy = ventas.filter(v=>v.fecha===fecha && v.tienda_id===tiendaId);

  // Abonos que entraron hoy a un Flexipago creado en OTRO día — el dinero entra hoy aunque la
  // venta se haya abierto antes, así que también debe verse en "Ventas de hoy" de esta tienda.
  // (Si el Flexipago se creó y se pagó completo hoy mismo, ya se ve como venta normal arriba,
  // no se duplica aquí). Si hubo VARIOS abonos hoy para la misma venta (ej: pagó una parte con
  // tarjeta y volvió más tarde con efectivo), se agrupan en una sola tarjeta — antes se mostraba
  // un renglón por cada abono y parecía una venta duplicada.
  const gruposAbonoHoy = {};
  (ventasAbonos||[]).filter(a=>a.fecha===fecha).forEach(a=>{
    const venta = ventas.find(v=>v.id===a.venta_id);
    if(!venta || venta.tienda_id!==tiendaId || venta.fecha===fecha) return;
    if(!gruposAbonoHoy[venta.id]) gruposAbonoHoy[venta.id] = { venta, abonos:[] };
    gruposAbonoHoy[venta.id].abonos.push(a);
  });
  const abonosHoyTienda = Object.values(gruposAbonoHoy).map(({venta, abonos})=>{
    const valorFlex = ventasItems.filter(i=>i.venta_id===venta.id && i.tipo==="flexipago").reduce((s,i)=>s+Number(i.valor||0)-Number(i.descuento||0),0);
    const todasDeEstaVenta = (ventasAbonos||[]).filter(ab=>ab.venta_id===venta.id).sort((p,q)=> new Date(p.created_at||p.fecha) - new Date(q.created_at||q.fecha) || String(p.id).localeCompare(String(q.id)));
    const idsHoy = new Set(abonos.map(a=>a.id));
    const primerIdxHoy = todasDeEstaVenta.findIndex(ab=>idsHoy.has(ab.id));
    const antes = todasDeEstaVenta.slice(0,primerIdxHoy).reduce((s,ab)=>s+Number(ab.valor||0),0);
    const abonosOrdenados = [...abonos].sort((p,q)=> new Date(p.created_at||p.fecha) - new Date(q.created_at||q.fecha) || String(p.id).localeCompare(String(q.id)));
    const totalHoy = abonosOrdenados.reduce((s,a)=>s+Number(a.valor||0),0);
    const completa = valorFlex>0 && (antes + totalHoy) >= valorFlex;
    const mediosHoy = [...new Set(abonosOrdenados.flatMap(a=>mediosDeAbono(a).map(p=>p.medio_pago)))];
    return { venta, abonos:abonosOrdenados, valorFlex, antes, totalHoy, completa, mediosHoy };
  });

  // Notacrédito: excedentes cuya fecha REAL (fecha_item del renglón, vía ventas_ajustes) cae en la
  // fecha que se está viendo, sin importar el día en que se registró la factura original — es un
  // registro aparte para que quede visible que hubo una Notacrédito, con el valor del excedente
  // (no el valor original de la factura). El monto ya suma como venta normal en su ítem
  // correspondiente; esta tarjeta es solo para que quede el rastro.
  const notaCreditoHoyTienda = (ventasAjustes||[]).filter(aj=>aj.fecha===fecha && !aj.es_correccion_error).map(aj=>{
    const venta = ventas.find(v=>v.id===aj.venta_id);
    return venta && venta.tienda_id===tiendaId ? { venta, ajuste:aj } : null;
  }).filter(Boolean);

  // Meta del día de hoy para la tienda seleccionada (si ya se asignó por día en Métricas) y
  // cuánto falta para completarla — el dato que se quiere ver de primeras al registrar ventas.
  const todayDiaNum = Number(todayStr.slice(8,10));
  const todayMesKey = todayStr.slice(0,7);
  const metaHoyTienda = tiendaId ? Number(metas?.find(m=>m.mes===todayMesKey && m.tienda_id===tiendaId && (m.tipo||"total")==="total")?.valores_dia?.[todayDiaNum] || 0) : 0;
  // "Vendido hoy" tenía un bug: contaba las ventas normales de hoy, pero excluía POR COMPLETO
  // cualquier Flexipago — ni su abono de hoy, ni su cierre si se terminó de pagar justo hoy. Eso
  // hacía que "faltan" saliera mal apenas había un abono o cierre de Flexipago en el día (el mismo
  // criterio que ya usa Métricas: un Flexipago cuenta su valor completo el día que se TERMINA de
  // pagar, y mientras sigue abierto, lo abonado ese día sí cuenta como plata real que entró hoy).
  const cierresFlexipagoTodos = tiendaId ? calcularCierresFlexipago(ventas, ventasItems, ventasAbonos) : [];
  const idsFlexipagoCerrados = new Set(cierresFlexipagoTodos.map(c=>c.ventaId));
  const cierresFlexipagoHoyTienda = cierresFlexipagoTodos.filter(c=>c.tiendaId===tiendaId && c.fechaCierre===todayStr).reduce((s,c)=>s+c.valorNeto,0);
  const abonosFlexipagoAbiertoHoyTienda = tiendaId ? (ventasAbonos||[]).filter(ab=>{
    if(ab.fecha!==todayStr) return false;
    const v = ventas.find(x=>x.id===ab.venta_id);
    if(!v || !v.es_flexipago || v.tienda_id!==tiendaId) return false;
    return !idsFlexipagoCerrados.has(v.id);
  }).reduce((s,ab)=>s+Number(ab.valor||0),0) : 0;
  // Notacrédito (excedentes) cuya fecha real de hoy — mismo criterio que Métricas: el excedente
  // cuenta el día en que de verdad se generó, no el día de la factura original.
  const ajustesHoyTienda = tiendaId ? (ventasAjustes||[]).filter(aj=>aj.fecha===todayStr && !aj.es_correccion_error && ventas.find(v=>v.id===aj.venta_id)?.tienda_id===tiendaId).reduce((s,aj)=>s+Number(aj.diferencia||0),0) : 0;
  const vendidoHoyTienda = tiendaId ? ventas.filter(v=>v.fecha===todayStr && v.tienda_id===tiendaId && !v.es_flexipago).reduce((s,v)=>s+Number(v.total||0),0) + cierresFlexipagoHoyTienda + abonosFlexipagoAbiertoHoyTienda + ajustesHoyTienda : 0;
  const faltaHoyTienda = Math.max(0, metaHoyTienda - vendidoHoyTienda);
  // Flexipagos de esta tienda que hay que recordarle al cliente que venga a pagar — vencidos,
  // urgentes (5 días o menos) o a mitad de plazo (30+ días), mismos umbrales que ya usa la
  // tarjeta de cada venta. Se muestra arriba de todo para que sea lo primero que vea el asesor.
  const flexipagosAvisar = tiendaId ? flexipagosPorVencer(tiendaId, ventas, ventasItems, ventasAbonos, todayStr) : [];

  return (
    <>
      {soloLectura && (
        <div style={{ background:`${C.amber}18`, border:`1px solid ${C.amber}55`, borderRadius:8, padding:"10px 14px", marginBottom:14, fontFamily:font.body, fontSize:12, color:C.amber }}>
          👁️ Modo solo lectura — puedes ver esta pantalla, pero no tienes permiso para registrar ventas.
        </div>
      )}
    <div style={soloLectura ? { pointerEvents:"none", opacity:0.55 } : undefined}>
      <PageHeader
        title="Registrar venta"
        subtitle={stores[tiendaId]?.name ? `Tienda: ${stores[tiendaId].name}` : "Elige la tienda"}
        action={(tiendaId && (metaHoyTienda>0 || flexipagosAvisar.length>0)) && (
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, flexWrap:"wrap", justifyContent:"flex-end", width: isMobile?"100%":undefined }}>
            {flexipagosAvisar.length>0 && (
              <div style={{ position:"relative" }}>
                <button
                  onClick={()=>setFlexipagoBellOpen(s=>!s)}
                  title="Flexipagos por recordarle al cliente"
                  style={{
                    position:"relative", display:"flex", alignItems:"center", justifyContent:"center",
                    width:38, height:38, borderRadius:99, cursor:"pointer", fontSize:17,
                    background: flexipagoBellOpen ? C.surfaceAlt : "transparent",
                    border:`1.5px solid ${flexipagosAvisar.some(f=>f.vencido||f.urgente)?C.red:C.gold}`,
                  }}
                >
                  🔔
                  <span style={{
                    position:"absolute", top:-5, right:-5, minWidth:17, height:17, padding:"0 4px",
                    borderRadius:99, background:flexipagosAvisar.some(f=>f.vencido||f.urgente)?C.red:C.gold,
                    color:"#111", fontFamily:font.mono, fontSize:10, fontWeight:800,
                    display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1,
                  }}>{flexipagosAvisar.length}</span>
                </button>
                {flexipagoBellOpen && (
                  <>
                    <div onClick={()=>setFlexipagoBellOpen(false)} style={{ position:"fixed", inset:0, zIndex:90 }}/>
                    <div style={{
                      position:"absolute", zIndex:91, top:"120%", right:0, width:300, maxWidth:"88vw",
                      maxHeight:340, overflowY:"auto", background:C.dark, border:`1px solid ${C.border}`,
                      borderRadius:10, boxShadow:"0 10px 30px rgba(0,0,0,0.5)", padding:8,
                    }}>
                      <div style={{ fontFamily:font.body, fontSize:11.5, fontWeight:700, color:C.goldLight, padding:"4px 6px 8px", textTransform:"uppercase", letterSpacing:"0.04em" }}>
                        🔔 Flexipagos por recordarle al cliente
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        {flexipagosAvisar.map(({venta:v, saldoPendiente, diasRestantes60, vencido})=>(
                          <div key={v.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"7px 10px", background:C.surfaceAlt, borderRadius:7, flexWrap:"wrap" }}>
                            <div style={{ fontFamily:font.body, fontSize:12.5, color:C.text }}>
                              <b>{v.cliente_nombre||"Cliente sin nombre"}</b> {v.cliente_telefono && <span style={{ color:C.textMuted }}>· Tel: {v.cliente_telefono}</span>}
                              <div style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, marginTop:1 }}>Debe {fmtCOP(saldoPendiente)}</div>
                            </div>
                            <Badge color={vencido?C.red:(diasRestantes60!==null && diasRestantes60<=5?C.amber:C.gold)} sm>
                              {vencido ? "⛔ Vencido" : `⏳ Vence en ${diasRestantes60}d`}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
            {metaHoyTienda>0 && (() => {
              // Antes esta burbuja mostraba la META arriba en grande (y solo cambiaba a vendido
              // una vez cumplida) — lo que el asesor quiere ver protagonista todo el día es
              // cuánto lleva VENDIDO. La barra también se quedaba pegada en un solo color (el
              // "gold" de la marca es en realidad un azul oscuro, por eso "se veía azul sin más")
              // — ahora cambia de etapa (azul vivo → ámbar cerca de la meta → verde al cumplirla)
              // para que se sienta viva y dé ganas de completarla.
              const pctRaw = (vendidoHoyTienda/metaHoyTienda)*100;
              const pct = Math.max(0, Math.min(100, Math.round(pctRaw)));
              const cumplida = faltaHoyTienda<=0;
              const etapaColor = cumplida ? C.green : pctRaw>=75 ? C.amber : C.blue;
              return (
                <div className={cumplida?"ozen-meta-cumplida":""} style={{
                  display:"flex", flexDirection:"column", gap:5,
                  background: `linear-gradient(135deg, ${etapaColor}26, ${etapaColor}08)`,
                  border:`1.5px solid ${etapaColor}`, borderRadius:12, padding:"10px 18px",
                  width: isMobile?"100%":undefined, minWidth: isMobile?0:320, boxSizing:"border-box",
                  boxShadow:`0 3px 14px ${etapaColor}22`, transition:"border-color 0.4s ease, background 0.4s ease",
                }}>
                  <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:10 }}>
                    <div style={{ fontFamily:font.body, fontSize:9.5, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", whiteSpace:"nowrap" }}>{cumplida?"🎉":"🎯"} Vendido hoy</div>
                    <div style={{ fontFamily:font.body, fontSize:9.5, color:C.textMuted, whiteSpace:"nowrap" }}>Meta {fmtCOP(metaHoyTienda)}</div>
                  </div>
                  <div style={{ fontFamily:font.mono, fontSize:22, fontWeight:800, color:C.goldLight, whiteSpace:"nowrap", lineHeight:1 }}>{fmtCOP(vendidoHoyTienda)}</div>
                  <div style={{ height:9, borderRadius:5, background:C.dark, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct}%`, borderRadius:5, background:`linear-gradient(90deg, ${C.blue}, ${etapaColor})`, transition:"width 0.5s cubic-bezier(.34,1.2,.5,1), background 0.4s ease" }}/>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div style={{ fontFamily:font.body, fontSize:10.5, fontWeight:700, color:etapaColor, whiteSpace:"nowrap" }}>
                      {cumplida ? `¡Meta cumplida! +${fmtCOP(vendidoHoyTienda-metaHoyTienda)}` : `Faltan ${fmtCOP(faltaHoyTienda)}`}
                    </div>
                    <div style={{ fontFamily:font.mono, fontSize:10.5, fontWeight:700, color:etapaColor, whiteSpace:"nowrap" }}>{pct}%</div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      />
      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:16, alignItems:"start" }}>
        <div>
          <SeccionVenta icon="🏬" titulo="Información general">
            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12 }}>
              {!tiendaFija ? (
                <Field label="Tienda" value={tiendaId} onChange={setTiendaId} options={tiendasVenta(stores).map(s=>({value:s.id,label:s.name}))}/>
              ) : (
                <div>
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>Tienda</div>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, padding:"9px 0" }}>{stores[tiendaId]?.name || "—"}</div>
                </div>
              )}
              {(user.role==="master" || user.role==="admin_finanzas") ? (
                <Field label="Fecha" type="date" value={fecha} onChange={setFecha}/>
              ) : (
                <div>
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>Fecha</div>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, padding:"9px 0" }}>{fecha} (hoy)</div>
                </div>
              )}
            </div>
            <Field label="¿Quién hizo la venta?" value={vendedorId} onChange={setVendedorId} options={[{value:"",label:"Selecciona un asesor"},...asesores.map(a=>({value:a.id,label:a.name}))]}/>
          </SeccionVenta>

          <SeccionVenta icon="🛍️" titulo="Ventas y servicios">
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
              {items.map((it,idx)=>(
                <div key={idx} style={{ display:"flex", flexDirection:"column", gap:4, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <Badge color={it.tipo==="producto"?C.green:it.tipo==="flexipago"?C.blue:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===it.tipo)?.label}</Badge>
                    <div style={{ flex:1, fontFamily:font.mono, fontSize:12, color:C.text, textAlign:"right" }}>${it.valorTotal.toLocaleString("es-CO")}{it.descuento>0 && ` (desc $${it.descuento.toLocaleString("es-CO")})`}</div>
                    <button onClick={()=>quitarItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                  </div>
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    {it.tipo==="flexipago" ? (
                      <Badge color={C.blue} sm>📦 Flexipago — se cobra con abonos</Badge>
                    ) : it.pagos.map((p,pidx)=>(
                      <Badge key={pidx} color={C.blue} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}{p.numero_autorizacion?` · AUT ${p.numero_autorizacion}`:""}</Badge>
                    ))}
                  </div>
                </div>
              ))}
              {items.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Todavía no has agregado nada.</div>}
            </div>

            <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"12px" }}>
              <Field label="Tipo" value={itemTipo} onChange={setItemTipo} options={itemTipoOptions}/>
              {items.length>0 && (esFlexipago
                ? <div style={{ fontFamily:font.body, fontSize:11, color:C.blue, marginTop:-8, marginBottom:10 }}>📦 Esta factura ya tiene un Flexipago — no se puede mezclar con otros tipos.</div>
                : <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:-8, marginBottom:10 }}>Ya hay ítems normales en esta factura — para un Flexipago, hazlo en una factura aparte.</div>
              )}
              {itemEsFlexipago ? (
                <>
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>Valor total</div>
                    <div style={{ width:"100%", background:C.dark, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.mono, boxSizing:"border-box" }}>${itemValorCodigosFlexipago.toLocaleString("es-CO")}</div>
                  </div>
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Productos separados</div>
                  {itemCodigosFlexipago.map((c,idx)=>(
                    <div key={idx} style={{ display:"grid", gridTemplateColumns: itemCodigosFlexipago.length>1 ? "1fr 1fr auto" : "1fr 1fr", gap:6, marginBottom:6, alignItems:"center" }}>
                      <input value={c.codigo} onChange={e=>setCodigoFlexipago(idx,"codigo",e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="#producto" inputMode="numeric" maxLength={6} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
                      <CurrencyField value={c.valor} onChange={v=>setCodigoFlexipago(idx,"valor",v)} noMargin/>
                      {itemCodigosFlexipago.length>1 && <button onClick={()=>quitarCodigoFlexipago(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>}
                    </div>
                  ))}
                  <button onClick={agregarCodigoFlexipago} style={{ background:"none", border:`1px dashed ${C.border}`, borderRadius:7, color:C.textMuted, cursor:"pointer", fontSize:11, fontFamily:font.body, padding:"6px 10px", marginBottom:10, width:"100%" }}>+ Agregar otro código</button>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr", gap:10, marginBottom:4 }}>
                    <CurrencyField label="Valor del abono" value={abonoInicialValor} onChange={setAbonoInicialValor}/>
                    <Field label="Medio de pago" value={abonoInicialMedio} onChange={setAbonoInicialMedio} options={VENTAS_MEDIOS_REALES}/>
                  </div>
                  {VENTAS_MEDIOS_TARJETA.includes(abonoInicialMedio) && (
                    <Field label="N.º autorización" value={abonoInicialAutorizacion} onChange={setAbonoInicialAutorizacion} placeholder="Ej: 056495"/>
                  )}
                  {itemValorNum>0 && abonoInicialValor.trim()!=="" && (
                    <div style={{ fontFamily:font.body, fontSize:12, marginBottom:10, color:itemFlexipagoRestante>0?C.amber:C.green }}>
                      {itemFlexipagoRestante>0 ? `Queda pendiente: $${itemFlexipagoRestante.toLocaleString("es-CO")}` : "✓ Queda saldado con este abono"}
                    </div>
                  )}
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Datos del cliente</div>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1.3fr", gap:10 }}>
                    <Field label="Tipo de documento" value={clienteTipoDoc} onChange={setClienteTipoDoc} options={VENTAS_TIPOS_DOC}/>
                    <div>
                      <Field label="N.º de documento" value={clienteDocumento} onChange={setClienteDocumento}/>
                      {buscandoCliente && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:-10, marginBottom:10 }}>Buscando...</div>}
                      {clienteEncontrado && <div style={{ fontFamily:font.body, fontSize:10, color:C.green, marginTop:-10, marginBottom:10 }}>✓ Cliente encontrado, datos autocompletados</div>}
                    </div>
                  </div>
                  <Field label="Nombre" value={clienteNombre} onChange={setClienteNombre}/>
                  <Field label="Teléfono" value={clienteTelefono} onChange={setClienteTelefono}/>

                  <div style={{ marginTop:6 }}>
                    <HoverTooltip label="ⓘ Aviso legal" labelStyle={{ fontSize:11, fontWeight:700, color:C.textMuted }} width={340} clickOnly>
                      {FLEXIPAGO_AVISO_ITEMS.map((it,i)=>(
                        <div key={i} style={{ fontFamily:font.body, fontSize:11, color:C.text, lineHeight:1.45, marginBottom:6, textAlign:"left" }}>
                          {it.n ? <><b>{it.n}. {it.titulo}:</b> {it.texto}</> : it.texto}
                        </div>
                      ))}
                    </HoverTooltip>
                  </div>
                </>
              ) : (
                <>
                  {isMobile ? (
                    <div style={{ marginBottom:4 }}>
                      <CurrencyField label="Valor total" value={itemValor} onChange={setItemValor}/>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                        <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Descuento / Bono</div>
                        <div style={{ display:"flex", gap:4 }}>
                          {VENTAS_DESCUENTO_TIPOS.map(dt=>(
                            <button key={dt.value} type="button" onClick={()=>setItemDescuentoTipo(dt.value)} style={{ width:22, height:20, borderRadius:5, border:`1px solid ${itemDescuentoTipo===dt.value?C.gold:C.border}`, background:itemDescuentoTipo===dt.value?`${C.gold}22`:"transparent", color:itemDescuentoTipo===dt.value?C.goldLight:C.textMuted, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{dt.label}</button>
                          ))}
                        </div>
                      </div>
                      <CurrencyField value={itemDescuento} onChange={setItemDescuento}/>
                    </div>
                  ) : (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gridTemplateRows:"auto auto", columnGap:10, rowGap:5, marginBottom:4 }}>
                      <div style={{ gridColumn:1, gridRow:1, fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Valor total</div>
                      <div style={{ gridColumn:2, gridRow:1, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Descuento / Bono</div>
                        <div style={{ display:"flex", gap:4 }}>
                          {VENTAS_DESCUENTO_TIPOS.map(dt=>(
                            <button key={dt.value} type="button" onClick={()=>setItemDescuentoTipo(dt.value)} style={{ width:22, height:20, borderRadius:5, border:`1px solid ${itemDescuentoTipo===dt.value?C.gold:C.border}`, background:itemDescuentoTipo===dt.value?`${C.gold}22`:"transparent", color:itemDescuentoTipo===dt.value?C.goldLight:C.textMuted, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{dt.label}</button>
                          ))}
                        </div>
                      </div>
                      <div style={{ gridColumn:1, gridRow:2 }}><CurrencyField value={itemValor} onChange={setItemValor} noMargin/></div>
                      <div style={{ gridColumn:2, gridRow:2 }}><CurrencyField value={itemDescuento} onChange={setItemDescuento} noMargin/></div>
                    </div>
                  )}

                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Medios de pago</div>
                  {itemPagos.length>0 && (
                    <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:8 }}>
                      {itemPagos.map((p,idx)=>{
                        const m = VENTAS_MEDIOS_PAGO.find(mm=>mm.value===p.medio_pago);
                        return (
                          <div key={idx} style={{ border:`1px solid ${C.gold}`, borderRadius:8, padding:"9px 10px", background:`${C.gold}0d` }}>
                            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                              <span style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600 }}>{m?.label}</span>
                              <button onClick={()=>quitarMedioDeItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:VENTAS_MEDIOS_TARJETA.includes(p.medio_pago)?"1fr 1fr":"1fr", gap:10 }}>
                              <CurrencyField label="Valor pagado" value={p.valor} onChange={v=>setItemPagoValor(idx,v)}/>
                              {VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && <Field label="N.º autorización" value={p.numero_autorizacion||""} onChange={v=>setItemPagoAutorizacion(idx,v)} placeholder="Ej: 056495"/>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Field value={itemMedioNuevo} onChange={v=>{ if(v) agregarMedioAItem(v); else setItemMedioNuevo(v); }} options={[{value:"",label:"+ Agregar medio de pago"}, ...VENTAS_MEDIOS_PAGO]}/>
                  {itemPagos.length>0 && (
                    <div style={{ fontFamily:font.body, fontSize:12, marginBottom:10, color:Math.abs(itemFalta)<1?C.green:C.red }}>
                      {Math.abs(itemFalta)<1 ? "✓ Los medios cuadran con el valor de este renglón" : itemFalta>0 ? `Faltan $${itemFalta.toLocaleString("es-CO")} por asignar` : `Te pasaste por $${Math.abs(itemFalta).toLocaleString("es-CO")}`}
                    </div>
                  )}
                </>
              )}
              <Btn onClick={agregarItem} disabled={itemEsFlexipago ? !itemFlexipagoValido : (itemValorNum<=0 || itemPagos.length===0 || Math.abs(itemFalta)>=1 || itemFaltaAUT)} sm full>+ Agregar</Btn>
            </div>
          </SeccionVenta>
        </div>

        <div style={{ position:isMobile?"static":"sticky", top:16 }}>
          <Card glow style={{ marginBottom:16, padding:0, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color:C.goldLight }}>🧾 Venta actual</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:2 }}>
                {[
                  esFlexipago && clienteNombre ? clienteNombre : null,
                  stores[tiendaId]?.name || null,
                  asesores.find(a=>a.id===vendedorId)?.name || null,
                ].filter(Boolean).join(" · ") || "Completa los datos para empezar"}
              </div>
            </div>

            <div style={{ padding:"14px 16px" }}>
              {items.length>0 && (
                <>
                  <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Ventas y servicios</div>
                  {items.map((it,idx)=>(
                    <div key={idx} style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:4 }}>
                      <span>{VENTAS_TIPOS.find(t=>t.value===it.tipo)?.label} · {it.tipo==="flexipago" ? "pago diferido" : it.pagos.map(p=>VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label).join(" + ")}</span><span style={{fontFamily:font.mono}}>${it.valorTotal.toLocaleString("es-CO")}</span>
                    </div>
                  ))}
                  <Divider/>
                </>
              )}
              <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:6, marginTop:items.length>0?10:0 }}>
                <span>Valor bruto</span><span style={{fontFamily:font.mono}}>${valorBruto.toLocaleString("es-CO")}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.red, marginBottom:10 }}>
                <span>Descuento</span><span style={{fontFamily:font.mono}}>- ${descuentoNum.toLocaleString("es-CO")}</span>
              </div>
              <Divider/>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", margin:"10px 0" }}>
                <span style={{ fontFamily:font.body, fontSize:14, fontWeight:700, color:C.text }}>Total a pagar</span>
                <span style={{ fontFamily:font.mono, fontSize:22, fontWeight:700, color:C.goldLight }}>${total.toLocaleString("es-CO")}</span>
              </div>

              {items.length>0 && (
                <>
                  <Divider/>
                  <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"10px 0 6px" }}>Resumen por medio de pago</div>
                  {Object.entries(items.flatMap(it=>it.pagos).reduce((acc,p)=>{ acc[p.medio_pago]=(acc[p.medio_pago]||0)+Number(p.valor); return acc; },{})).map(([medio,v])=>(
                    <div key={medio} style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:4 }}>
                      <span>{VENTAS_MEDIOS_PAGO.find(m=>m.value===medio)?.label}</span><span style={{fontFamily:font.mono}}>${v.toLocaleString("es-CO")}</span>
                    </div>
                  ))}
                  {valorFlexipago>0 && (
                    <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.blue, marginBottom:4 }}>
                      <span>Flexipago (pago diferido)</span><span style={{fontFamily:font.mono}}>${valorFlexipago.toLocaleString("es-CO")}</span>
                    </div>
                  )}
                </>
              )}

              {esFlexipago && (
                <>
                  <Divider/>
                  <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.textSub, marginTop:10, marginBottom:4 }}>
                    <span>Abono inicial</span><span style={{fontFamily:font.mono}}>${Number(abonoInicialValor||0).toLocaleString("es-CO")}</span>
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.amber, fontWeight:700 }}>
                    <span>Saldo pendiente</span><span style={{fontFamily:font.mono}}>${saldoPendiente.toLocaleString("es-CO")}</span>
                  </div>
                </>
              )}
            </div>
          </Card>
          {requiereSiigo && (
            <div style={{ marginBottom:16 }}>
              <Field label="N.º de factura (Siigo)" value={numeroFactura} onChange={setNumeroFactura} placeholder="Ej: FE-1234"/>
            </div>
          )}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.06em" }}>Notas (opcional)</div>
            <Field value={observacion} onChange={setObservacion} multiline rows={2}/>
          </div>
          {msg && <div style={{ background: msg.startsWith("✓")?`${C.green}18`:C.redDim, border:`1px solid ${msg.startsWith("✓")?C.green:C.red}44`, borderRadius:7, padding:"9px 12px", color: msg.startsWith("✓")?C.green:C.red, fontSize:12, marginBottom:12, fontFamily:font.body }}>{msg}</div>}
          <Btn onClick={guardar} disabled={guardando} full>{guardando?"Guardando...":"Registrar venta"}</Btn>
        </div>
      </div>

      <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, margin:"24px 0 10px" }}>Ventas de hoy en esta tienda ({ventasHoy.length + abonosHoyTienda.length + notaCreditoHoyTienda.length})</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {ventasHoy.map(v=>(
          <VentaCard key={v.id} venta={v} stores={stores} user={user} esAdmin={esAdmin} soloLectura={soloLectura} isMobile={isMobile}
            ventas={ventas} setVentas={setVentas} ventasItems={ventasItems} setVentasItems={setVentasItems}
            ventasAbonos={ventasAbonos} setVentasAbonos={setVentasAbonos} ajustes={ventasAjustes} setAjustes={setVentasAjustes}/>
        ))}
        {abonosHoyTienda.map(({venta, abonos, valorFlex, antes, totalHoy, completa, mediosHoy})=>(
          <Card key={`abono-${venta.id}`} p="10px 14px" style={{ borderLeft:`3px solid ${completa?C.green:C.blue}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"baseline", gap:6, overflow:"hidden" }}>
                <span style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, flexShrink:0 }}>{venta.numero_factura?`#${venta.numero_factura}`:"—"}</span>
                <span style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {venta.cliente_nombre || venta.vendedor_nombre}
                </span>
              </div>
              <Badge color={completa?C.green:C.blue} sm title={completa?`Antes había abonado $${antes.toLocaleString("es-CO")}`:`Lleva abonado $${(antes+totalHoy).toLocaleString("es-CO")} de $${valorFlex.toLocaleString("es-CO")}`}>{completa?"✅ Completa Flexipago":"⏳ Abono Flexipago"}</Badge>
              {mediosHoy.length===1 ? (
                <Badge color={C.blue} sm>{VENTAS_MEDIO_ICONOS[mediosHoy[0]]||"💰"} {VENTAS_MEDIOS_PAGO.find(m=>m.value===mediosHoy[0])?.label||mediosHoy[0]}</Badge>
              ) : (
                <Badge color={C.blue} sm title={abonos.map(a=>`${textoMediosAbono(a)}: $${Number(a.valor).toLocaleString("es-CO")}`).join(" · ")}>{abonos.length} abonos hoy</Badge>
              )}
              <div style={{ fontFamily:font.mono, fontSize:15, fontWeight:700, color:C.goldLight, flexShrink:0 }}>${(completa?valorFlex:totalHoy).toLocaleString("es-CO")}</div>
            </div>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>
              {abonos.length>1
                ? `Hoy: ${abonos.map(a=>`$${Number(a.valor).toLocaleString("es-CO")} (${textoMediosAbono(a)})`).join(" + ")} — antes había abonado $${antes.toLocaleString("es-CO")}`
                : completa
                  ? `Completó el Flexipago hoy con un abono de $${totalHoy.toLocaleString("es-CO")} — antes había abonado $${antes.toLocaleString("es-CO")}`
                  : `Abono parcial de $${totalHoy.toLocaleString("es-CO")} — lleva $${(antes+totalHoy).toLocaleString("es-CO")} de $${valorFlex.toLocaleString("es-CO")}`}
            </div>
          </Card>
        ))}
        {notaCreditoHoyTienda.map(({venta, ajuste})=>(
          <NotaCreditoCard key={`nc-${ajuste.id}`} ajuste={ajuste} venta={venta} ventasItems={ventasItems} desplegable={false}/>
        ))}
        {ventasHoy.length===0 && abonosHoyTienda.length===0 && notaCreditoHoyTienda.length===0 && <div style={{ textAlign:"center", padding:30, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin ventas registradas hoy en esta tienda.</div>}
      </div>
    </div>
    </>
  );
}

function VentasListaScreen({ user, stores, users, ventas, setVentas, ventasItems, setVentasItems, ventasAbonos, setVentasAbonos, ajustes, setAjustes, esAdmin, soloLectura }) {
  const isMobile = useIsMobile();
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const [filtroTienda, setFiltroTienda] = useState("");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [filtroVendedor, setFiltroVendedor] = useState("");
  const [filtroFlexipago, setFiltroFlexipago] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const asesores = users.filter(u=>u.role==="advisor" || ROLES_ADMIN_VENDEDOR.includes(u.role));

  const ventasFiltradas = ventas
    .filter(v => (!tiendaFija || v.tienda_id===tiendaFija))
    .filter(v => (!filtroTienda || v.tienda_id===filtroTienda))
    .filter(v => (!filtroFecha || v.fecha===filtroFecha))
    .filter(v => (!filtroVendedor || v.vendedor_id===filtroVendedor))
    .filter(v => (!filtroFlexipago || v.es_flexipago))
    .filter(v => {
      const q = busqueda.trim().toLowerCase();
      if(!q) return true;
      return (v.cliente_nombre||"").toLowerCase().includes(q) || (v.cliente_documento||"").toLowerCase().includes(q) || (v.numero_factura||"").toLowerCase().includes(q);
    })
    .sort((a,b)=> (b.fecha||"").localeCompare(a.fecha||"") || (b.created_at||"").localeCompare(a.created_at||""));

  // Notacrédito: un registro aparte por cada excedente aplicado (copia de los datos de la factura
  // original, pero con el valor del excedente y en su fecha REAL) — para que quede visible en la
  // lista que hubo una Notacrédito, respetando los mismos filtros de arriba (fecha filtra por la
  // fecha real del ajuste, no por la fecha de la factura original).
  const notaCreditosFiltradas = (ajustes||[])
    .filter(aj => !aj.es_correccion_error)
    .map(aj => ({ ajuste:aj, venta: ventas.find(v=>v.id===aj.venta_id) }))
    .filter(({venta}) => !!venta)
    .filter(({venta}) => (!tiendaFija || venta.tienda_id===tiendaFija))
    .filter(({venta}) => (!filtroTienda || venta.tienda_id===filtroTienda))
    .filter(({ajuste}) => (!filtroFecha || ajuste.fecha===filtroFecha))
    .filter(({venta}) => (!filtroVendedor || venta.vendedor_id===filtroVendedor))
    .filter(() => !filtroFlexipago)
    .filter(({venta}) => {
      const q = busqueda.trim().toLowerCase();
      if(!q) return true;
      return (venta.cliente_nombre||"").toLowerCase().includes(q) || (venta.cliente_documento||"").toLowerCase().includes(q) || (venta.numero_factura||"").toLowerCase().includes(q);
    })
    .sort((a,b)=> (b.ajuste.fecha||"").localeCompare(a.ajuste.fecha||""));

  // Abonos de Flexipago que entraron un día distinto al de la venta original — mismo caso que ya
  // se resolvía en "Ventas de hoy" (VentasRegistrarScreen): el dinero se recibió ese día aunque la
  // factura se haya creado antes. Solo se arma esta lista cuando hay un filtro de fecha activo, para
  // no inundar la vista general (sin filtro) con abonos de todo el historial de cada Flexipago.
  const abonosFiltrados = (() => {
    if(!filtroFecha) return [];
    const grupos = {};
    (ventasAbonos||[]).filter(a=>a.fecha===filtroFecha).forEach(a=>{
      const venta = ventas.find(v=>v.id===a.venta_id);
      if(!venta || venta.fecha===filtroFecha) return; // mismo día que la venta: ya sale en la fila normal
      if(tiendaFija && venta.tienda_id!==tiendaFija) return;
      if(filtroTienda && venta.tienda_id!==filtroTienda) return;
      if(filtroVendedor && venta.vendedor_id!==filtroVendedor) return;
      const q = busqueda.trim().toLowerCase();
      if(q && !((venta.cliente_nombre||"").toLowerCase().includes(q) || (venta.cliente_documento||"").toLowerCase().includes(q) || (venta.numero_factura||"").toLowerCase().includes(q))) return;
      if(!grupos[venta.id]) grupos[venta.id] = { venta, abonos:[] };
      grupos[venta.id].abonos.push(a);
    });
    return Object.values(grupos);
  })();

  return (
    <div>
      <PageHeader title="Lista de ventas" subtitle={`${ventasFiltradas.length} ventas${notaCreditosFiltradas.length>0?` · ${notaCreditosFiltradas.length} notas crédito`:""}${abonosFiltrados.length>0?` · ${abonosFiltrados.length} abonos Flexipago`:""}`} />
      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"end" }}>
            {!tiendaFija && (
              <div style={{ minWidth:140, flex:1 }}><Field label="Tienda" value={filtroTienda} onChange={setFiltroTienda} options={[{value:"",label:"Todas"},...tiendasVenta(stores).map(s=>({value:s.id,label:s.name}))]}/></div>
            )}
            <div style={{ minWidth:140, flex:1 }}><Field label="Vendedor" value={filtroVendedor} onChange={setFiltroVendedor} options={[{value:"",label:"Todos"},...asesores.map(a=>({value:a.id,label:a.name}))]}/></div>
            <div style={{ minWidth:130, flex:1 }}><Field label="Fecha" type="date" value={filtroFecha} onChange={setFiltroFecha}/></div>
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"end" }}>
            <div style={{ minWidth:200, flex:2 }}><Field label="Buscar" value={busqueda} onChange={setBusqueda} placeholder="Nombre, cédula o N.º factura"/></div>
            <div style={{ marginBottom:14 }}>
              <Btn variant={filtroFlexipago?"primary":"ghost"} sm onClick={()=>setFiltroFlexipago(f=>!f)}>📦 Flexipago</Btn>
            </div>
            {(filtroTienda||filtroFecha||filtroVendedor||filtroFlexipago||busqueda) && <div style={{ marginBottom:14 }}><Btn onClick={()=>{setFiltroTienda("");setFiltroFecha("");setFiltroVendedor("");setFiltroFlexipago(false);setBusqueda("");}} variant="ghost" sm>Limpiar filtros</Btn></div>}
          </div>
        </div>
      </Card>

      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {(() => {
        const elementosVentas = ventasFiltradas.map(v=>({ fecha: v.fecha, el: (
          <VentaCard key={v.id} venta={v} stores={stores} user={user} esAdmin={esAdmin} soloLectura={soloLectura} isMobile={isMobile}
            ventas={ventas} setVentas={setVentas} ventasItems={ventasItems} setVentasItems={setVentasItems}
            ventasAbonos={ventasAbonos} setVentasAbonos={setVentasAbonos} ajustes={ajustes} setAjustes={setAjustes}/>
        )}));
        // Las Notas crédito se mezclan en la MISMA lista, ordenadas por su fecha real junto con
        // las demás ventas — no van en una sección aparte, para que se vean como un registro más.
        const elementosNC = notaCreditosFiltradas.map(({ajuste, venta})=>({
          fecha: ajuste.fecha,
          el: <NotaCreditoCard key={`nc-${ajuste.id}`} ajuste={ajuste} venta={venta} ventasItems={ventasItems}/>,
        }));
        const elementosAbonos = abonosFiltrados.map(({venta, abonos})=>({
          fecha: filtroFecha,
          el: <AbonoFlexipagoCard key={`ab-${venta.id}`} venta={venta} abonos={abonos}/>,
        }));
        const combinados = [...elementosVentas, ...elementosNC, ...elementosAbonos].sort((a,b)=> (b.fecha||"").localeCompare(a.fecha||""));
        return combinados.map(e=>e.el);
        })()}
        {ventasFiltradas.length===0 && notaCreditosFiltradas.length===0 && abonosFiltrados.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>No hay ventas que coincidan con los filtros.</div>}
      </div>
    </div>
  );
}

const MESES_NOMBRE = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const diasDelMes = (anio, mesIdx) => new Date(anio, mesIdx+1, 0).getDate();
const fmtCOP = (n) => `$${Math.round(n||0).toLocaleString("es-CO")}`;
// La meta personal siempre se calcula sobre 30 días, sin importar si el mes tiene 28-31.
const DIAS_META = 30;

// A partir de la malla real de Turnos, calcula cuántos días trabajó un asesor en cada tienda ese
// mes — para precargar (no reemplazar) el campo manual "días por tienda" de la meta personal.
// Los días de descanso (el código especial cuyo nombre incluye "descanso") se suman a la tienda
// donde más turnos reales tuvo ese mes, porque siguen siendo días "de esa tienda". Los demás
// códigos especiales (incapacidad, vacaciones, etc.) no se cuentan aquí — esos se siguen
// manejando como novedad manual, igual que antes.
const diasTiendaDesdeMalla = (asesorId, mesKey, turnosAsignaciones, turnosGlobales) => {
  const esDescanso = (turnoGlobalId) => {
    const g = (turnosGlobales||[]).find(t=>t.id===turnoGlobalId);
    return !!g && /descanso/i.test(g.nombre||"");
  };
  const asigMes = (turnosAsignaciones||[]).filter(a=>a.asesor_id===asesorId && a.fecha && a.fecha.slice(0,7)===mesKey);
  const porTienda = {};
  let descansos = 0;
  asigMes.forEach(a=>{
    if(a.tienda_id) porTienda[a.tienda_id] = (porTienda[a.tienda_id]||0) + 1;
    else if(a.turno_global_id && esDescanso(a.turno_global_id)) descansos++;
  });
  const entries = Object.entries(porTienda);
  if(descansos>0 && entries.length>0){
    const top = entries.reduce((best,cur)=> cur[1]>best[1] ? cur : best);
    porTienda[top[0]] = (porTienda[top[0]]||0) + descansos;
  }
  return porTienda;
};

// "Oficina" es una tienda más (tiene turno y horario propio, se asigna igual que Unicentro o
// Jardín Plaza) pero no vende — cuando alguien tiene un día de Oficina, ese día resta de la meta
// porque no estuvo vendiendo, aunque sí estuvo trabajando. Se detecta por nombre (no por un id fijo)
// para que siga funcionando si se recrea o renombra ligeramente.
const esTiendaOficina = (store) => !!store && /oficina/i.test(store.name||"");

// Resumen automático de "novedades" (turnos especiales que no son Descanso: Vacaciones,
// Incapacidad, DR, DNR, cumpleaños, o cualquier otro que se cree después) que tuvo un asesor ese
// mes, sacado directo de la malla real de Turnos — ya no se escriben a mano. Se agrupan por
// nombre del turno especial y solo se listan los que de verdad tuvo (días > 0), para no ocupar
// espacio con categorías en cero. Como es dinámico (agrupa por el nombre que sea), cualquier
// código nuevo que se cree en Turnos especiales aparece solo, sin tocar código.
const novedadesDesdeMalla = (asesorId, mesKey, turnosAsignaciones, turnosGlobales) => {
  const asigMes = (turnosAsignaciones||[]).filter(a=>a.asesor_id===asesorId && a.fecha && a.fecha.slice(0,7)===mesKey && a.turno_global_id && !a.tienda_id);
  const porTurno = {};
  asigMes.forEach(a=>{
    const g = (turnosGlobales||[]).find(t=>t.id===a.turno_global_id);
    if(!g || /descanso/i.test(g.nombre||"")) return; // Descanso ya se cuenta como día de tienda, no es "novedad"
    porTurno[g.id] = porTurno[g.id] || { nombre:g.nombre, color:g.color, dias:0 };
    porTurno[g.id].dias++;
  });
  return Object.values(porTurno);
};

// Un flexipago suma como ingreso el día que se TERMINA de pagar (con su valor completo),
// sin importar cuándo se creó la venta ni en cuántos días/medios se fue abonando.
// Mientras no esté completo, no suma nada a ingresos (aunque ya tenga abonos).
const calcularCierresFlexipago = (ventas, ventasItems, ventasAbonos) => {
  const cierres = []; // {ventaId, tiendaId, vendedorId, valorNeto, fechaCierre}
  ventas.filter(v=>v.es_flexipago).forEach(v=>{
    const valorNeto = ventasItems.filter(i=>i.venta_id===v.id && i.tipo==="flexipago").reduce((s,i)=>s+(Number(i.valor||0)-Number(i.descuento||0)),0);
    if(valorNeto<=0) return;
    const abonos = ventasAbonos.filter(a=>a.venta_id===v.id).sort((a,b)=> new Date(a.created_at||a.fecha) - new Date(b.created_at||b.fecha));
    let acumulado = 0;
    for(const ab of abonos){
      const antes = acumulado;
      acumulado += Number(ab.valor||0);
      if(antes<valorNeto && acumulado>=valorNeto){
        cierres.push({ ventaId:v.id, tiendaId:v.tienda_id, vendedorId:v.vendedor_id, valorNeto, fechaCierre:ab.fecha });
        break;
      }
    }
  });
  return cierres;
};

function VentasMetricasScreen({ user, stores, users, ventas, ventasItems, ventasAbonos, ventasAjustes, metas, setMetas, metasAsesor, setMetasAsesor, esAdmin, puedeAsignarMetas, isMobile, turnosAsignaciones, turnosGlobales }) {
  const hoy = toColombiaDate();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mesIdx, setMesIdx] = useState(hoy.getMonth());
  const [tiendaSel, setTiendaSel] = useState("");
  const [metaInputs, setMetaInputs] = useState({});
  const [guardandoMeta, setGuardandoMeta] = useState(null);
  const [metaMsg, setMetaMsg] = useState("");
  const [detalleInputs, setDetalleInputs] = useState({});
  const [metaDiasInputs, setMetaDiasInputs] = useState({}); // { [tiendaId]: { "1": "50000", "2": "45000", ... } }
  const [metaDiaAbierto, setMetaDiaAbierto] = useState(null); // tiendaId con la lista de días desplegada
  const [guardandoDetalle, setGuardandoDetalle] = useState(null);
  const [asesorExpandido, setAsesorExpandido] = useState(null);

  const mesKey = `${anio}-${String(mesIdx+1).padStart(2,"0")}`;
  const esMesActual = anio===hoy.getFullYear() && mesIdx===hoy.getMonth();
  const diasTotalesMes = diasDelMes(anio, mesIdx);
  const diasRestantes = esMesActual ? (diasTotalesMes - hoy.getDate() + 1) : 0;

  const irMesAnterior = () => { if(mesIdx===0){ setMesIdx(11); setAnio(a=>a-1); } else setMesIdx(m=>m-1); };
  const irMesSiguiente = () => { if(mesIdx===11){ setMesIdx(0); setAnio(a=>a+1); } else setMesIdx(m=>m+1); };

  const tiendasList = tiendasVenta(stores);
  // Para "días por tienda" en la meta personal se necesitan TODAS las tiendas, incluyendo Oficina
  // (que no vende, por eso no está en tiendasList) — así se puede ver y asignar días ahí también,
  // aunque esos días no sumen a la meta de ninguna tienda.
  const tiendasListConOficina = Object.values(stores);
  const asesores = users.filter(esVendedorPosible);
  const vistaAsesor = esCuentaTienda(user);
  // La tienda del usuario (si es cuenta de tienda) va primera, luego el resto, y "Todas" de última.
  const tiendaPropia = vistaAsesor ? tiendasList.find(t=>t.id===user.tienda_id) : null;
  const tiendasOrdenadas = tiendaPropia ? [tiendaPropia, ...tiendasList.filter(t=>t.id!==tiendaPropia.id)] : tiendasList;

  const metaTiendaValor = (tiendaId, tipo="total") => Number(metas.find(m=>m.mes===mesKey && m.tienda_id===tiendaId && (m.tipo||"total")===tipo)?.valor || 0);
  const metaTiendaValoresDia = (tiendaId) => metas.find(m=>m.mes===mesKey && m.tienda_id===tiendaId && (m.tipo||"total")==="total")?.valores_dia || {};

  // Una cuenta de tienda entra viendo su propia tienda de una vez, no "Todas".
  useEffect(()=>{
    if(vistaAsesor && user.tienda_id && !tiendaSel) setTiendaSel(user.tienda_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vistaAsesor, user.tienda_id]);

  useEffect(()=>{
    const obj = {};
    const objDias = {};
    tiendasList.forEach(t=>{
      obj[`tienda:${t.id}:total`] = String(metaTiendaValor(t.id,"total")||"");
      obj[`tienda:${t.id}:personal`] = String(metaTiendaValor(t.id,"personal")||"");
      const vd = metaTiendaValoresDia(t.id);
      const diasObj = {};
      for(let dNum=1; dNum<=diasDelMes(anio,mesIdx); dNum++){ diasObj[dNum] = String(vd[dNum]||""); }
      objDias[t.id] = diasObj;
    });
    setMetaInputs(obj);
    setMetaDiasInputs(objDias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesKey, metas.length]);

  useEffect(()=>{
    const obj = {};
    asesores.forEach(a=>{
      const existente = metasAsesor.find(m=>m.mes===mesKey && m.vendedor_id===a.id);
      const diasTiendaGuardados = existente?.dias_tienda || {};
      // Si todavía no hay días por tienda guardados para este asesor este mes, se precargan
      // (no se reemplazan) calculándolos desde la malla real de Turnos — sigue siendo editable,
      // y se puede volver a traer en cualquier momento con el botón "Actualizar desde la malla".
      const hayGuardados = Object.values(diasTiendaGuardados).some(v=>Number(v||0)>0);
      const diasTiendaAuto = hayGuardados ? {} : diasTiendaDesdeMalla(a.id, mesKey, turnosAsignaciones, turnosGlobales);
      obj[a.id] = {
        diasTienda: Object.fromEntries(tiendasListConOficina.map(t=>[t.id, String(diasTiendaGuardados[t.id] || diasTiendaAuto[t.id] || "")])),
      };
    });
    setDetalleInputs(obj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesKey, metasAsesor.length, asesores.length, turnosAsignaciones, turnosGlobales]);

  // Botón "Actualizar desde la malla" — recalcula los días por tienda desde los turnos reales de
  // ese asesor ese mes y REEMPLAZA lo que haya en el formulario (aunque ya hubiera algo guardado o
  // editado a mano). No guarda solo; hay que darle "Guardar" después para confirmarlo.
  const actualizarDiasDesdeMalla = (asesorId) => {
    const diasAuto = diasTiendaDesdeMalla(asesorId, mesKey, turnosAsignaciones, turnosGlobales);
    setDetalleInputs(prev=>({ ...prev, [asesorId]: { ...prev[asesorId], diasTienda: Object.fromEntries(tiendasListConOficina.map(t=>[t.id, String(diasAuto[t.id]||"")])) } }));
  };

  const setMetaDiaValor = (tiendaId, diaNum, value) => setMetaDiasInputs(prev=>({...prev, [tiendaId]: {...prev[tiendaId], [diaNum]:value}}));
  const sumaMetaDias = (tiendaId) => Object.values(metaDiasInputs[tiendaId]||{}).reduce((s,v)=>s+Number(v||0),0);
  const tieneMetaPorDia = (tiendaId) => Object.values(metaDiasInputs[tiendaId]||{}).some(v=>Number(v||0)>0);

  const guardarMetaTienda = async (tiendaId) => {
    setGuardandoMeta(tiendaId);
    setMetaMsg("");
    for(const tipo of ["total","personal"]){
      const key = `tienda:${tiendaId}:${tipo}`;
      // Para la meta "total", si se llenó la lista de días, el total sale de sumar esos días
      // en vez de escribirse a mano.
      const usaMetaPorDia = tipo==="total" && tieneMetaPorDia(tiendaId);
      const valor = usaMetaPorDia ? sumaMetaDias(tiendaId) : Number(metaInputs[key]||0);
      const valoresDia = usaMetaPorDia ? Object.fromEntries(Object.entries(metaDiasInputs[tiendaId]||{}).filter(([,v])=>Number(v||0)>0).map(([k,v])=>[k,Number(v)])) : {};
      const existente = metas.find(m=>m.mes===mesKey && m.tienda_id===tiendaId && (m.tipo||"total")===tipo);
      let data, error;
      const payloadTienda = tipo==="total" ? { valor, valores_dia:valoresDia } : { valor };
      if(existente){
        ({data,error} = await supabase.from("ventas_metas").update(payloadTienda).eq("id",existente.id).select().single());
      } else {
        ({data,error} = await supabase.from("ventas_metas").insert({ mes:mesKey, tienda_id:tiendaId, vendedor_id:null, tipo, ...payloadTienda }).select().single());
      }
      if(data && !error){
        setMetas(prev => existente ? prev.map(m=>m.id===data.id?data:m) : [...prev, data]);
      } else if(error){
        setMetaMsg(`No se pudo guardar: ${error.message||"error desconocido"}`);
      }
    }
    setGuardandoMeta(null);
  };

  const setDetalleTienda = (asesorId, tiendaId, value) => setDetalleInputs(prev=>({...prev, [asesorId]: {...prev[asesorId], diasTienda:{...prev[asesorId]?.diasTienda, [tiendaId]:value}}}));

  const guardarDetalleAsesor = async (asesorId) => {
    const d = detalleInputs[asesorId];
    if(!d) return;
    // Las novedades (Vacaciones, Incapacidad, DR, DNR, cumpleaños, etc.) ya no se escriben a mano
    // — se leen directo de la malla real de Turnos de ese asesor ese mes.
    const novedadesAuto = novedadesDesdeMalla(asesorId, mesKey, turnosAsignaciones, turnosGlobales);
    const diasNovedadTotal = novedadesAuto.reduce((s,n)=>s+n.dias,0);
    // Los días disponibles del mes son siempre 30 (DIAS_META) menos los de las novedades — ya no
    // hay un toggle manual de "ingresó nuevo": si alguien empezó a mitad de mes, simplemente no
    // tiene turnos asignados antes de esa fecha, así que sus días por tienda ya salen más bajos
    // solos, sin necesitar un campo aparte.
    const diasDisponibles = DIAS_META - diasNovedadTotal;
    const sumaDiasTienda = Object.values(d.diasTienda||{}).reduce((s,v)=>s+Number(v||0),0);
    if(sumaDiasTienda > diasDisponibles){
      setMetaMsg(`Los días por tienda de ${users.find(u=>u.id===asesorId)?.name||"este asesor"} suman ${sumaDiasTienda}, pero solo tiene ${diasDisponibles} días disponibles este mes (30 menos ${diasNovedadTotal} de novedades).`);
      return;
    }
    setGuardandoDetalle(asesorId);
    setMetaMsg("");
    const payload = {
      mes: mesKey, vendedor_id: asesorId,
      mes_completo: true,
      dias_ingreso: null,
      tipo_novedad: null,
      dias_novedad: diasNovedadTotal,
      novedades: novedadesAuto.map(n=>({ tipo:n.nombre, dias:n.dias })),
      dias_tienda: Object.fromEntries(Object.entries(d.diasTienda||{}).map(([k,v])=>[k, Number(v||0)])),
      updated_at: new Date().toISOString(),
    };
    const existente = metasAsesor.find(m=>m.mes===mesKey && m.vendedor_id===asesorId);
    let data, error;
    if(existente){
      ({data,error} = await supabase.from("ventas_metas_asesor").update(payload).eq("id",existente.id).select().single());
    } else {
      ({data,error} = await supabase.from("ventas_metas_asesor").insert(payload).select().single());
    }
    if(data && !error){
      setMetasAsesor(prev => existente ? prev.map(m=>m.id===data.id?data:m) : [...prev, data]);
    } else if(error){
      setMetaMsg(`No se pudo guardar la meta de ${users.find(u=>u.id===asesorId)?.name||"asesor"}: ${error.message||"error desconocido"}`);
    }
    setGuardandoDetalle(null);
  };

  const metaAsesorCalculada = (asesorId) => {
    const d = metasAsesor.find(m=>m.mes===mesKey && m.vendedor_id===asesorId);
    if(!d) return 0;
    // La meta de cada tienda ya es "la meta de alguien que trabaja los 30 días ahí", así que
    // cada día asignado en dias_tienda vale 1/30 de esa meta — no se divide entre los días
    // disponibles del asesor, porque eso inflaba la meta cuando había novedades (menos días
    // disponibles con los mismos días de tienda sin ajustar). Los días de incapacidad/licencia
    // simplemente significan menos días para repartir entre tiendas, y por lo tanto una meta menor.
    // Cuando hay una tienda seleccionada (tiendaSel), solo cuenta la porción de esa tienda — así
    // el top/ranking dentro de una tienda compara metas reales de esa tienda, no el total del
    // asesor sumando todas las tiendas donde trabaja.
    let total = 0;
    for(const t of tiendasListConOficina){
      if(esTiendaOficina(t)) continue; // Oficina no vende, no aporta a la meta de ninguna tienda
      if(tiendaSel && t.id!==tiendaSel) continue;
      const diasEnTienda = Number((d.dias_tienda||{})[t.id]||0);
      if(diasEnTienda<=0) continue;
      total += (diasEnTienda/DIAS_META) * metaTiendaValor(t.id,"personal");
    }
    return Math.round(total);
  };

  const cierresFlexipago = calcularCierresFlexipago(ventas, ventasItems, ventasAbonos);
  const ventaByIdGlobal = {}; ventas.forEach(v=>{ ventaByIdGlobal[v.id]=v; });

  // Corrección de facturas (solo ventas normales, no flexipago): si una venta se corrigió después
  // hacia un valor mayor, el valor original se queda en su mes de venta y el excedente cuenta en el
  // mes en que se hizo la corrección (ver ventas_ajustes). recortePorVenta es cuánto hay que restarle
  // al mes/día original de cada venta corregida para no contar el excedente dos veces.
  const recortePorVenta = {};
  ventas.forEach(v=>{
    if(v.es_flexipago) return;
    const totalOriginal = Number(v.valor_original ?? v.total);
    const totalActual = Number(v.total);
    if(totalActual > totalOriginal) recortePorVenta[v.id] = totalActual - totalOriginal;
  });
  const netoProductoAjustadoPorVenta = (items) => {
    const m = {};
    items.forEach(i=>{ m[i.venta_id] = (m[i.venta_id]||0) + (Number(i.valor)-Number(i.descuento||0)); });
    const out = {};
    for(const [ventaId, neto] of Object.entries(m)){
      const recorte = Math.min(recortePorVenta[ventaId]||0, neto);
      out[ventaId] = neto - recorte;
    }
    return out;
  };
  const sumaProductoConRecorte = (items) => Object.values(netoProductoAjustadoPorVenta(items)).reduce((a,b)=>a+b,0);
  // Ajustes cuya fecha (día de la corrección) cae en el mes que se está viendo.
  // Las correcciones "por error" no son un excedente real de venta (ya quedaron reflejadas
  // reseteando valor_original), así que no deben sumar aparte aquí.
  const ajustesDelMesTodasTiendas = ventasAjustes.filter(aj=>aj.fecha && aj.fecha.slice(0,7)===mesKey && !aj.es_correccion_error);
  const ajustesDelMes = ajustesDelMesTodasTiendas.filter(aj=>{
    const v = ventaByIdGlobal[aj.venta_id];
    return v && (!tiendaSel || v.tienda_id===tiendaSel);
  });

  const ventasDelMes = ventas.filter(v => v.fecha && v.fecha.slice(0,7)===mesKey && (!tiendaSel || v.tienda_id===tiendaSel));
  const idsVentasDelMes = new Set(ventasDelMes.map(v=>v.id));
  const itemsDelMes = ventasItems.filter(i => idsVentasDelMes.has(i.venta_id));
  // Solo "producto": el flexipago NO cuenta aquí por fecha de creación — cuenta como ingreso
  // el día que se termina de pagar (ver cierresDelMes), con su valor completo.
  const itemsDelMesProducto = itemsDelMes.filter(i=>i.tipo==="producto");
  const itemsDelMesServicios = itemsDelMes.filter(i=>i.tipo==="arreglo"||i.tipo==="marcacion"||i.tipo==="grabado");
  const cierresDelMes = cierresFlexipago.filter(c => c.fechaCierre && c.fechaCierre.slice(0,7)===mesKey && (!tiendaSel || c.tiendaId===tiendaSel));
  // Un flexipago que YA terminó de pagarse (en cualquier mes) cuenta su valor completo como venta
  // (bucket "Ingresos", vía cierresDelMes) — no debe volver a sumarse abono por abono en "con servicios".
  // Solo los flexipagos que TODAVÍA están abiertos (aún no se terminan de pagar) aportan a "con servicios"
  // por lo realmente abonado este mes: es plata que ya entró pero que todavía no se reconoce como venta.
  const idsVentasFlexipagoCerradas = new Set(cierresFlexipago.map(c=>c.ventaId));
  const abonosFlexipagoAbiertoDelMes = ventasAbonos.filter(ab=>{
    if(!ab.fecha || ab.fecha.slice(0,7)!==mesKey) return false;
    const v = ventaByIdGlobal[ab.venta_id];
    if(!v || !v.es_flexipago) return false;
    if(idsVentasFlexipagoCerradas.has(v.id)) return false;
    return !tiendaSel || v.tienda_id===tiendaSel;
  });
  const sumaPagos = (items) => items.reduce((a,i)=>a+(i.pagos||[]).reduce((s,p)=>s+Number(p.valor||0),0), 0);

  const totalSinServicios = sumaProductoConRecorte(itemsDelMesProducto) + cierresDelMes.reduce((a,c)=>a+c.valorNeto,0) + ajustesDelMes.reduce((a,aj)=>a+Number(aj.diferencia||0),0);
  const totalConServicios = totalSinServicios + sumaPagos(itemsDelMesServicios) + abonosFlexipagoAbiertoDelMes.reduce((a,ab)=>a+Number(ab.valor||0),0);

  const metaTiendaTotal = tiendaSel ? metaTiendaValor(tiendaSel) : tiendasList.reduce((a,t)=>a+metaTiendaValor(t.id),0);
  const idcTienda = metaTiendaTotal>0 ? Math.round((totalSinServicios/metaTiendaTotal)*1000)/10 : null;
  const mdaTienda = esMesActual && diasRestantes>0 && metaTiendaTotal>0 ? Math.round((metaTiendaTotal-totalSinServicios)/diasRestantes) : null;

  const fechaPorVenta = {}; ventasDelMes.forEach(v=>{ fechaPorVenta[v.id]=v.fecha; });

  const dataAsesores = asesores.map(a=>{
    const ventasAsesor = ventasDelMes.filter(v=>v.vendedor_id===a.id);
    const idsAsesor = new Set(ventasAsesor.map(v=>v.id));
    const sinServiciosProducto = sumaProductoConRecorte(itemsDelMesProducto.filter(i=>idsAsesor.has(i.venta_id)))
      + ajustesDelMes.filter(aj=>ventaByIdGlobal[aj.venta_id]?.vendedor_id===a.id).reduce((s,aj)=>s+Number(aj.diferencia||0),0);
    // El flexipago se le atribuye a quien hizo la venta original, sin importar en qué mes se creó —
    // solo importa que se haya terminado de pagar este mes.
    const sinServiciosFlexipago = cierresDelMes.filter(c=>c.vendedorId===a.id).reduce((s,c)=>s+c.valorNeto,0);
    const sinServicios = sinServiciosProducto + sinServiciosFlexipago;
    const serviciosDirecto = sumaPagos(itemsDelMesServicios.filter(i=>idsAsesor.has(i.venta_id)));
    const flexipagoAbierto = abonosFlexipagoAbiertoDelMes.filter(ab=>ventaByIdGlobal[ab.venta_id]?.vendedor_id===a.id).reduce((s,ab)=>s+Number(ab.valor||0),0);
    const conServicios = sinServicios + serviciosDirecto + flexipagoAbierto;
    const meta = metaAsesorCalculada(a.id);
    const idc = meta>0 ? Math.round((sinServicios/meta)*1000)/10 : null;
    const mda = esMesActual && diasRestantes>0 && meta>0 ? Math.round((meta-sinServicios)/diasRestantes) : null;
    return { asesor:a, sinServicios, conServicios, meta, idc, mda };
  });

  const ranking = [...dataAsesores].filter(d=>d.idc!==null).sort((a,b)=>b.idc-a.idc);

  const dataTiendas = tiendasList.map(t=>{
    const ventasTienda = ventas.filter(v => v.fecha && v.fecha.slice(0,7)===mesKey && v.tienda_id===t.id);
    const idsT = new Set(ventasTienda.map(v=>v.id));
    const sinServiciosProducto = sumaProductoConRecorte(ventasItems.filter(i=>idsT.has(i.venta_id) && i.tipo==="producto"))
      + ajustesDelMesTodasTiendas.filter(aj=>ventaByIdGlobal[aj.venta_id]?.tienda_id===t.id).reduce((s,aj)=>s+Number(aj.diferencia||0),0);
    const sinServiciosFlexipago = cierresFlexipago.filter(c=>c.tiendaId===t.id && c.fechaCierre && c.fechaCierre.slice(0,7)===mesKey).reduce((s,c)=>s+c.valorNeto,0);
    const sinServicios = sinServiciosProducto + sinServiciosFlexipago;
    const meta = metaTiendaValor(t.id,"total");
    const idc = meta>0 ? Math.round((sinServicios/meta)*1000)/10 : null;
    return { tienda:t, sinServicios, meta, idc };
  });
  const rankingTiendas = [...dataTiendas].filter(d=>d.idc!==null).sort((a,b)=>b.idc-a.idc);

  const porDia = {};
  ventasDelMes.forEach(v=>{ porDia[v.fecha] = porDia[v.fecha] || { con:0, sin:0, count:0 }; porDia[v.fecha].count += 1; });
  Object.entries(netoProductoAjustadoPorVenta(itemsDelMesProducto)).forEach(([ventaId,val])=>{
    const f=fechaPorVenta[ventaId];
    if(f){ porDia[f]=porDia[f]||{con:0,sin:0,count:0}; porDia[f].sin += val; porDia[f].con += val; }
  });
  ajustesDelMes.forEach(aj=>{
    porDia[aj.fecha] = porDia[aj.fecha] || { con:0, sin:0, count:0 };
    porDia[aj.fecha].sin += Number(aj.diferencia||0);
    porDia[aj.fecha].con += Number(aj.diferencia||0);
  });
  cierresDelMes.forEach(c=>{
    porDia[c.fechaCierre] = porDia[c.fechaCierre] || { con:0, sin:0, count:0 };
    porDia[c.fechaCierre].sin += c.valorNeto;
    porDia[c.fechaCierre].con += c.valorNeto;
  });
  itemsDelMesServicios.forEach(i=>{
    const f=fechaPorVenta[i.venta_id];
    if(f){ porDia[f]=porDia[f]||{con:0,sin:0,count:0}; porDia[f].con += (i.pagos||[]).reduce((s,p)=>s+Number(p.valor||0),0); }
  });
  abonosFlexipagoAbiertoDelMes.forEach(ab=>{
    porDia[ab.fecha] = porDia[ab.fecha] || { con:0, sin:0, count:0 };
    porDia[ab.fecha].con += Number(ab.valor||0);
  });
  const diasList = Object.entries(porDia).sort((a,b)=>b[0].localeCompare(a[0]));

  // Anotación informativa (no suma nada aquí, solo aviso): en el día ORIGINAL de una venta que
  // después recibió una nota crédito con excedente en otra fecha, mostramos un aviso de que ese
  // excedente existe — igual que el Flexipago se muestra informativamente sin sumar hasta que se
  // completa. El valor del excedente ya se está sumando en su propia fecha real (ver ajustesDelMes
  // arriba); esto es solo para que se vea, al mirar el día original, que parte de esa venta se
  // completó después.
  const excedentesPorDiaOriginal = {};
  ventasAjustes.forEach(aj=>{
    if(aj.es_correccion_error) return;
    const v = ventaByIdGlobal[aj.venta_id];
    if(!v || !idsVentasDelMes.has(v.id) || aj.fecha===v.fecha) return;
    excedentesPorDiaOriginal[v.fecha] = excedentesPorDiaOriginal[v.fecha] || [];
    excedentesPorDiaOriginal[v.fecha].push({ valor:Number(aj.diferencia||0), fecha:aj.fecha });
  });

  // Ingresos de HOY (sin servicios) para la cápsula rápida — independiente del mes que se esté
  // viendo en el selector, para poder chequear el día sin cambiar de mes.
  const ventasHoyCap = ventas.filter(v => v.fecha===todayStr && (!tiendaSel || v.tienda_id===tiendaSel));
  const idsVentasHoyCap = new Set(ventasHoyCap.map(v=>v.id));
  const itemsHoyProductoCap = ventasItems.filter(i=>idsVentasHoyCap.has(i.venta_id) && i.tipo==="producto");
  const cierresHoyCap = cierresFlexipago.filter(c=>c.fechaCierre===todayStr && (!tiendaSel || c.tiendaId===tiendaSel));
  const ajustesHoyCap = ventasAjustes.filter(aj=>aj.fecha===todayStr && !aj.es_correccion_error && ventaByIdGlobal[aj.venta_id] && (!tiendaSel || ventaByIdGlobal[aj.venta_id].tienda_id===tiendaSel));
  const ingresosHoy = sumaProductoConRecorte(itemsHoyProductoCap) + cierresHoyCap.reduce((a,c)=>a+c.valorNeto,0) + ajustesHoyCap.reduce((a,aj)=>a+Number(aj.diferencia||0),0);

  const medalla = (idx) => idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":`${idx+1}.`;

  return (
    <div>
      <PageHeader title="Métricas" subtitle={tiendaSel ? `${stores[tiendaSel]?.name||""} · ${MESES_NOMBRE[mesIdx]} ${anio}` : `Todas las tiendas · ${MESES_NOMBRE[mesIdx]} ${anio}`} />

      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <button onClick={irMesAnterior} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, color:C.text, cursor:"pointer", padding:"4px 10px", fontSize:14 }}>‹</button>
            <div style={{ fontFamily:font.body, fontSize:14, fontWeight:700, color:C.goldLight, minWidth:140, textAlign:"center" }}>{MESES_NOMBRE[mesIdx]} {anio}{esMesActual && <span style={{ color:C.textMuted, fontWeight:400, fontSize:11 }}> · en curso</span>}</div>
            <button onClick={irMesSiguiente} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:6, color:C.text, cursor:"pointer", padding:"4px 10px", fontSize:14 }}>›</button>
          </div>
          {esMesActual && <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{diasRestantes} días restantes del mes</div>}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {tiendasOrdenadas.map(t=>(
            <button key={t.id} onClick={()=>setTiendaSel(t.id)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${tiendaSel===t.id?C.gold:C.border}`, background:tiendaSel===t.id?`${C.gold}22`:"transparent", color:tiendaSel===t.id?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12, cursor:"pointer" }}>{t.name}</button>
          ))}
          <button onClick={()=>setTiendaSel("")} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${!tiendaSel?C.gold:C.border}`, background:!tiendaSel?`${C.gold}22`:"transparent", color:!tiendaSel?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12, cursor:"pointer" }}>Todas las tiendas</button>
        </div>
      </Card>

      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":`repeat(${vistaAsesor?5:6}, 1fr)`, gap:10, marginBottom:16 }}>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ventas hoy</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(ingresosHoy)}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ventas mes</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(totalSinServicios)}</div>
        </div>
        {!vistaAsesor && (
          <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ingreso total</div>
            <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(totalConServicios)}</div>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:2 }}>+{fmtCOP(totalConServicios-totalSinServicios)} en servicios</div>
          </div>
        )}
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Meta{tiendaSel?"":" total"}</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{metaTiendaTotal>0?fmtCOP(metaTiendaTotal):"—"}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <HoverTooltip label="IDC" labelStyle={{ fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700 }} width={240} align="right">
            <div style={{ fontFamily:font.body, fontSize:11.5, color:C.text, lineHeight:1.4 }}><b>IDC — Índice de Cumplimiento.</b> Qué porcentaje de la meta del mes ya se alcanzó: (ingresos ÷ meta) × 100.</div>
          </HoverTooltip>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:colorSemaforoIDC(idcTienda), marginTop:6 }}>{idcTienda===null?"—":`${idcTienda}%`}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <HoverTooltip label="MDA" labelStyle={{ fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700 }} width={240} align="right">
            <div style={{ fontFamily:font.body, fontSize:11.5, color:C.text, lineHeight:1.4 }}><b>MDA — Meta Diaria.</b> Cuánto falta vender en promedio cada día para llegar a la meta: (meta − ingresos) ÷ días que quedan del mes.</div>
          </HoverTooltip>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text, marginTop:6 }}>{mdaTienda===null?"—":fmtCOP(mdaTienda)}</div>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:2 }}>por día, sin servicios</div>
        </div>
      </div>

      {puedeAsignarMetas && (
        <SeccionVenta icon="🎯" titulo="Metas del mes">
          {metaMsg && <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:7, padding:"9px 12px", color:C.red, fontSize:12, marginBottom:10, fontFamily:font.body }}>{metaMsg}</div>}
          <div style={{ display:"flex", flexDirection:"column", marginBottom:16 }}>
            {tiendasList.map(t=>{
              const usaDias = tieneMetaPorDia(t.id);
              const diaAbierto = metaDiaAbierto===t.id;
              return (
                <div key={t.id} style={{ padding:"6px 0", borderBottom:`1px solid ${C.border}` }}>
                  <div style={{ display:"flex", alignItems:"end", gap:8, flexWrap:"wrap" }}>
                    <div style={{ width:isMobile?70:110, flexShrink:0, marginBottom:14, fontFamily:font.body, fontSize:12, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.name}</div>
                    <div style={{ flex:1, minWidth:100 }}><CurrencyField placeholder="Meta total" value={usaDias?String(sumaMetaDias(t.id)):(metaInputs[`tienda:${t.id}:total`]||"")} onChange={v=>setMetaInputs(prev=>({...prev,[`tienda:${t.id}:total`]:v}))} disabled={usaDias}/></div>
                    <div style={{ marginBottom:14 }}><Btn onClick={()=>setMetaDiaAbierto(diaAbierto?null:t.id)} variant="ghost" sm>{diaAbierto?"▲ por día":"📅 por día"}</Btn></div>
                    <div style={{ flex:1, minWidth:100 }}><CurrencyField placeholder="Meta personal" value={metaInputs[`tienda:${t.id}:personal`]||""} onChange={v=>setMetaInputs(prev=>({...prev,[`tienda:${t.id}:personal`]:v}))}/></div>
                    <div style={{ marginBottom:14 }}><Btn onClick={()=>guardarMetaTienda(t.id)} disabled={guardandoMeta===t.id} sm>{guardandoMeta===t.id?"...":"Guardar"}</Btn></div>
                  </div>
                  {diaAbierto && (
                    <div style={{ marginTop:6, marginBottom:8, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px" }}>
                      <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginBottom:6 }}>Meta de cada día del mes — la meta total de la tienda queda como la suma de estos valores. Deja en blanco los días sin meta puntual.</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:3, maxHeight:260, overflowY:"auto" }}>
                        {Array.from({length:diasDelMes(anio,mesIdx)}, (_,i)=>i+1).map(diaNum=>(
                          <div key={diaNum} style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:26, flexShrink:0, fontFamily:font.body, fontSize:11, color:C.textMuted, textAlign:"right" }}>{diaNum}</div>
                            <input value={metaDiasInputs[t.id]?.[diaNum]||""} onChange={e=>setMetaDiaValor(t.id,diaNum,e.target.value.replace(/[^\d]/g,""))} placeholder="0" style={cajaInputStyle}/>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontFamily:font.body, fontSize:12, color:C.text, marginTop:8, fontWeight:700 }}>Total del mes: {fmtCOP(sumaMetaDias(t.id))}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Metas personales de asesores</div>
          <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
            {asesores.map(a=>{
              const d = detalleInputs[a.id] || { diasTienda:{} };
              const abierto = asesorExpandido===a.id;
              // Novedades (Vacaciones, Incapacidad, DR, DNR, cumpleaños, etc.) ya no se escriben a
              // mano — se leen directo de la malla real de Turnos de ese mes.
              const novedadesAuto = novedadesDesdeMalla(a.id, mesKey, turnosAsignaciones, turnosGlobales);
              const diasNovedadTotal = novedadesAuto.reduce((s,n)=>s+n.dias,0);
              const diasDisponibles = DIAS_META - diasNovedadTotal;
              const sumaDiasTienda = Object.values(d.diasTienda||{}).reduce((s,v)=>s+Number(v||0),0);
              // Si lo que se está mostrando en "días por tienda" todavía no se ha guardado, es la
              // sugerencia calculada desde la malla de Turnos — se avisa para que se revise antes
              // de confirmar (no reemplaza el registro guardado si ya existe).
              const existenteMeta = metasAsesor.find(m=>m.mes===mesKey && m.vendedor_id===a.id);
              const diasTiendaEsAuto = !Object.values(existenteMeta?.dias_tienda||{}).some(v=>Number(v||0)>0) && sumaDiasTienda>0;
              return (
                <div key={a.id} style={{ border:`1px solid ${abierto?C.gold:C.border}`, borderRadius:7, overflow:"hidden" }}>
                  <button onClick={()=>setAsesorExpandido(abierto?null:a.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
                    <span style={{ flex:1, fontFamily:font.body, fontSize:12.5, color:C.text, fontWeight:600 }}>{a.name}</span>
                    <span style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{fmtCOP(metaAsesorCalculada(a.id))}</span>
                    <span style={{ color:C.textMuted, fontSize:10 }}>{abierto?"▲":"▼"}</span>
                  </button>
                  <Collapse open={abierto}>
                    <div style={{ padding:"0 10px 10px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                        <span style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginLeft:"auto" }}>Días disponibles: <b style={{ fontFamily:font.mono, color:diasDisponibles>0?C.text:C.red }}>{diasDisponibles}</b> (30 − {diasNovedadTotal} de novedades)</span>
                      </div>

                      <div style={{ fontSize:10.5, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Novedades este mes</div>
                      {novedadesAuto.length>0 ? (
                        <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:10 }}>
                          {novedadesAuto.map(n=>(
                            <div key={n.nombre} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:font.body, fontSize:12, color:C.text }}>
                              <span style={{ display:"flex", alignItems:"center", gap:6 }}>{n.color && <span style={{ width:7, height:7, borderRadius:"50%", background:n.color }}/>}{n.nombre}</span>
                              <span style={{ fontFamily:font.mono, color:C.textMuted }}>{n.dias} día{n.dias!==1?"s":""}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginBottom:10 }}>Sin novedades este mes (según la malla de Turnos).</div>
                      )}

                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:diasTiendaEsAuto?8:0 }}>
                        <div style={{ fontSize:10.5, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.06em" }}>Turnos por tienda</div>
                        <Btn onClick={()=>actualizarDiasDesdeMalla(a.id)} variant="ghost" sm>🔄 Actualizar desde la malla</Btn>
                      </div>
                      {diasTiendaEsAuto && <div style={{ fontFamily:font.body, fontSize:11, color:C.goldLight, marginTop:4 }}>📅 Calculado desde la malla de Turnos — revisa y dale "Guardar" para confirmarlo.</div>}
                      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":`repeat(${Math.min(tiendasListConOficina.length||1,4)}, 1fr)`, gap:8, marginTop:6 }}>
                        {tiendasListConOficina.map(t=>(
                          <Field key={t.id} label={t.name} value={d.diasTienda?.[t.id]||""} onChange={v=>setDetalleTienda(a.id,t.id,v.replace(/[^\d]/g,""))} placeholder="días"/>
                        ))}
                      </div>
                      <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginTop:2 }}>Oficina no suma a la meta de ninguna tienda (no vendió ese día).</div>
                      {sumaDiasTienda>diasDisponibles && <div style={{ fontFamily:font.body, fontSize:11, color:C.red, marginTop:4 }}>Los días por tienda suman {sumaDiasTienda}, pero solo hay {diasDisponibles} días disponibles.</div>}
                      <div style={{ marginTop:8 }}><Btn onClick={()=>guardarDetalleAsesor(a.id)} disabled={guardandoDetalle===a.id || sumaDiasTienda>diasDisponibles} sm>{guardandoDetalle===a.id?"Guardando...":"Guardar"}</Btn></div>
                    </div>
                  </Collapse>
                </div>
              );
            })}
            {asesores.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>No hay asesores activos.</div>}
          </div>
        </SeccionVenta>
      )}

      <SeccionVenta icon="🏬" titulo="Top tiendas por cumplimiento">
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {rankingTiendas.map((d,idx)=>(
            <div key={d.tienda.id} style={{ display:"flex", alignItems:"center", gap:10, background:idx<3?`${C.gold}0d`:C.surfaceAlt, border:`1px solid ${idx<3?C.gold:C.border}`, borderRadius:8, padding:"9px 12px" }}>
              <div style={{ fontFamily:font.body, fontSize:idx<3?16:13, width:28, textAlign:"center" }}>{medalla(idx)}</div>
              <div style={{ flex:1, fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600 }}>{d.tienda.name}</div>
              <div style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{fmtCOP(d.sinServicios)} / {fmtCOP(d.meta)}</div>
              <Badge color={colorSemaforoIDC(d.idc)} sm>{d.idc}%</Badge>
            </div>
          ))}
          {rankingTiendas.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, textAlign:"center", padding:16 }}>Aún no hay metas asignadas o ventas este mes para armar el ranking.</div>}
        </div>
      </SeccionVenta>

      <SeccionVenta icon="🏆" titulo="Top asesores por cumplimiento">
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {ranking.map((d,idx)=>(
            <div key={d.asesor.id} style={{ display:"flex", alignItems:"center", gap:10, background:idx<3?`${C.gold}0d`:C.surfaceAlt, border:`1px solid ${idx<3?C.gold:C.border}`, borderRadius:8, padding:"9px 12px" }}>
              <div style={{ fontFamily:font.body, fontSize:idx<3?16:13, width:28, textAlign:"center" }}>{medalla(idx)}</div>
              <div style={{ flex:1, fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600 }}>{d.asesor.name}</div>
              <div style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{fmtCOP(d.sinServicios)} / {fmtCOP(d.meta)}</div>
              <Badge color={colorSemaforoIDC(d.idc)} sm>{d.idc}%</Badge>
            </div>
          ))}
          {ranking.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, textAlign:"center", padding:16 }}>Aún no hay metas asignadas o ventas este mes para armar el ranking.</div>}
        </div>
      </SeccionVenta>

      <SeccionVenta icon="👤" titulo="Ventas por asesor">
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:font.body, fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}`, color:C.textMuted, textAlign:"left" }}>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>Asesor</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>Venta total</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>Meta</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>IDC</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>MDA</th>
              </tr>
            </thead>
            <tbody>
              {[...dataAsesores].sort((a,b)=>a.asesor.name.localeCompare(b.asesor.name)).map(d=>(
                <tr key={d.asesor.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"7px 8px", color:C.text, textAlign:"left" }}>{d.asesor.name}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.text, textAlign:"left" }}>{fmtCOP(d.sinServicios)}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted, textAlign:"left" }}>{d.meta>0?fmtCOP(d.meta):"—"}</td>
                  <td style={{ padding:"7px 8px", textAlign:"left" }}>{d.idc===null?"—":<Badge color={colorSemaforoIDC(d.idc)} sm>{d.idc}%</Badge>}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted, textAlign:"left" }}>{d.mda===null?"—":fmtCOP(d.mda)}</td>
                </tr>
              ))}
              {dataAsesores.length===0 && <tr><td colSpan={5} style={{ padding:16, textAlign:"center", color:C.textMuted }}>No hay asesores activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </SeccionVenta>

      <SeccionVenta icon="📅" titulo={`Ventas por día — ${tiendaSel ? stores[tiendaSel]?.name : "Todas las tiendas"}`}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:font.body, fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}`, color:C.textMuted, textAlign:"left" }}>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>Fecha</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}># de ventas</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>Total ventas</th>
                <th style={{ padding:"6px 8px", fontWeight:500, textAlign:"left" }}>Total ingreso</th>
              </tr>
            </thead>
            <tbody>
              {diasList.map(([fecha,d])=>{
                const excedentes = excedentesPorDiaOriginal[fecha];
                return (
                  <Fragment key={fecha}>
                    <tr style={{ borderBottom: excedentes&&excedentes.length>0 ? "none" : `1px solid ${C.border}` }}>
                      <td style={{ padding:"7px 8px", color:C.text, textAlign:"left", whiteSpace:"nowrap" }}>{new Date(fecha+"T12:00:00").toLocaleDateString("es-CO",{weekday:"short",day:"numeric",month:"short"})}</td>
                      <td style={{ padding:"7px 8px", color:C.textMuted, textAlign:"left" }}>{d.count} venta{d.count!==1?"s":""}</td>
                      <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.text, textAlign:"left" }}>{fmtCOP(d.sin)}</td>
                      <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted, textAlign:"left" }}>{fmtCOP(d.con)}</td>
                    </tr>
                    {excedentes && excedentes.length>0 && (
                      <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                        <td colSpan={4} style={{ padding:"0 8px 6px", fontFamily:font.body, fontSize:10.5, color:C.amber }} title="Este valor ya entró y se sumó en la fecha real de la Notacrédito, no aquí.">
                          ⓘ {excedentes.map((e,idx)=>`+${fmtCOP(e.valor)} nota crédito el ${new Date(e.fecha+"T12:00:00").toLocaleDateString("es-CO",{day:"numeric",month:"short"})}`).join(" · ")}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {diasList.length===0 && <tr><td colSpan={4} style={{ padding:16, textAlign:"center", color:C.textMuted }}>Sin ventas registradas este mes.</td></tr>}
            </tbody>
          </table>
        </div>
      </SeccionVenta>
    </div>
  );
}

// ── Caja: apertura de turno, cierre de turno, recolección de efectivo ─────────
// No hay tabla de "turno" en Ventas — cada acción queda con fecha y hora exactas
// (created_at), y todos los cálculos de dinero se sacan en vivo de ventas/abonos,
// nunca se guardan como número fijo (así siempre reflejan la info real).
const CAJA_MEDIOS = ["efectivo","tarjeta","transferencia","addi"];
const CAJA_MEDIO_LABEL = { efectivo:"Efectivo", tarjeta:"Tarjeta", transferencia:"Transferencia", addi:"ADDI" };
const cajaZeros = () => ({ efectivo:0, tarjeta:0, transferencia:0, addi:0 });
const cajaTotal = (o) => CAJA_MEDIOS.reduce((s,k)=>s+(o[k]||0),0);
// La base de caja casi siempre es este valor (dinero fijo que debe quedar disponible en la
// tienda para vueltos o gastos menores) — se puede ajustar, y se recuerda el último valor usado.
const BASE_CAJA_FIJA = 100000;

// Versiones compactas de Card/Field/CurrencyField, solo para Caja: la pantalla se usa muchas
// veces al día y necesita mucha más densidad que el resto de la app (menos relleno, menos alto por campo).
// Cuando se le pasa "color" (el color asignado a la tienda), todo el cuadro se pinta con ese
// color — pero el contenido de adentro (campos, historiales) queda sobre un panel oscuro
// insertado, para que siga tan legible como siempre sin importar qué tan claro sea el color.
const cajaHeaderSelectStyle = { background:"rgba(0,0,0,0.28)", border:"1px solid rgba(255,255,255,0.28)", borderRadius:5, color:"#fff", fontSize:12, fontFamily:font.body, padding:"3px 7px", fontWeight:600 };
// `compact` = versión más apretada (menos padding/márgenes) para cuando varias tarjetas van
// apiladas en columna y necesitan caber en un solo pantallazo (p.ej. la columna de Apertura en Caja).
// Cuando hay `color` (tienda seleccionada en Caja) usamos un look "liquid glass": vidrio esmerilado
// translúcido con un tinte del color de la tienda sobre el fondo oscuro de siempre, en vez del
// bloque de color sólido de antes. El contenido ya no necesita un panel oscuro interno para
// legibilidad — el fondo sigue siendo oscuro (solo con el tinte), así que el texto normal de la
// app (C.text/C.goldLight/C.textMuted) siempre contrasta bien, sea cual sea el color de la tienda.
const CajaCard = ({ icon, titulo, children, color, headerExtra, compact }) => {
  const glass = !!color;
  return (
    <div style={{
      background: glass
        ? `radial-gradient(130% 65% at 0% 0%, rgba(255,255,255,0.16), transparent 60%), radial-gradient(130% 65% at 100% 0%, rgba(255,255,255,0.16), transparent 60%), linear-gradient(180deg, ${color}80 0%, ${color}45 32%, ${C.surface}f0 68%, ${C.dark}fa 100%)`
        : C.surface,
      backdropFilter: glass ? "blur(16px) saturate(220%)" : undefined,
      WebkitBackdropFilter: glass ? "blur(16px) saturate(220%)" : undefined,
      border: glass ? `1px solid ${color}70` : `1px solid ${C.border}`,
      borderRadius:12,
      boxShadow: glass ? `inset 0 1px 0 rgba(255,255,255,0.22), 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px ${color}40` : "none",
      padding:compact?"7px 12px":"10px 14px",
      marginBottom:compact?6:10,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:compact?4:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, fontFamily:font.body, fontSize:12.5, fontWeight:700, color:C.goldLight, textTransform:"uppercase", letterSpacing:"0.04em" }}>
          {glass && <span style={{ width:7, height:7, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}` }}/>}
          {icon} {titulo}
        </div>
        {headerExtra}
      </div>
      {children}
    </div>
  );
};
const cajaInputStyle = { width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:5, padding:"5px 8px", color:C.text, fontSize:12.5, fontFamily:font.body, outline:"none", boxSizing:"border-box" };
const cajaLabelStyle = { fontSize:9.5, color:C.textMuted, fontFamily:font.body, marginBottom:2, textTransform:"uppercase", letterSpacing:"0.05em" };
const CajaField = ({ label, value, onChange, options, placeholder, type="text" }) => (
  <div style={{ marginBottom:0 }}>
    {label && <div style={cajaLabelStyle}>{label}</div>}
    {options ? (
      <select value={value} onChange={e=>onChange(e.target.value)} style={cajaInputStyle}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={cajaInputStyle}/>
    )}
  </div>
);
const CajaMoney = ({ label, value, onChange, placeholder }) => {
  const digits = String(value||"").replace(/[^\d]/g,"");
  const mostrado = digits ? `$${Number(digits).toLocaleString("es-CO")}` : "";
  return (
    <div style={{ marginBottom:0 }}>
      {label && <div style={cajaLabelStyle}>{label}</div>}
      <input type="text" inputMode="numeric" value={mostrado} onChange={e=>onChange(e.target.value.replace(/[^\d]/g,""))} placeholder={placeholder||"$0"} style={cajaInputStyle}/>
    </div>
  );
};
const CajaBtn = ({ onClick, children, disabled }) => (
  <button onClick={disabled?undefined:onClick} style={{ padding:"5px 12px", borderRadius:5, border:"none", background:C.gold, color:"#fff", fontSize:12, fontWeight:600, fontFamily:font.body, cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.5:1, whiteSpace:"nowrap" }}>{children}</button>
);
// Línea "a modo factura" — título al frente, valor a la derecha. Usada en las tarjetas de Apertura
// y Cierre de turno para el rediseño en dos columnas (ver diseño de Felipe). Solo presentación:
// no calcula nada, únicamente muestra los valores que ya vienen calculados desde afuera.
const CajaReciboLinea = ({ label, value, bold, color, small, indent, totalLine, compact }) => (
  <div style={{
    display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10,
    padding: indent ? (compact?"0.5px 0 0.5px 12px":"1.5px 0 1.5px 14px") : (compact?"1px 0":"2.5px 0"),
    marginTop: totalLine ? (compact?3:5) : 0,
    paddingTop: totalLine ? (compact?4:6) : undefined,
    borderTop: totalLine ? `1px solid ${C.border}` : "none",
  }}>
    <span style={{ fontFamily:font.body, fontSize: small?11.5:13, color: color || (small?C.textMuted:C.text), fontWeight: bold?700:400 }}>{label}</span>
    <span style={{ fontFamily:font.mono, fontSize: small?12:13.5, fontWeight: bold?700:400, color: color || (bold?C.goldLight:C.text), whiteSpace:"nowrap" }}>{value}</span>
  </div>
);
// Barra divisoria de sub-sección dentro de una tarjeta (p.ej. "Dinero recibido por método de pago",
// "Ventas", "Servicios" dentro de Cierre) — imita las barras de encabezado del diseño de Felipe.
const CajaSubHeader = ({ label, compact }) => (
  <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:4, padding: compact?"2px 6px":"4px 8px", margin: compact?"6px 0 2px":"10px 0 4px", fontFamily:font.body, fontSize:11, fontWeight:700, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
);
// Fila de formulario "a modo factura": título/etiqueta a la izquierda, el campo editable compacto a
// la derecha — mismo look que CajaReciboLinea pero con un input/select real en vez de texto. Usada
// para que Apertura, Cierre, Novedades y Recolección se vean como una sola lista consistente.
// minWidth:0 es necesario para que el input de verdad se achique en vez de salirse del cuadro —
// por defecto un flex item no encoge más allá del ancho de su propio contenido (min-width:auto),
// así que sin esto una etiqueta+valor largos empujan el input fuera del borde en pantallas angostas.
const cajaInputStyleRow = { ...cajaInputStyle, width:"auto", flex:"0 1 190px", minWidth:0, textAlign:"right", fontSize:13 };
const cajaInputStyleRowCompact = { ...cajaInputStyleRow, padding:"4px 7px", fontSize:12.5 };
const CajaFieldRow = ({ label, value, onChange, options, placeholder, type="text", wide, compact }) => {
  const base = compact ? cajaInputStyleRowCompact : cajaInputStyleRow;
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding: compact?"2px 0":"4px 0" }}>
      {label && <div style={{ fontFamily:font.body, fontSize: compact?12:13, color:C.text, flexShrink:0 }}>{label}</div>}
      {options ? (
        <select value={value} onChange={e=>onChange(e.target.value)} style={base}>
          {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={wide ? { ...base, flex:"1 1 240px" } : base}/>
      )}
    </div>
  );
};
const CajaMoneyRow = ({ label, value, onChange, placeholder, compact, narrow }) => {
  const digits = String(value||"").replace(/[^\d]/g,"");
  const mostrado = digits ? `$${Number(digits).toLocaleString("es-CO")}` : "";
  // `narrow` = la celda mide justo lo que necesita un valor típico ("$100.000", 8 caracteres) en
  // vez de estirarse a 190px como el resto de campos — para "Base", que casi nunca es un número
  // largo, se ve mucho más proporcional al resto de la tarjeta.
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding: compact?"2px 0":"4px 0" }}>
      {label && <div style={{ fontFamily:font.body, fontSize: compact?12:13, color:C.text, flexShrink:0 }}>{label}</div>}
      <input type="text" inputMode="numeric" value={mostrado} onChange={e=>onChange(e.target.value.replace(/[^\d]/g,""))} placeholder={placeholder||"$0"} style={narrow ? { ...(compact?cajaInputStyleRowCompact:cajaInputStyleRow), flex:"0 0 84px", width:84 } : (compact?cajaInputStyleRowCompact:cajaInputStyleRow)}/>
    </div>
  );
};
// Campo "a modo factura" que normalmente se ve solo como texto (label a la izq., valor a la
// der.) con un botoncito ✏️ — al hacer click se convierte en el input/select real para cambiar
// el dato, y al salir (blur, o al elegir una opción) vuelve a verse como texto plano. Pensado
// para fecha/asesor/entrega/recibe/valor a recoger: cosas que se eligen una vez y rara vez se
// vuelven a tocar, así que no necesitan quedar siempre como una celda de formulario.
const CajaCampoPick = ({ label, value, onChange, options, type="text", money, compact, placeholder }) => {
  const [editando, setEditando] = useState(false);
  const selectRef = useRef(null);
  const digits = money ? String(value||"").replace(/[^\d]/g,"") : null;
  // Sin cuadro: en edición se ve igual que en modo lectura (mismo texto, mismo tamaño), solo que
  // ahora es un input/select real — nada de fondo ni borde tipo "caja". Si es una lista, se intenta
  // abrir el desplegable de una vez al entrar en edición (soportado en navegadores recientes).
  const bareStyle = {
    background:"transparent", border:"none", borderRadius:0, padding:0, margin:0,
    color:C.text, fontFamily:font.mono, fontSize: compact?12:13.5, textAlign:"right",
    outline:"none", boxShadow:"none", WebkitAppearance:"none", appearance:"none", cursor:"pointer",
  };
  useEffect(()=>{
    if(editando && options && selectRef.current){
      try{ selectRef.current.showPicker?.(); }catch(e){ /* no soportado en este navegador, no pasa nada */ }
    }
  }, [editando]);
  if(editando){
    return (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding: compact?"2px 0":"4px 0" }}>
        {label && <div style={{ fontFamily:font.body, fontSize: compact?12:13, color:C.text, flexShrink:0 }}>{label}</div>}
        {options ? (
          <select ref={selectRef} autoFocus value={value} onChange={e=>{ onChange(e.target.value); setEditando(false); }} onBlur={()=>setEditando(false)} style={bareStyle}>
            {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : money ? (
          <input autoFocus type="text" inputMode="numeric" value={digits?`$${Number(digits).toLocaleString("es-CO")}`:""} onChange={e=>onChange(e.target.value.replace(/[^\d]/g,""))} onBlur={()=>setEditando(false)} placeholder={placeholder||"$0"} style={{...bareStyle, cursor:"text", width:110}}/>
        ) : (
          <input autoFocus type={type} value={value} onChange={e=>onChange(e.target.value)} onBlur={()=>setEditando(false)} style={{...bareStyle, cursor:"text"}}/>
        )}
      </div>
    );
  }
  const texto = options ? (options.find(o=>o.value===value)?.label || "Selecciona...") : money ? (digits?`$${Number(digits).toLocaleString("es-CO")}`:"$0") : (value||"—");
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, padding: compact?"1px 0":"2.5px 0" }}>
      <span style={{ fontFamily:font.body, fontSize: compact?12:13, color:C.text }}>{label}</span>
      <button type="button" onClick={()=>setEditando(true)} style={{ display:"flex", alignItems:"center", gap:5, background:"none", border:"none", cursor:"pointer", padding:0 }}>
        <span style={{ fontFamily:font.mono, fontSize: compact?12:13.5, color:C.text }}>{texto}</span>
        <span style={{ color:C.textMuted, fontSize:11 }}>✏️</span>
      </button>
    </div>
  );
};

function VentasCajaScreen({ user, stores, users, ventas, ventasItems, ventasAbonos, ventasAjustes, gastos, setGastos, aperturas, setAperturas, cierres, setCierres, recolecciones, setRecolecciones, solicitudesBorrado, setSolicitudesBorrado, puedeRecoleccion, soloLectura, isMobile, turnosAsignaciones, turnosHorarios, lideres }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const tiendasList = tiendasVenta(stores);
  const [tiendaId, setTiendaId] = useState(tiendaFija || tiendasList[0]?.id || "");
  // Color asignado a la tienda que se está viendo — se usa para pintar los cuadros de Caja.
  const tiendaColor = stores[tiendaId]?.color;
  const [cajaVista, setCajaVista] = useState(soloLectura ? "historial" : "registrar"); // 'registrar' | 'historial'
  const asesores = users.filter(esVendedorPosible);
  const posiblesRecibe = users.filter(u=>(u.role==="master"||u.role==="admin"||u.role==="admin_finanzas"||u.role==="admin_turnos") && u.active);

  // Master o admin de finanzas pueden registrar con una fecha distinta a hoy (para poner al día algo atrasado).
  const puedeFechaLibre = esAdminDeVentas(user);

  const [apAsesorId, setApAsesorId] = useState("");
  const [apFecha, setApFecha] = useState(todayStr);
  const [guardandoAp, setGuardandoAp] = useState(false);

  const [gaValor, setGaValor] = useState("");
  const [gaMotivo, setGaMotivo] = useState("");
  const [gaTipo, setGaTipo] = useState("costo");
  // El login de Caja es compartido por toda la tienda, así que `user.name` no dice QUIÉN de
  // verdad está registrando la novedad — hay que elegirlo a mano, igual que "Asesor" en Apertura,
  // Cierre y Recolección.
  const [gaAsesorId, setGaAsesorId] = useState("");
  // Quién de los líderes actuales autorizó la novedad — distinto de "quién registra" (el asesor
  // que la digita) y de "quién aprueba" (master/admin_finanzas, después, desde el Historial).
  const [gaAutorizoLiderId, setGaAutorizoLiderId] = useState("");
  const lideresActivos = (lideres||[]).filter(l=>l.nombre && l.nombre.trim()).sort((a,b)=>(a.orden??999)-(b.orden??999));
  const puedeAprobarNovedad = user.role==="master" || user.role==="admin_finanzas";
  const [guardandoGa, setGuardandoGa] = useState(false);

  // Editar/borrar novedades desde el Historial — la tienda solo puede tocar las de HOY (por si se
  // equivocó al digitar), master/admin_finanzas pueden tocar cualquier día.
  const [gastoEditandoId, setGastoEditandoId] = useState(null);
  const [geValor, setGeValor] = useState("");
  const [geMotivo, setGeMotivo] = useState("");
  const [geTipo, setGeTipo] = useState("costo");
  const [geAutorizoLiderId, setGeAutorizoLiderId] = useState("");

  const [ciAsesorId, setCiAsesorId] = useState("");
  const [ciTipo, setCiTipo] = useState("definitivo");
  const [ciNovedades, setCiNovedades] = useState("");
  // La nota arranca oculta (solo un botón "+ Agregar nota") para ahorrar espacio — se abre al
  // hacer click, o de una vez si ya hay algo escrito (para poder verlo/editarlo).
  const [ciNotaAbierta, setCiNotaAbierta] = useState(false);
  const [ciFecha, setCiFecha] = useState(todayStr);
  const [guardandoCi, setGuardandoCi] = useState(false);

  const [reEntregaId, setReEntregaId] = useState("");
  const [reRecibeId, setReRecibeId] = useState("");
  const [reValor, setReValor] = useState("");
  const [reComentarios, setReComentarios] = useState("");
  const [reFecha, setReFecha] = useState(todayStr);
  const [guardandoRe, setGuardandoRe] = useState(false);
  const [reValorTocado, setReValorTocado] = useState(false);
  // Caso esporádico: además de lo de días anteriores (siempre incluido), también se retira una
  // parte del efectivo de HOY, con tope de lo acumulado hoy hasta el momento.
  const [reIncluyeHoy, setReIncluyeHoy] = useState(false);
  const [reValorHoy, setReValorHoy] = useState("");
  // La Base sí se puede editar acá — es el único momento en que se bloquea en Apertura/Cierre pero
  // se deja libre: al recoger efectivo es cuando de verdad se cuenta la plata físicamente, así que
  // es el momento natural para corregir la base si quedó desfasada (por ejemplo, por un hueco de
  // gastos sin cubrir). Se sugiere el valor calculado automáticamente (baseVigente), pero se puede
  // cambiar con el lápiz igual que "Valor a recoger".
  const [reBaseCaja, setReBaseCaja] = useState("");
  const [reBaseCajaTocado, setReBaseCajaTocado] = useState(false);

  const [msg, setMsg] = useState("");

  const aperturasTienda = aperturas.filter(a=>a.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  const cierresTienda = cierres.filter(c=>c.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  const recoleccionesTienda = recolecciones.filter(r=>r.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  const ultimaRecoleccion = recoleccionesTienda[0] || null;

  useEffect(()=>{
    setReValorTocado(false);
    setReIncluyeHoy(false);
    setReValorHoy("");
    setReBaseCajaTocado(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiendaId, aperturasTienda[0]?.id, ultimaRecoleccion?.id]);

  const ventasTiendaMap = {};
  ventas.forEach(v=>{ if(v.tienda_id===tiendaId) ventasTiendaMap[v.id]=v; });

  // Efectivo (ventas + abonos en efectivo) de la tienda en un día calendario dado.
  // Cada renglón cuenta en SU propia fecha efectiva: la de la venta original, salvo que sea un
  // excedente de nota crédito (es_original:false), en cuyo caso cuenta en su fecha_item real.
  const efectivoDelDia = (fechaDia) => {
    let total = 0;
    ventasItems.forEach(i=>{
      const v = ventasTiendaMap[i.venta_id];
      if(!v || i.tipo==="flexipago") return;
      const fechaEfectiva = (i.es_original===false && i.fecha_item) ? i.fecha_item : v.fecha;
      if(fechaEfectiva!==fechaDia) return;
      (i.pagos||[]).forEach(p=>{ if(p.medio_pago==="efectivo") total += Number(p.valor||0); });
    });
    ventasAbonos.forEach(a=>{
      const v = ventasTiendaMap[a.venta_id];
      if(!v || a.fecha!==fechaDia) return;
      if(a.medio_pago==="efectivo") total += Number(a.valor||0);
    });
    return total;
  };

  // Gastos de caja (novedades con valor, ej. comprar un limpiavidrios, o lo que alguien debe) desde
  // la última recolección — se calculan ACÁ ARRIBA porque ahora entran directo al cálculo del
  // efectivo pendiente (ver más abajo): un "costo" (o una deuda, como lo que debe un asesor) reduce
  // permanentemente lo que de verdad hay para recolectar, no solo la sugerencia inicial — si no, esa
  // plata quedaba "perdida" en cuanto se guardaba la recolección con un valor editado a mano.
  const desdeTS = ultimaRecoleccion ? new Date(ultimaRecoleccion.created_at).getTime() : 0;
  const gastosTienda = gastos.filter(g=>g.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  // Una novedad de tipo "costo" resta (se pagó algo con la base, o alguien quedó debiendo) y una de
  // tipo "ingreso" suma (ej. vueltas que un cliente no reclamó). Las novedades viejas sin tipo se
  // tratan como costo.
  const gastosDesdeRecoleccion = gastosTienda.filter(g=> new Date(g.created_at).getTime() > desdeTS);
  const gastosNetoAcumulado = gastosDesdeRecoleccion.reduce((s,g)=> (g.tipo==="ingreso" ? s+Number(g.valor||0) : s-Number(g.valor||0)), 0);
  const costosAcumulados = gastosDesdeRecoleccion.filter(g=>g.tipo!=="ingreso").reduce((s,g)=>s+Number(g.valor||0),0);
  const ingresosAcumulados = gastosDesdeRecoleccion.filter(g=>g.tipo==="ingreso").reduce((s,g)=>s+Number(g.valor||0),0);

  // ── Efectivo pendiente por recoger ──────────────────────────────────────────
  // Regla general: una recolección SIEMPRE se lleva el efectivo de días ya cerrados (anteriores a
  // hoy) — el de HOY no se recoge por defecto, sigue sumando hasta la siguiente recolección. Solo
  // si se marca "Recoges efectivo de hoy" se retira una parte de hoy, con tope de lo acumulado hoy.
  // fechaCorte se sigue usando más abajo (base) como referencia de "desde la última recolección",
  // pero YA NO se usa para calcular el efectivo pendiente: ese cálculo es ahora por
  // fecha de corte — así una recolección PARCIAL (recoger menos de lo sugerido) deja correctamente
  // el resto pendiente para la próxima vez, en lugar de darlo por recogido solo porque cambió la
  // fecha de la última recolección.
  const fechaCorte = ultimaRecoleccion ? ultimaRecoleccion.fecha : null;

  // Efectivo (ventas + abonos en efectivo) de TODOS los días anteriores a hoy, en toda la historia
  // de la tienda — sin importar cuándo fue la última recolección.
  let efectivoAnterioresBruto = 0;
  ventasItems.forEach(i=>{
    const v = ventasTiendaMap[i.venta_id];
    if(!v || i.tipo==="flexipago") return;
    const fechaEfectiva = (i.es_original===false && i.fecha_item) ? i.fecha_item : v.fecha;
    if(fechaEfectiva>=todayStr) return;
    (i.pagos||[]).forEach(p=>{ if(p.medio_pago==="efectivo") efectivoAnterioresBruto += Number(p.valor||0); });
  });
  ventasAbonos.forEach(a=>{
    const v = ventasTiendaMap[a.venta_id];
    if(!v) return;
    if(a.fecha>=todayStr) return;
    if(a.medio_pago==="efectivo") efectivoAnterioresBruto += Number(a.valor||0);
  });
  // Lo ya recogido de "días anteriores" en TODAS las recolecciones hechas hasta ahora. El campo
  // "valor" guarda días-anteriores + hoy juntos (ver guardarRecoleccion), así que se resta
  // valor_hoy para aislar solo la parte de días anteriores de cada recolección.
  const recogidoAnterioresAcumulado = recoleccionesTienda.reduce((s,r)=> s + (Number(r.valor||0) - Number(r.valor_hoy||0)), 0);
  // Efectivo de días anteriores a hoy que sigue pendiente — esto es lo que SIEMPRE se sugiere
  // recoger (la "regla general"). Si una recolección fue parcial, la diferencia queda acá. También
  // se le resta/suma el neto de novedades desde la última recolección (costo resta, ingreso suma)
  // para que una deuda o gasto quede reflejada de forma PERMANENTE en el pendiente real — no solo
  // en la sugerencia inicial, que se perdía en cuanto Santiago editaba el valor a mano.
  const efectivoAnteriores = Math.max(0, efectivoAnterioresBruto + gastosNetoAcumulado - recogidoAnterioresAcumulado);

  // Efectivo de HOY que sigue pendiente — es el tope para el retiro esporádico de "efectivo de hoy".
  const retiradoHoyYa = recoleccionesTienda.filter(r=>r.fecha===todayStr).reduce((s,r)=>s+Number(r.valor_hoy||0),0);
  const efectivoHoyPendiente = Math.max(0, efectivoDelDia(todayStr) - retiradoHoyYa);

  const efectivoPendienteTotal = efectivoAnteriores + efectivoHoyPendiente;

  // Lo que se sugiere recoger por defecto: los días anteriores a hoy, ya con las novedades
  // incluidas arriba. El efectivo de hoy (si se marca el check) se suma aparte.
  const efectivoARecolectar = efectivoAnteriores;

  // ── Base afectada por gastos sin cubrir ─────────────────────────────────────
  // Si una novedad tipo "costo" no alcanza a cubrirse con el efectivo YA acumulado en ese momento
  // (revisado día por día desde la última recolección), el resto sale de la base — ese hueco NO se
  // repara solo aunque después entre más efectivo (eso solo pasa al recoger, y solo si se acepta
  // completar la base). Se camina día por día, en orden, para que ventas de días POSTERIORES no
  // tapen huecos de días anteriores — cada costo solo se cubre con lo acumulado HASTA ese momento.
  const baseLineaVigente = Number(ultimaRecoleccion?.base_caja ?? BASE_CAJA_FIJA);
  let baseDeficit = 0;
  {
    const gastosOrdenados = [...gastosDesdeRecoleccion].sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
    let cursor = fechaCorte ? sumarDias(fechaCorte, 1) : (gastosOrdenados[0]?.fecha || null);
    let pool = 0, guard = 0;
    while(cursor && cursor<=todayStr && guard<730){
      pool += efectivoDelDia(cursor);
      gastosOrdenados.filter(g=>g.fecha===cursor).forEach(g=>{
        const valor = Number(g.valor||0);
        if(g.tipo==="ingreso"){ pool += valor; }
        else if(pool>=valor){ pool -= valor; }
        else { baseDeficit += (valor - pool); pool = 0; }
      });
      cursor = sumarDias(cursor, 1);
      guard++;
    }
  }
  // Lo que de verdad hay en la base ahora mismo: la última base registrada, menos el hueco.
  const baseVigente = Math.max(0, baseLineaVigente - baseDeficit);
  const totalEnCajaAhora = baseVigente + efectivoPendienteTotal;

  useEffect(()=>{
    if(!reValorTocado) setReValor(String(efectivoARecolectar||""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [efectivoARecolectar, tiendaId]);

  useEffect(()=>{
    if(!reBaseCajaTocado) setReBaseCaja(String(baseVigente||""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseVigente, tiendaId]);

  // Resumen de ventas del día para el Cierre: ingreso neto, servicios, y flexipagos del día (informativo)
  const resumenDia = (fecha) => {
    const ventasTienda = Object.values(ventasTiendaMap);
    const ingresoNeto = cajaZeros();
    const servicios = cajaZeros();
    const flexipagoDia = cajaZeros();
    // Notacrédito: el día en que se aplicó un excedente (fecha_item), mostramos el valor ORIGINAL
    // de la(s) factura(s) corregidas ese día — es solo informativo, no suma ni resta del total de
    // este día (el excedente en sí ya suma arriba, en "Ventas", como una venta más). Si hubo más
    // de una Notacrédito ese día, se suman los valores originales de cada factura.
    const notaCreditoDia = cajaZeros();
    let flexipagoCerradoHoy = 0;
    // Igual que flexipagoCerradoHoy pero desglosado por medio de pago — lo necesita "Ingreso del
    // día" para poder RESTAR justo esa parte (el valor TOTAL del flexipago ya quedó sumado en
    // ingresoNeto[medio] arriba, junto con las ventas normales — "Ventas"/"Total ventas" sí
    // reconocen el valor completo el día que se cierra). Para "Ingreso del día" ese valor total se
    // resta de nuevo y se reemplaza por abonoFlexipagoFinalMedios (ver abajo): lo que de verdad
    // entró HOY en caja no es el valor completo del flexipago, es solo el abono final.
    const flexipagoCerradoHoyMedios = cajaZeros();
    // Abono que CIERRA un Flexipago (a diferencia de un abono parcial que no lo completa): lo que
    // realmente entró en caja hoy por ese abono, desglosado por medio de pago. Junto con
    // flexipagoDia (los abonos parciales), es lo que Felipe pidió sumar en "Ingreso del día" —
    // "los dos abonos de flexipago, el normal y el final" — porque ambos son plata real que entró
    // hoy, sin importar si la venta completa quedó saldada o no.
    const abonoFlexipagoFinalMedios = cajaZeros();
    // "Descuentos" del día — suma informativa de los descuentos/bonos que ya traía cada renglón
    // (campo `descuento`, existente desde antes). Es puramente para mostrarlo en el rediseño de
    // Felipe: no resta de ningún total ni afecta ningún cálculo existente, solo se muestra aparte.
    let descuentoDia = 0;

    ventasItems.forEach(i=>{
      const v = ventasTiendaMap[i.venta_id];
      if(!v || i.tipo==="flexipago") return;
      const esExcedente = i.es_original===false && !!i.fecha_item;
      const fechaEfectiva = esExcedente ? i.fecha_item : v.fecha;
      if(fechaEfectiva===fecha){
        descuentoDia += Number(i.descuento||0);
        if(i.tipo==="producto"){
          (i.pagos||[]).forEach(p=>{ if(CAJA_MEDIOS.includes(p.medio_pago)) ingresoNeto[p.medio_pago]+=Number(p.valor||0); });
        } else if(i.tipo==="arreglo"||i.tipo==="marcacion"||i.tipo==="grabado"){
          (i.pagos||[]).forEach(p=>{ if(CAJA_MEDIOS.includes(p.medio_pago)) servicios[p.medio_pago]+=Number(p.valor||0); });
        }
      }
    });

    // Facturas que recibieron una Notacrédito con fecha_item === este día — mostramos el valor
    // original (venta.valor_original), desglosado por medio según los renglones ORIGINALES de esa
    // factura (no los renglones de excedente).
    const ventasConNotaCreditoHoy = new Set();
    ventasItems.forEach(i=>{
      const v = ventasTiendaMap[i.venta_id];
      if(!v) return;
      if(i.es_original===false && i.fecha_item===fecha) ventasConNotaCreditoHoy.add(v.id);
    });
    ventasConNotaCreditoHoy.forEach(ventaId=>{
      ventasItems.filter(i=>i.venta_id===ventaId && i.es_original!==false).forEach(i=>{
        (i.pagos||[]).forEach(p=>{ if(CAJA_MEDIOS.includes(p.medio_pago)) notaCreditoDia[p.medio_pago]+=Number(p.valor||0); });
      });
    });

    // Flexipagos: se revisan TODAS las ventas flexipago de la tienda (sin importar el día de venta),
    // para saber si alguna se terminó de pagar justo hoy.
    const ventasFlexipago = ventasTienda.filter(v=>v.es_flexipago);
    ventasFlexipago.forEach(v=>{
      const valorTotal = ventasItems.filter(i=>i.venta_id===v.id && i.tipo==="flexipago").reduce((s,i)=>s+(Number(i.valor||0)-Number(i.descuento||0)),0);
      const abonos = ventasAbonos.filter(a=>a.venta_id===v.id).sort((a,b)=> new Date(a.created_at||a.fecha) - new Date(b.created_at||b.fecha));
      let acumulado = 0;
      abonos.forEach(ab=>{
        const antes = acumulado;
        acumulado += Number(ab.valor||0);
        const completaHoy = antes < valorTotal && acumulado >= valorTotal && ab.fecha===fecha;
        // Un abono puede venir dividido en varios medios de pago (mediosDeAbono normaliza los
        // abonos viejos de un solo medio a una lista de un solo renglón, para que esto no cambie
        // en nada el cálculo de los de siempre).
        const subPagos = mediosDeAbono(ab);
        const totalEsteAbono = subPagos.reduce((s,p)=>s+Number(p.valor||0),0) || 1;
        if(completaHoy){
          // Este es el abono que cierra el flexipago: su valor TOTAL ya entra al ingreso neto de
          // hoy — repartido entre los medios de ESTE abono en la misma proporción con la que se
          // pagó (agrupado según el/los medio(s) de ESE abono) — así "Ventas"/"Total ventas"
          // reconocen la venta completa el día que se termina de pagar. No hay forma de saber con
          // qué medio se pagaron los abonos de días anteriores, así que se sigue usando el/los
          // medio(s) del abono que cierra, como ya se hacía con uno solo. No se muestra también en
          // "Flexipagos de ese día" — mostrarlo ahí además del ingreso neto hacía parecer que esa
          // plata no contaba, cuando en realidad es justo la que cerró la venta.
          flexipagoCerradoHoy += valorTotal;
          subPagos.forEach(p=>{
            if(!CAJA_MEDIOS.includes(p.medio_pago)) return;
            const parte = Number(p.valor||0);
            const proporcion = parte / totalEsteAbono;
            ingresoNeto[p.medio_pago] += valorTotal * proporcion;
            flexipagoCerradoHoyMedios[p.medio_pago] += valorTotal * proporcion;
            // Pero lo que de verdad entró en CAJA hoy es solo el valor de este abono (no el valor
            // total del flexipago, que en gran parte ya había entrado en días anteriores) — esto es
            // lo que "Ingreso del día" necesita sumar.
            abonoFlexipagoFinalMedios[p.medio_pago] += parte;
          });
        } else if(ab.fecha===fecha){
          // Abono de hoy que NO cierra el flexipago: es plata que entró pero la venta todavía no
          // se reconoce como completa, así que se muestra aparte y no suma al ingreso neto.
          subPagos.forEach(p=>{
            if(!CAJA_MEDIOS.includes(p.medio_pago)) return;
            flexipagoDia[p.medio_pago] += Number(p.valor||0);
          });
        }
      });
    });

    // Cambios de producto por el mismo valor (ver botón 🔄 en la venta) — puramente informativo
    // para contrastar contra Siigo (que sí genera un N.º de factura nuevo aunque no haya diferencia
    // de plata). No suma ni resta de Ventas/Ingreso ni de ningún otro total de este resumen.
    const totalCambioProductoDia = (ventasAjustes||[])
      .filter(a=>a.es_cambio_producto && a.fecha===fecha && ventasTiendaMap[a.venta_id])
      .reduce((s,a)=>s+Number(a.valor_informativo||0),0);

    return { ingresoNeto, servicios, flexipagoDia, notaCreditoDia, flexipagoCerradoHoy, flexipagoCerradoHoyMedios, abonoFlexipagoFinalMedios, totalIngresoNeto:cajaTotal(ingresoNeto), totalServicios:cajaTotal(servicios), totalFlexipagoDia:cajaTotal(flexipagoDia), totalNotaCreditoDia:cajaTotal(notaCreditoDia), totalDescuentosDia:descuentoDia, totalAbonoFlexipagoFinal:cajaTotal(abonoFlexipagoFinalMedios), totalCambioProductoDia };
  };

  const resumenHoy = resumenDia(ciFecha);

  // Arma un mensaje "Falta elegir X, Y y Z" con solo lo que de verdad falta, en vez de nombrar
  // campos que ya están llenos.
  const listarFaltantes = (arr) => arr.length<=1 ? (arr[0]||"") : `${arr.slice(0,-1).join(", ")} y ${arr[arr.length-1]}`;

  const guardarApertura = async () => {
    if(!tiendaId || !apAsesorId){
      const falt = []; if(!tiendaId) falt.push("la tienda"); if(!apAsesorId) falt.push("quién abre");
      setMsg(`Falta elegir ${listarFaltantes(falt)}.`); return;
    }
    if(apFecha!==todayStr && !puedeFechaLibre){ setMsg("Solo el master o admin de finanzas puede registrar una apertura con fecha distinta a hoy. Pide autorización."); return; }
    setGuardandoAp(true); setMsg("");
    const asesor = users.find(u=>u.id===apAsesorId);
    const { data, error } = await supabase.from("ventas_caja_aperturas").insert({
      tienda_id:tiendaId, fecha:apFecha, asesor_id:apAsesorId, asesor_nombre:asesor?.name||"",
      base_caja:Number(baseVigente||0), novedades:null, registrado_por:user.name,
    }).select().single();
    setGuardandoAp(false);
    if(data){ setAperturas(prev=>[data,...prev]); }
    else if(error){ setMsg(`No se pudo guardar la apertura: ${error.message||"error desconocido"}`); }
  };

  const guardarGasto = async () => {
    if(!tiendaId || !gaValor || !gaMotivo.trim() || !gaAsesorId || !gaAutorizoLiderId){ setMsg("Falta el valor, el motivo, quién registra y quién autorizó la novedad."); return; }
    setGuardandoGa(true); setMsg("");
    const nombreAsesorGa = asesores.find(a=>a.id===gaAsesorId)?.name || user.name;
    const nombreLiderGa = lideresActivos.find(l=>l.id===gaAutorizoLiderId)?.nombre || "";
    // La novedad afecta el cálculo de recolección de inmediato, pero queda "pendiente" hasta que
    // master/admin_finanzas la revise y apruebe — son movimientos de dinero, así que quedan a la vista.
    const { data, error } = await supabase.from("ventas_caja_gastos").insert({
      tienda_id:tiendaId, fecha:apFecha, valor:Number(gaValor||0), motivo:gaMotivo.trim(), tipo:gaTipo, estado:"pendiente", registrado_por:nombreAsesorGa, autorizado_por:nombreLiderGa,
    }).select().single();
    setGuardandoGa(false);
    if(data){ setGastos(prev=>[data,...prev]); setGaValor(""); setGaMotivo(""); setGaAsesorId(""); setGaAutorizoLiderId(""); }
    else if(error){ setMsg(`No se pudo guardar la novedad: ${error.message||"error desconocido"}`); }
  };

  const aprobarGasto = async (g) => {
    const { data, error } = await supabase.from("ventas_caja_gastos").update({ estado:"aprobado", aprobado_por:user.name, aprobado_at:new Date().toISOString() }).eq("id", g.id).select().single();
    if(data){ setGastos(prev=>prev.map(x=>x.id===data.id?data:x)); }
    else if(error){ setMsg(`No se pudo aprobar: ${error.message||"error desconocido"}`); }
  };

  // La tienda solo puede editar/borrar las novedades de HOY; master/admin_finanzas cualquier día.
  const puedeTocarGasto = (g) => esAdminDeVentas(user) || (esCuentaTienda(user) && g.fecha===todayStr);
  const empezarEditarGasto = (g) => { setGastoEditandoId(g.id); setGeValor(String(g.valor||"")); setGeMotivo(g.motivo||""); setGeTipo(g.tipo||"costo"); setGeAutorizoLiderId(lideresActivos.find(l=>l.nombre===g.autorizado_por)?.id || ""); };
  const cancelarEditarGasto = () => { setGastoEditandoId(null); setGeValor(""); setGeMotivo(""); setGeTipo("costo"); setGeAutorizoLiderId(""); };
  const guardarEdicionGasto = async (g) => {
    if(!geValor || !geMotivo.trim() || !geAutorizoLiderId){ setMsg("Falta el valor, el motivo y quién autorizó la novedad."); return; }
    const nombreLiderGe = lideresActivos.find(l=>l.id===geAutorizoLiderId)?.nombre || "";
    const { data, error } = await supabase.from("ventas_caja_gastos").update({ valor:Number(geValor||0), motivo:geMotivo.trim(), tipo:geTipo, autorizado_por:nombreLiderGe }).eq("id", g.id).select().single();
    if(data){ setGastos(prev=>prev.map(x=>x.id===data.id?data:x)); cancelarEditarGasto(); }
    else if(error){ setMsg(`No se pudo guardar la edición: ${error.message||"error desconocido"}`); }
  };
  const borrarGasto = async (g) => {
    if(!window.confirm(`¿Borrar esta novedad (${g.motivo})? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("ventas_caja_gastos").delete().eq("id", g.id);
    if(error){ setMsg(`No se pudo borrar: ${error.message||"error desconocido"}`); return; }
    setGastos(prev=>prev.filter(x=>x.id!==g.id));
  };

  const guardarCierre = async () => {
    if(!tiendaId || !ciAsesorId){
      const falt = []; if(!tiendaId) falt.push("la tienda"); if(!ciAsesorId) falt.push("quién cierra");
      setMsg(`Falta elegir ${listarFaltantes(falt)}.`); return;
    }
    if(ciFecha!==todayStr && !puedeFechaLibre){ setMsg("Solo el master o admin de finanzas puede registrar un cierre con fecha distinta a hoy. Pide autorización."); return; }
    setGuardandoCi(true); setMsg("");
    const asesor = users.find(u=>u.id===ciAsesorId);
    const { data, error } = await supabase.from("ventas_caja_cierres").insert({
      tienda_id:tiendaId, fecha:ciFecha, tipo:ciTipo, asesor_id:ciAsesorId, asesor_nombre:asesor?.name||"",
      base_caja:Number(baseVigente||0), novedades:ciNovedades.trim()||null, registrado_por:user.name,
    }).select().single();
    setGuardandoCi(false);
    if(data){ setCierres(prev=>[data,...prev]); setCiNovedades(""); sonidoCierreCaja(); }
    else if(error){ setMsg(`No se pudo guardar el cierre: ${error.message||"error desconocido"}`); sonidoError(); }
  };

  const guardarRecoleccion = async () => {
    if(!tiendaId || !reEntregaId || !reRecibeId || !reValor){
      const falt = [];
      if(!tiendaId) falt.push("la tienda");
      if(!reEntregaId) falt.push("quién entrega");
      if(!reRecibeId) falt.push("quién recibe");
      if(!reValor) falt.push("el valor");
      setMsg(`Falta elegir ${listarFaltantes(falt)}.`); return;
    }
    if(reFecha!==todayStr && !puedeFechaLibre){ setMsg("Solo el master o admin de finanzas puede registrar una recolección con fecha distinta a hoy. Pide autorización."); return; }
    const valorHoyNum = reIncluyeHoy ? Number(reValorHoy||0) : 0;
    if(reIncluyeHoy && valorHoyNum<=0){ setMsg("Marcaste que recoges efectivo de hoy — falta el valor a retirar."); return; }
    if(reIncluyeHoy && valorHoyNum>efectivoHoyPendiente){ setMsg(`No puedes retirar más de lo acumulado hoy (${fmtCOP(efectivoHoyPendiente)}).`); return; }

    // La base que queda es un campo editable en esta misma tarjeta (ver "Base que queda" con
    // lápiz) — a diferencia de Apertura/Cierre donde está bloqueada, acá sí se puede corregir a
    // mano porque es el momento en que de verdad se cuenta el efectivo físicamente. Por defecto
    // trae el valor calculado automáticamente (baseVigente), pero si hay un hueco por gastos sin
    // cubrir, o simplemente no cuadra con lo contado, Santiago puede cambiarlo directo ahí.
    const valorFinal = Number(reValor||0) + valorHoyNum;
    const baseCajaFinal = Number(reBaseCaja||0);

    setGuardandoRe(true); setMsg("");
    const entrega = users.find(u=>u.id===reEntregaId);
    const recibe = users.find(u=>u.id===reRecibeId);
    const { data, error } = await supabase.from("ventas_caja_recolecciones").insert({
      tienda_id:tiendaId, fecha:reFecha, entrega_usuario_id:reEntregaId, entrega_nombre:entrega?.name||"",
      recibe_usuario_id:reRecibeId, recibe_nombre:recibe?.name||"", valor:valorFinal,
      valor_hoy:valorHoyNum, incluye_hoy:reIncluyeHoy,
      base_caja:baseCajaFinal, comentarios:reComentarios.trim()||null, registrado_por:user.name,
    }).select().single();
    setGuardandoRe(false);
    if(data){ setRecolecciones(prev=>[data,...prev]); setReValor(""); setReComentarios(""); setReIncluyeHoy(false); setReValorHoy(""); setReBaseCajaTocado(false); }
    else if(error){ setMsg(`No se pudo guardar la recolección: ${error.message||"error desconocido"}`); }
  };

  // Borrar registros de caja — solo master/admin_finanzas, y con confirmación (son registros
  // financieros, así que hay que estar seguro antes de borrar).
  const puedeBorrarCaja = esAdminDeVentas(user);
  const borrarApertura = async (a) => {
    if(!window.confirm(`¿Borrar esta apertura (${fmtFechaHora(a.created_at)} · ${a.asesor_nombre})? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("ventas_caja_aperturas").delete().eq("id", a.id);
    if(error){ setMsg(`No se pudo borrar: ${error.message||"error desconocido"}`); return; }
    setAperturas(prev=>prev.filter(x=>x.id!==a.id));
  };
  const borrarCierre = async (c) => {
    if(!window.confirm(`¿Borrar este cierre (${fmtFechaHora(c.created_at)} · ${c.asesor_nombre})? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("ventas_caja_cierres").delete().eq("id", c.id);
    if(error){ setMsg(`No se pudo borrar: ${error.message||"error desconocido"}`); return; }
    setCierres(prev=>prev.filter(x=>x.id!==c.id));
  };
  const borrarRecoleccion = async (r) => {
    if(!window.confirm(`¿Borrar esta recolección (${fmtFechaHora(r.created_at)} · ${r.entrega_nombre} → ${r.recibe_nombre})? Esta acción no se puede deshacer.`)) return;
    const { error } = await supabase.from("ventas_caja_recolecciones").delete().eq("id", r.id);
    if(error){ setMsg(`No se pudo borrar: ${error.message||"error desconocido"}`); return; }
    setRecolecciones(prev=>prev.filter(x=>x.id!==r.id));
  };

  // ── Cuenta de tienda: solicitar borrado (no puede borrar directo) — master/admin_finanzas aprueban ──
  const puedeSolicitarBorradoCaja = esCuentaTienda(user);
  const solicitudesTienda = (solicitudesBorrado||[]).filter(s=>s.tienda_id===tiendaId);
  const solicitudPendientePara = (tabla, registroId) => solicitudesTienda.find(s=>s.tabla===tabla && s.registro_id===registroId && s.estado==="pendiente");
  const solicitudesPendientes = solicitudesTienda.filter(s=>s.estado==="pendiente");

  const solicitarBorrado = async (tabla, registro, resumen) => {
    if(!window.confirm(`¿Solicitar el borrado de este registro (${resumen})? Un master o admin_finanzas debe aprobarlo.`)) return;
    const { data, error } = await supabase.from("ventas_caja_solicitudes_borrado").insert({
      tienda_id:tiendaId, tabla, registro_id:registro.id, resumen, solicitado_por:user.name, estado:"pendiente",
    }).select().single();
    if(error){ setMsg(`No se pudo enviar la solicitud: ${error.message||"error desconocido"}`); return; }
    setSolicitudesBorrado(prev=>[data, ...(prev||[])]);
  };

  const resolverSolicitudBorrado = async (solicitud, nuevoEstado) => {
    if(nuevoEstado==="aprobada"){
      if(!window.confirm(`¿Aprobar y borrar (${solicitud.resumen})? Esta acción no se puede deshacer.`)) return;
      const tablaReal = solicitud.tabla==="apertura"?"ventas_caja_aperturas":solicitud.tabla==="cierre"?"ventas_caja_cierres":"ventas_caja_recolecciones";
      const { error:errBorrar } = await supabase.from(tablaReal).delete().eq("id", solicitud.registro_id);
      if(errBorrar){ setMsg(`No se pudo borrar: ${errBorrar.message||"error desconocido"}`); return; }
      if(solicitud.tabla==="apertura") setAperturas(prev=>prev.filter(x=>x.id!==solicitud.registro_id));
      else if(solicitud.tabla==="cierre") setCierres(prev=>prev.filter(x=>x.id!==solicitud.registro_id));
      else setRecolecciones(prev=>prev.filter(x=>x.id!==solicitud.registro_id));
    }
    const { data, error } = await supabase.from("ventas_caja_solicitudes_borrado").update({ estado:nuevoEstado, resuelto_por:user.name, fecha_resolucion:new Date().toISOString() }).eq("id", solicitud.id).select().single();
    if(error){ setMsg(`No se pudo actualizar la solicitud: ${error.message||"error desconocido"}`); return; }
    setSolicitudesBorrado(prev=>prev.map(s=>s.id===data.id?data:s));
  };

  const fmtFechaHora = (iso) => new Date(iso).toLocaleString("es-CO",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  // Solo para mostrar (rediseño Felipe): nombre de la tienda ya elegida arriba, y las novedades
  // (gastos) cuya fecha coincide con la fecha de cierre — no cambian ningún cálculo existente.
  const tiendaNombreActual = stores[tiendaId]?.name || "";
  const novedadesDelDia = gastosTienda.filter(g=>g.fecha===ciFecha);
  // La fila "Turno" mostraba el nombre de la tienda (redundante con el selector de arriba) — en
  // vez de eso, una vez se elige el asesor, muestra el turno que tiene asignado ese día en la
  // malla de Turnos (ej. "UT2 (12pm–8pm)"), tomado de turnos_asignaciones + turnos_horarios. Si
  // ese día no tiene ninguna asignación (ej. cuenta que no está en la malla), se cae de vuelta al
  // nombre de la tienda.
  const turnoAsesorTexto = (asesorId, fecha) => {
    if(!asesorId) return tiendaNombreActual || "—";
    const asig = (turnosAsignaciones||[]).find(a=>a.asesor_id===asesorId && a.fecha===fecha);
    if(!asig || !asig.shift) return tiendaNombreActual || "—";
    const rango = getExpectedRange(asig.shift, fecha, asig.tienda_id||tiendaId, turnosHorarios, asig.entrada_custom, asig.salida_custom);
    return rango ? `${asig.shift} (${rango})` : asig.shift;
  };

  return (
    <div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10, alignItems:"center", marginBottom:10 }}>
        {!tiendaFija && (
          <div style={{ width:200 }}>
            <CajaField value={tiendaId} onChange={setTiendaId} options={tiendasList.map(t=>({value:t.id,label:t.name}))}/>
          </div>
        )}
        <div style={{ display:"flex", gap:6, marginLeft:"auto" }}>
          {!soloLectura && <Btn variant={cajaVista==="registrar"?"primary":"ghost"} sm onClick={()=>setCajaVista("registrar")}>Registrar</Btn>}
          <Btn variant={cajaVista==="historial"?"primary":"ghost"} sm onClick={()=>setCajaVista("historial")}>Historial</Btn>
        </div>
      </div>
      {msg && <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:7, padding:"7px 10px", color:C.red, fontSize:12, marginBottom:10, fontFamily:font.body }}>{msg}</div>}

      <div key={cajaVista} className="ozen-pane-anim-tab">
      {cajaVista==="registrar" && !soloLectura ? (
        <>
          {/* Rediseño Felipe (v2, fiel al mockup real): columna izquierda = una sola tarjeta Cierre
              (con el selector Parcial/Final en el encabezado, tabla combinada de "dinero recibido
              por método de pago", Ventas, Servicios, Descuentos, Nota crédito, Novedades del día).
              Columna derecha = 4 tarjetas apiladas: Apertura, Última Recolección, Novedades del
              período, Agregar novedad. Solo presentación — mismas variables/cálculos de siempre;
              únicas adiciones: `tiendaNombreActual` (nombre de la tienda ya elegida arriba, para la
              fila "Turno") y `resumenHoy.totalDescuentosDia` (suma informativa de descuentos que ya
              traía cada renglón, no afecta ningún total). */}
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:10, alignItems:"start" }}>
            <div>
              {/* Apertura, Última Recolección y Novedades del período unificados en una sola
                  burbuja (pedido de Santiago) — mismo contenido de siempre, ahora con
                  CajaSubHeader como divisores en vez de ser 3 tarjetas separadas. */}
              <CajaCard compact icon="🔓" titulo="Apertura de turno" color={tiendaColor}>
                <CajaCampoPick compact label="Fecha" type="date" value={apFecha} onChange={setApFecha}/>
                <CajaCampoPick compact label="Asesor *" value={apAsesorId} onChange={setApAsesorId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
                <CajaReciboLinea compact label="Turno" value={turnoAsesorTexto(apAsesorId, apFecha)} small/>
                <CajaReciboLinea compact label="Base" value={fmtCOP(baseVigente)} color={baseDeficit>0?C.red:undefined} small/>
                {baseDeficit>0 && <div style={{ fontFamily:font.body, fontSize:10, color:C.red, marginTop:2 }}>Base afectada por gastos sin cubrir — se completa al recoger efectivo.</div>}
                {apFecha!==todayStr && <div style={{ fontFamily:font.body, fontSize:10, color:puedeFechaLibre?C.amber:C.red, marginTop:2 }}>{puedeFechaLibre?"Fecha distinta a hoy.":"Solo el master o admin de finanzas puede usar una fecha distinta a hoy."}</div>}
                <CajaReciboLinea compact label="Efectivo" value={fmtCOP(Math.max(0, efectivoPendienteTotal))}/>
                <CajaReciboLinea compact label="Total" value={fmtCOP(totalEnCajaAhora)} bold totalLine/>
                <div style={{ marginTop:6, display:"flex", justifyContent:"flex-end" }}>
                  <CajaBtn onClick={guardarApertura} disabled={guardandoAp || !tiendaId || !apAsesorId}>{guardandoAp?"...":"Registrar apertura"}</CajaBtn>
                </div>

                <CajaSubHeader compact label="Última Recolección"/>
                <CajaReciboLinea compact label="Fecha" value={ultimaRecoleccion ? fmtFechaHora(ultimaRecoleccion.created_at) : "—"}/>
                <CajaReciboLinea compact label="Por" value={ultimaRecoleccion ? (ultimaRecoleccion.recibe_nombre||"—") : "Sin registro previo"}/>

                <CajaSubHeader compact label="Novedades del período"/>
                <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:4 }}>Costos en rojo, ingresos en verde — desde la última recolección.</div>
                {gastosDesdeRecoleccion.length>0 ? (
                  <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                    {gastosDesdeRecoleccion.slice(0,5).map((g,idx)=>(
                      <div key={g.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:font.body, fontSize:12, color:C.text, gap:6 }}>
                        <span>{idx+1}. {g.motivo}{g.estado!=="aprobado" && <span style={{ color:C.amber }}> · pendiente</span>}</span>
                        <span style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <span style={{ fontFamily:font.mono, color:g.tipo==="ingreso"?C.green:C.red }}>{g.tipo==="ingreso"?"+":"−"}{fmtCOP(g.valor)}</span>
                          {puedeAprobarNovedad && g.estado!=="aprobado" && <button onClick={()=>aprobarGasto(g)} title="Aprobar esta novedad" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.green, cursor:"pointer", fontSize:11, padding:"2px 6px" }}>Aprobar</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin novedades registradas.</div>}
              </CajaCard>

              <CajaCard
                compact
                icon="🔒"
                titulo="Cierre de caja"
                color={tiendaColor}
                headerExtra={
                  <select value={ciTipo} onChange={e=>setCiTipo(e.target.value)} style={cajaHeaderSelectStyle}>
                    <option value="parcial">Parcial</option>
                    <option value="definitivo">Final</option>
                  </select>
                }
              >
                <CajaCampoPick compact label="Fecha" type="date" value={ciFecha} onChange={setCiFecha}/>
                <CajaCampoPick compact label="Asesor *" value={ciAsesorId} onChange={setCiAsesorId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
                <CajaReciboLinea compact label="Turno" value={turnoAsesorTexto(ciAsesorId, ciFecha)} small/>
                <CajaReciboLinea compact label="Base" value={fmtCOP(baseVigente)} color={baseDeficit>0?C.red:undefined} small/>
                {baseDeficit>0 && <div style={{ fontFamily:font.body, fontSize:10.5, color:C.red, marginTop:2 }}>Base afectada por gastos sin cubrir — se completa al recoger efectivo.</div>}
                {ciFecha!==todayStr && <div style={{ fontFamily:font.body, fontSize:11.5, color:puedeFechaLibre?C.amber:C.red, marginTop:2 }}>{puedeFechaLibre?"Fecha distinta a hoy.":"Solo el master o admin de finanzas puede usar una fecha distinta a hoy."}</div>}

                {/* Estructura pensada para contrastar contra el cierre de Siigo (ver captura que
                    mandó Santiago): Sección 2 debe coincidir con "Totales por medio de pago" de
                    Siigo, y Sección 4 es la plata real que entró a caja ese día — son dos lecturas
                    distintas de la misma información, por eso van separadas. Cada sección se oculta
                    por completo (encabezado incluido) si su total da $0 ese día; dentro de la que
                    sí se muestra, una línea puntual también se oculta si su valor es $0. */}

                {/* Sección 2 — "Formas de pago ventas": debe coincidir con Siigo. Por cada medio,
                    ventas normales + el abono que CIERRA un Flexipago ese día (Siigo lo factura
                    como una venta normal por ese medio, no como abono) — el valor total del
                    flexipago NO se reparte por medio, sino que se muestra aparte como "Flexipago
                    redimido" (así como Siigo lo separa en su columna "Ventas a crédito"). Por eso
                    NO se incluyen aquí servicios ni abonos que no completan la venta — Siigo no los
                    registra (ver nota de Santiago). */}
                {resumenHoy.totalIngresoNeto>0 && (
                  <>
                    <CajaSubHeader compact label="Formas de pago ventas"/>
                    {CAJA_MEDIOS.filter(m=>(resumenHoy.ingresoNeto[m]-resumenHoy.flexipagoCerradoHoyMedios[m]+resumenHoy.abonoFlexipagoFinalMedios[m])>0).map(m=><CajaReciboLinea compact key={`m-${m}`} label={CAJA_MEDIO_LABEL[m]} value={fmtCOP(resumenHoy.ingresoNeto[m]-resumenHoy.flexipagoCerradoHoyMedios[m]+resumenHoy.abonoFlexipagoFinalMedios[m])} small/>)}
                    {(resumenHoy.flexipagoCerradoHoy-resumenHoy.totalAbonoFlexipagoFinal)>0 && <CajaReciboLinea compact label="Flexipago redimido" value={fmtCOP(resumenHoy.flexipagoCerradoHoy-resumenHoy.totalAbonoFlexipagoFinal)} small/>}
                    <CajaReciboLinea compact label="Total ventas" value={fmtCOP(resumenHoy.totalIngresoNeto)} bold totalLine/>
                  </>
                )}

                {/* Sección 3 — Descuentos y notas crédito, solo informativo. */}
                {(resumenHoy.totalDescuentosDia+resumenHoy.totalNotaCreditoDia+resumenHoy.totalCambioProductoDia)>0 && (
                  <>
                    <CajaSubHeader compact label="Descuentos y notas crédito"/>
                    {resumenHoy.totalDescuentosDia>0 && <CajaReciboLinea compact label="Descuentos" value={fmtCOP(resumenHoy.totalDescuentosDia)} small/>}
                    {resumenHoy.totalNotaCreditoDia>0 && <CajaReciboLinea compact label="Nota crédito" value={fmtCOP(resumenHoy.totalNotaCreditoDia)} color={C.amber} small/>}
                    {resumenHoy.totalCambioProductoDia>0 && <CajaReciboLinea compact label="🔄 Cambio de producto (informativo)" value={fmtCOP(resumenHoy.totalCambioProductoDia)} color={C.gold} small/>}
                  </>
                )}

                {/* Sección 4 — "Ingreso del día": la plata REAL que entró a la caja ese día, para
                    contrastar contra el efectivo/transacciones/tarjeta físicos — incluye ventas,
                    servicios y los DOS tipos de abono de Flexipago (el que no completa la venta y
                    el que sí la completa), cada uno por SU valor real de hoy, no el valor total del
                    flexipago (que en gran parte ya había entrado en días anteriores). */}
                {(resumenHoy.totalIngresoNeto-resumenHoy.flexipagoCerradoHoy+resumenHoy.totalServicios+resumenHoy.totalFlexipagoDia+resumenHoy.totalAbonoFlexipagoFinal)>0 && (
                  <>
                    <CajaSubHeader compact label="Ingreso del día"/>
                    {CAJA_MEDIOS.filter(m=>(resumenHoy.ingresoNeto[m]-resumenHoy.flexipagoCerradoHoyMedios[m]+resumenHoy.servicios[m]+resumenHoy.flexipagoDia[m]+resumenHoy.abonoFlexipagoFinalMedios[m])>0).map(m=><CajaReciboLinea compact key={`m-${m}`} label={CAJA_MEDIO_LABEL[m]} value={fmtCOP(resumenHoy.ingresoNeto[m]-resumenHoy.flexipagoCerradoHoyMedios[m]+resumenHoy.servicios[m]+resumenHoy.flexipagoDia[m]+resumenHoy.abonoFlexipagoFinalMedios[m])} small/>)}
                    <CajaReciboLinea compact label="Total ingreso del día" value={fmtCOP(resumenHoy.totalIngresoNeto-resumenHoy.flexipagoCerradoHoy+resumenHoy.totalServicios+resumenHoy.totalFlexipagoDia+resumenHoy.totalAbonoFlexipagoFinal)} bold totalLine/>
                  </>
                )}

                {novedadesDelDia.length>0 && (
                  <>
                    <CajaSubHeader compact label="Novedades del día"/>
                    <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                      {novedadesDelDia.map((g,idx)=>(
                        <div key={g.id} style={{ fontFamily:font.body, fontSize:12, color:C.text, display:"flex", justifyContent:"space-between", gap:6 }}>
                          <span>{idx+1}. {g.motivo}</span>
                          <span style={{ fontFamily:font.mono, color:g.tipo==="ingreso"?C.green:C.red }}>{g.tipo==="ingreso"?"+":"−"}{fmtCOP(g.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {(ciNotaAbierta || ciNovedades) ? (
                  <CajaFieldRow compact wide label="Nota" value={ciNovedades} onChange={setCiNovedades} placeholder="Nota corta (opcional)"/>
                ) : (
                  <div style={{ marginTop:6 }}>
                    <button type="button" onClick={()=>setCiNotaAbierta(true)} style={{ background:"none", border:`1px dashed ${C.border}`, borderRadius:6, color:C.textMuted, cursor:"pointer", fontSize:11.5, fontFamily:font.body, padding:"4px 10px" }}>+ Agregar nota</button>
                  </div>
                )}

                <div style={{ marginTop:6, display:"flex", justifyContent:"flex-end" }}>
                  <CajaBtn onClick={guardarCierre} disabled={guardandoCi || !tiendaId || !ciAsesorId}>{guardandoCi?"...":"Registrar cierre"}</CajaBtn>
                </div>
              </CajaCard>
            </div>

            <div>
              <CajaCard compact icon="➕" titulo="Agregar novedad" color={tiendaColor}>
                <CajaFieldRow compact label="Quién registra *" value={gaAsesorId} onChange={setGaAsesorId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
                <CajaFieldRow compact label="Quién autorizó *" value={gaAutorizoLiderId} onChange={setGaAutorizoLiderId} options={[{value:"",label:"Selecciona un líder..."}, ...lideresActivos.map(l=>({value:l.id,label:l.nombre}))]}/>
                <CajaFieldRow compact label="Tipo" value={gaTipo} onChange={setGaTipo} options={[{value:"costo",label:"Costo"},{value:"ingreso",label:"Ingreso"}]}/>
                <CajaMoneyRow compact label="Valor" value={gaValor} onChange={setGaValor}/>
                <CajaFieldRow compact wide label="Motivo" placeholder="Ej: limpiavidrios / vueltas no reclamadas" value={gaMotivo} onChange={setGaMotivo}/>
                <div style={{ marginTop:6, display:"flex", justifyContent:"flex-end" }}>
                  <CajaBtn onClick={guardarGasto} disabled={guardandoGa || !gaAsesorId || !gaAutorizoLiderId}>{guardandoGa?"...":"Agregar +"}</CajaBtn>
                </div>
              </CajaCard>

              {/* Recolección de efectivo: movida a esta columna y hecha compacta — se veía
                  desproporcionadamente grande al lado de Apertura. */}
              <CajaCard compact icon="🚚" titulo="Recolección de efectivo" color={tiendaColor}>
                {!puedeRecoleccion ? (
                  <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>No tienes permiso para registrar una recolección. Puedes verlas en Historial.</div>
                ) : (
                  <>
                    <CajaCampoPick compact label="Fecha" type="date" value={reFecha} onChange={setReFecha}/>
                    <CajaCampoPick compact label="Entrega *" value={reEntregaId} onChange={setReEntregaId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
                    <CajaCampoPick compact label="Recibe *" value={reRecibeId} onChange={setReRecibeId} options={[{value:"",label:"Selecciona..."}, ...posiblesRecibe.map(u=>({value:u.id,label:u.name}))]}/>
                    <CajaCampoPick compact money label="Valor a recoger (días anteriores)" value={reValor} onChange={v=>{ setReValor(v); setReValorTocado(true); }}/>
                    {/* Informativo: el efectivo de hoy no entra en "días anteriores" (regla: no se
                        recoge el mismo día), pero sigue existiendo — se deja siempre visible aquí
                        debajo, con el mismo estilo de línea que el resto de la tarjeta, para que no
                        parezca que "desapareció" solo porque ese campo da $0. */}
                    {reFecha===todayStr && efectivoHoyPendiente>0 && <CajaReciboLinea compact label="Efectivo de hoy" value={fmtCOP(efectivoHoyPendiente)} small/>}
                    <CajaCampoPick compact money label="Base que queda" value={reBaseCaja} onChange={v=>{ setReBaseCaja(v); setReBaseCajaTocado(true); }}/>
                    {baseDeficit>0 && <div style={{ fontFamily:font.body, fontSize:10.5, color:C.red, marginTop:2 }}>Hay un hueco de {fmtCOP(baseDeficit)} en la base por gastos sin cubrir (sugerido: {fmtCOP(baseVigente)}). Ajusta el valor de arriba con lo que de verdad quieras dejar de base — no tiene que ser exacto.</div>}
                    {reFecha!==todayStr && <div style={{ fontFamily:font.body, fontSize:10.5, color:puedeFechaLibre?C.amber:C.red, marginTop:4 }}>{puedeFechaLibre?"Vas a registrar con una fecha distinta a hoy.":"Solo el master o admin de finanzas puede registrar con una fecha distinta a hoy — pide autorización."}</div>}
                    {reFecha===todayStr && (
                      <div style={{ marginTop:8, padding:"8px 10px", background:C.surfaceAlt, borderRadius:7, border:`1px solid ${C.border}` }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                          <label style={{ display:"flex", alignItems:"center", gap:7, fontFamily:font.body, fontSize:12, color:C.text, cursor:"pointer" }}>
                            ¿Recoges efectivo de hoy?
                            {efectivoHoyPendiente<=0 && <span style={{ color:C.textMuted }}> (aún no hay efectivo de hoy)</span>}
                          </label>
                          <input type="checkbox" checked={reIncluyeHoy} onChange={e=>{ setReIncluyeHoy(e.target.checked); if(!e.target.checked) setReValorHoy(""); }} disabled={efectivoHoyPendiente<=0}/>
                        </div>
                        {/* Sin "a retirar de hoy" en el label — es redundante con la pregunta de
                            arriba, que ya deja claro que es de hoy; y sin la línea de "Acumulado
                            hoy" aparte, que repetía el mismo dato que ya está en el "(máx. ...)". */}
                        {reIncluyeHoy && (
                          <div style={{ marginTop:6 }}>
                            <CajaMoneyRow compact label={`Valor (máx. ${fmtCOP(efectivoHoyPendiente)})`} value={reValorHoy} onChange={setReValorHoy}/>
                          </div>
                        )}
                      </div>
                    )}
                    <CajaFieldRow compact label="Comentarios" wide value={reComentarios} onChange={setReComentarios} placeholder="Opcional"/>
                    <div style={{ marginTop:8, display:"flex", justifyContent:"flex-end" }}>
                      <CajaBtn onClick={guardarRecoleccion} disabled={guardandoRe || !tiendaId || !reEntregaId || !reRecibeId || !reValor}>{guardandoRe?"...":"Registrar"}</CajaBtn>
                    </div>
                  </>
                )}
              </CajaCard>
            </div>
          </div>
        </>
      ) : (
        <>
          {puedeBorrarCaja && solicitudesPendientes.length>0 && (
            <CajaCard icon="🗑️" titulo="Solicitudes de borrado pendientes" color={tiendaColor}>
              <div style={{ display:"flex", flexDirection:"column" }}>
                {solicitudesPendientes.map(s=>(
                  <div key={s.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:6, fontFamily:font.body, fontSize:11.5, color:C.text, padding:"4px 2px", borderBottom:`1px solid ${C.border}` }}>
                    <span>{s.resumen} <span style={{ color:C.textMuted }}>· pidió {s.solicitado_por} · {fmtFechaHora(s.fecha_solicitud)}</span></span>
                    <span style={{ display:"flex", gap:6 }}>
                      <button onClick={()=>resolverSolicitudBorrado(s,"aprobada")} style={{ background:"none", border:`1px solid ${C.green}`, borderRadius:5, color:C.green, cursor:"pointer", fontSize:10, padding:"2px 8px" }}>Aprobar y borrar</button>
                      <button onClick={()=>resolverSolicitudBorrado(s,"rechazada")} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.textMuted, cursor:"pointer", fontSize:10, padding:"2px 8px" }}>Rechazar</button>
                    </span>
                  </div>
                ))}
              </div>
            </CajaCard>
          )}

          <CajaCard icon="🔓" titulo="Historial de apertura" color={tiendaColor}>
            <div style={{ display:"flex", flexDirection:"column" }}>
              {aperturasTienda.slice(0,30).map(a=>(
                <div key={a.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, fontFamily:font.body, fontSize:11.5, color:C.text, padding:"3px 2px", borderBottom:`1px solid ${C.border}` }}>
                  <span>{fmtFechaHora(a.created_at)} · {a.asesor_nombre}</span>
                  <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontFamily:font.mono, color:C.textMuted }}>Base: {fmtCOP(a.base_caja)}</span>
                    {puedeBorrarCaja && <button onClick={()=>borrarApertura(a)} title="Borrar" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.red, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Borrar</button>}
                    {puedeSolicitarBorradoCaja && (solicitudPendientePara("apertura",a.id) ? <span style={{ color:C.amber, fontSize:10 }}>Pendiente de aprobación</span> : <button onClick={()=>solicitarBorrado("apertura",a,`Apertura ${fmtFechaHora(a.created_at)} · ${a.asesor_nombre}`)} title="Solicitar borrado" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.amber, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Solicitar borrado</button>)}
                  </span>
                </div>
              ))}
              {aperturasTienda.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, padding:4 }}>Sin registros todavía.</div>}
            </div>
          </CajaCard>

          <CajaCard icon="🔒" titulo="Historial de cierre" color={tiendaColor}>
            <div style={{ display:"flex", flexDirection:"column" }}>
              {cierresTienda.slice(0,30).map(c=>{
                const rd = resumenDia(c.fecha);
                const totalDia = rd.totalIngresoNeto + rd.totalServicios;
                return (
                  <div key={c.id} style={{ display:"flex", flexDirection:"column", gap:1, fontFamily:font.body, fontSize:11.5, color:C.text, padding:"4px 2px", borderBottom:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:4 }}>
                      <span>{fmtFechaHora(c.created_at)} · {c.asesor_nombre} · {c.tipo==="parcial"?"Parcial":"Definitivo"}{c.novedades?` · ${c.novedades}`:""}</span>
                      <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:font.mono, color:C.textMuted }}>Base al cierre: {fmtCOP(c.base_caja)}</span>
                        {puedeBorrarCaja && <button onClick={()=>borrarCierre(c)} title="Borrar" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.red, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Borrar</button>}
                        {puedeSolicitarBorradoCaja && (solicitudPendientePara("cierre",c.id) ? <span style={{ color:C.amber, fontSize:10 }}>Pendiente de aprobación</span> : <button onClick={()=>solicitarBorrado("cierre",c,`Cierre ${fmtFechaHora(c.created_at)} · ${c.asesor_nombre}`)} title="Solicitar borrado" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.amber, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Solicitar borrado</button>)}
                      </span>
                    </div>
                    <div style={{ fontFamily:font.mono, fontSize:10.5, color:C.textMuted }}>
                      Ventas {fmtCOP(rd.totalIngresoNeto)} · Servicios {fmtCOP(rd.totalServicios)} · <span style={{ color:C.goldLight, fontWeight:700 }}>Total {fmtCOP(totalDia)}</span>
                      {rd.totalNotaCreditoDia>0 && <span style={{ color:C.amber }}> · Notacrédito {fmtCOP(rd.totalNotaCreditoDia)}</span>}
                    </div>
                  </div>
                );
              })}
              {cierresTienda.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, padding:4 }}>Sin registros todavía.</div>}
            </div>
          </CajaCard>

          <CajaCard icon="🚚" titulo="Historial de recolección" color={tiendaColor}>
            <div style={{ display:"flex", flexDirection:"column" }}>
              {recoleccionesTienda.slice(0,30).map(r=>(
                <div key={r.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:4, fontFamily:font.body, fontSize:11.5, color:C.text, padding:"3px 2px", borderBottom:`1px solid ${C.border}` }}>
                  <span>{fmtFechaHora(r.created_at)} · {r.entrega_nombre} → {r.recibe_nombre}{r.comentarios?` · ${r.comentarios}`:""}{r.incluye_hoy && Number(r.valor_hoy||0)>0 ? ` · incluye ${fmtCOP(r.valor_hoy)} de ese mismo día` : ""}</span>
                  <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontFamily:font.mono }}>{fmtCOP(r.valor)} <span style={{ color:C.textMuted }}>(queda base {fmtCOP(r.base_caja)})</span></span>
                    {puedeBorrarCaja && <button onClick={()=>borrarRecoleccion(r)} title="Borrar" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.red, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Borrar</button>}
                    {puedeSolicitarBorradoCaja && (solicitudPendientePara("recoleccion",r.id) ? <span style={{ color:C.amber, fontSize:10 }}>Pendiente de aprobación</span> : <button onClick={()=>solicitarBorrado("recoleccion",r,`Recolección ${fmtFechaHora(r.created_at)} · ${r.entrega_nombre} → ${r.recibe_nombre}`)} title="Solicitar borrado" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.amber, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Solicitar borrado</button>)}
                  </span>
                </div>
              ))}
              {recoleccionesTienda.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, padding:4 }}>Sin registros todavía.</div>}
            </div>
          </CajaCard>

          <CajaCard icon="🗒️" titulo="Historial de novedades" color={tiendaColor}>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:4 }}>La tienda puede editar/borrar solo las de hoy — master y admin de finanzas, cualquier día.</div>
            <div style={{ display:"flex", flexDirection:"column" }}>
              {gastosTienda.slice(0,30).map(g=>(
                <div key={g.id} style={{ display:"flex", flexDirection:"column", gap:3, fontFamily:font.body, fontSize:11.5, color:C.text, padding:"4px 2px", borderBottom:`1px solid ${C.border}` }}>
                  {gastoEditandoId===g.id ? (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
                      <CajaFieldRow compact label="Tipo" value={geTipo} onChange={setGeTipo} options={[{value:"costo",label:"Costo"},{value:"ingreso",label:"Ingreso"}]}/>
                      <CajaMoneyRow compact label="Valor" value={geValor} onChange={setGeValor}/>
                      <CajaFieldRow compact wide label="Motivo" value={geMotivo} onChange={setGeMotivo}/>
                      <CajaFieldRow compact label="Quién autorizó" value={geAutorizoLiderId} onChange={setGeAutorizoLiderId} options={[{value:"",label:"Selecciona un líder..."}, ...lideresActivos.map(l=>({value:l.id,label:l.nombre}))]}/>
                      <span style={{ display:"flex", gap:6 }}>
                        <button onClick={()=>guardarEdicionGasto(g)} style={{ background:"none", border:`1px solid ${C.green}`, borderRadius:5, color:C.green, cursor:"pointer", fontSize:10, padding:"2px 8px" }}>Guardar</button>
                        <button onClick={cancelarEditarGasto} style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.textMuted, cursor:"pointer", fontSize:10, padding:"2px 8px" }}>Cancelar</button>
                      </span>
                    </div>
                  ) : (
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:6 }}>
                      <span>
                        {g.fecha ? new Date(g.fecha+"T00:00:00").toLocaleDateString("es-CO",{day:"numeric",month:"short"}) : "—"} · {g.motivo}{g.estado!=="aprobado" && <span style={{ color:C.amber }}> · pendiente</span>}
                        <span style={{ display:"block", fontSize:10, color:C.textMuted, marginTop:1 }}>
                          {[g.registrado_por?`Registró: ${g.registrado_por}`:null, g.autorizado_por?`Autorizó: ${g.autorizado_por}`:null, g.aprobado_por?`Aprobó: ${g.aprobado_por}`:null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:font.mono, color:g.tipo==="ingreso"?C.green:C.red }}>{g.tipo==="ingreso"?"+":"−"}{fmtCOP(g.valor)}</span>
                        {puedeTocarGasto(g) && <button onClick={()=>empezarEditarGasto(g)} title="Editar" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.goldLight, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Editar</button>}
                        {puedeTocarGasto(g) && <button onClick={()=>borrarGasto(g)} title="Borrar" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.red, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Borrar</button>}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {gastosTienda.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, padding:4 }}>Sin novedades registradas.</div>}
            </div>
          </CajaCard>
        </>
      )}
      </div>
    </div>
  );
}

// ── APP SHELL ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null),[area,setArea]=useState(null),[tab,setTab]=useState(null),[records,setRecords]=useState([]),[users,setUsers]=useState([]),[stores,setStores]=useState({}),[booting,setBooting]=useState(true),[refreshing,setRefreshing]=useState(false);
  // Para que el panel principal sepa si el cambio que se acaba de hacer fue de MÓDULO (área) o solo
  // de PESTAÑA dentro del mismo módulo — cada uno usa una animación distinta (ver globalAnimStyles).
  const prevAreaRef = useRef(area);
  const esCambioModulo = prevAreaRef.current !== area;
  useEffect(()=>{ prevAreaRef.current = area; }, [area]);
  // TurnosScreen avisa aquí en qué sub-pestaña está (ver/editar/administrar) — se usa solo para
  // alargar el cierre de sesión por inactividad mientras se edita Borrador o Administrar.
  const [turnosSub, setTurnosSub] = useState(null);
  const [juntaLideres,setJuntaLideres]=useState([]),[juntaCompromisos,setJuntaCompromisos]=useState([]),[juntaAcuerdos,setJuntaAcuerdos]=useState([]);
  const [juntaAreas,setJuntaAreas]=useState([]),[juntaLiderAreas,setJuntaLiderAreas]=useState([]);
  const [ventas,setVentas]=useState([]),[ventasItems,setVentasItems]=useState([]),[ventasMetas,setVentasMetas]=useState([]),[ventasMetasAsesor,setVentasMetasAsesor]=useState([]);
  const [ventasAbonos,setVentasAbonos]=useState([]),[cajaAperturas,setCajaAperturas]=useState([]),[cajaCierres,setCajaCierres]=useState([]),[cajaRecolecciones,setCajaRecolecciones]=useState([]),[cajaGastos,setCajaGastos]=useState([]);
  const [cajaSolicitudesBorrado,setCajaSolicitudesBorrado]=useState([]);
  const [ventasAjustes,setVentasAjustes]=useState([]);
  const [turnosGlobales,setTurnosGlobales]=useState([]),[turnosAsignaciones,setTurnosAsignaciones]=useState([]),[turnosHorarios,setTurnosHorarios]=useState([]);
  const [mostrarCambiarPassword,setMostrarCambiarPassword]=useState(false);
  const [mostrarUsuarios,setMostrarUsuarios]=useState(false);
  const [mostrarAccesoTiendas,setMostrarAccesoTiendas]=useState(false);
  const isMobile=useIsMobile();

  // `todayStr` se calcula UNA sola vez cuando carga la página (no es reactivo). Si alguien deja
  // una pestaña abierta de un día para otro sin recargar, todo lo que depende de "hoy" (fecha por
  // defecto al registrar una venta, apertura, cierre, etc.) se queda pegado en el día viejo — así
  // una venta de hoy termina guardada con la fecha de ayer. Por eso se revisa cada minuto (y cada
  // vez que se vuelve a esta pestaña) si el día real ya cambió, y si cambió, se recarga la página
  // sola para que todo tome la fecha correcta.
  useEffect(()=>{
    const revisarCambioDeDia = () => { if(fmt(new Date())!==todayStr) window.location.reload(); };
    const intervalo = setInterval(revisarCambioDeDia, 60000);
    document.addEventListener("visibilitychange", revisarCambioDeDia);
    window.addEventListener("focus", revisarCambioDeDia);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", revisarCambioDeDia);
      window.removeEventListener("focus", revisarCambioDeDia);
    };
  }, []);

  // Cada vez que se abre la app instalada en el computador (PWA de escritorio), se fuerza un
  // tamaño de ventana compacto y más cuadrado (4:3) en vez de dejar que quede en pantalla
  // completa — pedido de Santiago: quiere que SIEMPRE abra en este mismo tamaño, no que recuerde
  // el último tamaño que haya quedado. Esto no aplica a pestañas normales del navegador — los
  // sitios no pueden redimensionar una pestaña común, solo funciona en la ventana de una app
  // instalada (modo "standalone").
  useEffect(()=>{
    const esInstalada = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    if(!esInstalada) return;
    try { window.resizeTo(1120, 840); } catch(e) { /* si falla, se queda con el tamaño que dé el sistema */ }
  }, []);

  const loadAll=async()=>{
    const[{data:t},{data:u},{data:r},{data:jl},{data:jc},{data:ja},{data:jar},{data:jla},{data:v},{data:vi},{data:vm},{data:vma},{data:vab},{data:ca},{data:cc},{data:cr},{data:cg},{data:vaj},{data:csb},{data:tg},{data:tas},{data:th}]=await Promise.all([
      supabase.from("tiendas").select("*"),
      supabase.from("usuarios").select("*"),
      supabase.from("registros").select("*").order("date",{ascending:false}),
      supabase.from("junta_lideres").select("*").order("orden",{ascending:true}),
      supabase.from("junta_compromisos").select("*").order("semana",{ascending:false}),
      supabase.from("junta_acuerdos").select("*").order("fecha",{ascending:false}),
      supabase.from("junta_areas").select("*").order("nombre",{ascending:true}),
      supabase.from("junta_lider_areas").select("*"),
      supabase.from("ventas").select("*").order("fecha",{ascending:false}),
      supabase.from("ventas_items").select("*"),
      supabase.from("ventas_metas").select("*"),
      supabase.from("ventas_metas_asesor").select("*"),
      supabase.from("ventas_abonos").select("*"),
      supabase.from("ventas_caja_aperturas").select("*").order("created_at",{ascending:false}),
      supabase.from("ventas_caja_cierres").select("*").order("created_at",{ascending:false}),
      supabase.from("ventas_caja_recolecciones").select("*").order("created_at",{ascending:false}),
      supabase.from("ventas_caja_gastos").select("*").order("created_at",{ascending:false}),
      supabase.from("ventas_ajustes").select("*"),
      supabase.from("ventas_caja_solicitudes_borrado").select("*").order("fecha_solicitud",{ascending:false}),
      supabase.from("turnos_globales").select("*"),
      supabase.from("turnos_asignaciones").select("*"),
      supabase.from("turnos_horarios").select("*"),
    ]);
    const sm={}; (t||[]).forEach(s=>sm[s.id]=s);
    setStores(sm);setUsers(u||[]);setRecords(r||[]);
    setJuntaLideres(jl||[]);
    setJuntaCompromisos(jc||[]);
    setJuntaAcuerdos(ja||[]);
    setJuntaAreas(jar||[]);
    setJuntaLiderAreas(jla||[]);
    setVentas(v||[]);
    setVentasItems(vi||[]);
    setVentasMetas(vm||[]);
    setVentasMetasAsesor(vma||[]);
    setVentasAbonos(vab||[]);
    setCajaAperturas(ca||[]);
    setCajaCierres(cc||[]);
    setCajaRecolecciones(cr||[]);
    setCajaGastos(cg||[]);
    setVentasAjustes(vaj||[]);
    setCajaSolicitudesBorrado(csb||[]);
    setTurnosGlobales(tg||[]);
    setTurnosAsignaciones(tas||[]);
    setTurnosHorarios(th||[]);
  };

  useEffect(()=>{ loadAll().then(()=>setBooting(false)); },[]);

  const login=(u)=>{setUser(u);setArea(null);setTab(esCuentaTienda(u)?"registrar":puedeUsarAreas(u)?null:"checkin");sonidoBienvenida();};
  const logout=()=>{setUser(null);setArea(null);setTab(null);};
  const chooseArea=(a)=>{setArea(a);setTab(a==="junta"?"seguimiento":a==="ventas"?(ventasSoloLectura(user)?"lista":"registrar"):a==="firmas"?"firmar":"dashboard");};
  const backToAreas=()=>{setArea(null);setTab(null);};
  const addRecord=(r)=>setRecords(prev=>[r,...prev]);
  const refreshAll=async()=>{ setRefreshing(true); await loadAll(); setRefreshing(false); };
  const refreshUserRecords=(newRecs)=>{ setRecords(prev=>{ const otros=prev.filter(r=>!(r.user_id===user?.id&&r.date===todayStr)); return [...newRecs,...otros]; }); };

  // Notificaciones push reales (avisan a los admins de Turnos aunque tengan la app cerrada) — el
  // botón que dispara esto solo se muestra a quien puede gestionar Turnos (ver Sidebar/MobileHeader).
  // El botón se oculta solo cuando queda confirmada la suscripción (pushActivo, en push.js) — no
  // solo con que el navegador reporte el permiso como concedido, porque en Safari/macOS se vio un
  // caso real donde el permiso queda "granted" pero el registro de la suscripción falla igual (el
  // sistema tenía bloqueadas las notificaciones del navegador a nivel de Ajustes del Sistema) —
  // si el botón se ocultara solo por el permiso, la persona se quedaba sin forma de reintentar.
  // `pushTick` fuerza a Sidebar/MobileHeader a releer pushActivo() apenas cambia, sin esperar a
  // que otro estado de la app cause un refresco.
  const [, setPushTick] = useState(0);
  const activarNotificaciones = async () => {
    if(!notificacionesSoportadas()){ alert("Este navegador no soporta notificaciones push."); return; }
    // En iPhone/iPad, Apple solo entrega push a sitios instalados en la pantalla de inicio — desde
    // Safari normal el permiso se puede conceder y la suscripción se puede crear sin ningún error
    // (por eso puede parecer "activada"), pero el aviso nunca llega. Se revisa esto ANTES de
    // intentar activar, para no dejar a la persona creyendo que quedó funcionando cuando no.
    if(requiereInstalarEnIOS()){
      alert("En iPhone/iPad, Apple solo permite las notificaciones si esta página está agregada a la Pantalla de Inicio (no funciona desde Safari normal).\n\nPara activarlas:\n1. Toca el botón Compartir (el cuadrito con la flecha) en Safari.\n2. Elige \"Agregar a pantalla de inicio\".\n3. Abre la app desde ese ícono nuevo (no desde Safari) y vuelve a tocar este botón ahí.");
      return;
    }
    const r = await activarNotificacionesPush(user);
    if(r.ok){ alert("Listo — vas a recibir un aviso cada vez que alguien marque asistencia."); setPushTick(t=>t+1); }
    else if(r.motivo==="permiso_denegado"){ alert("No se activaron las notificaciones — el navegador dice que el permiso está bloqueado. Revisa los ajustes de notificaciones de este sitio."); }
    else if(r.motivo==="error_guardando"){ alert("El permiso quedó concedido, pero no se pudo guardar la suscripción. Intenta de nuevo — si sigue fallando, avísame."); }
    else {
      // Antes esto se quedaba en un mensaje genérico sin mostrar el error real — para poder
      // diagnosticar a distancia (ej. por chat) hace falta ver qué excepción concreta lanzó el
      // navegador (nombre tipo NotAllowedError/AbortError, y su mensaje).
      const detalle = r.error ? `\n\nDetalle técnico: ${r.error.name||""} ${r.error.message||String(r.error)}` : "";
      alert(`El navegador concedió el permiso pero no se pudo activar el push (en Mac esto puede ser porque el Sistema tiene bloqueadas las notificaciones de este navegador — revísalo en Ajustes del Sistema ▸ Notificaciones). Puedes volver a intentar.${detalle}`);
      console.error("Error activando push:", r.error);
    }
  };

  // Cuenta de tienda: es el equipo compartido que queda abierto en el mostrador toda la
  // jornada, así que se le da el margen de una jornada completa (7 horas) antes de cerrar
  // sesión por inactividad. El resto de cuentas (uso personal) sigue en 5 minutos — salvo en
  // zonas donde se sabe que se pasa rato largo editando sin soltar el mouse todo el tiempo:
  // Junta (dura horas, con ratos de solo escuchar), Turnos → Borrador/Administrar (edición
  // larga), y Ventas para master/admin_finanzas (edición y cierres que toman su tiempo) —
  // en esos casos se da margen de 2 horas.
  const margenExtendido = area==="junta"
    || (tab==="turnos" && (turnosSub==="editar" || turnosSub==="administrar"))
    || (area==="ventas" && (user?.role==="master" || user?.role==="admin_finanzas"));
  const minutosInactividad = esCuentaTienda(user||{}) ? 7*60 : (margenExtendido ? 120 : 5);
  useInactivityLogout(logout, minutosInactividad);

  if(booting) return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,fontFamily:font.body,color:C.textMuted,fontSize:14}}>
      <style>{`@keyframes ozenBootPulse { 0%,100% { opacity:.5; transform:scale(.97); } 50% { opacity:1; transform:scale(1); } }`}</style>
      <img src="/logo-horizontal.png" alt="OZEN" style={{ width:150, height:"auto", animation:"ozenBootPulse 1.3s cubic-bezier(.34,1.2,.5,1) infinite" }} />
      <div>Cargando...</div>
    </div>
  );
  if(!user) return <LoginScreen onLogin={login}/>;

  if(passwordVencida(user)) return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16,gap:20}}>
      <img src="/logo-horizontal.png" alt="OZEN" style={{width:280,height:"auto"}}/>
      <CambiarPasswordForm user={user} obligatorio onUpdated={setUser}/>
      <Btn onClick={logout} variant="ghost" sm>Cerrar sesión</Btn>
    </div>
  );

  if(puedeUsarAreas(user) && !area) return <AreaSelector user={user} onChoose={chooseArea} onLogout={logout}/>;

  const renderScreen=()=>{
    if(puedeUsarAreas(user)){
      if(area==="junta"){
        if(tab==="equipo")       return <JuntaEquipoTab lideres={juntaLideres} setLideres={setJuntaLideres} areas={juntaAreas} setAreas={setJuntaAreas} liderAreas={juntaLiderAreas} setLiderAreas={setJuntaLiderAreas} isMobile={isMobile}/>;
        if(tab==="seguimiento")  return <JuntaSeguimientoScreen user={user} lideres={juntaLideres} compromisos={juntaCompromisos} setCompromisos={setJuntaCompromisos} isMobile={isMobile}/>;
        if(tab==="indicadores")  return <JuntaIndicadoresTab lideres={juntaLideres} compromisos={juntaCompromisos} isMobile={isMobile}/>;
        if(tab==="guion")        return <JuntaGuionTab monitor={getMonitorActual(juntaLideres)} isMobile={isMobile}/>;
        if(tab==="acuerdos")     return <JuntaAcuerdosTab user={user} acuerdos={juntaAcuerdos} setAcuerdos={setJuntaAcuerdos}/>;
      } else if(area==="ventas"){
        if(tab==="registrar" && puedeVerRegistrar(user)) return <VentasRegistrarScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} ventasItems={ventasItems} setVentasItems={setVentasItems} ventasAbonos={ventasAbonos} setVentasAbonos={setVentasAbonos} ventasAjustes={ventasAjustes} setVentasAjustes={setVentasAjustes} metas={ventasMetas} esAdmin={esAdminDeVentas(user)} soloLectura={!puedeRegistrarVenta(user)} isMobile={isMobile}/>;
        if(tab==="lista")     return <VentasListaScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} ventasItems={ventasItems} setVentasItems={setVentasItems} ventasAbonos={ventasAbonos} setVentasAbonos={setVentasAbonos} ajustes={ventasAjustes} setAjustes={setVentasAjustes} esAdmin={esAdminDeVentas(user)} soloLectura={ventasSoloLectura(user)}/>;
        if(tab==="metricas")  return <VentasMetricasScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} metas={ventasMetas} setMetas={setVentasMetas} metasAsesor={ventasMetasAsesor} setMetasAsesor={setVentasMetasAsesor} esAdmin={esAdminDeVentas(user)} puedeAsignarMetas={puedeAsignarMetas(user)} isMobile={isMobile} turnosAsignaciones={turnosAsignaciones} turnosGlobales={turnosGlobales}/>;
        if(tab==="caja")      return <VentasCajaScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} gastos={cajaGastos} setGastos={setCajaGastos} aperturas={cajaAperturas} setAperturas={setCajaAperturas} cierres={cajaCierres} setCierres={setCajaCierres} recolecciones={cajaRecolecciones} setRecolecciones={setCajaRecolecciones} solicitudesBorrado={cajaSolicitudesBorrado} setSolicitudesBorrado={setCajaSolicitudesBorrado} puedeRecoleccion={puedeHacerRecoleccion(user)} soloLectura={ventasSoloLectura(user)} isMobile={isMobile} turnosAsignaciones={turnosAsignaciones} turnosHorarios={turnosHorarios} lideres={juntaLideres}/>;
      } else if(area==="firmas"){
        if(tab==="firmar")   return <FirmarDocumentoScreen/>;
      } else {
        if(tab==="dashboard") return <DashboardScreen records={records} stores={stores} isMobile={isMobile}/>;
        if(tab==="records")   return <RecordsScreen records={records} stores={stores} users={users} isMobile={isMobile} turnosHorarios={turnosHorarios} turnosAsignaciones={turnosAsignaciones}/>;
        if(tab==="turnos")    return <TurnosScreen users={users} setUsers={setUsers} stores={stores} setStores={setStores} turnosGlobales={turnosGlobales} setTurnosGlobales={setTurnosGlobales} asignaciones={turnosAsignaciones} setAsignaciones={setTurnosAsignaciones} turnosHorarios={turnosHorarios} setTurnosHorarios={setTurnosHorarios} puedeGestionar={puedeGestionarTurnos(user)} onSubChange={setTurnosSub}/>;
        if(tab==="mi_asistencia") return <MiAsistenciaScreen user={user} records={records} onRecord={addRecord} onRefresh={refreshUserRecords} stores={stores} asignaciones={turnosAsignaciones} turnosHorarios={turnosHorarios} turnosAsignaciones={turnosAsignaciones}/>;
        if(tab==="reports")   return <ReportsScreen records={records} users={users} stores={stores} isMobile={isMobile}/>;
      }
    } else if(esCuentaTienda(user)){
      if(tab==="registrar") return <VentasRegistrarScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} ventasItems={ventasItems} setVentasItems={setVentasItems} ventasAbonos={ventasAbonos} setVentasAbonos={setVentasAbonos} ventasAjustes={ventasAjustes} setVentasAjustes={setVentasAjustes} metas={ventasMetas} esAdmin={false} isMobile={isMobile}/>;
      if(tab==="lista")     return <VentasListaScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} ventasItems={ventasItems} setVentasItems={setVentasItems} ventasAbonos={ventasAbonos} setVentasAbonos={setVentasAbonos} ajustes={ventasAjustes} setAjustes={setVentasAjustes} esAdmin={false} soloLectura={false}/>;
      if(tab==="metricas")  return <VentasMetricasScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} metas={ventasMetas} setMetas={setVentasMetas} metasAsesor={ventasMetasAsesor} setMetasAsesor={setVentasMetasAsesor} esAdmin={false} puedeAsignarMetas={puedeAsignarMetas(user)} isMobile={isMobile} turnosAsignaciones={turnosAsignaciones} turnosGlobales={turnosGlobales}/>;
      if(tab==="caja")      return <VentasCajaScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} gastos={cajaGastos} setGastos={setCajaGastos} aperturas={cajaAperturas} setAperturas={setCajaAperturas} cierres={cajaCierres} setCierres={setCajaCierres} recolecciones={cajaRecolecciones} setRecolecciones={setCajaRecolecciones} solicitudesBorrado={cajaSolicitudesBorrado} setSolicitudesBorrado={setCajaSolicitudesBorrado} puedeRecoleccion={puedeHacerRecoleccion(user)} soloLectura={false} isMobile={isMobile} turnosAsignaciones={turnosAsignaciones} turnosHorarios={turnosHorarios} lideres={juntaLideres}/>;
    } else {
      if(tab==="checkin")  return <CheckInScreen user={user} records={records} onRecord={addRecord} onRefresh={refreshUserRecords} stores={stores} asignaciones={turnosAsignaciones} turnosHorarios={turnosHorarios}/>;
      if(tab==="history")  return <HistoryScreen user={user} records={records} stores={stores} turnosHorarios={turnosHorarios} turnosAsignaciones={turnosAsignaciones}/>;
      if(tab==="schedule") return <TurnosVerScreen users={users} stores={stores} turnosGlobales={turnosGlobales} turnosHorarios={turnosHorarios} asignaciones={turnosAsignaciones}/>;
      if(tab==="firmar")   return <FirmarDocumentoScreen/>;
    }
    return null;
  };

  const soloLectura = user.role==="visualizador";

  // Dos animaciones DISTINTAS para el contenido principal, según qué cambió:
  // - Cambiar de módulo (área) se siente como abrir un espacio nuevo: entra desde abajo con un
  //   respiro (rebote incluido), un poco más lento — igual de familia que el pop-in del selector
  //   de módulos, pero pensado para el panel completo.
  // - Cambiar de pestaña dentro del mismo módulo es una acción frecuente: un desplazamiento lateral
  //   corto y rápido, con solo una pizca de rebote — se siente vivo sin ser lento ni repetitivo.
  const globalAnimStyles = (
    <style>{`
      @keyframes ozenPaneModulo { from { opacity:0; transform:translateY(18px) scale(.97); } 60% { opacity:1; } to { opacity:1; transform:translateY(0) scale(1); } }
      @keyframes ozenPaneTab { from { opacity:0; transform:translateX(14px); } to { opacity:1; transform:translateX(0); } }
      .ozen-pane-anim-modulo { animation: ozenPaneModulo .42s cubic-bezier(.34,1.56,.64,1) both; }
      .ozen-pane-anim-tab { animation: ozenPaneTab .28s cubic-bezier(.34,1.2,.5,1) both; }
      .ozen-collapse { display:grid; transition:grid-template-rows .38s cubic-bezier(.34,1.56,.64,1); }
      @keyframes ozenModalOverlay { from { opacity:0; } to { opacity:1; } }
      @keyframes ozenModalPop { from { opacity:0; transform:scale(.92) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
      .ozen-modal-overlay { animation: ozenModalOverlay .18s ease both; }
      .ozen-modal-pop { animation: ozenModalPop .38s cubic-bezier(.34,1.56,.64,1) both; }
      /* Barra de scroll del navegador/SO: por defecto se ve pálida y desentona con el fondo oscuro
         (se nota como una franja rara al pasar el mouse justo después de hacer scroll). Se
         redefine aquí, delgada y con los mismos colores del tema, para que se vea a propósito y no
         como si algo estuviera mal. */
      * { scrollbar-width: thin; scrollbar-color: ${C.surfaceHover} transparent; }
      *::-webkit-scrollbar { width: 9px; height: 9px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { background-color: ${C.surfaceHover}; border-radius: 999px; }
      *::-webkit-scrollbar-thumb:hover { background-color: ${C.border}; }
      /* El desplegable de un <select> lo dibuja el navegador con SU propio fondo (casi siempre
         blanco), no con el fondo oscuro que se le puso al <select> — así el texto claro pensado
         para fondo oscuro quedaba casi ilegible al abrir cualquier lista (ej. elegir asesor). Se
         fija acá, una sola vez, para que todos los <select> de la app queden legibles. */
      select { color-scheme: dark; }
      option { background-color: ${C.surface}; color: ${C.text}; }
      @keyframes ozenMetaCumplida { 0%,100% { box-shadow: 0 3px 14px rgba(46,204,113,0.35); } 50% { box-shadow: 0 3px 24px rgba(46,204,113,0.65); } }
      .ozen-meta-cumplida { animation: ozenMetaCumplida 1.8s ease-in-out infinite; }
    `}</style>
  );

  const modalCambiarPassword = mostrarCambiarPassword && (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:1000}} className="ozen-modal-overlay">
      <div className="ozen-modal-pop"><CambiarPasswordForm user={user} onUpdated={(u)=>{setUser(u);setMostrarCambiarPassword(false);}} onCancel={()=>setMostrarCambiarPassword(false)}/></div>
    </div>
  );

  const modalUsuarios = mostrarUsuarios && (
    <div style={{position:"fixed",inset:0,background:C.dark,zIndex:1000,overflowY:"auto",padding:isMobile?16:"32px 36px"}} className="ozen-pane-anim-modulo">
      <div style={{maxWidth:900,margin:"0 auto"}}>
        <Btn onClick={()=>setMostrarUsuarios(false)} variant="ghost" sm style={{marginBottom:14}}>← Volver</Btn>
        <UsuariosScreen users={users} setUsers={setUsers} stores={stores}/>
      </div>
    </div>
  );

  const modalAccesoTiendas = mostrarAccesoTiendas && (
    <div style={{position:"fixed",inset:0,background:C.dark,zIndex:1000,overflowY:"auto",padding:isMobile?16:"32px 36px"}} className="ozen-pane-anim-modulo">
      <div style={{maxWidth:900,margin:"0 auto"}}>
        <Btn onClick={()=>setMostrarAccesoTiendas(false)} variant="ghost" sm style={{marginBottom:14}}>← Volver</Btn>
        <TiendasAccesoScreen users={users} setUsers={setUsers} stores={stores}/>
      </div>
    </div>
  );

  if(isMobile) return (
    <ReadOnlyContext.Provider value={soloLectura}>
      <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.dark,overflow:"hidden"}}>
        {globalAnimStyles}
        <MobileHeader user={user} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onChangeArea={backToAreas} onCambiarPassword={()=>setMostrarCambiarPassword(true)} onAbrirUsuarios={()=>setMostrarUsuarios(true)} onAbrirAccesoTiendas={()=>setMostrarAccesoTiendas(true)} onActivarNotificaciones={activarNotificaciones}/>
        <main style={{flex:1,overflowY:"auto",padding:16}}><div key={`${area}-${tab}`} className={esCambioModulo?"ozen-pane-anim-modulo":"ozen-pane-anim-tab"}>{renderScreen()}</div></main>
        <BottomNav tab={tab} setTab={setTab} user={user} area={area}/>
        {modalCambiarPassword}
        {modalUsuarios}
        {modalAccesoTiendas}
      </div>
    </ReadOnlyContext.Provider>
  );

  return (
    <ReadOnlyContext.Provider value={soloLectura}>
      <div style={{display:"flex",height:"100vh",background:C.dark,fontFamily:font.body,overflow:"hidden"}}>
        {globalAnimStyles}
        <Sidebar tab={tab} setTab={setTab} user={user} area={area} onChangeArea={backToAreas} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onCambiarPassword={()=>setMostrarCambiarPassword(true)} onAbrirUsuarios={()=>setMostrarUsuarios(true)} onAbrirAccesoTiendas={()=>setMostrarAccesoTiendas(true)} onActivarNotificaciones={activarNotificaciones}/>
        <main style={{flex:1,overflowY:"auto",padding:"32px 36px"}}><div key={`${area}-${tab}`} className={esCambioModulo?"ozen-pane-anim-modulo":"ozen-pane-anim-tab"}>{renderScreen()}</div></main>
        {modalCambiarPassword}
        {modalUsuarios}
        {modalAccesoTiendas}
      </div>
    </ReadOnlyContext.Provider>
  );
}