import { useState, useRef, useCallback, useEffect, createContext, useContext } from "react";
import { supabase } from "./supabase";

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
const font = { body: "'Segoe UI', system-ui, sans-serif", mono: "monospace" };

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
// Fechas de corte: desde cada fecha (inclusive) rigen los horarios de esa fila.
// Los registros con fecha anterior siguen evaluándose con el horario que regía
// en ese momento, congelado para siempre, sin importar qué cambie el código después.
const CUTOVER_DATE = "2026-07-15";
const CUTOVER_DATE_2 = "2026-08-01"; // nuevo horario de cierre (T2)

// Horarios de entrada esperados en minutos desde medianoche: [Lunes-Jueves, Viernes-Sábado]
// Vigentes hasta el 14 de julio de 2026 (inclusive)
const SHIFT_HOURS_OLD = {
  T1:  [600, 600],   // 10:00am todos los días (excepto Chipichape, ver abajo)
  T2:  [730, 760],   // 12:10pm L-J / 12:40pm V-S
  T3:  [630, 630],   // 10:30am todos los días
  T4:  [690, 690],   // 11:30am todos los días
  TOF: [540, 540],   // 9:00am todos los días (oficina)
};
// Vigentes del 15 de julio al 31 de julio de 2026 (inclusive)
const SHIFT_HOURS_NEW = {
  T1:  [600, 600],   // 10:00am todos los días (excepto Chipichape, ver abajo)
  T2:  [750, 780],   // 12:30pm L-J / 1:00pm V-S
  T3:  [630, 630],   // 10:30am todos los días
  T4:  [690, 690],   // 11:30am todos los días
  TOF: [540, 540],   // 9:00am todos los días (oficina)
};
// Vigentes desde el 1 de agosto de 2026 — nuevo horario de cierre:
// Lunes a jueves 12:00m-8:00pm, Viernes y sábado 12:30pm-8:30pm
const SHIFT_HOURS_V3 = {
  T1:  [600, 600],   // 10:00am todos los días (excepto Chipichape, ver abajo)
  T2:  [720, 750],   // 12:00m L-J / 12:30pm V-S
  T3:  [630, 630],   // 10:30am todos los días
  T4:  [690, 690],   // 11:30am todos los días
  TOF: [540, 540],   // 9:00am todos los días (oficina)
};
// Excepción: Chipichape T1 entra a las 9:00am en vez de 10:00am (igual en todos los periodos)
const CHIPICHAPE_T1_ENTRY = 540;

const getExpectedEntry = (shift, date, store) => {
  if (!shift) return null;
  const SHIFT_HOURS = date >= CUTOVER_DATE_2 ? SHIFT_HOURS_V3 : date >= CUTOVER_DATE ? SHIFT_HOURS_NEW : SHIFT_HOURS_OLD;
  const shiftUpper = shift.toUpperCase();
  if (shiftUpper.includes("TOF")) return SHIFT_HOURS.TOF[0];

  const match = shift.match(/T(\d)/i);
  if (!match) return null;
  const key = `T${match[1]}`;
  if (!SHIFT_HOURS[key]) return null;

  // Excepción Chipichape T1
  if (key === "T1" && store === "chipichape") return CHIPICHAPE_T1_ENTRY;

  const dow = new Date(date + "T12:00:00").getDay(); // 0=dom,1=lun,...,5=vie,6=sab
  const isVS = dow === 5 || dow === 6;
  return isVS ? SHIFT_HOURS[key][1] : SHIFT_HOURS[key][0];
};

const calcPuntualidad = (entryTime, shift, date, store) => {
  if (!entryTime) return null;
  const expected = getExpectedEntry(shift, date, store);
  if (expected === null) return null;
  const [h, m] = entryTime.split(":").map(Number);
  const diff = (h * 60 + m) - expected;
  if (diff <= 5) return { puntual: true, diff: 0 };
  return { puntual: false, diff };
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
// Una tarea que no se marcó completada y ya pasaron más de 3 días desde la fecha en que se
// esperaba, queda cerrada como "no realizada" — ya no se puede marcar completada desde ahí.
const tareaVencidaNoRealizada = (t) => !t.completado && !!t.fecha_estimada && diasEntre(t.fecha_estimada, todayStr) > 3;
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
// Indicadores de un mes: sesiones registradas (martes con al menos una tarea) y % de tareas completadas.
const statsDelMes = (compromisos, anio, mes) => {
  const martes = martesDelMes(anio, mes);
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  const sesiones = new Set(tareas.map(t => t.semana)).size;
  const completadas = tareas.filter(t => t.completado).length;
  const pct = tareas.length ? Math.round((completadas / tareas.length) * 100) : null;
  return { totalMartes: martes.length, sesiones, totalTareas: tareas.length, completadas, pct };
};
// Cumplimiento de tareas, pero desglosado por cada líder — no todos cargan el mismo peso ni la
// misma cantidad de tareas, así que el % se calcula individualmente (completadas ÷ asignadas).
const statsPorLiderDelMes = (compromisos, lideres, anio, mes) => {
  const martes = martesDelMes(anio, mes);
  const tareas = compromisos.filter(c => martes.includes(c.semana));
  return lideres
    .map(l => {
      const deLider = tareas.filter(t => t.lider_id === l.id);
      const completadas = deLider.filter(t => t.completado).length;
      const pct = deLider.length ? Math.round((completadas / deLider.length) * 100) : null;
      return { lider: l, total: deLider.length, completadas, pct };
    })
    .filter(x => x.total > 0)
    .sort((a,b) => (a.lider.nombre||"").localeCompare(b.lider.nombre||""));
};
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
const Badge = ({ color, children, sm, title }) => (
  <span title={title} style={{ display:"inline-flex", alignItems:"center", padding: sm?"2px 8px":"3px 10px", borderRadius:99, fontSize:sm?10:11, fontWeight:600, background:`${color}20`, color, border:`1px solid ${color}40`, fontFamily:font.body, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap", cursor:title?"help":"default" }}>{children}</span>
);

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

const Card = ({ children, style={}, glow, p="20px" }) => (
  <div style={{ background:C.surface, borderRadius:10, border:`1px solid ${glow?C.borderGold:C.border}`, padding:p, boxShadow:glow?`0 0 20px ${C.gold}15`:"0 1px 3px rgba(0,0,0,0.3)", ...style }}>{children}</div>
);

// Campo de valor en pesos colombianos: mientras se escribe muestra $000.000,
// pero guarda (y entrega vía onChange) solo los dígitos, como los demás campos numéricos.
const CurrencyField = ({ label, value, onChange, placeholder, disabled }) => {
  const digits = String(value||"").replace(/[^\d]/g,"");
  const mostrado = digits ? `$${Number(digits).toLocaleString("es-CO")}` : "";
  return (
    <div style={{ marginBottom:14 }}>
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
  <div style={{ marginBottom:14 }}>
    {label && <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>}
    {options ? (
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{ width:"100%", background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : multiline ? (
      <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} rows={rows} style={{ width:"100%", background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box", resize:"vertical", lineHeight:1.5 }} />
    ) : (
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} autoComplete={autoComplete} style={{ width:"100%", background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }} />
    )}
  </div>
);

// Texto que aparece al pasar el mouse (o al tocar, en celular) sobre una etiqueta — para
// explicaciones cortas (IDC, MDA) o avisos largos (términos del Flexipago) sin ocupar espacio fijo.
const HoverTooltip = ({ label, labelStyle={}, width=280, align="left", children }) => {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position:"relative", display:"inline-block" }}>
      <span
        onMouseEnter={()=>setShow(true)}
        onMouseLeave={()=>setShow(false)}
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
  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, gap:10 }}>
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
const ADMIN_TABS_ASISTENCIA = [{ id:"dashboard",icon:"📊",label:"Panel" },{ id:"records",icon:"📋",label:"Registros" },{ id:"users",icon:"👥",label:"Asesores" },{ id:"stores",icon:"🏬",label:"Tiendas" },{ id:"reports",icon:"📈",label:"Informes" }];
// Usuarios (control total de contraseñas) ya no va en esta lista de pestañas — es solo para
// master, y se abre aparte con un ícono discreto en el pie del menú (ver Sidebar/MobileHeader).
const ADMIN_TABS_JUNTA      = [{ id:"seguimiento",icon:"✅",label:"Seguimiento semanal" },{ id:"acuerdos",icon:"🔒",label:"Acuerdos y decisiones" },{ id:"equipo",icon:"👥",label:"Perfiles y áreas" },{ id:"guion",icon:"📖",label:"Rol de Monitor" },{ id:"indicadores",icon:"📊",label:"Indicadores" }];
const ADVISOR_TABS          = [{ id:"checkin",icon:"📍",label:"Marcar Asistencia" },{ id:"history",icon:"📋",label:"Mi Historial" },{ id:"schedule",icon:"📅",label:"Malla Horaria" }];
const ADMIN_TABS_VENTAS     = [{ id:"registrar",icon:"🧾",label:"Registrar venta" },{ id:"lista",icon:"📋",label:"Lista de ventas" },{ id:"metricas",icon:"📊",label:"Métricas" },{ id:"caja",icon:"💰",label:"Caja" }];
const puedeUsarAreas = (user) => user.role==="admin" || user.role==="master" || user.role==="visualizador" || user.role==="admin_finanzas";
// Quién puede elegir el área "Ventas" desde el selector. Admin y Visualizador entran en modo
// solo lectura (ver ventasSoloLectura); master y admin_finanzas entran completo.
const puedeUsarVentasArea = (user) => user.role==="master" || user.role==="admin_finanzas" || user.role==="admin" || user.role==="visualizador";
// Quién solo puede VER Ventas (lista, métricas, caja) sin registrar ni corregir nada.
const ventasSoloLectura = (user) => user.role==="admin" || user.role==="visualizador";
// Cuentas de tienda: login compartido, van directo a Ventas sin selector de área
const esCuentaTienda = (user) => user.role==="tienda";
// Admin Finanzas: hace todo lo de un Administrador normal (Asistencia/Junta), más Ventas completo
// (registrar, lista, métricas, asignar metas, aprobar notas crédito y corregir por error).
const esAdminFinanzas = (user) => user.role==="admin_finanzas";
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
  : (area==="junta" ? ADMIN_TABS_JUNTA : area==="ventas" ? (ventasSoloLectura(user) ? ADMIN_TABS_VENTAS.filter(t=>t.id!=="registrar") : ADMIN_TABS_VENTAS) : ADMIN_TABS_ASISTENCIA);

// ── Vencimiento de contraseña ────────────────────────────────────────────────
const DIAS_EXPIRACION_PASSWORD = 90;
const passwordVencida = (u) => {
  if (!u.password_updated_at) return true;
  const dias = (Date.now() - new Date(u.password_updated_at).getTime()) / 86400000;
  return dias >= DIAS_EXPIRACION_PASSWORD;
};

function Sidebar({ tab, setTab, user, area, onChangeArea, onLogout, onRefresh, refreshing, onCambiarPassword, onAbrirUsuarios }) {
  const tabs = tabsPara(user, area);
  return (
    <div style={{ width:220, flexShrink:0, background:C.sidebar, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"18px 16px", borderBottom:`1px solid ${C.border}` }}>
        {/* El logo, para master, también es la entrada a Usuarios — a propósito no lleva ningún
            aviso visual de que se puede hacer clic ahí. */}
        <img src="/logo-icon.png" alt="OZEN" onClick={user.role==="master"?onAbrirUsuarios:undefined} style={{ width:44, height:44, borderRadius:"50%", cursor:user.role==="master"?"pointer":"default" }} />
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
        {user.role!=="master" && <Btn onClick={onCambiarPassword} variant="ghost" full sm style={{ marginBottom:8 }}>🔑 Mi contraseña</Btn>}
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

function MobileHeader({ user, onLogout, onRefresh, refreshing, onChangeArea, onCambiarPassword, onAbrirUsuarios }) {
  return (
    <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${C.border}`, background:C.sidebar, flexShrink:0 }}>
      {/* El logo, para master, también es la entrada a Usuarios — sin ningún aviso visual. */}
      <img src="/logo-icon.png" alt="OZEN" onClick={user.role==="master"?onAbrirUsuarios:undefined} style={{ width:34, height:34, borderRadius:"50%" }} />
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {puedeUsarAreas(user) && <button onClick={onChangeArea} title="Cambiar de área" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔀</button>}
        {user.role!=="master" && <button onClick={onCambiarPassword} title="Mi contraseña" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔑</button>}
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
function RecordsScreen({ records, stores, users, isMobile }) {
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
          <div>
            <div style={{ fontSize:10, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Desde</div>
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{ width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 8px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box" }} />
          </div>
          <div>
            <div style={{ fontSize:10, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Hasta</div>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{ width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 8px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box" }} />
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
          const punt=calcPuntualidad(j.entrada?.time,j.shift,j.date,j.store);
          return (
            <Card key={j.key} p="14px">
              <div style={{ marginBottom:10 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{j.userName}</div>
                  {punt && (punt.puntual ? <Badge color={C.green} sm>🟢 Puntual</Badge> : <Badge color={C.red} sm>🔴 Tarde {punt.diff} min</Badge>)}
                </div>
                <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{stores[j.store]?.name} · {j.shift} · {j.date}</div>
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
const ROLE_LABEL = { master:"Master", admin:"Administrador", admin_finanzas:"Admin Finanzas", visualizador:"Visualizador", advisor:"Asesor", tienda:"Cuenta de tienda" };
const ROLE_COLOR = { master:C.red, admin:C.gold, admin_finanzas:C.blue, visualizador:C.amber, advisor:C.blue, tienda:C.textMuted };
const ROLE_PERMISOS = {
  master: "Acceso total: Asistencia, Junta, Ventas y el módulo de Usuarios (ve y cambia todas las contraseñas).",
  admin: "Asistencia y Junta completos (panel, registros, asesores, tiendas, informes). En Ventas solo puede ver (lista, métricas, caja) — no puede registrar ni corregir nada.",
  admin_finanzas: "Todo lo de un Administrador (Asistencia y Junta), más Ventas completo: registrar, lista, métricas, asignar metas, aprobar notas crédito y corregir por error.",
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
  const ordenados=[...users].sort((a,b)=>(a.role==="master"?0:a.role==="admin"?1:2)-(b.role==="master"?0:b.role==="admin"?1:2) || a.name.localeCompare(b.name));
  const roleOptions=[{value:"advisor",label:"Asesor"},{value:"admin",label:"Administrador"},{value:"admin_finanzas",label:"Admin Finanzas"},{value:"visualizador",label:"Visualizador"},{value:"tienda",label:"Cuenta de tienda"},{value:"master",label:"Master"}];
  const add=async()=>{ if(!form.name.trim()||!form.documento.trim())return; if(form.role==="tienda"&&!form.tienda_id)return; setLoading(true); const{data,error}=await supabase.from("usuarios").insert({name:form.name.trim(),documento:form.documento.trim(),password:form.documento.trim(),role:form.role,tienda_id:form.role==="tienda"?form.tienda_id:null,active:true}).select().single(); if(!error&&data){setUsers(prev=>[...prev,data]);setForm({name:"",documento:"",role:"advisor",tienda_id:""});setShowForm(false);} setLoading(false); };
  const toggle=async(u)=>{ const{data}=await supabase.from("usuarios").update({active:!u.active}).eq("id",u.id).select().single(); if(data)setUsers(prev=>prev.map(x=>x.id===u.id?data:x)); };
  const saveEdit=async(id)=>{ if(!editVal.name.trim()||!editVal.documento.trim())return; if(editVal.role==="tienda"&&!editVal.tienda_id)return; const{data}=await supabase.from("usuarios").update({name:editVal.name.trim(),documento:editVal.documento.trim(),role:editVal.role,tienda_id:editVal.role==="tienda"?(editVal.tienda_id||null):null}).eq("id",id).select().single(); if(data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setEditing(null);} };
  const deleteUsuario=async(id)=>{
    const { count } = await supabase.from("registros").select("id", { count: "exact", head: true }).eq("user_id", id);
    if (count > 0) { alert(`Este usuario tiene ${count} registro(s) de asistencia. Eliminarlo borraría ese historial para siempre. Usa el botón "✕" para desactivarlo en su lugar.`); return; }
    if (!window.confirm("Este usuario no tiene registros de asistencia. ¿Eliminarlo de todas formas? Esto no se puede deshacer.")) return;
    await supabase.from("usuarios").delete().eq("id",id); setUsers(prev=>prev.filter(u=>u.id!==id));
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

// ── SCREEN: Stores ────────────────────────────────────────────────────────────
function StoresScreen({ stores, setStores }) {
  const soloLectura = useReadOnly();
  const [showForm,setShowForm]=useState(false),[newName,setNewName]=useState(""),[editing,setEditing]=useState(null),[editVal,setEditVal]=useState({}),[newShift,setNewShift]=useState({});
  const addStore=async()=>{ if(!newName.trim())return; const id=newName.trim().toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,""); if(stores[id])return; const{data}=await supabase.from("tiendas").insert({id,name:newName.trim(),shifts:[]}).select().single(); if(data){setStores(prev=>({...prev,[data.id]:data}));setNewName("");setShowForm(false);} };
  const deleteStore=async(id)=>{
    const { count } = await supabase.from("registros").select("id", { count: "exact", head: true }).eq("store", id);
    if (count > 0) { alert(`Esta tienda tiene ${count} registro(s) de asistencia asociados. Eliminarla podría borrar ese historial para siempre. Si ya no está operando, simplemente deja de asignarle turnos nuevos en vez de eliminarla.`); return; }
    if (!window.confirm("Esta tienda no tiene registros de asistencia. ¿Eliminarla de todas formas? Esto no se puede deshacer.")) return;
    await supabase.from("tiendas").delete().eq("id",id); setStores(prev=>{const c={...prev};delete c[id];return c;});
  };
  const saveEdit=async(id)=>{ if(!editVal.name.trim())return; const{data}=await supabase.from("tiendas").update({name:editVal.name.trim()}).eq("id",id).select().single(); if(data){setStores(prev=>({...prev,[id]:data}));setEditing(null);} };
  const toggleVende=async(s)=>{ const{data}=await supabase.from("tiendas").update({vende:!(s.vende!==false)}).eq("id",s.id).select().single(); if(data)setStores(prev=>({...prev,[s.id]:data})); };
  const removeShift=async(sid,sh)=>{ const shifts=stores[sid].shifts.filter(x=>x!==sh); const{data}=await supabase.from("tiendas").update({shifts}).eq("id",sid).select().single(); if(data)setStores(prev=>({...prev,[sid]:data})); };
  const addShift=async(sid)=>{ const sh=(newShift[sid]||"").trim(); if(!sh||stores[sid].shifts.includes(sh))return; const shifts=[...stores[sid].shifts,sh]; const{data}=await supabase.from("tiendas").update({shifts}).eq("id",sid).select().single(); if(data){setStores(prev=>({...prev,[sid]:data}));setNewShift(p=>({...p,[sid]:""}));} };
  return (
    <div>
      <PageHeader title="Tiendas" subtitle="Puntos de venta y turnos" action={soloLectura?null:<Btn onClick={()=>setShowForm(!showForm)} sm>{showForm?"Cancelar":"+ Nueva"}</Btn>} />
      {!soloLectura && showForm&&(<Card glow style={{marginBottom:16}}><Field label="Nombre de la tienda" value={newName} onChange={setNewName} placeholder="Ej: Centenario" /><Btn onClick={addStore} full>Crear tienda</Btn></Card>)}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {Object.values(stores).map(s=>(
          <Card key={s.id} glow={editing===s.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              {!soloLectura && editing===s.id?<input value={editVal.name} onChange={e=>setEditVal(p=>({...p,name:e.target.value}))} style={{flex:1,background:C.surfaceAlt,border:`1px solid ${C.gold}`,borderRadius:7,padding:"7px 10px",color:C.text,fontSize:15,fontFamily:font.body,outline:"none",fontWeight:700}}/>:<div style={{fontFamily:font.body,fontSize:15,fontWeight:700,color:C.goldLight}}>{s.name}</div>}
              {!soloLectura && <div style={{display:"flex",gap:6,marginLeft:10,flexShrink:0}}>
                {editing===s.id?<><Btn onClick={()=>saveEdit(s.id)} sm>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm>✕</Btn></>:<><Btn onClick={()=>{setEditing(s.id);setEditVal({name:s.name});}} variant="ghost" sm>✏</Btn><Btn onClick={()=>deleteStore(s.id)} variant="danger" sm>🗑</Btn></>}
              </div>}
            </div>
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
                <div key={sh} style={{display:"flex",alignItems:"center",gap:4}}>
                  <Badge color={C.goldLight} sm>{sh}</Badge>
                  {!soloLectura && <button onClick={()=>removeShift(s.id,sh)} style={{background:C.redDim,border:`1px solid ${C.red}33`,color:C.red,borderRadius:4,width:16,height:16,cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>}
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

// ── SCREEN: CheckIn ───────────────────────────────────────────────────────────
function CheckInScreen({ user, records, onRecord, onRefresh, stores }) {
  const [selStore,setSelStore]=useState(""),[selShift,setSelShift]=useState(""),[locked,setLocked]=useState(false),[showCamera,setShowCamera]=useState(false),[recording,setRecording]=useState(false),[toast,setToast]=useState(null);
  useEffect(()=>{ const h=records.filter(r=>r.user_id===user.id&&r.date===todayStr&&r.event!=="omitido"); if(h.length>0){setSelStore(h[0].store);setSelShift(h[0].shift);setLocked(true);} },[records]);
  const todayRecs=records.filter(r=>r.user_id===user.id&&r.date===todayStr);
  const eventosReales=todayRecs.filter(r=>r.event!=="omitido").map(r=>r.event);
  const ultimoReal=[...ORDEN].reverse().find(e=>eventosReales.includes(e));
  const nextEvent=!ultimoReal?"entrada":ultimoReal==="entrada"?"inicio_almuerzo":ultimoReal==="inicio_almuerzo"?"fin_almuerzo":ultimoReal==="fin_almuerzo"?"salida":null;
  const refreshTodayRecs=async()=>{ const{data}=await supabase.from("registros").select("*").eq("user_id",user.id).eq("date",todayStr); if(data)onRefresh(data); };
  const handleCapture=async(photoBase64)=>{ setShowCamera(false);setRecording(true); let photo_url=null; try{ const blob=await fetch(photoBase64).then(r=>r.blob()); const fileName=`${user.id}_${Date.now()}.jpg`; const{data:up}=await supabase.storage.from("fotos-registro").upload(fileName,blob,{contentType:"image/jpeg"}); if(up){const{data:ud}=supabase.storage.from("fotos-registro").getPublicUrl(fileName);photo_url=ud.publicUrl;} }catch(e){console.error(e);} const{data,error}=await supabase.from("registros").insert({user_id:user.id,user_name:user.name,store:selStore,shift:selShift,event:nextEvent,date:todayStr,time:fmtTime(new Date()),photo_url}).select().single(); if(!error){onRecord(data);setLocked(true);await refreshTodayRecs();} setRecording(false);setToast(`✓ ${EVENT_LABELS[nextEvent]} registrada`);setTimeout(()=>setToast(null),3000); };

  const puntHoy = calcPuntualidad(todayRecs.find(r=>r.event==="entrada")?.time, selShift, todayStr, selStore);

  return (
    <div>
      {showCamera&&<CameraModal eventLabel={EVENT_LABELS[nextEvent]} onCapture={handleCapture} onCancel={()=>setShowCamera(false)}/>}
      {toast&&<div style={{position:"fixed",top:16,right:16,left:16,background:C.greenDim,border:`1px solid ${C.green}`,borderRadius:10,padding:"12px 16px",color:C.green,fontFamily:font.body,fontSize:13,fontWeight:600,zIndex:200,textAlign:"center"}}>{toast}</div>}
      <PageHeader title="Marcar Asistencia" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})} />
      <Card style={{marginBottom:12}}>
        <Field label="Tienda" value={selStore} onChange={v=>{setSelStore(v);setSelShift("");}} disabled={locked} options={[{value:"",label:"Selecciona tienda"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]}/>
        {selStore&&stores[selStore]?.shifts?.length>0&&<Field label="Turno" value={selShift} onChange={setSelShift} disabled={locked} options={[{value:"",label:"Selecciona turno"},...(stores[selStore]?.shifts||[]).map(s=>({value:s,label:s}))]}/>}
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
          {puntHoy && (puntHoy.puntual ? <Badge color={C.green} sm>🟢 Puntual hoy</Badge> : <Badge color={C.red} sm>🔴 Tarde {puntHoy.diff} min hoy</Badge>)}
        </div>
        {ORDEN.map((ev,i)=>{ const rec=todayRecs.find(r=>r.event===ev); const isNext=ev===nextEvent; return (
          <div key={ev} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:i<3?`1px solid ${C.border}`:"none"}}>
            <div style={{width:12,height:12,borderRadius:99,background:rec?EVENT_COLORS[ev]:C.border,boxShadow:rec?`0 0 8px ${EVENT_COLORS[ev]}`:"none",flexShrink:0}}/>
            <div style={{flex:1,fontFamily:font.body,fontSize:13,color:rec?C.text:C.textMuted}}>{EVENT_LABELS[ev]}</div>
            {isNext&&!rec&&<Badge color={C.gold} sm>Pendiente</Badge>}
            {rec?.photo_url&&<img src={rec.photo_url} alt="foto" style={{width:28,height:28,borderRadius:6,objectFit:"cover"}}/>}
            <div style={{fontFamily:font.mono,fontSize:13,color:rec?EVENT_COLORS[ev]:C.border,fontWeight:700}}>{rec?rec.time:"--:--"}</div>
          </div>
        );})}
      </Card>
    </div>
  );
}

// ── SCREEN: History ───────────────────────────────────────────────────────────
function HistoryScreen({ user, records, stores }) {
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
          const punt = calcPuntualidad(j.entrada?.time, j.shift, j.date, j.store);
          return (
          <Card key={j.key} p="14px">
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>{new Date(j.date+"T12:00:00").toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})}</div>
                {punt && (punt.puntual ? <Badge color={C.green} sm>🟢 Puntual</Badge> : <Badge color={C.red} sm>🔴 Tarde {punt.diff} min</Badge>)}
              </div>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{stores[j.store]?.name} · {j.shift}</div>
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

// ── SCREEN: Schedule ──────────────────────────────────────────────────────────
function ScheduleScreen() {
  return (
    <div>
      <PageHeader title="Malla Horaria" subtitle="Consulta tu programación semanal"/>
      <Card glow><div style={{textAlign:"center",padding:"24px 0"}}><div style={{fontSize:40,marginBottom:12}}>📅</div><div style={{fontFamily:font.body,fontSize:13,color:C.textMuted,marginBottom:16}}>Tu malla horaria está disponible en Google Sheets.</div><a href="https://docs.google.com/spreadsheets/d/1dQ3aPmKrvZXl7Njqvt_F36SIulnV6aenArLBk1bcTe0/edit?usp=sharing" target="_blank" rel="noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,background:C.gold,color:"#fff",fontFamily:font.body,fontWeight:600,fontSize:14,padding:"11px 22px",borderRadius:8,textDecoration:"none"}}>Abrir malla horaria ↗</a></div></Card>
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
      {vista==="lideres"
        ? <JuntaVistaPorLider lideres={lideres} setLideres={setLideres} areas={areas} setAreas={setAreas} liderAreas={liderAreas} setLiderAreas={setLiderAreas} isMobile={isMobile}/>
        : <JuntaVistaPorArea areas={areas} setAreas={setAreas} lideres={lideres} liderAreas={liderAreas}/>}
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
                  <Badge color={C.gold} sm>🔒 Fijo</Badge>
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
const TODOS_LIDER_ID = "__todos__";
function JuntaSeguimientoScreen({ user, lideres, compromisos, setCompromisos, isMobile }) {
  const soloLectura = useReadOnly();
  const [semana, setSemana] = useState(martesDeSemana(todayStr));
  const [showNueva, setShowNueva] = useState(false);
  const [nueva, setNueva] = useState({ descripcion:"", lider_id:"", fecha_estimada:"", comentarios:"" });

  const tareas = compromisos.filter(c=>c.semana===semana);
  const nombreLider = (id) => lideres.find(l=>l.id===id)?.nombre || "— sin asignar";
  const monitor = getMonitorActual(lideres);
  const esMonitor = esMonitorActual(user, lideres);
  // Solo el monitor de turno puede crear tareas y marcarlas completadas. Master queda como
  // respaldo por si el nombre del líder no coincide exactamente con el de la cuenta que entra.
  const puedeGestionar = !soloLectura && (user.role==="master" || esMonitor);

  const crear = async () => {
    if (!nueva.descripcion.trim()) return;
    if (nueva.lider_id===TODOS_LIDER_ID) {
      const filas = lideres.map(l=>({
        semana, descripcion:nueva.descripcion.trim(), lider_id:l.id,
        fecha_estimada:nueva.fecha_estimada||null, comentarios:nueva.comentarios.trim(), completado:false,
      }));
      if (filas.length===0) return;
      const { data, error } = await supabase.from("junta_compromisos").insert(filas).select();
      if (!error && data) { setCompromisos(prev=>[...data, ...prev]); setNueva({ descripcion:"", lider_id:"", fecha_estimada:"", comentarios:"" }); setShowNueva(false); }
      return;
    }
    const { data, error } = await supabase.from("junta_compromisos").insert({
      semana, descripcion:nueva.descripcion.trim(), lider_id:nueva.lider_id||null,
      fecha_estimada:nueva.fecha_estimada||null, comentarios:nueva.comentarios.trim(), completado:false,
    }).select().single();
    if (!error && data) { setCompromisos(prev=>[data, ...prev]); setNueva({ descripcion:"", lider_id:"", fecha_estimada:"", comentarios:"" }); setShowNueva(false); }
  };
  const actualizar = async (id, patch) => {
    const { data, error } = await supabase.from("junta_compromisos").update(patch).eq("id", id).select().single();
    if (!error && data) setCompromisos(prev=>prev.map(c=>c.id===id?data:c));
  };
  const eliminar = async (id) => {
    if (!window.confirm("¿Eliminar esta tarea? Esto no se puede deshacer.")) return;
    await supabase.from("junta_compromisos").delete().eq("id", id);
    setCompromisos(prev=>prev.filter(c=>c.id!==id));
  };

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
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Semana del martes</div>
          <input type="date" value={semana} onChange={e=>setSemana(martesDeSemana(e.target.value))} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}/>
          <Btn onClick={()=>setSemana(martesDeSemana(todayStr))} variant="ghost" sm>Esta semana</Btn>
          {puedeGestionar && <Btn onClick={()=>setShowNueva(true)} sm style={{ marginLeft:"auto" }}>+ Nueva tarea</Btn>}
        </div>
        <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:8 }}>💡 Si la reunión se hace otro día de esa semana (miércoles, jueves...), igual selecciona esa fecha — la app la archiva sola bajo el martes correcto, aunque ese martes sea de otro mes.</div>
        {!puedeGestionar && !soloLectura && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:4 }}>Solo el monitor de turno puede crear tareas nuevas.</div>}
      </Card>

      {puedeGestionar && showNueva && (
        <Card style={{ marginBottom:16 }} p="10px">
          <input value={nueva.descripcion} onChange={e=>setNueva(p=>({...p,descripcion:e.target.value}))} placeholder="¿Qué hay que hacer?" style={{ width:"100%", marginBottom:6, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
          <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "1.4fr 1fr 1.3fr", gap:6, marginBottom:6 }}>
            <select value={nueva.lider_id} onChange={e=>setNueva(p=>({...p,lider_id:e.target.value}))} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}>
              <option value="">Quién la hace...</option>
              <option value={TODOS_LIDER_ID}>Todos (una por líder)</option>
              {lideres.map(l=><option key={l.id} value={l.id}>{l.nombre||"(sin nombre)"}</option>)}
            </select>
            <input type="date" value={nueva.fecha_estimada} onChange={e=>setNueva(p=>({...p,fecha_estimada:e.target.value}))} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}/>
            <input value={nueva.comentarios} onChange={e=>setNueva(p=>({...p,comentarios:e.target.value}))} placeholder="Comentario (opcional)" style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"7px 9px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
          </div>
          <div style={{ display:"flex", gap:6 }}><Btn onClick={crear} sm>Guardar</Btn><Btn onClick={()=>setShowNueva(false)} variant="ghost" sm>Cancelar</Btn></div>
        </Card>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
        {tareas.map(t=>{
          const vencida = tareaVencidaNoRealizada(t);
          const cerrada = t.completado || vencida;
          const puedeMarcar = puedeGestionar && !vencida;
          const puedeBorrar = !soloLectura && (cerrada ? user.role==="master" : (user.role==="master" || esMonitor));
          return (
            <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, flexWrap: isMobile ? "wrap" : "nowrap" }}>
              <button onClick={puedeMarcar?()=>actualizar(t.id,{completado:!t.completado}):undefined} disabled={!puedeMarcar} title={vencida?"Vencida — ya pasó el plazo, no se puede marcar":!puedeGestionar?"Solo el monitor de turno puede marcar tareas":""} style={{ width:20, height:20, borderRadius:5, border:`2px solid ${t.completado?C.green:vencida?C.red:C.border}`, background:t.completado?C.green:"transparent", cursor:puedeMarcar?"pointer":"default", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:11 }}>{t.completado?"✓":vencida?"✕":""}</button>
              <div style={{ flex:1, minWidth:120, textAlign:"left", fontFamily:font.body, fontSize:12.5, color:C.text, fontWeight:600, textDecoration:t.completado?"line-through":"none", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }} title={t.descripcion}>{t.descripcion}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, flexShrink:0, whiteSpace:"nowrap" }}>👤 {nombreLider(t.lider_id)}</div>
              {t.fecha_estimada && <div style={{ fontFamily:font.mono, fontSize:11, color:vencida?C.red:C.amber, flexShrink:0 }}>📅 {t.fecha_estimada}</div>}
              {vencida && <Badge color={C.red} sm>Vencida sin cumplir</Badge>}
              <input placeholder="Comentario..." defaultValue={t.comentarios||""} disabled={soloLectura} onBlur={e=>{ if(e.target.value!==t.comentarios) actualizar(t.id,{comentarios:e.target.value}); }} style={{ width:isMobile?"100%":150, flexShrink:0, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 8px", color:C.text, fontSize:11, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
              {puedeBorrar && <button onClick={()=>eliminar(t.id)} title="Eliminar" style={{ background:"none", border:"none", color:C.red, cursor:"pointer", flexShrink:0, fontSize:13 }}>🗑</button>}
            </div>
          );
        })}
        {tareas.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin tareas para esta semana. Usa "+ Nueva tarea".</div>}
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
  const monitorActual = actual ? getMonitorDeMes(lideres, actual.anio, actual.mes) : null;
  const statsActual = actual ? statsDelMes(compromisos, actual.anio, actual.mes) : null;
  const statsLideresActual = actual ? statsPorLiderDelMes(compromisos, lideres, actual.anio, actual.mes) : [];

  return (
    <div>
      <PageHeader title="Indicadores" subtitle="Cumplimiento del Monitor, mes a mes" />

      {!actual ? (
        <Card><div style={{ textAlign:"center", padding:20, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Aún no hay meses para mostrar.</div></Card>
      ) : (
        <Card glow style={{ marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom:14 }}>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>{MESES[actual.mes]} {actual.anio} · mes en curso</div>
            <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub }}>Monitor: <span style={{ color:C.goldLight, fontWeight:700 }}>{monitorActual ? (monitorActual.nombre || "— sin nombre") : "—"}</span></div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12 }}>
            <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Sesiones hechas</div>
              <div style={{ fontFamily:font.mono, fontSize:24, fontWeight:700, color:statsActual.sesiones>=statsActual.totalMartes?C.green:C.amber }}>{statsActual.sesiones} / {statsActual.totalMartes}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>martes con checklist registrado</div>
            </div>
            <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Cumplimiento de tareas (todos)</div>
              <div style={{ fontFamily:font.mono, fontSize:24, fontWeight:700, color:statsActual.pct===null?C.textMuted:statsActual.pct>=70?C.green:C.amber }}>{statsActual.pct===null?"—":`${statsActual.pct}%`}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>{statsActual.completadas} de {statsActual.totalTareas} tareas completadas</div>
            </div>
          </div>
          {statsLideresActual.length>0 && (
            <>
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", margin:"16px 0 8px" }}>Cumplimiento por líder</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {statsLideresActual.map(s=>(
                  <div key={s.lider.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 10px", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7 }}>
                    <div style={{ flex:1, fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600 }}>{s.lider.nombre || "— sin nombre"}</div>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{s.completadas} de {s.total} tareas</div>
                    <Badge color={s.pct>=70?C.green:C.amber} sm>{s.pct}%</Badge>
                  </div>
                ))}
              </div>
            </>
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
                <Badge color={s.pct===null?C.textMuted:s.pct>=70?C.green:C.amber} sm>{s.pct===null?"Sin tareas registradas":`${s.pct}% cumplido`}</Badge>
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
        const nuevoToken = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const { data:actualizado } = await supabase.from("usuarios").update({ device_token:nuevoToken }).eq("id",data.id).select().single();
        localStorage.setItem(storageKey, nuevoToken);
        if(actualizado) data.device_token = actualizado.device_token;
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
            <div style={{fontFamily:font.body,fontSize:17,fontWeight:600,color:C.text,marginBottom:18}}>Iniciar sesión</div>

            {/* Campos señuelo ocultos: distraen al navegador para que no ofrezca
                guardar la contraseña de los campos reales de abajo */}
            <input type="text" name="username" autoComplete="username" style={{position:"absolute",width:1,height:1,opacity:0,pointerEvents:"none"}} tabIndex={-1} aria-hidden="true" />
            <input type="password" name="password" autoComplete="new-password" style={{position:"absolute",width:1,height:1,opacity:0,pointerEvents:"none"}} tabIndex={-1} aria-hidden="true" />

            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>N.º de documento</div>
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
              <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>Contraseña</div>
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
  return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ width:"100%", maxWidth:520 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <img src="/logo-horizontal.png" alt="OZEN" style={{ width:280, height:"auto", marginBottom:10 }} />
          <div style={{ fontFamily:font.body, fontSize:13, color:C.textMuted }}>Hola, {user.name.split(" ")[0]} — ¿qué quieres abrir?</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Card glow style={{ cursor:"pointer" }} p="0">
            <button onClick={()=>onChoose("junta")} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"26px 22px", display:"flex", alignItems:"center", gap:16, textAlign:"left" }}>
              <div style={{ fontSize:32 }}>🗓️</div>
              <div>
                <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.goldLight }}>La Junta Administrativa</div>
                <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:2 }}>Equipo, seguimiento semanal y guion de la reunión</div>
              </div>
            </button>
          </Card>
          <Card style={{ cursor:"pointer" }} p="0">
            <button onClick={()=>onChoose("asistencia")} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"26px 22px", display:"flex", alignItems:"center", gap:16, textAlign:"left" }}>
              <div style={{ fontSize:32 }}>📋</div>
              <div>
                <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.text }}>Registro de Asistencia</div>
                <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:2 }}>Panel, registros, asesores, tiendas e informes</div>
              </div>
            </button>
          </Card>
          {puedeUsarVentasArea(user) && (
            <Card style={{ cursor:"pointer" }} p="0">
              <button onClick={()=>onChoose("ventas")} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"26px 22px", display:"flex", alignItems:"center", gap:16, textAlign:"left" }}>
                <div style={{ fontSize:32 }}>💰</div>
                <div>
                  <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.green }}>Ventas</div>
                  <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:2 }}>{ventasSoloLectura(user) ? "Solo para ver: lista, métricas y caja (sin registrar)" : "Registro de ventas, metas y métricas por tienda"}</div>
                </div>
              </button>
            </Card>
          )}
        </div>
        <div style={{ textAlign:"center", marginTop:20 }}>
          <Btn onClick={onLogout} variant="ghost" sm>Cerrar sesión</Btn>
        </div>
      </div>
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

const VENTAS_TIPOS = [
  { value:"producto", label:"Venta" },
  { value:"arreglo", label:"Arreglo" },
  { value:"marcacion", label:"Marcación" },
  { value:"grabado", label:"Grabado" },
  { value:"flexipago", label:"Flexipago" },
];
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

const VENTAS_TIPOS_DOC = [{value:"CC",label:"Cédula de ciudadanía"},{value:"CE",label:"Cédula de extranjería"},{value:"TI",label:"Tarjeta de identidad"},{value:"NIT",label:"NIT"},{value:"PA",label:"Pasaporte"}];

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

function VentasRegistrarScreen({ user, stores, users, ventas, setVentas, metas, isMobile }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const [tiendaId, setTiendaId] = useState(tiendaFija || Object.keys(stores)[0] || "");
  const [fecha, setFecha] = useState(todayStr);
  const [numeroFactura, setNumeroFactura] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [items, setItems] = useState([]); // [{tipo, valorTotal, descuento, pagos:[{medio_pago,valor,numero_autorizacion}]}]
  const [itemTipo, setItemTipo] = useState("producto");
  const [itemValor, setItemValor] = useState("");
  const [itemCodigoProducto, setItemCodigoProducto] = useState("");
  const [itemDescuento, setItemDescuento] = useState("");
  const [itemDescuentoTipo, setItemDescuentoTipo] = useState("valor");
  const [itemPagos, setItemPagos] = useState([]); // [{medio_pago, valor, numero_autorizacion}] — permite repetir medio (ej. dos tarjetas)
  const [itemMedioNuevo, setItemMedioNuevo] = useState("");
  const [observacion, setObservacion] = useState("");

  const [clienteTipoDoc, setClienteTipoDoc] = useState("CC");
  const [clienteDocumento, setClienteDocumento] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [buscandoCliente, setBuscandoCliente] = useState(false);
  const [clienteEncontrado, setClienteEncontrado] = useState(false);

  const [abonoInicialValor, setAbonoInicialValor] = useState("");
  const [abonoInicialMedio, setAbonoInicialMedio] = useState("efectivo");

  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const asesores = users.filter(u=>u.role==="advisor" && u.active);

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

  const itemValorNum = Number(itemValor||0);
  const itemDescuentoInput = Number(itemDescuento||0);
  const itemDescuentoNum = itemDescuentoTipo==="porcentaje" ? Math.round(itemValorNum*itemDescuentoInput/100) : itemDescuentoInput;
  const itemNeto = itemValorNum - itemDescuentoNum;
  const itemSumaMedios = itemPagos.reduce((a,p)=>a+Number(p.valor||0),0);
  const itemFalta = itemNeto - itemSumaMedios;
  const itemFaltaAUT = itemPagos.some(p=>VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && !(p.numero_autorizacion||"").trim());
  const itemFlexipagoRestante = itemValorNum - Number(abonoInicialValor||0);
  const itemFlexipagoValido = itemValorNum>0 && clienteDocumento.trim()!=="" && clienteNombre.trim()!=="" && abonoInicialValor.trim()!=="";

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
      setItems(prev=>[...prev, { tipo:"flexipago", valorTotal:itemValorNum, descuento:0, pagos:[], codigoProducto:itemCodigoProducto.trim()||null }]);
      setItemValor(""); setItemCodigoProducto("");
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

  const limpiarTodo = () => {
    setNumeroFactura(""); setVendedorId(""); setItems([]); setItemTipo("producto"); setItemValor(""); setItemDescuento(""); setItemDescuentoTipo("valor"); setItemPagos([]); setItemMedioNuevo(""); setObservacion("");
    setAbonoInicialValor(""); setAbonoInicialMedio("efectivo");
    setClienteTipoDoc("CC"); setClienteDocumento(""); setClienteNombre(""); setClienteTelefono(""); setClienteEncontrado(false);
  };

  const guardar = async () => {
    setMsg("");
    if(!tiendaId){ setMsg("Falta elegir la tienda."); return; }
    if(!vendedorId){ setMsg("Falta elegir quién hizo la venta."); return; }
    if(items.length===0 || valorBruto<=0){ setMsg("Agrega al menos una venta o servicio."); return; }
    if(requiereSiigo && !numeroFactura.trim()){ setMsg("Falta el número de factura de Siigo."); return; }
    if(esFlexipago){
      if(!clienteDocumento.trim() || !clienteNombre.trim()){ setMsg("Flexipago necesita los datos del cliente para poder contactarlo."); return; }
      if(Number(abonoInicialValor||0)>0 && !abonoInicialMedio){ setMsg("Falta el medio de pago del abono inicial."); return; }
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
    if(error || !venta){ setGuardando(false); setMsg("No se pudo guardar. Intenta de nuevo."); return; }
    const filasItems = items.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valorTotal, descuento:i.descuento, pagos:i.pagos, codigo_producto:i.codigoProducto||null }));
    const { error:errorItems } = await supabase.from("ventas_items").insert(filasItems);
    if(errorItems){ setGuardando(false); setMsg("La venta se guardó, pero hubo un problema guardando las ventas/servicios."); return; }
    if(esFlexipago && Number(abonoInicialValor||0) > 0){
      await supabase.from("ventas_abonos").insert({ venta_id:venta.id, fecha, valor:Number(abonoInicialValor), registrado_por:user.name, medio_pago:abonoInicialMedio });
    }
    setGuardando(false);
    setVentas(prev=>[venta, ...prev]);
    const numeroMsg = venta.numero_factura ? ` #${venta.numero_factura}` : "";
    limpiarTodo();
    setMsg(`✓ Venta${numeroMsg} registrada`);
    setTimeout(()=>setMsg(""), 3000);
  };

  const ventasHoy = ventas.filter(v=>v.fecha===fecha && v.tienda_id===tiendaId);

  // Meta del día de hoy para la tienda seleccionada (si ya se asignó por día en Métricas) y
  // cuánto falta para completarla — el dato que se quiere ver de primeras al registrar ventas.
  const todayDiaNum = Number(todayStr.slice(8,10));
  const todayMesKey = todayStr.slice(0,7);
  const metaHoyTienda = tiendaId ? Number(metas?.find(m=>m.mes===todayMesKey && m.tienda_id===tiendaId && (m.tipo||"total")==="total")?.valores_dia?.[todayDiaNum] || 0) : 0;
  const vendidoHoyTienda = tiendaId ? ventas.filter(v=>v.fecha===todayStr && v.tienda_id===tiendaId && !v.es_flexipago).reduce((s,v)=>s+Number(v.total||0),0) : 0;
  const faltaHoyTienda = Math.max(0, metaHoyTienda - vendidoHoyTienda);

  return (
    <div>
      <PageHeader
        title="Registrar venta"
        subtitle={stores[tiendaId]?.name ? `Tienda: ${stores[tiendaId].name}` : "Elige la tienda"}
        action={tiendaId && metaHoyTienda>0 && (
          <div style={{
            background: faltaHoyTienda<=0 ? `linear-gradient(135deg, ${C.green}26, ${C.green}08)` : `linear-gradient(135deg, ${C.gold}26, ${C.gold}08)`,
            border:`1.5px solid ${faltaHoyTienda<=0?C.green:C.gold}`, borderRadius:14, padding:"10px 18px", minWidth:220, textAlign:"center",
            boxShadow:`0 3px 14px ${faltaHoyTienda<=0?C.green:C.gold}22`,
          }}>
            <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:3 }}>🎯 Meta de hoy</div>
            <div style={{ fontFamily:font.mono, fontSize:21, fontWeight:800, color:C.goldLight }}>{fmtCOP(faltaHoyTienda<=0 ? vendidoHoyTienda : metaHoyTienda)}</div>
            <div style={{ height:8, borderRadius:5, background:C.border, marginTop:7, marginBottom:7, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${Math.min(100, Math.round((vendidoHoyTienda/metaHoyTienda)*100))}%`, background: faltaHoyTienda<=0?C.green:C.gold, transition:"width 0.4s ease" }}/>
            </div>
            <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color: faltaHoyTienda<=0?C.green:C.amber }}>
              {faltaHoyTienda<=0 ? "🎉 ¡Meta cumplida!" : `Faltan ${fmtCOP(faltaHoyTienda)}`}
            </div>
            {faltaHoyTienda<=0 && (
              <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginTop:4 }}>
                +{fmtCOP(vendidoHoyTienda-metaHoyTienda)} sobre la meta · Meta era {fmtCOP(metaHoyTienda)}
              </div>
            )}
          </div>
        )}
      />
      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 380px", gap:16, alignItems:"start" }}>
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
              {user.role==="master" ? (
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
                      <Badge color={C.blue} sm>📦 Pago diferido — se cobra con abonos</Badge>
                    ) : it.pagos.map((p,pidx)=>(
                      <Badge key={pidx} color={C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}{p.numero_autorizacion?` · AUT ${p.numero_autorizacion}`:""}</Badge>
                    ))}
                  </div>
                </div>
              ))}
              {items.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Todavía no has agregado nada.</div>}
            </div>

            <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"12px" }}>
              <Field label="Tipo" value={itemTipo} onChange={setItemTipo} options={VENTAS_TIPOS}/>
              {itemEsFlexipago ? (
                <>
                  <CurrencyField label="Valor total" value={itemValor} onChange={setItemValor}/>
                  <Field label="Código del producto separado" value={itemCodigoProducto} onChange={setItemCodigoProducto} placeholder="Código del producto (para saber qué se separó)"/>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr", gap:10, marginBottom:4 }}>
                    <CurrencyField label="Valor del abono" value={abonoInicialValor} onChange={setAbonoInicialValor}/>
                    <Field label="Medio del abono" value={abonoInicialMedio} onChange={setAbonoInicialMedio} options={VENTAS_MEDIOS_REALES}/>
                  </div>
                  {itemValorNum>0 && abonoInicialValor.trim()!=="" && (
                    <div style={{ fontFamily:font.body, fontSize:12, marginBottom:10, color:itemFlexipagoRestante>0?C.amber:C.green }}>
                      {itemFlexipagoRestante>0 ? `Queda pendiente: $${itemFlexipagoRestante.toLocaleString("es-CO")}` : "✓ Queda saldado con este abono"}
                    </div>
                  )}
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Datos del cliente — para poder contactarlo</div>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1.3fr", gap:10 }}>
                    <Field label="Tipo de documento" value={clienteTipoDoc} onChange={setClienteTipoDoc} options={VENTAS_TIPOS_DOC}/>
                    <div>
                      <Field label="N.º de documento" value={clienteDocumento} onChange={setClienteDocumento} placeholder="Número de documento"/>
                      {buscandoCliente && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:-10, marginBottom:10 }}>Buscando...</div>}
                      {clienteEncontrado && <div style={{ fontFamily:font.body, fontSize:10, color:C.green, marginTop:-10, marginBottom:10 }}>✓ Cliente encontrado, datos autocompletados</div>}
                    </div>
                  </div>
                  <Field label="Nombre" value={clienteNombre} onChange={setClienteNombre} placeholder="Nombre completo"/>
                  <Field label="Teléfono" value={clienteTelefono} onChange={setClienteTelefono} placeholder="Para poder contactarlo"/>

                  <div style={{ marginTop:6 }}>
                    <HoverTooltip label={`ⓘ ${FLEXIPAGO_AVISO_TITULO}`} labelStyle={{ fontSize:11, fontWeight:700, color:C.textMuted }} width={340}>
                      {FLEXIPAGO_AVISO_ITEMS.map((it,i)=>(
                        <div key={i} style={{ fontFamily:font.body, fontSize:11, color:C.text, lineHeight:1.45, marginBottom:6, textAlign:"left" }}>
                          {it.n ? <><b>{it.n}. {it.titulo}:</b> {it.texto}</> : it.texto}
                        </div>
                      ))}
                    </HoverTooltip>
                    <span style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginLeft:6 }}>el cliente acepta estas condiciones al pagar — quedan impresas en el recibo</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr", gap:10, marginBottom:4 }}>
                    <CurrencyField label="Valor total" value={itemValor} onChange={setItemValor}/>
                    <div>
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
                  </div>

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
              {requiereSiigo && (
                <Field label="N.º de factura (Siigo)" value={numeroFactura} onChange={setNumeroFactura} placeholder="Ej: FE-1234"/>
              )}
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
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.06em" }}>Notas (opcional)</div>
            <Field value={observacion} onChange={setObservacion} placeholder="Nota o comentario..." multiline rows={2}/>
          </div>
          {msg && <div style={{ background: msg.startsWith("✓")?`${C.green}18`:C.redDim, border:`1px solid ${msg.startsWith("✓")?C.green:C.red}44`, borderRadius:7, padding:"9px 12px", color: msg.startsWith("✓")?C.green:C.red, fontSize:12, marginBottom:12, fontFamily:font.body }}>{msg}</div>}
          <Btn onClick={guardar} disabled={guardando} full>{guardando?"Guardando...":"Registrar venta"}</Btn>
        </div>
      </div>

      <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, margin:"24px 0 10px" }}>Ventas de hoy en esta tienda ({ventasHoy.length})</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {ventasHoy.map(v=>(
          <Card key={v.id} p="12px">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
              <div>
                <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600 }}>
                  {v.numero_factura?`#${v.numero_factura} · `:""}{v.vendedor_nombre}
                </div>
                {v.cliente_nombre && <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Cliente: {v.cliente_nombre}</div>}
              </div>
              <div style={{ fontFamily:font.mono, fontSize:15, fontWeight:700, color:C.goldLight }}>${Number(v.total).toLocaleString("es-CO")}</div>
            </div>
          </Card>
        ))}
        {ventasHoy.length===0 && <div style={{ textAlign:"center", padding:30, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin ventas registradas hoy en esta tienda.</div>}
      </div>
    </div>
  );
}

function VentasListaScreen({ user, stores, users, ventas, setVentas, ajustes, setAjustes, esAdmin, soloLectura }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const [filtroTienda, setFiltroTienda] = useState("");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [filtroVendedor, setFiltroVendedor] = useState("");
  const [filtroFlexipago, setFiltroFlexipago] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [expandido, setExpandido] = useState(null);
  const [detalle, setDetalle] = useState({});

  const [mostrarSolicitud, setMostrarSolicitud] = useState(null);
  const [motivoSolicitud, setMotivoSolicitud] = useState("");

  const [editando, setEditando] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [editItemTipo, setEditItemTipo] = useState("producto");
  const [editItemValor, setEditItemValor] = useState("");
  const [editItemDescuento, setEditItemDescuento] = useState("");
  const [editItemDescuentoTipo, setEditItemDescuentoTipo] = useState("valor");
  const [editItemPagos, setEditItemPagos] = useState([]); // [{medio_pago, valor, numero_autorizacion}]
  const [editItemMedioNuevo, setEditItemMedioNuevo] = useState("");
  const [editObservacion, setEditObservacion] = useState("");
  const [editNumeroFactura, setEditNumeroFactura] = useState("");

  const [abonoForm, setAbonoForm] = useState(null);
  const [abonoValor, setAbonoValor] = useState("");
  const [abonoMedio, setAbonoMedio] = useState("efectivo");
  const [guardando, setGuardando] = useState(false);
  const [editErrorMsg, setEditErrorMsg] = useState("");

  // "Corregir por error": solo para master/admin/admin_finanzas, sin necesitar solicitud aprobada.
  // A diferencia de agregar excedente, aquí sí se puede subir O bajar el valor libremente — es
  // solo para cuando el número se digitó mal desde el principio, no para cambios reales de venta.
  const puedeCorregirError = !soloLectura && ["master","admin_finanzas"].includes(user.role);
  const [modoErrorId, setModoErrorId] = useState(null);

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
    const item = (detalle[venta.id]?.items||[]).find(i=>i.id===corrigiendoPago.itemId);
    if(!item) return;
    setGuardandoCp(true);
    const nuevosPagos = (item.pagos||[]).map((p,idx)=> idx===corrigiendoPago.pagoIdx ? { ...p, medio_pago:cpMedio, numero_autorizacion:VENTAS_MEDIOS_TARJETA.includes(cpMedio)?(cpAutorizacion||"").trim():null } : p);
    const { data } = await supabase.from("ventas_items").update({ pagos:nuevosPagos }).eq("id",item.id).select().single();
    if(data){
      setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], items:(prev[venta.id]?.items||[]).map(i=>i.id===data.id?data:i)}}));
      const aprobadasSinAplicar = (detalle[venta.id]?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);
      for(const s of aprobadasSinAplicar){
        await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
      }
      if(aprobadasSinAplicar.length>0){
        setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], solicitudes:(prev[venta.id]?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s) }}));
      }
    }
    setGuardandoCp(false);
    setCorrigiendoPago(null);
  };

  const iniciarEdicionAbono = (a) => { setEditandoAbonoId(a.id); setEaFecha(a.fecha); setEaValor(String(a.valor)); setEaMedio(a.medio_pago); };
  const guardarEdicionAbono = async (ventaId) => {
    if(!eaFecha || !eaValor){ return; }
    setGuardandoEa(true);
    const { data, error } = await supabase.from("ventas_abonos").update({ fecha:eaFecha, valor:Number(eaValor), medio_pago:eaMedio }).eq("id", editandoAbonoId).select().single();
    setGuardandoEa(false);
    if(data){
      setDetalle(prev=>({...prev, [ventaId]: { ...prev[ventaId], abonos:(prev[ventaId]?.abonos||[]).map(x=>x.id===data.id?data:x) }}));
      setEditandoAbonoId(null);
    }
  };

  const asesores = users.filter(u=>u.role==="advisor");

  const ventasFiltradas = ventas
    .filter(v => (!tiendaFija || v.tienda_id===tiendaFija))
    .filter(v => (!filtroTienda || v.tienda_id===filtroTienda))
    .filter(v => (!filtroFecha || v.fecha===filtroFecha))
    .filter(v => (!filtroVendedor || v.vendedor_id===filtroVendedor))
    .filter(v => (!filtroFlexipago || v.es_flexipago))
    .filter(v => {
      const q = busqueda.trim().toLowerCase();
      if(!q) return true;
      return (v.cliente_nombre||"").toLowerCase().includes(q) || (v.cliente_documento||"").toLowerCase().includes(q);
    })
    .sort((a,b)=> (b.fecha||"").localeCompare(a.fecha||"") || (b.created_at||"").localeCompare(a.created_at||""));

  const fetchDetalle = async (ventaId) => {
    setDetalle(prev=>({...prev, [ventaId]:{...(prev[ventaId]||{}), cargando:true}}));
    const [{data:items},{data:abonos},{data:solicitudes}] = await Promise.all([
      supabase.from("ventas_items").select("*").eq("venta_id",ventaId),
      supabase.from("ventas_abonos").select("*").eq("venta_id",ventaId).order("fecha",{ascending:true}),
      supabase.from("ventas_solicitudes_correccion").select("*").eq("venta_id",ventaId).order("fecha_solicitud",{ascending:false}),
    ]);
    setDetalle(prev=>({...prev, [ventaId]:{ items:items||[], abonos:abonos||[], solicitudes:solicitudes||[], cargando:false }}));
  };
  const toggleExpand = (ventaId) => {
    if(expandido===ventaId){ setExpandido(null); return; }
    setExpandido(ventaId);
    if(!detalle[ventaId]) fetchDetalle(ventaId);
  };

  const enviarSolicitud = async (ventaId) => {
    if(!motivoSolicitud.trim()) return;
    const { data } = await supabase.from("ventas_solicitudes_correccion").insert({ venta_id:ventaId, solicitado_por:user.name, motivo:motivoSolicitud.trim(), estado:"pendiente" }).select().single();
    if(data){
      setDetalle(prev=>({...prev, [ventaId]:{...prev[ventaId], solicitudes:[data, ...(prev[ventaId]?.solicitudes||[])]}}));
      setMostrarSolicitud(null); setMotivoSolicitud("");
    }
  };

  const resolverSolicitud = async (solicitud, nuevoEstado) => {
    const { data } = await supabase.from("ventas_solicitudes_correccion").update({ estado:nuevoEstado, resuelto_por:user.name, fecha_resolucion:new Date().toISOString() }).eq("id",solicitud.id).select().single();
    if(data){
      setDetalle(prev=>({...prev, [solicitud.venta_id]:{...prev[solicitud.venta_id], solicitudes:prev[solicitud.venta_id].solicitudes.map(s=>s.id===data.id?data:s)}}));
    }
  };

  const iniciarEdicion = (venta) => {
    setEditando(venta.id);
    // Flexipago se sigue editando completo (como antes). Las ventas normales ya no permiten
    // tocar lo que ya está registrado — solo se puede agregar el excedente como renglón nuevo.
    setEditItems(venta.es_flexipago ? (detalle[venta.id]?.items||[]).map(i=>({ tipo:i.tipo, valorTotal:Number(i.valor), descuento:Number(i.descuento||0), pagos:i.pagos||[] })) : []);
    setEditObservacion(venta.observacion||"");
    setEditNumeroFactura(venta.numero_factura||"");
    setEditErrorMsg("");
    setEditItemTipo("producto");
    setEditItemValor("");
    setEditItemDescuento("");
    setEditItemDescuentoTipo("valor");
    setEditItemPagos([]);
    setEditItemMedioNuevo("");
  };

  const iniciarCorreccionError = (venta) => {
    const confirmacion = window.prompt(`Vas a CORREGIR POR ERROR la factura #${venta.numero_factura||"—"} (hoy dice $${Number(venta.total).toLocaleString("es-CO")}).\n\nA diferencia de "Agregar excedente", aquí el valor puede subir o bajar libremente. Úsalo SOLO si el número se digitó mal desde el principio — no para un cambio real de producto (para eso usa "Agregar excedente").\n\nEscribe CORREGIR para confirmar.`);
    if(confirmacion!=="CORREGIR") return;
    setModoErrorId(venta.id);
    setEditando(venta.id);
    setEditItems((detalle[venta.id]?.items||[]).map(i=>({ tipo:i.tipo, valorTotal:Number(i.valor), descuento:Number(i.descuento||0), pagos:i.pagos||[] })));
    setEditObservacion(venta.observacion||"");
    setEditNumeroFactura(venta.numero_factura||"");
    setEditErrorMsg("");
    setEditItemTipo("producto");
    setEditItemValor("");
    setEditItemDescuento("");
    setEditItemDescuentoTipo("valor");
    setEditItemPagos([]);
    setEditItemMedioNuevo("");
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
  const setEditItemPagoValor = (idx, v) => setEditItemPagos(prev=>prev.map((p,i)=>i===idx?{...p,valor:v}:p));
  const setEditItemPagoAutorizacion = (idx, v) => setEditItemPagos(prev=>prev.map((p,i)=>i===idx?{...p,numero_autorizacion:v}:p));

  const agregarEditItem = () => {
    if(editItemEsFlexipago){
      if(editItemValorNum<=0) return;
      setEditItems(prev=>[...prev, { tipo:"flexipago", valorTotal:editItemValorNum, descuento:0, pagos:[] }]);
      setEditItemValor("");
      return;
    }
    if(editItemValorNum<=0 || editItemPagos.length===0 || Math.abs(editItemFalta)>=1 || editItemFaltaAUT) return;
    const pagos = editItemPagos.map(p=>({ medio_pago:p.medio_pago, valor:Number(p.valor||0), numero_autorizacion:VENTAS_MEDIOS_TARJETA.includes(p.medio_pago)?(p.numero_autorizacion||"").trim():null }));
    setEditItems(prev=>[...prev, { tipo:editItemTipo, valorTotal:editItemValorNum, descuento:editItemDescuentoNum, pagos }]);
    setEditItemValor(""); setEditItemDescuento(""); setEditItemDescuentoTipo("valor"); setEditItemPagos([]);
  };
  const quitarEditItem = (idx) => setEditItems(prev=>prev.filter((_,i)=>i!==idx));

  const guardarEdicion = async (venta) => {
    const esModoError = modoErrorId===venta.id;
    // Flexipago (edición normal) y "corregir por error" se editan completo, como antes
    // (se reemplazan todos los renglones). Solo el modo error puede subir O bajar el valor.
    if(venta.es_flexipago || esModoError){
      if(editItems.length===0) return;
      setGuardando(true);
      const bruto = editItems.reduce((a,i)=>a+i.valorTotal,0);
      const desc = editItems.reduce((a,i)=>a+i.descuento,0);
      const total = bruto - desc;
      const esFlexipagoEdit = editItems.some(i=>i.tipo==="flexipago");
      const valorAnterior = Number(venta.total);
      const payload = { observacion:editObservacion.trim(), numero_factura:editNumeroFactura.trim()||null, valor_bruto:bruto, descuento_total:desc, total, es_flexipago:esFlexipagoEdit, updated_at:new Date().toISOString() };
      // En modo error se resetea el piso: el valor corregido queda como si siempre hubiera sido
      // el original, para no dejar un "excedente" fantasma en Métricas.
      if(esModoError) payload.valor_original = total;
      const { data:ventaAct } = await supabase.from("ventas").update(payload).eq("id",venta.id).select().single();
      await supabase.from("ventas_items").delete().eq("venta_id",venta.id);
      const filasItems = editItems.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valorTotal, descuento:i.descuento, pagos:i.pagos }));
      const { data:itemsNuevos } = await supabase.from("ventas_items").insert(filasItems).select();
      const aprobadasSinAplicar = (detalle[venta.id]?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);
      for(const s of aprobadasSinAplicar){
        await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
      }
      // Se deja un rastro en el historial de ajustes, marcado como corrección por error para que
      // Métricas no lo cuente como un excedente real (eso ya quedó reflejado arriba en valor_original).
      if(esModoError && total!==valorAnterior){
        const { data:ajusteNuevo } = await supabase.from("ventas_ajustes").insert({ venta_id:venta.id, fecha:todayStr, valor_anterior:valorAnterior, valor_nuevo:total, diferencia:total-valorAnterior, motivo:`Corrección por error${editObservacion.trim()?": "+editObservacion.trim():""}`, aplicado_por:user.name, es_correccion_error:true }).select().single();
        if(ajusteNuevo) setAjustes(prev=>[...prev, ajusteNuevo]);
      }
      setGuardando(false);
      if(ventaAct){
        setVentas(prev=>prev.map(v=>v.id===venta.id?ventaAct:v));
        setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], items:itemsNuevos||[], solicitudes:(prev[venta.id]?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s) }}));
      }
      setEditando(null);
      setModoErrorId(null);
      return;
    }

    // Ventas normales: lo ya registrado (valor y medio de pago) NO se toca aquí. Solo se agrega
    // el excedente como renglón(es) nuevo(s) — por eso el total nunca puede bajar: no hay forma
    // de borrar ni modificar lo que ya está guardado desde esta pantalla.
    const nuevoBruto = editItems.reduce((a,i)=>a+i.valorTotal,0);
    const nuevoDesc = editItems.reduce((a,i)=>a+i.descuento,0);
    const excedente = nuevoBruto - nuevoDesc;
    if(excedente < 0){
      setEditErrorMsg("El descuento del renglón nuevo no puede ser mayor a su valor.");
      return;
    }
    setEditErrorMsg("");
    setGuardando(true);
    const valorActual = Number(venta.total);
    const nuevoTotal = valorActual + excedente;
    const { data:ventaAct } = await supabase.from("ventas").update({ observacion:editObservacion.trim(), numero_factura:editNumeroFactura.trim()||null, valor_bruto:Number(venta.valor_bruto)+nuevoBruto, descuento_total:Number(venta.descuento_total)+nuevoDesc, total:nuevoTotal, updated_at:new Date().toISOString() }).eq("id",venta.id).select().single();
    let itemsActualizados = detalle[venta.id]?.items || [];
    if(editItems.length>0){
      const filasItems = editItems.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valorTotal, descuento:i.descuento, pagos:i.pagos }));
      const { data:itemsInsertados } = await supabase.from("ventas_items").insert(filasItems).select();
      itemsActualizados = [...itemsActualizados, ...(itemsInsertados||[])];
    }
    const aprobadasSinAplicar = (detalle[venta.id]?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);
    for(const s of aprobadasSinAplicar){
      await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
    }
    // El excedente queda registrado con la fecha de HOY (el mes de la corrección); el valor
    // original se queda en su mes de venta (no se toca acá).
    if(excedente > 0){
      const { data:ajusteNuevo } = await supabase.from("ventas_ajustes").insert({ venta_id:venta.id, fecha:todayStr, valor_anterior:valorActual, valor_nuevo:nuevoTotal, diferencia:excedente, motivo:editObservacion.trim()||null, aplicado_por:user.name }).select().single();
      if(ajusteNuevo) setAjustes(prev=>[...prev, ajusteNuevo]);
    }
    setGuardando(false);
    if(ventaAct){
      setVentas(prev=>prev.map(v=>v.id===venta.id?ventaAct:v));
      setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], items:itemsActualizados, solicitudes:(prev[venta.id]?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s) }}));
    }
    setEditando(null);
  };

  const eliminarVenta = async (venta) => {
    const confirmacion = window.prompt(`Esto borra para siempre la venta #${venta.numero_factura||"—"} (${venta.vendedor_nombre}, $${Number(venta.total).toLocaleString("es-CO")}) y todo lo que tenga: renglones, abonos y solicitudes. No se puede deshacer.\n\nEscribe BORRAR para confirmar.`);
    if(confirmacion!=="BORRAR") return;
    await supabase.from("ventas_solicitudes_correccion").delete().eq("venta_id",venta.id);
    await supabase.from("ventas_abonos").delete().eq("venta_id",venta.id);
    await supabase.from("ventas_items").delete().eq("venta_id",venta.id);
    const { error } = await supabase.from("ventas").delete().eq("id",venta.id);
    if(!error){
      setVentas(prev=>prev.filter(v=>v.id!==venta.id));
      setDetalle(prev=>{ const c={...prev}; delete c[venta.id]; return c; });
    }
  };

  const [abonoNumeroFactura, setAbonoNumeroFactura] = useState("");
  const agregarAbono = async (venta, valorFlexipagoVenta, totalAbonadoActual) => {
    if(!abonoValor || Number(abonoValor)<=0) return;
    const completaPago = (valorFlexipagoVenta - totalAbonadoActual - Number(abonoValor)) <= 0;
    if(completaPago && !venta.numero_factura && !abonoNumeroFactura.trim()) return;
    const { data } = await supabase.from("ventas_abonos").insert({ venta_id:venta.id, fecha:todayStr, valor:Number(abonoValor), registrado_por:user.name, medio_pago:abonoMedio }).select().single();
    if(data){
      setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], abonos:[...(prev[venta.id]?.abonos||[]), data]}}));
      if(completaPago && !venta.numero_factura && abonoNumeroFactura.trim()){
        const { data:ventaAct } = await supabase.from("ventas").update({ numero_factura:abonoNumeroFactura.trim() }).eq("id",venta.id).select().single();
        if(ventaAct) setVentas(prev=>prev.map(v=>v.id===venta.id?ventaAct:v));
      }
      setAbonoForm(null); setAbonoValor(""); setAbonoMedio("efectivo"); setAbonoNumeroFactura("");
    }
  };

  const imprimirVenta = (venta, d) => {
    const tienda = stores[venta.tienda_id]?.name || venta.tienda_id;
    const itemsHtml = (d?.items||[]).map(i=>`<tr><td>${VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label||i.tipo}${i.tipo==="flexipago"&&i.codigo_producto?` (código ${i.codigo_producto})`:""}</td><td style="text-align:right">${fmtCOP(i.valor)}</td><td style="text-align:right">${Number(i.descuento)>0?fmtCOP(i.descuento):"—"}</td><td>${i.tipo==="flexipago"?"Pago diferido":(i.pagos||[]).map(p=>VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label||p.medio_pago).join(" + ")}</td></tr>`).join("");
    const abonosHtml = (d?.abonos||[]).map(a=>`<tr><td>${a.fecha}</td><td>${VENTAS_MEDIOS_PAGO.find(m=>m.value===a.medio_pago)?.label||a.medio_pago}</td><td style="text-align:right">${fmtCOP(a.valor)}</td></tr>`).join("");
    const totalAbonado = (d?.abonos||[]).reduce((a,x)=>a+Number(x.valor),0);
    const valorFlex = (d?.items||[]).filter(i=>i.tipo==="flexipago").reduce((a,i)=>a+Number(i.valor),0);
    const saldo = valorFlex - totalAbonado;
    const avisoHtml = FLEXIPAGO_AVISO_ITEMS.map(it=>`<p style="margin:3px 0;text-align:left;">${it.n?`<b>${it.n}. ${it.titulo}:</b> `:""}${it.texto}</p>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Venta ${venta.numero_factura||""}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;padding:28px;color:#111;}
        h1{font-size:18px;margin:0 0 4px;}
        table{width:100%;border-collapse:collapse;margin-top:10px;}
        th,td{padding:6px 8px;border-bottom:1px solid #ddd;font-size:13px;text-align:left;}
        .total{font-size:16px;font-weight:bold;margin-top:12px;}
        .muted{color:#666;font-size:12px;}
        hr{border:none;border-top:1px solid #ccc;margin:14px 0;}
        .aviso{margin-top:22px;border:1px solid #ccc;border-radius:6px;padding:10px 14px;background:#fafafa;}
        .aviso-titulo{font-size:12px;font-weight:bold;margin-bottom:6px;}
        .aviso p{font-size:10.5px;color:#333;line-height:1.4;}
      </style></head><body>
      <img src="/logo.png" alt="OZEN" style="height:50px;margin-bottom:8px;"/>
      <h1>Comprobante Flexipago</h1>
      <div class="muted">Factura Siigo: ${venta.numero_factura||"—"} · Tienda: ${tienda} · Fecha: ${venta.fecha}</div>
      <div class="muted">Asesor: ${venta.vendedor_nombre||""}</div>
      <hr/>
      <div><strong>Cliente:</strong> ${venta.cliente_nombre||"—"} · ${venta.cliente_tipo_doc||""} ${venta.cliente_documento||""} · Tel: ${venta.cliente_telefono||""}</div>
      <table><thead><tr><th>Producto/Servicio</th><th style="text-align:right">Valor</th><th style="text-align:right">Descuento</th><th>Medio</th></tr></thead><tbody>${itemsHtml}</tbody></table>
      <div class="total">Total venta: ${fmtCOP(venta.total)}</div>
      <h3 style="margin-top:20px;">Plan Flexipago — Abonos</h3>
      <table><thead><tr><th>Fecha</th><th>Medio</th><th style="text-align:right">Valor</th></tr></thead><tbody>${abonosHtml || '<tr><td colspan="3">Sin abonos registrados</td></tr>'}</tbody></table>
      <div class="total">Saldo pendiente: ${fmtCOP(saldo)}</div>
      ${venta.observacion?`<div class="muted" style="margin-top:14px;">Nota: ${venta.observacion}</div>`:""}
      <div class="aviso"><div class="aviso-titulo">${FLEXIPAGO_AVISO_TITULO}</div>${avisoHtml}</div>
    </body></html>`;
    const w = window.open("", "_blank", "width=720,height=900");
    if(!w){ alert("El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio e intenta de nuevo."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(()=>{ w.print(); }, 300);
  };

  return (
    <div>
      <PageHeader title="Lista de ventas" subtitle={`${ventasFiltradas.length} ventas`} />
      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"end" }}>
          {!tiendaFija && (
            <div style={{ minWidth:160 }}><Field label="Tienda" value={filtroTienda} onChange={setFiltroTienda} options={[{value:"",label:"Todas"},...tiendasVenta(stores).map(s=>({value:s.id,label:s.name}))]}/></div>
          )}
          <div style={{ minWidth:160 }}><Field label="Vendedor" value={filtroVendedor} onChange={setFiltroVendedor} options={[{value:"",label:"Todos"},...asesores.map(a=>({value:a.id,label:a.name}))]}/></div>
          <div style={{ minWidth:150 }}><Field label="Fecha" type="date" value={filtroFecha} onChange={setFiltroFecha}/></div>
          <div style={{ minWidth:200, flex:1 }}><Field label="Buscar cliente (nombre o documento)" value={busqueda} onChange={setBusqueda} placeholder="Ej: Juan Pérez o 1234567"/></div>
          <div style={{ marginBottom:14 }}>
            <Btn variant={filtroFlexipago?"primary":"ghost"} sm onClick={()=>setFiltroFlexipago(f=>!f)}>📦 Solo Flexipago</Btn>
          </div>
          {(filtroTienda||filtroFecha||filtroVendedor||filtroFlexipago||busqueda) && <Btn onClick={()=>{setFiltroTienda("");setFiltroFecha("");setFiltroVendedor("");setFiltroFlexipago(false);setBusqueda("");}} variant="ghost" sm>Limpiar filtros</Btn>}
        </div>
      </Card>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {ventasFiltradas.map(v=>{
          const d = detalle[v.id];
          const abiertoEdicion = editando===v.id;
          const puedeEditar = !soloLectura && (d?.solicitudes||[]).some(s=>s.estado==="aprobada" && !s.aplicada_at);
          const totalAbonado = (d?.abonos||[]).reduce((a,x)=>a+Number(x.valor),0);
          const valorFlexipago = (d?.items||[]).filter(i=>i.tipo==="flexipago").reduce((a,i)=>a+Number(i.valor),0);
          const saldoPendiente = valorFlexipago - totalAbonado;
          // Regla del aviso legal: 60 días calendario desde el primer abono para completar el pago.
          const primerAbonoFecha = (d?.abonos && d.abonos.length>0) ? d.abonos[0].fecha : null;
          const diasDesdeAbono = primerAbonoFecha ? diasEntre(primerAbonoFecha, todayStr) : null;
          const flexipagoVencido = v.es_flexipago && saldoPendiente>0 && diasDesdeAbono!==null && diasDesdeAbono>FLEXIPAGO_PLAZO_DIAS;
          const diasRestantes60 = diasDesdeAbono!==null ? FLEXIPAGO_PLAZO_DIAS - diasDesdeAbono : null;
          // Avisos previos al vencimiento: a los 30 días (mitad del plazo) y en los últimos 5 días, para
          // que el asesor le recuerde al cliente que venga por su pedido antes de perderlo.
          const flexipagoUrgente = v.es_flexipago && saldoPendiente>0 && !flexipagoVencido && diasRestantes60!==null && diasRestantes60<=5;
          const flexipagoAviso30 = v.es_flexipago && saldoPendiente>0 && !flexipagoVencido && !flexipagoUrgente && diasDesdeAbono!==null && diasDesdeAbono>=30;
          return (
            <Card key={v.id} p="0" style={{ overflow:"hidden" }}>
              <button onClick={()=>toggleExpand(v.id)} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"9px 12px", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", textAlign:"left" }}>
                <Badge color={C.gold} sm>#{v.numero_factura||"—"}</Badge>
                <div style={{ flex:1, minWidth:140 }}>
                  <div style={{ fontFamily:font.body, fontSize:12.5, color:C.text, fontWeight:600, lineHeight:1.3 }}>{v.vendedor_nombre} <span style={{ color:C.textMuted, fontWeight:400 }}>· {v.fecha} · {stores[v.tienda_id]?.name||v.tienda_id}</span></div>
                  {v.cliente_nombre && <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, lineHeight:1.3 }}>{v.cliente_nombre}</div>}
                  {(v.cliente_documento || v.cliente_telefono) && (
                    <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, lineHeight:1.3 }}>
                      {v.cliente_tipo_doc||""} {v.cliente_documento||""}{v.cliente_documento && v.cliente_telefono ? " · " : ""}{v.cliente_telefono ? `Tel: ${v.cliente_telefono}` : ""}
                    </div>
                  )}
                </div>
                {v.es_flexipago && <Badge color={C.blue} sm>Flexipago</Badge>}
                {flexipagoVencido && <Badge color={C.red} sm title={`Pasaron ${diasDesdeAbono} días desde el primer abono (máximo ${FLEXIPAGO_PLAZO_DIAS}). No se puede abonar ni editar.`}>⛔ Vencido</Badge>}
                {flexipagoUrgente && <Badge color={C.red} sm title={`Quedan ${diasRestantes60} días para que se cumplan los ${FLEXIPAGO_PLAZO_DIAS} días. Recuérdale al cliente que venga por su pedido.`}>🔔 Vence en {diasRestantes60}d</Badge>}
                {flexipagoAviso30 && <Badge color={C.amber} sm title="Ya pasaron 30 días desde el primer abono. Buen momento para recordarle al cliente.">⚠️ 30 días</Badge>}
                <div style={{ fontFamily:font.mono, fontSize:14, fontWeight:700, color:C.goldLight }}>${Number(v.total).toLocaleString("es-CO")}</div>
                <span style={{ color:C.textMuted, fontSize:11 }}>{expandido===v.id?"▲":"▼"}</span>
              </button>

              {expandido===v.id && (
                <div style={{ padding:"0 12px 12px", borderTop:`1px solid ${C.border}` }}>
                  {d?.cargando ? (
                    <div style={{ padding:14, color:C.textMuted, fontFamily:font.body, fontSize:12 }}>Cargando...</div>
                  ) : (
                    <>
                      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", margin:"8px 0 3px" }}>
                        <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>Ventas y servicios</div>
                        <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Bruto ${Number(v.valor_bruto).toLocaleString("es-CO")}{Number(v.descuento_total)>0 && ` · Desc $${Number(v.descuento_total).toLocaleString("es-CO")}`}</div>
                      </div>
                      {!abiertoEdicion ? (
                        <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:6 }}>
                          {(d?.items||[]).map(i=>(
                            <div key={i.id} style={{ display:"flex", flexDirection:"column", gap:2, padding:"3px 0" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6, fontFamily:font.body, fontSize:12, color:C.text, flexWrap:"wrap" }}>
                                <Badge color={i.tipo==="producto"?C.green:i.tipo==="flexipago"?C.blue:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                                <span style={{ fontFamily:font.mono, marginLeft:"auto" }}>${Number(i.valor).toLocaleString("es-CO")}{Number(i.descuento)>0 && ` (desc $${Number(i.descuento).toLocaleString("es-CO")})`}</span>
                              </div>
                              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                                {i.tipo==="flexipago" ? (
                                  <>
                                    <Badge color={C.blue} sm>📦 Pago diferido</Badge>
                                    {i.codigo_producto && <Badge color={C.textMuted} sm>Código: {i.codigo_producto}</Badge>}
                                  </>
                                ) : (i.pagos||[]).map((p,pidx)=>(
                                  corrigiendoPago && corrigiendoPago.itemId===i.id && corrigiendoPago.pagoIdx===pidx ? (
                                    <div key={pidx} style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"end", padding:"4px 0", background:C.dark, borderRadius:6 }}>
                                      <div style={{ width:150 }}><Field label="Medio correcto" value={cpMedio} onChange={setCpMedio} options={VENTAS_MEDIOS_PAGO}/></div>
                                      {VENTAS_MEDIOS_TARJETA.includes(cpMedio) && <div style={{ width:130 }}><Field label="N.º autorización" value={cpAutorizacion} onChange={setCpAutorizacion}/></div>}
                                      <Btn onClick={()=>guardarCorreccionMedio(v)} disabled={guardandoCp} sm>{guardandoCp?"...":"Guardar"}</Btn>
                                      <Btn onClick={()=>setCorrigiendoPago(null)} variant="ghost" sm>Cancelar</Btn>
                                    </div>
                                  ) : (
                                    <Badge key={pidx} color={C.gold} sm>
                                      {VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}{p.numero_autorizacion?` · AUT ${p.numero_autorizacion}`:""}
                                      {puedeEditar && !abiertoEdicion && <button onClick={()=>iniciarCorreccionMedio(i,pidx)} title="Corregir solo el medio de pago (el valor no cambia)" style={{ background:"none", border:"none", cursor:"pointer", color:"inherit", marginLeft:6, padding:0 }}>✏️</button>}
                                    </Badge>
                                  )
                                ))}
                              </div>
                            </div>
                          ))}
                          {(d?.items||[]).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin ventas/servicios registrados.</div>}
                        </div>
                      ) : (v.es_flexipago || modoErrorId===v.id) ? (
                        <div style={{ marginBottom:10 }}>
                          {modoErrorId===v.id && (
                            <div style={{ fontFamily:font.body, fontSize:12, margin:"0 0 10px", padding:"8px 10px", borderRadius:7, background:`${C.red}18`, border:`1px solid ${C.red}` }}>
                              ⚠️ Modo corrección por error: aquí el valor puede subir o bajar libremente. Úsalo solo si el número se digitó mal — para un cambio real de producto usa "Agregar excedente".
                            </div>
                          )}
                          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
                            {editItems.map((i,idx)=>(
                              <div key={idx} style={{ display:"flex", flexDirection:"column", gap:4, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  <Badge color={i.tipo==="producto"?C.green:i.tipo==="flexipago"?C.blue:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                                  <div style={{ flex:1, fontFamily:font.mono, fontSize:12, color:C.text, textAlign:"right" }}>${i.valorTotal.toLocaleString("es-CO")}{i.descuento>0 && ` (desc $${i.descuento.toLocaleString("es-CO")})`}</div>
                                  <button onClick={()=>quitarEditItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                                </div>
                                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                                  {i.tipo==="flexipago" ? (
                                    <Badge color={C.blue} sm>📦 Pago diferido</Badge>
                                  ) : i.pagos.map((p,pidx)=>(
                                    <Badge key={pidx} color={C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}</Badge>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"12px", marginBottom:10 }}>
                            <Field label="Tipo" value={editItemTipo} onChange={setEditItemTipo} options={VENTAS_TIPOS}/>
                            {editItemEsFlexipago ? (
                              <>
                                <CurrencyField label="Valor total" value={editItemValor} onChange={setEditItemValor}/>
                                <div style={{ marginTop:6, marginBottom:4, fontFamily:font.body, fontSize:11, color:C.blue }}>📦 Flexipago no lleva descuento ni medio de pago aquí — se paga con abonos.</div>
                              </>
                            ) : (
                              <>
                                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:4 }}>
                                  <CurrencyField label="Valor total" value={editItemValor} onChange={setEditItemValor}/>
                                  <div>
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
                                </div>
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
                                            <CurrencyField label="Valor pagado" value={p.valor} onChange={v=>setEditItemPagoValor(idx,v)}/>
                                            {VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && <Field label="N.º autorización" value={p.numero_autorizacion||""} onChange={v=>setEditItemPagoAutorizacion(idx,v)} placeholder="Ej: 056495"/>}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"end" }}>
                                  <Field value={editItemMedioNuevo} onChange={v=>{ if(v) agregarMedioAEditItem(v); else setEditItemMedioNuevo(v); }} options={[{value:"",label:"+ Agregar medio de pago"}, ...VENTAS_MEDIOS_PAGO]}/>
                                </div>
                                {editItemPagos.length>0 && (
                                  <div style={{ fontFamily:font.body, fontSize:12, marginBottom:10, color:Math.abs(editItemFalta)<1?C.green:C.red }}>
                                    {Math.abs(editItemFalta)<1 ? "✓ Los medios cuadran con el valor de este renglón" : editItemFalta>0 ? `Faltan $${editItemFalta.toLocaleString("es-CO")} por asignar` : `Te pasaste por $${Math.abs(editItemFalta).toLocaleString("es-CO")}`}
                                  </div>
                                )}
                              </>
                            )}
                            <Btn onClick={agregarEditItem} disabled={editItemEsFlexipago ? editItemValorNum<=0 : (editItemValorNum<=0 || editItemPagos.length===0 || Math.abs(editItemFalta)>=1 || editItemFaltaAUT)} sm full>+ Agregar</Btn>
                          </div>
                          <Field label="Observación" value={editObservacion} onChange={setEditObservacion} multiline rows={2}/>
                          {editItems.some(i=>i.tipo==="flexipago") ? (
                            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, margin:"6px 0 10px" }}>📦 Esta venta tiene un renglón Flexipago — no factura hasta completar el pago.</div>
                          ) : (
                            <Field label="N.º de factura (Siigo)" value={editNumeroFactura} onChange={setEditNumeroFactura} placeholder="Ej: FE-1234"/>
                          )}
                          <div style={{ display:"flex", gap:8 }}>
                            <Btn onClick={()=>guardarEdicion(v)} disabled={guardando} sm>{guardando?"Guardando...":"Guardar corrección"}</Btn>
                            <Btn onClick={()=>{ setEditando(null); setEditErrorMsg(""); setModoErrorId(null); }} variant="ghost" sm>Cancelar</Btn>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginBottom:10 }}>
                          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:6 }}>Ya registrado — no se puede modificar desde aquí:</div>
                          <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:12, opacity:0.7 }}>
                            {(d?.items||[]).map(i=>(
                              <div key={i.id} style={{ display:"flex", flexDirection:"column", gap:2, padding:"3px 0" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:6, fontFamily:font.body, fontSize:12, color:C.text, flexWrap:"wrap" }}>
                                  <Badge color={i.tipo==="producto"?C.green:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                                  <span style={{ fontFamily:font.mono, marginLeft:"auto" }}>${Number(i.valor).toLocaleString("es-CO")}{Number(i.descuento)>0 && ` (desc $${Number(i.descuento).toLocaleString("es-CO")})`}</span>
                                </div>
                                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                                  {(i.pagos||[]).map((p,pidx)=>(
                                    <Badge key={pidx} color={C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}{p.numero_autorizacion?` · AUT ${p.numero_autorizacion}`:""}</Badge>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>

                          {editItems.length>0 && (
                            <>
                              <div style={{ fontFamily:font.body, fontSize:11, color:C.green, marginBottom:6 }}>Excedente nuevo (esto sí se va a agregar):</div>
                              <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
                                {editItems.map((i,idx)=>(
                                  <div key={idx} style={{ display:"flex", flexDirection:"column", gap:4, background:C.surfaceAlt, border:`1px solid ${C.green}55`, borderRadius:7, padding:"8px 10px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                      <Badge color={i.tipo==="producto"?C.green:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                                      <div style={{ flex:1, fontFamily:font.mono, fontSize:12, color:C.text, textAlign:"right" }}>${i.valorTotal.toLocaleString("es-CO")}{i.descuento>0 && ` (desc $${i.descuento.toLocaleString("es-CO")})`}</div>
                                      <button onClick={()=>quitarEditItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                                    </div>
                                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                                      {i.pagos.map((p,pidx)=>(
                                        <Badge key={pidx} color={C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===p.medio_pago)?.label} · ${Number(p.valor).toLocaleString("es-CO")}</Badge>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}

                          <div style={{ border:`1px solid ${C.green}55`, borderRadius:8, padding:"12px", marginBottom:10 }}>
                            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Agregar excedente</div>
                            <Field label="Tipo" value={editItemTipo} onChange={setEditItemTipo} options={VENTAS_TIPOS.filter(t=>t.value!=="flexipago")}/>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:4 }}>
                              <CurrencyField label="Valor del excedente" value={editItemValor} onChange={setEditItemValor}/>
                              <div>
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
                            </div>
                            <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Medios de pago del excedente</div>
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
                                        <CurrencyField label="Valor pagado" value={p.valor} onChange={v=>setEditItemPagoValor(idx,v)}/>
                                        {VENTAS_MEDIOS_TARJETA.includes(p.medio_pago) && <Field label="N.º autorización" value={p.numero_autorizacion||""} onChange={v=>setEditItemPagoAutorizacion(idx,v)} placeholder="Ej: 056495"/>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"end" }}>
                              <Field value={editItemMedioNuevo} onChange={v=>{ if(v) agregarMedioAEditItem(v); else setEditItemMedioNuevo(v); }} options={[{value:"",label:"+ Agregar medio de pago"}, ...VENTAS_MEDIOS_PAGO]}/>
                            </div>
                            {editItemPagos.length>0 && (
                              <div style={{ fontFamily:font.body, fontSize:12, marginBottom:10, color:Math.abs(editItemFalta)<1?C.green:C.red }}>
                                {Math.abs(editItemFalta)<1 ? "✓ Los medios cuadran con el valor de este renglón" : editItemFalta>0 ? `Faltan $${editItemFalta.toLocaleString("es-CO")} por asignar` : `Te pasaste por $${Math.abs(editItemFalta).toLocaleString("es-CO")}`}
                              </div>
                            )}
                            <Btn onClick={agregarEditItem} disabled={editItemValorNum<=0 || editItemPagos.length===0 || Math.abs(editItemFalta)>=1 || editItemFaltaAUT} sm full>+ Agregar excedente</Btn>
                          </div>

                          <Field label="Observación" value={editObservacion} onChange={setEditObservacion} multiline rows={2}/>
                          <Field label="N.º de factura (Siigo)" value={editNumeroFactura} onChange={setEditNumeroFactura} placeholder="Ej: FE-1234"/>

                          {(() => {
                            const editBruto = editItems.reduce((a,i)=>a+i.valorTotal,0);
                            const editDesc = editItems.reduce((a,i)=>a+i.descuento,0);
                            const excedente = editBruto - editDesc;
                            const nuevoTotal = Number(v.total) + excedente;
                            return (
                              <>
                                <div style={{ fontFamily:font.body, fontSize:12, margin:"2px 0 10px", padding:"8px 10px", borderRadius:7, background:`${C.gold}11`, border:`1px solid ${C.gold}55`, color:C.text }}>
                                  Valor ya registrado: <strong>${Number(v.total).toLocaleString("es-CO")}</strong> (no cambia) · Excedente: <strong>${excedente.toLocaleString("es-CO")}</strong> · Nuevo total: <strong>${nuevoTotal.toLocaleString("es-CO")}</strong>
                                </div>
                                {editErrorMsg && (
                                  <div style={{ fontFamily:font.body, fontSize:12, margin:"0 0 10px", padding:"8px 10px", borderRadius:7, background:`${C.red}18`, border:`1px solid ${C.red}`, color:C.red }}>
                                    {editErrorMsg}
                                  </div>
                                )}
                                <div style={{ display:"flex", gap:8 }}>
                                  <Btn onClick={()=>guardarEdicion(v)} disabled={guardando} sm>{guardando?"Guardando...":"Guardar"}</Btn>
                                  <Btn onClick={()=>{ setEditando(null); setEditErrorMsg(""); }} variant="ghost" sm>Cancelar</Btn>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      )}

                      {v.es_flexipago && (
                        <>
                          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"8px 0 3px" }}>Abonos</div>
                          <div style={{ display:"flex", flexDirection:"column", gap:2, marginBottom:4 }}>
                            {(d?.abonos||[]).map(a=>(
                              editandoAbonoId===a.id ? (
                                <div key={a.id} style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"end", padding:"4px 0", background:C.dark, borderRadius:6, marginBottom:2 }}>
                                  <div style={{ width:130 }}><Field label="Fecha" type="date" value={eaFecha} onChange={setEaFecha}/></div>
                                  <div style={{ width:110 }}><Field label="Valor" value={eaValor} onChange={v=>setEaValor(v.replace(/[^\d]/g,""))}/></div>
                                  <div style={{ width:130 }}><Field label="Medio" value={eaMedio} onChange={setEaMedio} options={VENTAS_MEDIOS_PAGO}/></div>
                                  <Btn onClick={()=>guardarEdicionAbono(v.id)} disabled={guardandoEa} sm>{guardandoEa?"...":"Guardar"}</Btn>
                                  <Btn onClick={()=>setEditandoAbonoId(null)} variant="ghost" sm>Cancelar</Btn>
                                </div>
                              ) : (
                                <div key={a.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:font.body, fontSize:12, color:C.text, padding:"2px 0" }}>
                                  <span>{a.fecha} — Abono · {VENTAS_MEDIOS_PAGO.find(m=>m.value===a.medio_pago)?.label||a.medio_pago}</span>
                                  <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <span style={{fontFamily:font.mono}}>${Number(a.valor).toLocaleString("es-CO")}</span>
                                    {user.role==="master" && <button onClick={()=>iniciarEdicionAbono(a)} title="Corregir este abono" style={{ background:"none", border:"none", cursor:"pointer", color:C.textMuted, fontSize:12 }}>✏️</button>}
                                  </span>
                                </div>
                              )
                            ))}
                            {(d?.abonos||[]).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin abonos todavía.</div>}
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:13, fontWeight:700, color:saldoPendiente>0?C.amber:C.green, marginBottom:6 }}>
                            <span>Saldo pendiente</span><span style={{fontFamily:font.mono}}>${saldoPendiente.toLocaleString("es-CO")}</span>
                          </div>
                          {saldoPendiente>0 && !soloLectura && (
                            flexipagoVencido ? (
                              <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:7, padding:"8px 10px", fontFamily:font.body, fontSize:12, color:C.red }}>
                                ⛔ Pasaron {diasDesdeAbono} días desde el primer abono (máximo {FLEXIPAGO_PLAZO_DIAS}, según el aviso legal). No se puede abonar más ni completar esta venta — el cliente pierde lo abonado y el separado.
                              </div>
                            ) : abonoForm===v.id ? (
                              <div style={{ marginBottom:6 }}>
                                <div style={{ display:"flex", gap:8, alignItems:"end", flexWrap:"wrap" }}>
                                  <div style={{ flex:1, minWidth:120 }}><CurrencyField label="Valor del abono" value={abonoValor} onChange={setAbonoValor}/></div>
                                  <div style={{ minWidth:160 }}><Field label="Medio del abono" value={abonoMedio} onChange={setAbonoMedio} options={VENTAS_MEDIOS_REALES}/></div>
                                </div>
                                {(saldoPendiente - Number(abonoValor||0) <= 0) && !v.numero_factura && (
                                  <Field label="Este abono completa el pago — N.º de factura (Siigo)" value={abonoNumeroFactura} onChange={setAbonoNumeroFactura} placeholder="Ej: FE-1234"/>
                                )}
                                <div style={{ display:"flex", gap:6 }}>
                                  <Btn onClick={()=>agregarAbono(v, valorFlexipago, totalAbonado)} disabled={!abonoValor || Number(abonoValor)<=0 || ((saldoPendiente - Number(abonoValor||0) <= 0) && !v.numero_factura && !abonoNumeroFactura.trim())} sm>Guardar</Btn>
                                  <Btn onClick={()=>{setAbonoForm(null);setAbonoValor("");setAbonoMedio("efectivo");setAbonoNumeroFactura("");}} variant="ghost" sm>Cancelar</Btn>
                                </div>
                              </div>
                            ) : (
                              <Btn onClick={()=>setAbonoForm(v.id)} sm style={{ marginBottom:6 }}>+ Agregar abono</Btn>
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

                      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:6 }}>
                        {v.es_flexipago && <Btn onClick={()=>imprimirVenta(v,d)} variant="ghost" sm>🖨️ Imprimir</Btn>}
                        {puedeEditar && !abiertoEdicion && !flexipagoVencido && <Btn onClick={()=>iniciarEdicion(v)} sm>{v.es_flexipago?"✏️ Hacer la corrección aprobada":"➕ Agregar excedente"}</Btn>}
                        {puedeCorregirError && !abiertoEdicion && <Btn onClick={()=>iniciarCorreccionError(v)} variant="ghost" sm style={{ color:C.amber }}>🛠️ Corregir por error</Btn>}
                        {user.role==="master" && <Btn onClick={()=>eliminarVenta(v)} variant="ghost" sm style={{ color:C.red }}>🗑️ Eliminar venta</Btn>}
                        {!soloLectura && (mostrarSolicitud===v.id ? (
                          <div style={{ display:"flex", gap:8, flex:1, minWidth:220, alignItems:"end" }}>
                            <div style={{ flex:1 }}><Field label="¿Qué hay que corregir y por qué?" value={motivoSolicitud} onChange={setMotivoSolicitud} multiline rows={2}/></div>
                            <div style={{ marginBottom:14, display:"flex", gap:6 }}>
                              <Btn onClick={()=>enviarSolicitud(v.id)} sm>Enviar</Btn>
                              <Btn onClick={()=>{setMostrarSolicitud(null);setMotivoSolicitud("");}} variant="ghost" sm>Cancelar</Btn>
                            </div>
                          </div>
                        ) : (
                          <Btn onClick={()=>setMostrarSolicitud(v.id)} variant="ghost" sm>🔒 Solicitar corrección</Btn>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </Card>
          );
        })}
        {ventasFiltradas.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>No hay ventas que coincidan con los filtros.</div>}
      </div>
    </div>
  );
}

const MESES_NOMBRE = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const diasDelMes = (anio, mesIdx) => new Date(anio, mesIdx+1, 0).getDate();
const fmtCOP = (n) => `$${Math.round(n||0).toLocaleString("es-CO")}`;
// La meta personal siempre se calcula sobre 30 días, sin importar si el mes tiene 28-31.
const DIAS_META = 30;

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

function VentasMetricasScreen({ user, stores, users, ventas, ventasItems, ventasAbonos, ventasAjustes, metas, setMetas, metasAsesor, setMetasAsesor, esAdmin, puedeAsignarMetas, isMobile }) {
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
  const asesores = users.filter(u=>u.role==="advisor" && u.active);
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
      // Novedades múltiples: si el registro es viejo y solo tiene el campo único de antes,
      // se migra automáticamente a una lista de una sola novedad.
      const novedadesExistentes = (existente?.novedades && existente.novedades.length>0)
        ? existente.novedades
        : (existente?.tipo_novedad ? [{ tipo:existente.tipo_novedad, dias:existente.dias_novedad||0 }] : []);
      obj[a.id] = {
        mesCompleto: existente ? existente.mes_completo : true,
        diasIngreso: String(existente?.dias_ingreso||""),
        novedades: novedadesExistentes.map(n=>({ tipo:n.tipo, dias:String(n.dias||"") })),
        diasTienda: Object.fromEntries(tiendasList.map(t=>[t.id, String((existente?.dias_tienda||{})[t.id]||"")])),
      };
    });
    setDetalleInputs(obj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesKey, metasAsesor.length, asesores.length]);

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

  const setDetalleField = (asesorId, field, value) => setDetalleInputs(prev=>({...prev, [asesorId]: {...prev[asesorId], [field]:value}}));
  const setDetalleTienda = (asesorId, tiendaId, value) => setDetalleInputs(prev=>({...prev, [asesorId]: {...prev[asesorId], diasTienda:{...prev[asesorId]?.diasTienda, [tiendaId]:value}}}));
  const agregarNovedadAsesor = (asesorId) => setDetalleInputs(prev=>({...prev, [asesorId]: {...prev[asesorId], novedades:[...(prev[asesorId]?.novedades||[]), {tipo:"incapacidad", dias:""}]}}));
  const quitarNovedadAsesor = (asesorId, idx) => setDetalleInputs(prev=>({...prev, [asesorId]: {...prev[asesorId], novedades:(prev[asesorId]?.novedades||[]).filter((_,i)=>i!==idx)}}));
  const setNovedadAsesorCampo = (asesorId, idx, campo, value) => setDetalleInputs(prev=>({...prev, [asesorId]: {...prev[asesorId], novedades:(prev[asesorId]?.novedades||[]).map((n,i)=>i===idx?{...n,[campo]:value}:n)}}));

  const guardarDetalleAsesor = async (asesorId) => {
    const d = detalleInputs[asesorId];
    if(!d) return;
    const novedadesLimpias = (d.novedades||[]).filter(n=>n.tipo && Number(n.dias)>0).map(n=>({ tipo:n.tipo, dias:Number(n.dias) }));
    // Los días disponibles para repartir entre tiendas son los del mes (o los de ingreso, si es
    // nuevo) menos los de las novedades — así una incapacidad sí reduce lo que se puede asignar.
    const diasDisponibles = (d.mesCompleto ? DIAS_META : Number(d.diasIngreso||0)) - novedadesLimpias.reduce((s,n)=>s+n.dias,0);
    const sumaDiasTienda = Object.values(d.diasTienda||{}).reduce((s,v)=>s+Number(v||0),0);
    if(sumaDiasTienda > diasDisponibles){
      setMetaMsg(`Los días por tienda de ${users.find(u=>u.id===asesorId)?.name||"este asesor"} suman ${sumaDiasTienda}, pero solo tiene ${diasDisponibles} días disponibles este mes.`);
      return;
    }
    setGuardandoDetalle(asesorId);
    setMetaMsg("");
    const payload = {
      mes: mesKey, vendedor_id: asesorId,
      mes_completo: d.mesCompleto,
      dias_ingreso: d.mesCompleto ? null : Number(d.diasIngreso||0),
      tipo_novedad: null,
      dias_novedad: novedadesLimpias.reduce((s,n)=>s+n.dias,0),
      novedades: novedadesLimpias,
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
    let total = 0;
    for(const t of tiendasList){
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
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ingresos hoy</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(ingresosHoy)}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ingresos del mes</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(totalSinServicios)}</div>
        </div>
        {!vistaAsesor && (
          <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ingresos con servicios</div>
            <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(totalConServicios)}</div>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:2 }}>+{fmtCOP(totalConServicios-totalSinServicios)} en servicios</div>
          </div>
        )}
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Meta {tiendaSel?"de la tienda":"total"}</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{metaTiendaTotal>0?fmtCOP(metaTiendaTotal):"—"}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <HoverTooltip label="IDC" labelStyle={{ fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", fontWeight:700 }} width={240} align="right">
            <div style={{ fontFamily:font.body, fontSize:11.5, color:C.text, lineHeight:1.4 }}><b>IDC — Índice de Cumplimiento.</b> Qué porcentaje de la meta del mes ya se alcanzó: (ingresos ÷ meta) × 100.</div>
          </HoverTooltip>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:idcTienda===null?C.textMuted:idcTienda>=100?C.green:C.amber, marginTop:6 }}>{idcTienda===null?"—":`${idcTienda}%`}</div>
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
              const d = detalleInputs[a.id] || { mesCompleto:true, diasIngreso:"", novedades:[], diasTienda:{} };
              const abierto = asesorExpandido===a.id;
              const diasNovedadTotal = (d.novedades||[]).reduce((s,n)=>s+Number(n.dias||0),0);
              const diasDisponibles = (d.mesCompleto ? DIAS_META : Number(d.diasIngreso||0)) - diasNovedadTotal;
              const sumaDiasTienda = Object.values(d.diasTienda||{}).reduce((s,v)=>s+Number(v||0),0);
              return (
                <div key={a.id} style={{ border:`1px solid ${abierto?C.gold:C.border}`, borderRadius:7, overflow:"hidden" }}>
                  <button onClick={()=>setAsesorExpandido(abierto?null:a.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"7px 10px", background:"none", border:"none", cursor:"pointer", textAlign:"left" }}>
                    <span style={{ flex:1, fontFamily:font.body, fontSize:12.5, color:C.text, fontWeight:600 }}>{a.name}</span>
                    <span style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{fmtCOP(metaAsesorCalculada(a.id))}</span>
                    <span style={{ color:C.textMuted, fontSize:10 }}>{abierto?"▲":"▼"}</span>
                  </button>
                  {abierto && (
                    <div style={{ padding:"0 10px 10px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, flexWrap:"wrap" }}>
                        <label style={{ display:"flex", alignItems:"center", gap:6, fontFamily:font.body, fontSize:12, color:C.text, cursor:"pointer" }}>
                          <input type="checkbox" checked={!d.mesCompleto} onChange={e=>setDetalleField(a.id,"mesCompleto",!e.target.checked)}/>
                          ¿Ingresa nuevo?
                        </label>
                        {!d.mesCompleto && (
                          <div style={{ width:140 }}><Field value={d.diasIngreso} onChange={v=>setDetalleField(a.id,"diasIngreso",v.replace(/[^\d]/g,""))} placeholder={`días trabajados (de ${DIAS_META})`}/></div>
                        )}
                        <span style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginLeft:"auto" }}>Días disponibles: <b style={{ fontFamily:font.mono, color:diasDisponibles>0?C.text:C.red }}>{diasDisponibles}</b></span>
                      </div>

                      <div style={{ fontSize:10.5, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:4 }}>Novedades (incapacidad / licencia)</div>
                      {(d.novedades||[]).map((n,idx)=>(
                        <div key={idx} style={{ display:"grid", gridTemplateColumns:"1fr 100px auto", gap:8, marginBottom:6 }}>
                          <Field value={n.tipo} onChange={v=>setNovedadAsesorCampo(a.id,idx,"tipo",v)} options={[{value:"incapacidad",label:"Incapacidad"},{value:"licencia",label:"Licencia"}]}/>
                          <Field value={n.dias} onChange={v=>setNovedadAsesorCampo(a.id,idx,"dias",v.replace(/[^\d]/g,""))} placeholder="días"/>
                          <Btn onClick={()=>quitarNovedadAsesor(a.id,idx)} variant="ghost" sm>✕</Btn>
                        </div>
                      ))}
                      <Btn onClick={()=>agregarNovedadAsesor(a.id)} variant="ghost" sm>+ Agregar novedad</Btn>

                      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":`repeat(${Math.min(tiendasList.length||1,4)}, 1fr)`, gap:8, marginTop:10 }}>
                        {tiendasList.map(t=>(
                          <Field key={t.id} label={t.name} value={d.diasTienda?.[t.id]||""} onChange={v=>setDetalleTienda(a.id,t.id,v.replace(/[^\d]/g,""))} placeholder="días"/>
                        ))}
                      </div>
                      {sumaDiasTienda>diasDisponibles && <div style={{ fontFamily:font.body, fontSize:11, color:C.red, marginTop:4 }}>Los días por tienda suman {sumaDiasTienda}, pero solo hay {diasDisponibles} días disponibles.</div>}
                      <div style={{ marginTop:8 }}><Btn onClick={()=>guardarDetalleAsesor(a.id)} disabled={guardandoDetalle===a.id || sumaDiasTienda>diasDisponibles} sm>{guardandoDetalle===a.id?"Guardando...":"Guardar"}</Btn></div>
                    </div>
                  )}
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
              <Badge color={d.idc>=100?C.green:d.idc>=70?C.amber:C.red} sm>{d.idc}%</Badge>
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
              <Badge color={d.idc>=100?C.green:d.idc>=70?C.amber:C.red} sm>{d.idc}%</Badge>
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
                  <td style={{ padding:"7px 8px", textAlign:"left" }}>{d.idc===null?"—":<Badge color={d.idc>=100?C.green:d.idc>=70?C.amber:C.red} sm>{d.idc}%</Badge>}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted, textAlign:"left" }}>{d.mda===null?"—":fmtCOP(d.mda)}</td>
                </tr>
              ))}
              {dataAsesores.length===0 && <tr><td colSpan={5} style={{ padding:16, textAlign:"center", color:C.textMuted }}>No hay asesores activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </SeccionVenta>

      <SeccionVenta icon="📅" titulo={`Ventas por día — ${tiendaSel ? stores[tiendaSel]?.name : "Todas las tiendas"}`}>
        <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
          {diasList.map(([fecha,d])=>(
            <div key={fecha} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:font.body, fontSize:12, color:C.text, padding:"6px 4px", borderBottom:`1px solid ${C.border}` }}>
              <span>{new Date(fecha+"T12:00:00").toLocaleDateString("es-CO",{weekday:"short",day:"numeric",month:"short"})}</span>
              <span style={{ color:C.textMuted }}>{d.count} venta{d.count!==1?"s":""}</span>
              <span style={{ fontFamily:font.mono }}>{fmtCOP(d.sin)} <span style={{ color:C.textMuted }}>/ {fmtCOP(d.con)}</span></span>
            </div>
          ))}
          {diasList.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, textAlign:"center", padding:16 }}>Sin ventas registradas este mes.</div>}
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
const CajaCard = ({ icon, titulo, children }) => (
  <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 14px", marginBottom:10 }}>
    <div style={{ fontFamily:font.body, fontSize:11.5, fontWeight:700, color:C.goldLight, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:8 }}>{icon} {titulo}</div>
    {children}
  </div>
);
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

function VentasCajaScreen({ user, stores, users, ventas, ventasItems, ventasAbonos, ventasAjustes, gastos, setGastos, aperturas, setAperturas, cierres, setCierres, recolecciones, setRecolecciones, solicitudesBorrado, setSolicitudesBorrado, puedeRecoleccion, soloLectura, isMobile }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const tiendasList = tiendasVenta(stores);
  const [tiendaId, setTiendaId] = useState(tiendaFija || tiendasList[0]?.id || "");
  const [cajaVista, setCajaVista] = useState(soloLectura ? "historial" : "registrar"); // 'registrar' | 'historial'
  const asesores = users.filter(u=>u.role==="advisor" && u.active);
  const posiblesRecibe = users.filter(u=>(u.role==="master"||u.role==="admin_finanzas") && u.active);

  // Solo master puede registrar con una fecha distinta a hoy (para poner al día algo atrasado).
  const puedeFechaLibre = user.role==="master";

  const [apAsesorId, setApAsesorId] = useState("");
  const [apBaseCaja, setApBaseCaja] = useState(String(BASE_CAJA_FIJA));
  const [apFecha, setApFecha] = useState(todayStr);
  const [guardandoAp, setGuardandoAp] = useState(false);

  const [gaValor, setGaValor] = useState("");
  const [gaMotivo, setGaMotivo] = useState("");
  const [gaTipo, setGaTipo] = useState("costo");
  const puedeAprobarNovedad = user.role==="master" || user.role==="admin_finanzas";
  const [guardandoGa, setGuardandoGa] = useState(false);

  const [ciAsesorId, setCiAsesorId] = useState("");
  const [ciTipo, setCiTipo] = useState("definitivo");
  const [ciNovedades, setCiNovedades] = useState("");
  const [ciBaseCaja, setCiBaseCaja] = useState(String(BASE_CAJA_FIJA));
  const [ciBaseCajaTocado, setCiBaseCajaTocado] = useState(false);
  const [ciFecha, setCiFecha] = useState(todayStr);
  const [guardandoCi, setGuardandoCi] = useState(false);

  const [reEntregaId, setReEntregaId] = useState("");
  const [reRecibeId, setReRecibeId] = useState("");
  const [reValor, setReValor] = useState("");
  const [reBaseCaja, setReBaseCaja] = useState(String(BASE_CAJA_FIJA));
  const [reComentarios, setReComentarios] = useState("");
  const [reFecha, setReFecha] = useState(todayStr);
  const [guardandoRe, setGuardandoRe] = useState(false);
  const [reValorTocado, setReValorTocado] = useState(false);
  // Caso esporádico: además de lo de días anteriores (siempre incluido), también se retira una
  // parte del efectivo de HOY, con tope de lo acumulado hoy hasta el momento.
  const [reIncluyeHoy, setReIncluyeHoy] = useState(false);
  const [reValorHoy, setReValorHoy] = useState("");

  const [msg, setMsg] = useState("");

  const aperturasTienda = aperturas.filter(a=>a.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  const cierresTienda = cierres.filter(c=>c.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  const recoleccionesTienda = recolecciones.filter(r=>r.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  const ultimaRecoleccion = recoleccionesTienda[0] || null;

  // La base casi siempre es $100.000, pero se puede ajustar — se recuerda el último valor usado.
  useEffect(()=>{
    setApBaseCaja(String(aperturasTienda[0]?.base_caja ?? ultimaRecoleccion?.base_caja ?? BASE_CAJA_FIJA));
    setReBaseCaja(String(ultimaRecoleccion?.base_caja ?? BASE_CAJA_FIJA));
    setReValorTocado(false);
    setReIncluyeHoy(false);
    setReValorHoy("");
    setCiBaseCajaTocado(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiendaId, aperturasTienda[0]?.id, ultimaRecoleccion?.id]);

  // La base al cierre por defecto es la misma con la que se abrió, salvo que el usuario la edite.
  useEffect(()=>{
    if(!ciBaseCajaTocado) setCiBaseCaja(String(apBaseCaja||BASE_CAJA_FIJA));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apBaseCaja, tiendaId]);

  const ventasTiendaMap = {};
  ventas.forEach(v=>{ if(v.tienda_id===tiendaId) ventasTiendaMap[v.id]=v; });

  // Efectivo (ventas + abonos en efectivo) de la tienda en un día calendario dado.
  const efectivoDelDia = (fechaDia) => {
    let total = 0;
    ventasItems.forEach(i=>{
      const v = ventasTiendaMap[i.venta_id];
      if(!v || i.tipo==="flexipago" || v.fecha!==fechaDia) return;
      (i.pagos||[]).forEach(p=>{ if(p.medio_pago==="efectivo") total += Number(p.valor||0); });
    });
    ventasAbonos.forEach(a=>{
      const v = ventasTiendaMap[a.venta_id];
      if(!v || a.fecha!==fechaDia) return;
      if(a.medio_pago==="efectivo") total += Number(a.valor||0);
    });
    return total;
  };

  // ── Efectivo pendiente por recoger ──────────────────────────────────────────
  // Regla general: una recolección SIEMPRE se lleva el efectivo de días ya cerrados (anteriores a
  // hoy) — el de HOY no se recoge por defecto, sigue sumando hasta la siguiente recolección. Solo
  // si se marca "Recoges efectivo de hoy" se retira una parte de hoy, con tope de lo acumulado hoy.
  const fechaCorte = ultimaRecoleccion ? ultimaRecoleccion.fecha : null;
  // Si hubo más de una recolección el mismo día (varios retiros parciales de "hoy" ese día), se
  // suman todos los valor_hoy de ese día para saber cuánto de ese día ya se retiró.
  const retiradoEnFechaCorte = fechaCorte
    ? recoleccionesTienda.filter(r=>r.fecha===fechaCorte).reduce((s,r)=>s+Number(r.valor_hoy||0),0)
    : 0;
  // Efectivo de todos los días después de la fecha de la última recolección (incluye hoy), más el
  // remanente del día de esa recolección (lo que no se llevó ese día si no marcó "hoy", o si marcó
  // solo una parte).
  let efectivoDiasPosteriores = 0;
  ventasItems.forEach(i=>{
    const v = ventasTiendaMap[i.venta_id];
    if(!v || i.tipo==="flexipago") return;
    if(fechaCorte && v.fecha<=fechaCorte) return;
    (i.pagos||[]).forEach(p=>{ if(p.medio_pago==="efectivo") efectivoDiasPosteriores += Number(p.valor||0); });
  });
  ventasAbonos.forEach(a=>{
    const v = ventasTiendaMap[a.venta_id];
    if(!v) return;
    if(fechaCorte && a.fecha<=fechaCorte) return;
    if(a.medio_pago==="efectivo") efectivoDiasPosteriores += Number(a.valor||0);
  });
  const efectivoEnFechaCorte = fechaCorte ? efectivoDelDia(fechaCorte) : 0;
  const efectivoPendienteTotal = Math.max(0, efectivoDiasPosteriores + efectivoEnFechaCorte - retiradoEnFechaCorte);

  // Efectivo de HOY que sigue pendiente — es el tope para el retiro esporádico de "efectivo de hoy".
  const retiradoHoyYa = recoleccionesTienda.filter(r=>r.fecha===todayStr).reduce((s,r)=>s+Number(r.valor_hoy||0),0);
  const efectivoHoyPendiente = Math.max(0, efectivoDelDia(todayStr) - retiradoHoyYa);
  // Efectivo de días anteriores a hoy que sigue pendiente — esto es lo que SIEMPRE se sugiere
  // recoger (la "regla general"), sin importar si hoy se marca el retiro esporádico o no.
  const efectivoAnteriores = Math.max(0, efectivoPendienteTotal - efectivoHoyPendiente);

  // Gastos de caja (novedades con valor, ej. comprar un limpiavidrios) desde la última recolección —
  // se pagan con la base, así que se restan de lo que hay para recolectar.
  const desdeTS = ultimaRecoleccion ? new Date(ultimaRecoleccion.created_at).getTime() : 0;
  const gastosTienda = gastos.filter(g=>g.tienda_id===tiendaId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
  // Una novedad de tipo "costo" resta (se pagó algo con la base) y una de tipo "ingreso" suma
  // (por ejemplo, vueltas que un cliente no reclamó). Las novedades viejas sin tipo se tratan como costo.
  const gastosDesdeRecoleccion = gastosTienda.filter(g=> new Date(g.created_at).getTime() > desdeTS);
  const gastosNetoAcumulado = gastosDesdeRecoleccion.reduce((s,g)=> (g.tipo==="ingreso" ? s+Number(g.valor||0) : s-Number(g.valor||0)), 0);
  const costosAcumulados = gastosDesdeRecoleccion.filter(g=>g.tipo!=="ingreso").reduce((s,g)=>s+Number(g.valor||0),0);
  const ingresosAcumulados = gastosDesdeRecoleccion.filter(g=>g.tipo==="ingreso").reduce((s,g)=>s+Number(g.valor||0),0);

  // Lo que se sugiere recoger por defecto: siempre los días anteriores a hoy + novedades. El
  // efectivo de hoy (si se marca el check) se suma aparte, no entra en este cálculo automático.
  const efectivoARecolectar = Math.max(0, efectivoAnteriores + gastosNetoAcumulado);
  const totalEnCajaAhora = Number(apBaseCaja||0) + efectivoPendienteTotal + gastosNetoAcumulado;

  useEffect(()=>{
    if(!reValorTocado) setReValor(String(efectivoARecolectar||""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [efectivoARecolectar, tiendaId]);

  // Resumen de ventas del día para el Cierre: ingreso neto, servicios, y flexipagos del día (informativo)
  const resumenDia = (fecha) => {
    const ventasTienda = Object.values(ventasTiendaMap);
    const idsFecha = new Set(ventasTienda.filter(v=>v.fecha===fecha).map(v=>v.id));
    const ingresoNeto = cajaZeros();
    const servicios = cajaZeros();
    const flexipagoDia = cajaZeros();
    let flexipagoCerradoHoy = 0;

    ventasItems.forEach(i=>{
      if(!idsFecha.has(i.venta_id)) return;
      if(i.tipo==="producto"){
        (i.pagos||[]).forEach(p=>{ if(CAJA_MEDIOS.includes(p.medio_pago)) ingresoNeto[p.medio_pago]+=Number(p.valor||0); });
      } else if(i.tipo==="arreglo"||i.tipo==="marcacion"||i.tipo==="grabado"){
        (i.pagos||[]).forEach(p=>{ if(CAJA_MEDIOS.includes(p.medio_pago)) servicios[p.medio_pago]+=Number(p.valor||0); });
      }
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
        if(completaHoy && CAJA_MEDIOS.includes(ab.medio_pago)){
          // Este es el abono que cierra el flexipago: su valor TOTAL ya entra al ingreso neto de
          // hoy (agrupado según el medio de ESE abono). No se muestra también en "Flexipagos de
          // ese día" — mostrarlo ahí además del ingreso neto hacía parecer que esa plata no
          // contaba, cuando en realidad es justo la que cerró la venta.
          ingresoNeto[ab.medio_pago] += valorTotal;
          flexipagoCerradoHoy += valorTotal;
        } else if(ab.fecha===fecha && CAJA_MEDIOS.includes(ab.medio_pago)){
          // Abono de hoy que NO cierra el flexipago: es plata que entró pero la venta todavía no
          // se reconoce como completa, así que se muestra aparte y no suma al ingreso neto.
          flexipagoDia[ab.medio_pago] += Number(ab.valor||0);
        }
      });
    });

    return { ingresoNeto, servicios, flexipagoDia, flexipagoCerradoHoy, totalIngresoNeto:cajaTotal(ingresoNeto), totalServicios:cajaTotal(servicios), totalFlexipagoDia:cajaTotal(flexipagoDia) };
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
    if(apFecha!==todayStr && !puedeFechaLibre){ setMsg("Solo el master puede registrar una apertura con fecha distinta a hoy. Pide autorización."); return; }
    setGuardandoAp(true); setMsg("");
    const asesor = users.find(u=>u.id===apAsesorId);
    const { data, error } = await supabase.from("ventas_caja_aperturas").insert({
      tienda_id:tiendaId, fecha:apFecha, asesor_id:apAsesorId, asesor_nombre:asesor?.name||"",
      base_caja:Number(apBaseCaja||0), novedades:null, registrado_por:user.name,
    }).select().single();
    setGuardandoAp(false);
    if(data){ setAperturas(prev=>[data,...prev]); }
    else if(error){ setMsg(`No se pudo guardar la apertura: ${error.message||"error desconocido"}`); }
  };

  const guardarGasto = async () => {
    if(!tiendaId || !gaValor || !gaMotivo.trim()){ setMsg("Falta el valor y el motivo del gasto."); return; }
    setGuardandoGa(true); setMsg("");
    // La novedad afecta el cálculo de recolección de inmediato, pero queda "pendiente" hasta que
    // master/admin_finanzas la revise y apruebe — son movimientos de dinero, así que quedan a la vista.
    const { data, error } = await supabase.from("ventas_caja_gastos").insert({
      tienda_id:tiendaId, fecha:apFecha, valor:Number(gaValor||0), motivo:gaMotivo.trim(), tipo:gaTipo, estado:"pendiente", registrado_por:user.name,
    }).select().single();
    setGuardandoGa(false);
    if(data){ setGastos(prev=>[data,...prev]); setGaValor(""); setGaMotivo(""); }
    else if(error){ setMsg(`No se pudo guardar la novedad: ${error.message||"error desconocido"}`); }
  };

  const aprobarGasto = async (g) => {
    const { data, error } = await supabase.from("ventas_caja_gastos").update({ estado:"aprobado", aprobado_por:user.name, aprobado_at:new Date().toISOString() }).eq("id", g.id).select().single();
    if(data){ setGastos(prev=>prev.map(x=>x.id===data.id?data:x)); }
    else if(error){ setMsg(`No se pudo aprobar: ${error.message||"error desconocido"}`); }
  };

  const guardarCierre = async () => {
    if(!tiendaId || !ciAsesorId){
      const falt = []; if(!tiendaId) falt.push("la tienda"); if(!ciAsesorId) falt.push("quién cierra");
      setMsg(`Falta elegir ${listarFaltantes(falt)}.`); return;
    }
    if(ciFecha!==todayStr && !puedeFechaLibre){ setMsg("Solo el master puede registrar un cierre con fecha distinta a hoy. Pide autorización."); return; }
    setGuardandoCi(true); setMsg("");
    const asesor = users.find(u=>u.id===ciAsesorId);
    const { data, error } = await supabase.from("ventas_caja_cierres").insert({
      tienda_id:tiendaId, fecha:ciFecha, tipo:ciTipo, asesor_id:ciAsesorId, asesor_nombre:asesor?.name||"",
      base_caja:Number(ciBaseCaja||0), novedades:ciNovedades.trim()||null, registrado_por:user.name,
    }).select().single();
    setGuardandoCi(false);
    if(data){ setCierres(prev=>[data,...prev]); setCiNovedades(""); setCiBaseCajaTocado(false); }
    else if(error){ setMsg(`No se pudo guardar el cierre: ${error.message||"error desconocido"}`); }
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
    if(reFecha!==todayStr && !puedeFechaLibre){ setMsg("Solo el master puede registrar una recolección con fecha distinta a hoy. Pide autorización."); return; }
    const valorHoyNum = reIncluyeHoy ? Number(reValorHoy||0) : 0;
    if(reIncluyeHoy && valorHoyNum<=0){ setMsg("Marcaste que recoges efectivo de hoy — falta el valor a retirar."); return; }
    if(reIncluyeHoy && valorHoyNum>efectivoHoyPendiente){ setMsg(`No puedes retirar más de lo acumulado hoy (${fmtCOP(efectivoHoyPendiente)}).`); return; }
    setGuardandoRe(true); setMsg("");
    const entrega = users.find(u=>u.id===reEntregaId);
    const recibe = users.find(u=>u.id===reRecibeId);
    const { data, error } = await supabase.from("ventas_caja_recolecciones").insert({
      tienda_id:tiendaId, fecha:reFecha, entrega_usuario_id:reEntregaId, entrega_nombre:entrega?.name||"",
      recibe_usuario_id:reRecibeId, recibe_nombre:recibe?.name||"", valor:Number(reValor||0)+valorHoyNum,
      valor_hoy:valorHoyNum, incluye_hoy:reIncluyeHoy,
      base_caja:Number(reBaseCaja||0), comentarios:reComentarios.trim()||null, registrado_por:user.name,
    }).select().single();
    setGuardandoRe(false);
    if(data){ setRecolecciones(prev=>[data,...prev]); setReValor(""); setReComentarios(""); setReIncluyeHoy(false); setReValorHoy(""); }
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

      {cajaVista==="registrar" && !soloLectura ? (
        <>
          <CajaCard icon="🔓" titulo="Apertura de turno">
            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1.3fr 1fr auto", gap:8, alignItems:"end" }}>
              <CajaField label="Fecha" type="date" value={apFecha} onChange={setApFecha}/>
              <CajaField label="Quién abre *" value={apAsesorId} onChange={setApAsesorId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
              <CajaMoney label="Base de caja" value={apBaseCaja} onChange={setApBaseCaja}/>
              <CajaBtn onClick={guardarApertura} disabled={guardandoAp || !tiendaId || !apAsesorId}>{guardandoAp?"...":"Registrar"}</CajaBtn>
            </div>
            {apFecha!==todayStr && <div style={{ fontFamily:font.body, fontSize:10.5, color:puedeFechaLibre?C.amber:C.red, marginTop:4 }}>{puedeFechaLibre?"Vas a registrar con una fecha distinta a hoy.":"Solo el master puede registrar con una fecha distinta a hoy — pide autorización."}</div>}

            <div style={{ fontFamily:font.body, fontSize:11.5, color:C.text, padding:"6px 0", marginTop:8, borderTop:`1px solid ${C.border}`, display:"flex", flexWrap:"wrap", rowGap:2, columnGap:14 }}>
              <span><span style={{ color:C.textMuted }}>Última recolección: </span>{ultimaRecoleccion ? `${fmtFechaHora(ultimaRecoleccion.created_at)} · ${ultimaRecoleccion.recibe_nombre||"—"}` : "sin registro previo"}</span>
              <span><span style={{ color:C.textMuted }}>Efectivo por recoger (sin base): </span><b style={{ fontFamily:font.mono }}>{fmtCOP(efectivoPendienteTotal)}</b>{efectivoHoyPendiente>0 && <span style={{ color:C.textMuted }}> (de hoy: {fmtCOP(efectivoHoyPendiente)})</span>}</span>
              {costosAcumulados>0 && <span><span style={{ color:C.textMuted }}>Costos: </span><b style={{ fontFamily:font.mono, color:C.red }}>−{fmtCOP(costosAcumulados)}</b></span>}
              {ingresosAcumulados>0 && <span><span style={{ color:C.textMuted }}>Ingresos: </span><b style={{ fontFamily:font.mono, color:C.green }}>+{fmtCOP(ingresosAcumulados)}</b></span>}
              <span><span style={{ color:C.textMuted }}>Total efectivo con base: </span><b style={{ fontFamily:font.mono, color:C.goldLight }}>{fmtCOP(totalEnCajaAhora)}</b></span>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 2fr auto", gap:8, alignItems:"end", marginTop:6 }}>
              <CajaMoney label="Novedad — valor" value={gaValor} onChange={setGaValor}/>
              <CajaField label="Tipo" value={gaTipo} onChange={setGaTipo} options={[{value:"costo",label:"Costo (resta)"},{value:"ingreso",label:"Ingreso (suma)"}]}/>
              <CajaField label="Motivo" placeholder="Ej: se usó para un limpiavidrios / vueltas no reclamadas" value={gaMotivo} onChange={setGaMotivo}/>
              <CajaBtn onClick={guardarGasto} disabled={guardandoGa}>{guardandoGa?"...":"Agregar"}</CajaBtn>
            </div>
            {gastosTienda.length>0 && (
              <div style={{ marginTop:6, display:"flex", flexDirection:"column", gap:2 }}>
                {gastosTienda.slice(0,4).map(g=>(
                  <div key={g.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontFamily:font.body, fontSize:11, color:C.textMuted, gap:6 }}>
                    <span>{fmtFechaHora(g.created_at)} · {g.motivo}{g.estado!=="aprobado" && <span style={{ color:C.amber }}> · pendiente</span>}</span>
                    <span style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <span style={{ fontFamily:font.mono, color:g.tipo==="ingreso"?C.green:C.red }}>{g.tipo==="ingreso"?"+":"−"}{fmtCOP(g.valor)}</span>
                      {puedeAprobarNovedad && g.estado!=="aprobado" && <button onClick={()=>aprobarGasto(g)} title="Aprobar esta novedad" style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:5, color:C.green, cursor:"pointer", fontSize:10, padding:"2px 6px" }}>Aprobar</button>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CajaCard>

          <CajaCard icon="🔒" titulo="Cierre de turno">
            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"200px 1fr", gap:8, alignItems:"end", marginBottom:8 }}>
              <CajaField label="Fecha" type="date" value={ciFecha} onChange={setCiFecha}/>
              {ciFecha!==todayStr && <div style={{ fontFamily:font.body, fontSize:10.5, color:puedeFechaLibre?C.amber:C.red }}>{puedeFechaLibre?"Vas a registrar con una fecha distinta a hoy.":"Solo el master puede registrar con una fecha distinta a hoy — pide autorización."}</div>}
            </div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:420 }}>
                <thead>
                  <tr style={{ fontFamily:font.body, fontSize:9.5, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.04em" }}>
                    <td style={{ padding:"2px 6px" }}></td>
                    {CAJA_MEDIOS.map(m=><td key={m} style={{ padding:"2px 6px", textAlign:"right" }}>{CAJA_MEDIO_LABEL[m]}</td>)}
                    <td style={{ padding:"2px 6px", textAlign:"right" }}>Total</td>
                  </tr>
                </thead>
                <tbody style={{ fontFamily:font.mono, fontSize:11.5, color:C.text }}>
                  <tr>
                    <td style={{ padding:"2px 6px", fontFamily:font.body }}>Ventas (productos + flexipagos cerrados ese día)</td>
                    {CAJA_MEDIOS.map(m=><td key={m} style={{ padding:"2px 6px", textAlign:"right" }}>{fmtCOP(resumenHoy.ingresoNeto[m])}</td>)}
                    <td style={{ padding:"2px 6px", textAlign:"right", fontWeight:700, color:C.goldLight }}>{fmtCOP(resumenHoy.totalIngresoNeto)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding:"2px 6px", fontFamily:font.body }}>Servicios (arreglo, marcación, grabado)</td>
                    {CAJA_MEDIOS.map(m=><td key={m} style={{ padding:"2px 6px", textAlign:"right" }}>{fmtCOP(resumenHoy.servicios[m])}</td>)}
                    <td style={{ padding:"2px 6px", textAlign:"right", fontWeight:700 }}>{fmtCOP(resumenHoy.totalServicios)}</td>
                  </tr>
                  <tr style={{ borderTop:`1px solid ${C.border}` }}>
                    <td style={{ padding:"3px 6px", fontFamily:font.body, fontWeight:700, color:C.text }}>Total (Ventas + Servicios)</td>
                    {CAJA_MEDIOS.map(m=><td key={m} style={{ padding:"3px 6px", textAlign:"right", fontWeight:700 }}>{fmtCOP(resumenHoy.ingresoNeto[m]+resumenHoy.servicios[m])}</td>)}
                    <td style={{ padding:"3px 6px", textAlign:"right", fontWeight:700, color:C.goldLight }}>{fmtCOP(resumenHoy.totalIngresoNeto+resumenHoy.totalServicios)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding:"2px 6px", fontFamily:font.body, color:C.textMuted }}>Flexipagos abonados hoy que siguen pendientes (no suma al total)</td>
                    {CAJA_MEDIOS.map(m=><td key={m} style={{ padding:"2px 6px", textAlign:"right", color:C.textMuted }}>{fmtCOP(resumenHoy.flexipagoDia[m])}</td>)}
                    <td style={{ padding:"2px 6px", textAlign:"right", color:C.textMuted }}>{fmtCOP(resumenHoy.totalFlexipagoDia)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {resumenHoy.flexipagoCerradoHoy>0 && <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginTop:3 }}>Incluye {fmtCOP(resumenHoy.flexipagoCerradoHoy)} de flexipagos que se terminaron de pagar hoy.</div>}

            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr 1.2fr auto", gap:8, alignItems:"end", marginTop:8 }}>
              <CajaField label="Quién cierra *" value={ciAsesorId} onChange={setCiAsesorId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
              <CajaField label="Tipo" value={ciTipo} onChange={setCiTipo} options={[{value:"parcial",label:"Parcial"},{value:"definitivo",label:"Definitivo"}]}/>
              <CajaMoney label="Base de caja al cierre" value={ciBaseCaja} onChange={(v)=>{ setCiBaseCaja(v); setCiBaseCajaTocado(true); }}/>
              <CajaField label="Novedades" value={ciNovedades} onChange={setCiNovedades} placeholder="Nota corta (opcional)"/>
              <CajaBtn onClick={guardarCierre} disabled={guardandoCi || !tiendaId || !ciAsesorId}>{guardandoCi?"...":"Registrar"}</CajaBtn>
            </div>
          </CajaCard>

          <CajaCard icon="🚚" titulo="Recolección de efectivo">
            {!puedeRecoleccion ? (
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>No tienes permiso para registrar una recolección. Puedes verlas en Historial.</div>
            ) : (
              <>
                <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted, marginBottom:6 }}>Sugerido (días anteriores a hoy): {fmtCOP(efectivoAnteriores)} ventas en efectivo {gastosNetoAcumulado>=0?"+":"−"} {fmtCOP(Math.abs(gastosNetoAcumulado))} novedades = {fmtCOP(efectivoARecolectar)}. Ajusta si al contar sale distinto. El efectivo de hoy no se incluye aquí — si necesitas recogerlo, usa el check de abajo.</div>
                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr 1fr 1fr 1fr", gap:8, alignItems:"end" }}>
                  <CajaField label="Fecha" type="date" value={reFecha} onChange={setReFecha}/>
                  <CajaField label="Entrega *" value={reEntregaId} onChange={setReEntregaId} options={[{value:"",label:"Selecciona..."}, ...asesores.map(a=>({value:a.id,label:a.name}))]}/>
                  <CajaField label="Recibe *" value={reRecibeId} onChange={setReRecibeId} options={[{value:"",label:"Selecciona..."}, ...posiblesRecibe.map(u=>({value:u.id,label:u.name}))]}/>
                  <CajaMoney label="Valor a recoger (días anteriores)" value={reValor} onChange={v=>{ setReValor(v); setReValorTocado(true); }}/>
                  <CajaMoney label="Base que queda" value={reBaseCaja} onChange={setReBaseCaja}/>
                </div>
                {reFecha!==todayStr && <div style={{ fontFamily:font.body, fontSize:10.5, color:puedeFechaLibre?C.amber:C.red, marginTop:4 }}>{puedeFechaLibre?"Vas a registrar con una fecha distinta a hoy.":"Solo el master puede registrar con una fecha distinta a hoy — pide autorización."}</div>}
                {reFecha===todayStr && (
                  <div style={{ marginTop:8, padding:"8px 10px", background:C.surfaceAlt, borderRadius:7, border:`1px solid ${C.border}` }}>
                    <label style={{ display:"flex", alignItems:"center", gap:7, fontFamily:font.body, fontSize:12, color:C.text, cursor:"pointer" }}>
                      <input type="checkbox" checked={reIncluyeHoy} onChange={e=>{ setReIncluyeHoy(e.target.checked); if(!e.target.checked) setReValorHoy(""); }} disabled={efectivoHoyPendiente<=0}/>
                      Recoges efectivo de hoy
                      {efectivoHoyPendiente<=0 && <span style={{ color:C.textMuted }}> (aún no hay efectivo de hoy)</span>}
                    </label>
                    {reIncluyeHoy && (
                      <div style={{ marginTop:6, display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr auto", gap:8, alignItems:"end" }}>
                        <CajaMoney label={`Valor a retirar de hoy (máx. ${fmtCOP(efectivoHoyPendiente)})`} value={reValorHoy} onChange={setReValorHoy}/>
                        <div style={{ fontFamily:font.body, fontSize:10.5, color:C.textMuted }}>Acumulado hoy: {fmtCOP(efectivoHoyPendiente)}</div>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"2fr auto", gap:8, alignItems:"end", marginTop:8 }}>
                  <CajaField label="Comentarios" value={reComentarios} onChange={setReComentarios} placeholder="Opcional"/>
                  <CajaBtn onClick={guardarRecoleccion} disabled={guardandoRe || !tiendaId || !reEntregaId || !reRecibeId || !reValor}>{guardandoRe?"...":"Registrar"}</CajaBtn>
                </div>
              </>
            )}
          </CajaCard>
        </>
      ) : (
        <>
          {puedeBorrarCaja && solicitudesPendientes.length>0 && (
            <CajaCard icon="🗑️" titulo="Solicitudes de borrado pendientes">
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

          <CajaCard icon="🔓" titulo="Historial de apertura">
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

          <CajaCard icon="🔒" titulo="Historial de cierre">
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
                    </div>
                  </div>
                );
              })}
              {cierresTienda.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, padding:4 }}>Sin registros todavía.</div>}
            </div>
          </CajaCard>

          <CajaCard icon="🚚" titulo="Historial de recolección">
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
        </>
      )}
    </div>
  );
}

// ── APP SHELL ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null),[area,setArea]=useState(null),[tab,setTab]=useState(null),[records,setRecords]=useState([]),[users,setUsers]=useState([]),[stores,setStores]=useState({}),[booting,setBooting]=useState(true),[refreshing,setRefreshing]=useState(false);
  const [juntaLideres,setJuntaLideres]=useState([]),[juntaCompromisos,setJuntaCompromisos]=useState([]),[juntaAcuerdos,setJuntaAcuerdos]=useState([]);
  const [juntaAreas,setJuntaAreas]=useState([]),[juntaLiderAreas,setJuntaLiderAreas]=useState([]);
  const [ventas,setVentas]=useState([]),[ventasItems,setVentasItems]=useState([]),[ventasMetas,setVentasMetas]=useState([]),[ventasMetasAsesor,setVentasMetasAsesor]=useState([]);
  const [ventasAbonos,setVentasAbonos]=useState([]),[cajaAperturas,setCajaAperturas]=useState([]),[cajaCierres,setCajaCierres]=useState([]),[cajaRecolecciones,setCajaRecolecciones]=useState([]),[cajaGastos,setCajaGastos]=useState([]);
  const [cajaSolicitudesBorrado,setCajaSolicitudesBorrado]=useState([]);
  const [ventasAjustes,setVentasAjustes]=useState([]);
  const [mostrarCambiarPassword,setMostrarCambiarPassword]=useState(false);
  const [mostrarUsuarios,setMostrarUsuarios]=useState(false);
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

  const loadAll=async()=>{
    const[{data:t},{data:u},{data:r},{data:jl},{data:jc},{data:ja},{data:jar},{data:jla},{data:v},{data:vi},{data:vm},{data:vma},{data:vab},{data:ca},{data:cc},{data:cr},{data:cg},{data:vaj},{data:csb}]=await Promise.all([
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
  };

  useEffect(()=>{ loadAll().then(()=>setBooting(false)); },[]);

  const login=(u)=>{setUser(u);setArea(null);setTab(esCuentaTienda(u)?"registrar":puedeUsarAreas(u)?null:"checkin");};
  const logout=()=>{setUser(null);setArea(null);setTab(null);};
  const chooseArea=(a)=>{setArea(a);setTab(a==="junta"?"seguimiento":a==="ventas"?(ventasSoloLectura(user)?"lista":"registrar"):"dashboard");};
  const backToAreas=()=>{setArea(null);setTab(null);};
  const addRecord=(r)=>setRecords(prev=>[r,...prev]);
  const refreshAll=async()=>{ setRefreshing(true); await loadAll(); setRefreshing(false); };
  const refreshUserRecords=(newRecs)=>{ setRecords(prev=>{ const otros=prev.filter(r=>!(r.user_id===user?.id&&r.date===todayStr)); return [...newRecs,...otros]; }); };

  // Cuenta de tienda: es el equipo que queda abierto en el mostrador todo el turno, así que se le
  // da más margen (30 min) antes de cerrar sesión por inactividad. El resto de cuentas sigue en 5.
  useInactivityLogout(logout, esCuentaTienda(user||{}) ? 30 : 5);

  if(booting) return <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,color:C.textMuted,fontSize:14}}>Cargando...</div>;
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
        if(tab==="registrar" && !ventasSoloLectura(user)) return <VentasRegistrarScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} metas={ventasMetas} esAdmin={esAdminDeVentas(user)} isMobile={isMobile}/>;
        if(tab==="lista")     return <VentasListaScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} ajustes={ventasAjustes} setAjustes={setVentasAjustes} esAdmin={esAdminDeVentas(user)} soloLectura={ventasSoloLectura(user)}/>;
        if(tab==="metricas")  return <VentasMetricasScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} metas={ventasMetas} setMetas={setVentasMetas} metasAsesor={ventasMetasAsesor} setMetasAsesor={setVentasMetasAsesor} esAdmin={esAdminDeVentas(user)} puedeAsignarMetas={puedeAsignarMetas(user)} isMobile={isMobile}/>;
        if(tab==="caja")      return <VentasCajaScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} gastos={cajaGastos} setGastos={setCajaGastos} aperturas={cajaAperturas} setAperturas={setCajaAperturas} cierres={cajaCierres} setCierres={setCajaCierres} recolecciones={cajaRecolecciones} setRecolecciones={setCajaRecolecciones} solicitudesBorrado={cajaSolicitudesBorrado} setSolicitudesBorrado={setCajaSolicitudesBorrado} puedeRecoleccion={puedeHacerRecoleccion(user)} soloLectura={ventasSoloLectura(user)} isMobile={isMobile}/>;
      } else {
        if(tab==="dashboard") return <DashboardScreen records={records} stores={stores} isMobile={isMobile}/>;
        if(tab==="records")   return <RecordsScreen records={records} stores={stores} users={users} isMobile={isMobile}/>;
        if(tab==="users")     return <UsersScreen users={users} setUsers={setUsers}/>;
        if(tab==="stores")    return <StoresScreen stores={stores} setStores={setStores}/>;
        if(tab==="reports")   return <ReportsScreen records={records} users={users} stores={stores} isMobile={isMobile}/>;
      }
    } else if(esCuentaTienda(user)){
      if(tab==="registrar") return <VentasRegistrarScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} metas={ventasMetas} esAdmin={false} isMobile={isMobile}/>;
      if(tab==="lista")     return <VentasListaScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} ajustes={ventasAjustes} setAjustes={setVentasAjustes} esAdmin={false} soloLectura={false}/>;
      if(tab==="metricas")  return <VentasMetricasScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} metas={ventasMetas} setMetas={setVentasMetas} metasAsesor={ventasMetasAsesor} setMetasAsesor={setVentasMetasAsesor} esAdmin={false} puedeAsignarMetas={puedeAsignarMetas(user)} isMobile={isMobile}/>;
      if(tab==="caja")      return <VentasCajaScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} ventasAbonos={ventasAbonos} ventasAjustes={ventasAjustes} gastos={cajaGastos} setGastos={setCajaGastos} aperturas={cajaAperturas} setAperturas={setCajaAperturas} cierres={cajaCierres} setCierres={setCajaCierres} recolecciones={cajaRecolecciones} setRecolecciones={setCajaRecolecciones} solicitudesBorrado={cajaSolicitudesBorrado} setSolicitudesBorrado={setCajaSolicitudesBorrado} puedeRecoleccion={puedeHacerRecoleccion(user)} soloLectura={false} isMobile={isMobile}/>;
    } else {
      if(tab==="checkin")  return <CheckInScreen user={user} records={records} onRecord={addRecord} onRefresh={refreshUserRecords} stores={stores}/>;
      if(tab==="history")  return <HistoryScreen user={user} records={records} stores={stores}/>;
      if(tab==="schedule") return <ScheduleScreen/>;
    }
    return null;
  };

  const soloLectura = user.role==="visualizador";

  const modalCambiarPassword = mostrarCambiarPassword && (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:1000}}>
      <CambiarPasswordForm user={user} onUpdated={(u)=>{setUser(u);setMostrarCambiarPassword(false);}} onCancel={()=>setMostrarCambiarPassword(false)}/>
    </div>
  );

  const modalUsuarios = mostrarUsuarios && (
    <div style={{position:"fixed",inset:0,background:C.dark,zIndex:1000,overflowY:"auto",padding:isMobile?16:"32px 36px"}}>
      <div style={{maxWidth:900,margin:"0 auto"}}>
        <Btn onClick={()=>setMostrarUsuarios(false)} variant="ghost" sm style={{marginBottom:14}}>← Volver</Btn>
        <UsuariosScreen users={users} setUsers={setUsers} stores={stores}/>
      </div>
    </div>
  );

  if(isMobile) return (
    <ReadOnlyContext.Provider value={soloLectura}>
      <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.dark,overflow:"hidden"}}>
        <MobileHeader user={user} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onChangeArea={backToAreas} onCambiarPassword={()=>setMostrarCambiarPassword(true)} onAbrirUsuarios={()=>setMostrarUsuarios(true)}/>
        <main style={{flex:1,overflowY:"auto",padding:16}}>{renderScreen()}</main>
        <BottomNav tab={tab} setTab={setTab} user={user} area={area}/>
        {modalCambiarPassword}
        {modalUsuarios}
      </div>
    </ReadOnlyContext.Provider>
  );

  return (
    <ReadOnlyContext.Provider value={soloLectura}>
      <div style={{display:"flex",height:"100vh",background:C.dark,fontFamily:font.body,overflow:"hidden"}}>
        <Sidebar tab={tab} setTab={setTab} user={user} area={area} onChangeArea={backToAreas} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onCambiarPassword={()=>setMostrarCambiarPassword(true)} onAbrirUsuarios={()=>setMostrarUsuarios(true)}/>
        <main style={{flex:1,overflowY:"auto",padding:"32px 36px"}}>{renderScreen()}</main>
        {modalCambiarPassword}
        {modalUsuarios}
      </div>
    </ReadOnlyContext.Provider>
  );
}