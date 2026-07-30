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

// ── Puntualidad ───────────────────────────────────────────────────────────────
// Fecha de corte: desde este día (inclusive) rigen los turnos nuevos.
// Los registros con fecha anterior siguen evaluándose con el horario viejo,
// congelado para siempre, sin importar qué cambie el código más adelante.
const CUTOVER_DATE = "2026-07-15";

// Horarios de entrada esperados en minutos desde medianoche: [Lunes-Jueves, Viernes-Sábado]
// Vigentes hasta el 14 de julio de 2026 (inclusive)
const SHIFT_HOURS_OLD = {
  T1:  [600, 600],   // 10:00am todos los días (excepto Chipichape, ver abajo)
  T2:  [730, 760],   // 12:10pm L-J / 12:40pm V-S
  T3:  [630, 630],   // 10:30am todos los días
  T4:  [690, 690],   // 11:30am todos los días
  TOF: [540, 540],   // 9:00am todos los días (oficina)
};
// Vigentes desde el 15 de julio de 2026
const SHIFT_HOURS_NEW = {
  T1:  [600, 600],   // 10:00am todos los días (excepto Chipichape, ver abajo)
  T2:  [750, 780],   // 12:30pm L-J / 1:00pm V-S
  T3:  [630, 630],   // 10:30am todos los días
  T4:  [690, 690],   // 11:30am todos los días
  TOF: [540, 540],   // 9:00am todos los días (oficina)
};
// Excepción: Chipichape T1 entra a las 9:00am en vez de 10:00am (igual en ambos periodos)
const CHIPICHAPE_T1_ENTRY = 540;

const getExpectedEntry = (shift, date, store) => {
  if (!shift) return null;
  const SHIFT_HOURS = date >= CUTOVER_DATE ? SHIFT_HOURS_NEW : SHIFT_HOURS_OLD;
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
// Arranca el 21 de julio de 2026 (primer martes del protocolo).
const JUNTA_ROTATION_EPOCH = "2026-07-21";
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
const Badge = ({ color, children, sm }) => (
  <span style={{ display:"inline-flex", alignItems:"center", padding: sm?"2px 8px":"3px 10px", borderRadius:99, fontSize:sm?10:11, fontWeight:600, background:`${color}20`, color, border:`1px solid ${color}40`, fontFamily:font.body, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap" }}>{children}</span>
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
const ADMIN_TABS_ASISTENCIA_MASTER = ADMIN_TABS_ASISTENCIA.map(t => t.id==="users" ? { id:"usuarios", icon:"🗝️", label:"Usuarios" } : t);
const ADMIN_TABS_JUNTA      = [{ id:"seguimiento",icon:"✅",label:"Seguimiento semanal" },{ id:"acuerdos",icon:"🔒",label:"Acuerdos y decisiones" },{ id:"equipo",icon:"👥",label:"Perfiles y áreas" },{ id:"guion",icon:"📖",label:"Rol de Monitor" },{ id:"indicadores",icon:"📊",label:"Indicadores" }];
const ADVISOR_TABS          = [{ id:"checkin",icon:"📍",label:"Marcar Asistencia" },{ id:"history",icon:"📋",label:"Mi Historial" },{ id:"schedule",icon:"📅",label:"Malla Horaria" }];
const ADMIN_TABS_VENTAS     = [{ id:"registrar",icon:"🧾",label:"Registrar venta" },{ id:"lista",icon:"📋",label:"Lista de ventas" },{ id:"metricas",icon:"📊",label:"Métricas" }];
const puedeUsarAreas = (user) => user.role==="admin" || user.role==="master" || user.role==="visualizador" || user.role==="admin_turnos";
// Quién puede elegir el área "Ventas" desde el selector (no todos los que puedeUsarAreas)
const puedeUsarVentasArea = (user) => user.role==="master" || user.role==="admin_turnos";
// Cuentas de tienda: login compartido, van directo a Ventas sin selector de área
const esCuentaTienda = (user) => user.role==="tienda";
// Admin Finanzas: rol angosto solo para Ventas (métricas y metas), sin Junta/Asistencia ni notas crédito. Va directo a Ventas, como las cuentas de tienda.
const esAdminFinanzas = (user) => user.role==="admin_finanzas";
// Quién puede aprobar/rechazar notas crédito dentro de Ventas
const esAdminDeVentas = (user) => user.role==="master" || user.role==="admin_turnos";
// Quién puede asignar las metas mensuales en Métricas
const puedeAsignarMetas = (user) => user.role==="master" || user.role==="admin_turnos" || user.role==="admin_finanzas";
// Qué pestañas le corresponden a cada quien, según su rol y el área elegida
const tabsPara = (user, area) => !puedeUsarAreas(user)
  ? ((esCuentaTienda(user) || esAdminFinanzas(user)) ? ADMIN_TABS_VENTAS : ADVISOR_TABS)
  : (area==="junta" ? ADMIN_TABS_JUNTA : area==="ventas" ? ADMIN_TABS_VENTAS : (user.role==="master" ? ADMIN_TABS_ASISTENCIA_MASTER : ADMIN_TABS_ASISTENCIA));

// ── Vencimiento de contraseña ────────────────────────────────────────────────
const DIAS_EXPIRACION_PASSWORD = 90;
const passwordVencida = (u) => {
  if (!u.password_updated_at) return true;
  const dias = (Date.now() - new Date(u.password_updated_at).getTime()) / 86400000;
  return dias >= DIAS_EXPIRACION_PASSWORD;
};

function Sidebar({ tab, setTab, user, area, onChangeArea, onLogout, onRefresh, refreshing, onCambiarPassword }) {
  const tabs = tabsPara(user, area);
  return (
    <div style={{ width:220, flexShrink:0, background:C.sidebar, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"18px 16px", borderBottom:`1px solid ${C.border}` }}>
        <img src="/logo-icon.png" alt="OZEN" style={{ width:44, height:44, borderRadius:"50%" }} />
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
            <div style={{ fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600 }}>{user.name.split(" ")[0]}</div>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>{ROLE_LABEL[user.role] || "Asesor"}</div>
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

function MobileHeader({ user, onLogout, onRefresh, refreshing, onChangeArea, onCambiarPassword }) {
  return (
    <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${C.border}`, background:C.sidebar, flexShrink:0 }}>
      <img src="/logo-icon.png" alt="OZEN" style={{ width:34, height:34, borderRadius:"50%" }} />
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {puedeUsarAreas(user) && <button onClick={onChangeArea} title="Cambiar de área" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔀</button>}
        {user.role!=="master" && <button onClick={onCambiarPassword} title="Mi contraseña" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔑</button>}
        <button onClick={onRefresh} disabled={refreshing} style={{ background:"none", border:"none", cursor:refreshing?"not-allowed":"pointer", fontSize:18, opacity:refreshing?0.4:1 }}>🔄</button>
        <div style={{ fontFamily:font.body, fontSize:12, color:C.text }}>{user.name.split(" ")[0]}</div>
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
const ROLE_LABEL = { master:"Master", admin:"Administrador", admin_turnos:"Admin Turnos", admin_finanzas:"Admin Finanzas", visualizador:"Visualizador", advisor:"Asesor", tienda:"Cuenta de tienda" };
const ROLE_COLOR = { master:C.red, admin:C.gold, admin_turnos:C.green, admin_finanzas:C.blue, visualizador:C.amber, advisor:C.blue, tienda:C.textMuted };
function UsuariosScreen({ users, setUsers }) {
  const [showForm,setShowForm]=useState(false),[form,setForm]=useState({name:"",documento:"",role:"advisor"}),[editing,setEditing]=useState(null),[editVal,setEditVal]=useState({}),[cambiandoPass,setCambiandoPass]=useState(null),[nuevaPass,setNuevaPass]=useState(""),[loading,setLoading]=useState(false);
  const [passVisible,setPassVisible]=useState({});
  const [sincronizando,setSincronizando]=useState(false);
  const traerFrescos=async()=>{ setSincronizando(true); const{data}=await supabase.from("usuarios").select("*"); if(data)setUsers(data); setSincronizando(false); };
  // Cada vez que se entra a esta pestaña, trae los datos más recientes de la base de
  // datos — así si alguien cambió su propia contraseña desde otra sesión, aparece
  // aquí sin que master tenga que adivinar o darle refrescar manualmente.
  useEffect(()=>{ traerFrescos(); },[]);
  const ordenados=[...users].sort((a,b)=>(a.role==="master"?0:a.role==="admin"?1:2)-(b.role==="master"?0:b.role==="admin"?1:2) || a.name.localeCompare(b.name));
  const roleOptions=[{value:"advisor",label:"Asesor"},{value:"admin",label:"Administrador"},{value:"admin_turnos",label:"Admin Turnos"},{value:"admin_finanzas",label:"Admin Finanzas"},{value:"visualizador",label:"Visualizador"},{value:"master",label:"Master"}];
  const add=async()=>{ if(!form.name.trim()||!form.documento.trim())return; setLoading(true); const{data,error}=await supabase.from("usuarios").insert({name:form.name.trim(),documento:form.documento.trim(),password:form.documento.trim(),role:form.role,active:true}).select().single(); if(!error&&data){setUsers(prev=>[...prev,data]);setForm({name:"",documento:"",role:"advisor"});setShowForm(false);} setLoading(false); };
  const toggle=async(u)=>{ const{data}=await supabase.from("usuarios").update({active:!u.active}).eq("id",u.id).select().single(); if(data)setUsers(prev=>prev.map(x=>x.id===u.id?data:x)); };
  const saveEdit=async(id)=>{ if(!editVal.name.trim()||!editVal.documento.trim())return; const{data}=await supabase.from("usuarios").update({name:editVal.name.trim(),documento:editVal.documento.trim(),role:editVal.role}).eq("id",id).select().single(); if(data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setEditing(null);} };
  const deleteUsuario=async(id)=>{
    const { count } = await supabase.from("registros").select("id", { count: "exact", head: true }).eq("user_id", id);
    if (count > 0) { alert(`Este usuario tiene ${count} registro(s) de asistencia. Eliminarlo borraría ese historial para siempre. Usa el botón "✕" para desactivarlo en su lugar.`); return; }
    if (!window.confirm("Este usuario no tiene registros de asistencia. ¿Eliminarlo de todas formas? Esto no se puede deshacer.")) return;
    await supabase.from("usuarios").delete().eq("id",id); setUsers(prev=>prev.filter(u=>u.id!==id));
  };
  const guardarPassword=async(id)=>{ if(!nuevaPass.trim())return; const{data,error}=await supabase.from("usuarios").update({password:nuevaPass.trim(),password_updated_at:new Date().toISOString()}).eq("id",id).select().single(); if(!error&&data){setUsers(prev=>prev.map(u=>u.id===id?data:u));setCambiandoPass(null);setNuevaPass("");alert("Contraseña actualizada.");} };
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
          <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginBottom:12}}>💡 La contraseña inicial será el número de documento.</div>
          <Btn onClick={add} disabled={loading} full>{loading?"Guardando...":"Crear usuario"}</Btn>
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
                <Badge color={ROLE_COLOR[u.role]||C.textMuted} sm>{ROLE_LABEL[u.role]||u.role}</Badge>
                <Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <Btn onClick={()=>{setEditing(u.id);setEditVal({name:u.name,documento:u.documento,role:u.role});}} variant="ghost" sm>✏</Btn>
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
function JuntaSeguimientoScreen({ lideres, compromisos, setCompromisos }) {
  const soloLectura = useReadOnly();
  const [semana, setSemana] = useState(martesDeSemana(todayStr));
  const [showNueva, setShowNueva] = useState(false);
  const [nueva, setNueva] = useState({ descripcion:"", lider_id:"", fecha_estimada:"", comentarios:"" });

  const tareas = compromisos.filter(c=>c.semana===semana);
  const nombreLider = (id) => lideres.find(l=>l.id===id)?.nombre || "— sin asignar";
  const monitor = getMonitorActual(lideres);

  const crear = async () => {
    if (!nueva.descripcion.trim()) return;
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
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:2 }}>Monitor de turno · rota cada mes</div>
            <div style={{ fontFamily:font.body, fontSize:17, fontWeight:700, color:C.goldLight }}>{monitor ? (monitor.nombre || "— sin nombre") : "— sin líderes configurados"}</div>
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Semana del martes</div>
          <input type="date" value={semana} onChange={e=>setSemana(martesDeSemana(e.target.value))} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}/>
          <Btn onClick={()=>setSemana(martesDeSemana(todayStr))} variant="ghost" sm>Esta semana</Btn>
          {!soloLectura && <Btn onClick={()=>setShowNueva(true)} sm style={{ marginLeft:"auto" }}>+ Nueva tarea</Btn>}
        </div>
        <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:8 }}>💡 Si la reunión se hace otro día de esa semana (miércoles, jueves...), igual selecciona esa fecha — la app la archiva sola bajo el martes correcto, aunque ese martes sea de otro mes.</div>
      </Card>

      {!soloLectura && showNueva && (
        <Card glow style={{ marginBottom:16 }}>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.goldLight, marginBottom:14 }}>Nueva tarea</div>
          <Field label="Tarea" value={nueva.descripcion} onChange={v=>setNueva(p=>({...p,descripcion:v}))} placeholder="¿Qué hay que hacer?"/>
          <Field label="Quién la hace" value={nueva.lider_id} onChange={v=>setNueva(p=>({...p,lider_id:v}))} options={[{value:"",label:"Selecciona"},...lideres.map(l=>({value:l.id,label:l.nombre||"(sin nombre)"}))]}/>
          <Field label="¿Cuándo cree que la termina?" type="date" value={nueva.fecha_estimada} onChange={v=>setNueva(p=>({...p,fecha_estimada:v}))}/>
          <Field label="Comentarios / avance" value={nueva.comentarios} onChange={v=>setNueva(p=>({...p,comentarios:v}))} placeholder="Opcional"/>
          <div style={{ display:"flex", gap:8 }}><Btn onClick={crear} full>Guardar</Btn><Btn onClick={()=>setShowNueva(false)} variant="ghost" full>Cancelar</Btn></div>
        </Card>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {tareas.map(t=>(
          <Card key={t.id} p="14px" style={{ opacity:t.completado?0.6:1 }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
              <button onClick={soloLectura?undefined:()=>actualizar(t.id,{completado:!t.completado})} disabled={soloLectura} style={{ width:22, height:22, borderRadius:6, border:`2px solid ${t.completado?C.green:C.border}`, background:t.completado?C.green:"transparent", cursor:soloLectura?"default":"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13, marginTop:2 }}>{t.completado?"✓":""}</button>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, textDecoration:t.completado?"line-through":"none" }}>{t.descripcion}</div>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>👤 {nombreLider(t.lider_id)}</div>
                  {t.fecha_estimada && <div style={{ fontFamily:font.mono, fontSize:11, color:C.amber }}>📅 {t.fecha_estimada}</div>}
                </div>
                <input placeholder="Comentarios / avance..." defaultValue={t.comentarios||""} disabled={soloLectura} onBlur={e=>{ if(e.target.value!==t.comentarios) actualizar(t.id,{comentarios:e.target.value}); }} style={{ width:"100%", marginTop:8, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"6px 8px", color:C.text, fontSize:11, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
              </div>
              {!soloLectura && <Btn onClick={()=>eliminar(t.id)} variant="ghost" sm>🗑</Btn>}
            </div>
          </Card>
        ))}
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
              <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Cumplimiento de tareas</div>
              <div style={{ fontFamily:font.mono, fontSize:24, fontWeight:700, color:statsActual.pct===null?C.textMuted:statsActual.pct>=70?C.green:C.amber }}>{statsActual.pct===null?"—":`${statsActual.pct}%`}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:3 }}>{statsActual.completadas} de {statsActual.totalTareas} tareas completadas</div>
            </div>
          </div>
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

  const handle=async(e)=>{ if(e)e.preventDefault(); if(!documento.trim()||!pass){setErr("Completa todos los campos.");return;} setLoading(true);setErr(""); const{data}=await supabase.from("usuarios").select("*").eq("documento",documento.trim()).eq("password",pass).eq("active",true).single(); if(data)onLogin(data); else setErr("Documento o contraseña incorrecta, o cuenta inactiva."); setLoading(false); };
  return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <style>{`
        @keyframes ozenNoAutofill { from {} to {} }
        input.ozen-anti-autofill:-webkit-autofill { animation-name: ozenNoAutofill; }
      `}</style>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <img src="/logo.png" alt="OZEN" style={{width:140,height:"auto",marginBottom:12}}/>
          <div style={{fontFamily:font.body,fontSize:12,color:C.textMuted,letterSpacing:"0.2em"}}>CONTROL DE PERSONAL</div>
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
          <img src="/logo.png" alt="OZEN" style={{ width:120, height:"auto", marginBottom:10 }} />
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
                  <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:2 }}>Registro de ventas, metas y métricas por tienda</div>
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
const VENTAS_MEDIOS_PAGO = [
  { value:"efectivo", label:"Efectivo" },
  { value:"tarjeta", label:"Tarjeta (débito/crédito)" },
  { value:"transferencia", label:"Transferencia" },
  { value:"addi", label:"ADDI" },
  { value:"flexipago", label:"Flexipago (plan separe)" },
];
const VENTAS_MEDIOS_TARJETA = ["tarjeta"];
// Medios que sí ingresan dinero de verdad (todos menos Flexipago, que es un plan a crédito)
const VENTAS_MEDIOS_REALES = VENTAS_MEDIOS_PAGO.filter(m=>m.value!=="flexipago");

const VENTAS_TIPOS = [
  { value:"producto", label:"Venta" },
  { value:"arreglo", label:"Arreglo" },
  { value:"marcacion", label:"Marcación" },
  { value:"grabado", label:"Grabado" },
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

function VentasRegistrarScreen({ user, stores, users, ventas, setVentas, isMobile }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const [tiendaId, setTiendaId] = useState(tiendaFija || Object.keys(stores)[0] || "");
  const [fecha, setFecha] = useState(todayStr);
  const [vendedorId, setVendedorId] = useState("");
  const [items, setItems] = useState([]); // [{tipo, valor, descuento, medio_pago, numero_autorizacion}]
  const [itemTipo, setItemTipo] = useState("producto");
  const [itemValor, setItemValor] = useState("");
  const [itemDescuento, setItemDescuento] = useState("");
  const [itemDescuentoTipo, setItemDescuentoTipo] = useState("valor");
  const [itemMedio, setItemMedio] = useState("efectivo");
  const [itemAutorizacion, setItemAutorizacion] = useState("");
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

  const itemMedioEsTarjeta = VENTAS_MEDIOS_TARJETA.includes(itemMedio);
  const agregarItem = () => {
    if(!itemValor || Number(itemValor)<=0) return;
    if(itemMedioEsTarjeta && !itemAutorizacion.trim()) return;
    const valor = Number(itemValor);
    const descInput = Number(itemDescuento||0);
    const descuento = itemDescuentoTipo==="porcentaje" ? Math.round(valor*descInput/100) : descInput;
    setItems(prev=>[...prev, { tipo:itemTipo, valor, descuento, medio_pago:itemMedio, numero_autorizacion:itemMedioEsTarjeta?itemAutorizacion.trim():null }]);
    setItemValor(""); setItemDescuento(""); setItemDescuentoTipo("valor"); setItemAutorizacion("");
  };
  const quitarItem = (idx) => setItems(prev=>prev.filter((_,i)=>i!==idx));

  const valorBruto = items.reduce((a,i)=>a+i.valor,0);
  const descuentoNum = items.reduce((a,i)=>a+i.descuento,0);
  const total = valorBruto - descuentoNum;
  const esFlexipago = items.some(i=>i.medio_pago==="flexipago");
  const valorFlexipago = items.filter(i=>i.medio_pago==="flexipago").reduce((a,i)=>a+(i.valor-i.descuento),0);
  const saldoPendiente = esFlexipago ? valorFlexipago - Number(abonoInicialValor||0) : 0;

  const limpiarTodo = () => {
    setVendedorId(""); setItems([]); setItemTipo("producto"); setItemValor(""); setItemDescuento(""); setItemDescuentoTipo("valor"); setItemMedio("efectivo"); setItemAutorizacion(""); setObservacion("");
    setAbonoInicialValor(""); setAbonoInicialMedio("efectivo");
    setClienteTipoDoc("CC"); setClienteDocumento(""); setClienteNombre(""); setClienteTelefono(""); setClienteEncontrado(false);
  };

  const guardar = async () => {
    setMsg("");
    if(!tiendaId){ setMsg("Falta elegir la tienda."); return; }
    if(!vendedorId){ setMsg("Falta elegir quién hizo la venta."); return; }
    if(items.length===0 || valorBruto<=0){ setMsg("Agrega al menos una venta o servicio."); return; }
    if(esFlexipago){
      if(!clienteDocumento.trim() || !clienteNombre.trim()){ setMsg("Flexipago necesita los datos del cliente para poder contactarlo."); return; }
      if(Number(abonoInicialValor||0)>0 && !abonoInicialMedio){ setMsg("Falta el medio de pago del abono inicial."); return; }
    }
    setGuardando(true);
    const vendedor = users.find(u=>u.id===vendedorId);
    const { data:venta, error } = await supabase.from("ventas").insert({
      fecha, tienda_id:tiendaId, vendedor_id:vendedorId, vendedor_nombre:vendedor?.name||"",
      registrado_por:user.name,
      cliente_tipo_doc:esFlexipago?clienteTipoDoc:null, cliente_documento:esFlexipago?clienteDocumento.trim():null,
      cliente_nombre:esFlexipago?clienteNombre.trim():null, cliente_telefono:esFlexipago?clienteTelefono.trim():null,
      observacion:observacion.trim(), valor_bruto:valorBruto, descuento_total:descuentoNum, total, es_flexipago:esFlexipago,
    }).select().single();
    if(error || !venta){ setGuardando(false); setMsg("No se pudo guardar. Intenta de nuevo."); return; }
    const filasItems = items.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valor, descuento:i.descuento, medio_pago:i.medio_pago, numero_autorizacion:i.numero_autorizacion }));
    const { error:errorItems } = await supabase.from("ventas_items").insert(filasItems);
    if(errorItems){ setGuardando(false); setMsg("La venta se guardó, pero hubo un problema guardando las ventas/servicios."); return; }
    if(esFlexipago && Number(abonoInicialValor||0) > 0){
      await supabase.from("ventas_abonos").insert({ venta_id:venta.id, fecha, valor:Number(abonoInicialValor), registrado_por:user.name, medio_pago:abonoInicialMedio });
    }
    setGuardando(false);
    setVentas(prev=>[venta, ...prev]);
    const numeroMsg = venta.numero_factura ? ` #${String(venta.numero_factura).padStart(4,"0")}` : "";
    limpiarTodo();
    setMsg(`✓ Venta${numeroMsg} registrada`);
    setTimeout(()=>setMsg(""), 3000);
  };

  const ventasHoy = ventas.filter(v=>v.fecha===fecha && v.tienda_id===tiendaId);

  return (
    <div>
      <PageHeader title="Registrar venta" subtitle={stores[tiendaId]?.name ? `Tienda: ${stores[tiendaId].name}` : "Elige la tienda"} />
      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 380px", gap:16, alignItems:"start" }}>
        <div>
          <SeccionVenta icon="🏬" titulo="Información general" subtitulo="Datos básicos de la venta">
            <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:12 }}>
              {!tiendaFija ? (
                <Field label="Tienda" value={tiendaId} onChange={setTiendaId} options={Object.values(stores).map(s=>({value:s.id,label:s.name}))}/>
              ) : (
                <div>
                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>Tienda</div>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, padding:"9px 0" }}>{stores[tiendaId]?.name || "—"}</div>
                </div>
              )}
              <Field label="Fecha" type="date" value={fecha} onChange={setFecha}/>
            </div>
            <Field label="¿Quién hizo la venta?" value={vendedorId} onChange={setVendedorId} options={[{value:"",label:"Selecciona un asesor"},...asesores.map(a=>({value:a.id,label:a.name}))]}/>
          </SeccionVenta>

          <SeccionVenta icon="🛍️" titulo="Ventas y servicios" subtitulo="Cada uno con su valor, descuento (si aplica) y medio de pago">
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
              {items.map((it,idx)=>(
                <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", flexWrap:"wrap" }}>
                  <Badge color={it.tipo==="producto"?C.green:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===it.tipo)?.label}</Badge>
                  <Badge color={it.medio_pago==="flexipago"?C.amber:C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===it.medio_pago)?.label}</Badge>
                  {it.numero_autorizacion && <span style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted }}>AUT #{it.numero_autorizacion}</span>}
                  <div style={{ flex:1, fontFamily:font.mono, fontSize:12, color:C.text, textAlign:"right" }}>${it.valor.toLocaleString("es-CO")}{it.descuento>0 && ` (desc $${it.descuento.toLocaleString("es-CO")})`}</div>
                  <button onClick={()=>quitarItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                </div>
              ))}
              {items.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Todavía no has agregado nada.</div>}
            </div>

            <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"12px" }}>
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr", gap:10, marginBottom:10 }}>
                <Field label="Tipo" value={itemTipo} onChange={setItemTipo} options={VENTAS_TIPOS}/>
                <Field label="Medio de pago" value={itemMedio} onChange={setItemMedio} options={VENTAS_MEDIOS_PAGO}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr", gap:10, marginBottom:10 }}>
                <Field label="Valor" type="number" value={itemValor} onChange={setItemValor} placeholder="0"/>
                <div>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                    <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Descuento</div>
                    <div style={{ display:"flex", gap:4 }}>
                      {VENTAS_DESCUENTO_TIPOS.map(dt=>(
                        <button key={dt.value} type="button" onClick={()=>setItemDescuentoTipo(dt.value)} style={{ width:22, height:20, borderRadius:5, border:`1px solid ${itemDescuentoTipo===dt.value?C.gold:C.border}`, background:itemDescuentoTipo===dt.value?`${C.gold}22`:"transparent", color:itemDescuentoTipo===dt.value?C.goldLight:C.textMuted, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{dt.label}</button>
                      ))}
                    </div>
                  </div>
                  <Field value={itemDescuento} type="number" onChange={setItemDescuento} placeholder="0"/>
                </div>
              </div>
              {itemMedioEsTarjeta && <Field label="N.º autorización" value={itemAutorizacion} onChange={setItemAutorizacion} placeholder="Ej: 056495"/>}
              {itemMedio==="flexipago" && (
                <div style={{ background:C.amberDim, border:`1px solid ${C.amber}44`, borderRadius:8, padding:"10px 12px", fontFamily:font.body, fontSize:11, color:C.amber, marginBottom:10 }}>
                  📦 Flexipago es un plan separe: el saldo que no se pague hoy queda pendiente. El abono inicial se registra abajo, y los próximos abonos se agregan luego desde "Lista de ventas".
                </div>
              )}
              <Btn onClick={agregarItem} sm full>+ Agregar</Btn>
            </div>
          </SeccionVenta>

          {esFlexipago && (
            <SeccionVenta icon="🧾" titulo="Cliente" subtitulo="Obligatorio en Flexipago, para poder contactarlo">
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1.3fr", gap:12 }}>
                <Field label="Tipo de documento" value={clienteTipoDoc} onChange={setClienteTipoDoc} options={VENTAS_TIPOS_DOC}/>
                <div>
                  <Field label="N.º de documento" value={clienteDocumento} onChange={setClienteDocumento} placeholder="Número de documento"/>
                  {buscandoCliente && <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:-10, marginBottom:10 }}>Buscando...</div>}
                  {clienteEncontrado && <div style={{ fontFamily:font.body, fontSize:10, color:C.green, marginTop:-10, marginBottom:10 }}>✓ Cliente encontrado, datos autocompletados</div>}
                </div>
              </div>
              <Field label="Nombre" value={clienteNombre} onChange={setClienteNombre} placeholder="Nombre completo"/>
              <Field label="Teléfono" value={clienteTelefono} onChange={setClienteTelefono} placeholder="Para poder contactarlo"/>
              <Divider/>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"10px 0 8px" }}>Abono inicial de Flexipago (opcional)</div>
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"1fr 1fr", gap:10 }}>
                <Field label="Valor del abono" type="number" value={abonoInicialValor} onChange={setAbonoInicialValor} placeholder="0"/>
                <Field label="Medio del abono" value={abonoInicialMedio} onChange={setAbonoInicialMedio} options={VENTAS_MEDIOS_REALES}/>
              </div>
            </SeccionVenta>
          )}

          <SeccionVenta icon="📝" titulo="Notas (opcional)" subtitulo="Agrega alguna observación adicional">
            <Field value={observacion} onChange={setObservacion} placeholder="Escribe una nota o comentario..." multiline rows={3}/>
          </SeccionVenta>
        </div>

        <div style={{ position:isMobile?"static":"sticky", top:16 }}>
          <Card glow style={{ marginBottom:16, padding:0, overflow:"hidden" }}>
            <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontFamily:font.body, fontSize:13, fontWeight:700, color:C.goldLight }}>🧾 Venta actual</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:2 }}>{esFlexipago && clienteNombre ? clienteNombre : "—"}{stores[tiendaId]?.name ? ` · ${stores[tiendaId].name}` : ""}</div>
            </div>

            <div style={{ padding:"14px 16px" }}>
              {items.length>0 && (
                <>
                  <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Ventas y servicios</div>
                  {items.map((it,idx)=>(
                    <div key={idx} style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:4 }}>
                      <span>{VENTAS_TIPOS.find(t=>t.value===it.tipo)?.label} · {VENTAS_MEDIOS_PAGO.find(m=>m.value===it.medio_pago)?.label}</span><span style={{fontFamily:font.mono}}>${it.valor.toLocaleString("es-CO")}</span>
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
                  {Object.entries(items.reduce((acc,it)=>{ const neto=it.valor-it.descuento; acc[it.medio_pago]=(acc[it.medio_pago]||0)+neto; return acc; },{})).map(([medio,v])=>(
                    <div key={medio} style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:4 }}>
                      <span>{VENTAS_MEDIOS_PAGO.find(m=>m.value===medio)?.label}</span><span style={{fontFamily:font.mono}}>${v.toLocaleString("es-CO")}</span>
                    </div>
                  ))}
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
                  {v.numero_factura?`#${String(v.numero_factura).padStart(4,"0")} · `:""}{v.vendedor_nombre}
                </div>
                <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{v.cliente_nombre ? `Cliente: ${v.cliente_nombre}` : "Sin cliente registrado"}</div>
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

function VentasListaScreen({ user, stores, users, ventas, setVentas, esAdmin }) {
  const tiendaFija = esCuentaTienda(user) ? user.tienda_id : null;
  const [filtroTienda, setFiltroTienda] = useState("");
  const [filtroFecha, setFiltroFecha] = useState("");
  const [filtroVendedor, setFiltroVendedor] = useState("");
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
  const [editItemMedio, setEditItemMedio] = useState("efectivo");
  const [editItemAutorizacion, setEditItemAutorizacion] = useState("");
  const [editObservacion, setEditObservacion] = useState("");

  const [abonoForm, setAbonoForm] = useState(null);
  const [abonoValor, setAbonoValor] = useState("");
  const [abonoMedio, setAbonoMedio] = useState("efectivo");
  const [guardando, setGuardando] = useState(false);

  const asesores = users.filter(u=>u.role==="advisor");

  const ventasFiltradas = ventas
    .filter(v => (!tiendaFija || v.tienda_id===tiendaFija))
    .filter(v => (!filtroTienda || v.tienda_id===filtroTienda))
    .filter(v => (!filtroFecha || v.fecha===filtroFecha))
    .filter(v => (!filtroVendedor || v.vendedor_id===filtroVendedor))
    .sort((a,b)=> (b.numero_factura||0)-(a.numero_factura||0));

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

  const editItemMedioEsTarjeta = VENTAS_MEDIOS_TARJETA.includes(editItemMedio);
  const iniciarEdicion = (venta) => {
    setEditando(venta.id);
    setEditItems((detalle[venta.id]?.items||[]).map(i=>({...i})));
    setEditObservacion(venta.observacion||"");
  };
  const agregarEditItem = () => {
    if(!editItemValor || Number(editItemValor)<=0) return;
    if(editItemMedioEsTarjeta && !editItemAutorizacion.trim()) return;
    const valor = Number(editItemValor);
    const descInput = Number(editItemDescuento||0);
    const descuento = editItemDescuentoTipo==="porcentaje" ? Math.round(valor*descInput/100) : descInput;
    setEditItems(prev=>[...prev, { tipo:editItemTipo, valor, descuento, medio_pago:editItemMedio, numero_autorizacion:editItemMedioEsTarjeta?editItemAutorizacion.trim():null }]);
    setEditItemValor(""); setEditItemDescuento(""); setEditItemDescuentoTipo("valor"); setEditItemAutorizacion("");
  };
  const quitarEditItem = (idx) => setEditItems(prev=>prev.filter((_,i)=>i!==idx));

  const guardarEdicion = async (venta) => {
    if(editItems.length===0) return;
    setGuardando(true);
    const bruto = editItems.reduce((a,i)=>a+i.valor,0);
    const desc = editItems.reduce((a,i)=>a+i.descuento,0);
    const total = bruto - desc;
    const esFlexipagoEdit = editItems.some(i=>i.medio_pago==="flexipago");
    const { data:ventaAct } = await supabase.from("ventas").update({ observacion:editObservacion.trim(), valor_bruto:bruto, descuento_total:desc, total, es_flexipago:esFlexipagoEdit, updated_at:new Date().toISOString() }).eq("id",venta.id).select().single();
    await supabase.from("ventas_items").delete().eq("venta_id",venta.id);
    const filasItems = editItems.map(i=>({ venta_id:venta.id, tipo:i.tipo, valor:i.valor, descuento:i.descuento, medio_pago:i.medio_pago, numero_autorizacion:i.numero_autorizacion||null }));
    const { data:itemsNuevos } = await supabase.from("ventas_items").insert(filasItems).select();
    const aprobadasSinAplicar = (detalle[venta.id]?.solicitudes||[]).filter(s=>s.estado==="aprobada" && !s.aplicada_at);
    for(const s of aprobadasSinAplicar){
      await supabase.from("ventas_solicitudes_correccion").update({ aplicada_at:new Date().toISOString() }).eq("id",s.id);
    }
    setGuardando(false);
    if(ventaAct){
      setVentas(prev=>prev.map(v=>v.id===venta.id?ventaAct:v));
      setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], items:itemsNuevos||[], solicitudes:(prev[venta.id]?.solicitudes||[]).map(s=>aprobadasSinAplicar.find(a=>a.id===s.id)?{...s,aplicada_at:new Date().toISOString()}:s) }}));
    }
    setEditando(null);
  };

  const agregarAbono = async (venta) => {
    if(!abonoValor || Number(abonoValor)<=0) return;
    const { data } = await supabase.from("ventas_abonos").insert({ venta_id:venta.id, fecha:todayStr, valor:Number(abonoValor), registrado_por:user.name, medio_pago:abonoMedio }).select().single();
    if(data){
      setDetalle(prev=>({...prev, [venta.id]:{...prev[venta.id], abonos:[...(prev[venta.id]?.abonos||[]), data]}}));
      setAbonoForm(null); setAbonoValor(""); setAbonoMedio("efectivo");
    }
  };

  return (
    <div>
      <PageHeader title="Lista de ventas" subtitle={`${ventasFiltradas.length} ventas`} />
      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"end" }}>
          {!tiendaFija && (
            <div style={{ minWidth:160 }}><Field label="Tienda" value={filtroTienda} onChange={setFiltroTienda} options={[{value:"",label:"Todas"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]}/></div>
          )}
          <div style={{ minWidth:160 }}><Field label="Vendedor" value={filtroVendedor} onChange={setFiltroVendedor} options={[{value:"",label:"Todos"},...asesores.map(a=>({value:a.id,label:a.name}))]}/></div>
          <div style={{ minWidth:150 }}><Field label="Fecha" type="date" value={filtroFecha} onChange={setFiltroFecha}/></div>
          {(filtroTienda||filtroFecha||filtroVendedor) && <Btn onClick={()=>{setFiltroTienda("");setFiltroFecha("");setFiltroVendedor("");}} variant="ghost" sm>Limpiar filtros</Btn>}
        </div>
      </Card>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {ventasFiltradas.map(v=>{
          const d = detalle[v.id];
          const abiertoEdicion = editando===v.id;
          const puedeEditar = (d?.solicitudes||[]).some(s=>s.estado==="aprobada" && !s.aplicada_at);
          const totalAbonado = (d?.abonos||[]).reduce((a,x)=>a+Number(x.valor),0);
          const valorFlexipago = (d?.items||[]).filter(i=>i.medio_pago==="flexipago").reduce((a,i)=>a+(Number(i.valor)-Number(i.descuento||0)),0);
          const saldoPendiente = valorFlexipago - totalAbonado;
          return (
            <Card key={v.id} p="0" style={{ overflow:"hidden" }}>
              <button onClick={()=>toggleExpand(v.id)} style={{ width:"100%", background:"none", border:"none", cursor:"pointer", padding:"12px 14px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", textAlign:"left" }}>
                <Badge color={C.gold} sm>#{String(v.numero_factura||0).padStart(4,"0")}</Badge>
                <div style={{ flex:1, minWidth:120 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600 }}>{v.vendedor_nombre}</div>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{v.fecha} · {stores[v.tienda_id]?.name||v.tienda_id}{v.cliente_nombre?` · ${v.cliente_nombre}`:""}</div>
                </div>
                {v.es_flexipago && <Badge color={C.amber} sm>Flexipago</Badge>}
                <div style={{ fontFamily:font.mono, fontSize:15, fontWeight:700, color:C.goldLight }}>${Number(v.total).toLocaleString("es-CO")}</div>
                <span style={{ color:C.textMuted, fontSize:12 }}>{expandido===v.id?"▲":"▼"}</span>
              </button>

              {expandido===v.id && (
                <div style={{ padding:"0 14px 16px", borderTop:`1px solid ${C.border}` }}>
                  {d?.cargando ? (
                    <div style={{ padding:16, color:C.textMuted, fontFamily:font.body, fontSize:12 }}>Cargando...</div>
                  ) : (
                    <>
                      <div style={{ display:"flex", gap:16, flexWrap:"wrap", margin:"12px 0 6px", fontFamily:font.body, fontSize:12, color:C.textMuted }}>
                        <span>Valor bruto: <span style={{color:C.text,fontFamily:font.mono}}>${Number(v.valor_bruto).toLocaleString("es-CO")}</span></span>
                        {Number(v.descuento_total)>0 && <span>Descuento: <span style={{color:C.text,fontFamily:font.mono}}>${Number(v.descuento_total).toLocaleString("es-CO")}</span></span>}
                      </div>

                      <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"12px 0 6px" }}>Ventas y servicios</div>
                      {!abiertoEdicion ? (
                        <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:10 }}>
                          {(d?.items||[]).map(i=>(
                            <div key={i.id} style={{ display:"flex", alignItems:"center", gap:8, fontFamily:font.body, fontSize:12, color:C.text, flexWrap:"wrap" }}>
                              <Badge color={i.tipo==="producto"?C.green:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                              <Badge color={i.medio_pago==="flexipago"?C.amber:C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===i.medio_pago)?.label}</Badge>
                              {i.numero_autorizacion && <span style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted }}>AUT #{i.numero_autorizacion}</span>}
                              <span style={{ fontFamily:font.mono }}>${Number(i.valor).toLocaleString("es-CO")}{Number(i.descuento)>0 && ` (desc $${Number(i.descuento).toLocaleString("es-CO")})`}</span>
                            </div>
                          ))}
                          {(d?.items||[]).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin ventas/servicios registrados.</div>}
                        </div>
                      ) : (
                        <div style={{ marginBottom:10 }}>
                          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
                            {editItems.map((i,idx)=>(
                              <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", flexWrap:"wrap" }}>
                                <Badge color={i.tipo==="producto"?C.green:C.amber} sm>{VENTAS_TIPOS.find(t=>t.value===i.tipo)?.label}</Badge>
                                <Badge color={i.medio_pago==="flexipago"?C.amber:C.gold} sm>{VENTAS_MEDIOS_PAGO.find(m=>m.value===i.medio_pago)?.label}</Badge>
                                {i.numero_autorizacion && <span style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted }}>AUT #{i.numero_autorizacion}</span>}
                                <div style={{ flex:1, fontFamily:font.mono, fontSize:12, color:C.text, textAlign:"right" }}>${Number(i.valor).toLocaleString("es-CO")}{Number(i.descuento)>0 && ` (desc $${Number(i.descuento).toLocaleString("es-CO")})`}</div>
                                <button onClick={()=>quitarEditItem(idx)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer" }}>✕</button>
                              </div>
                            ))}
                          </div>
                          <div style={{ border:`1px solid ${C.border}`, borderRadius:8, padding:"12px", marginBottom:10 }}>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                              <Field label="Tipo" value={editItemTipo} onChange={setEditItemTipo} options={VENTAS_TIPOS}/>
                              <Field label="Medio de pago" value={editItemMedio} onChange={setEditItemMedio} options={VENTAS_MEDIOS_PAGO}/>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                              <Field label="Valor" type="number" value={editItemValor} onChange={setEditItemValor} placeholder="0"/>
                              <div>
                                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
                                  <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, textTransform:"uppercase", letterSpacing:"0.07em" }}>Descuento</div>
                                  <div style={{ display:"flex", gap:4 }}>
                                    {VENTAS_DESCUENTO_TIPOS.map(dt=>(
                                      <button key={dt.value} type="button" onClick={()=>setEditItemDescuentoTipo(dt.value)} style={{ width:22, height:20, borderRadius:5, border:`1px solid ${editItemDescuentoTipo===dt.value?C.gold:C.border}`, background:editItemDescuentoTipo===dt.value?`${C.gold}22`:"transparent", color:editItemDescuentoTipo===dt.value?C.goldLight:C.textMuted, fontSize:11, fontFamily:font.body, cursor:"pointer" }}>{dt.label}</button>
                                    ))}
                                  </div>
                                </div>
                                <Field value={editItemDescuento} type="number" onChange={setEditItemDescuento} placeholder="0"/>
                              </div>
                            </div>
                            {editItemMedioEsTarjeta && <Field label="N.º autorización" value={editItemAutorizacion} onChange={setEditItemAutorizacion} placeholder="Ej: 056495"/>}
                            <Btn onClick={agregarEditItem} sm full>+ Agregar</Btn>
                          </div>
                          <Field label="Observación" value={editObservacion} onChange={setEditObservacion} multiline rows={2}/>
                          <div style={{ display:"flex", gap:8 }}>
                            <Btn onClick={()=>guardarEdicion(v)} disabled={guardando} sm>{guardando?"Guardando...":"Guardar corrección"}</Btn>
                            <Btn onClick={()=>setEditando(null)} variant="ghost" sm>Cancelar</Btn>
                          </div>
                        </div>
                      )}

                      {v.es_flexipago && (
                        <>
                          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"14px 0 6px" }}>Abonos (plan separe)</div>
                          <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:8 }}>
                            {(d?.abonos||[]).map(a=>(
                              <div key={a.id} style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:12, color:C.text }}>
                                <span>{a.fecha} — {a.registrado_por} · {VENTAS_MEDIOS_PAGO.find(m=>m.value===a.medio_pago)?.label||a.medio_pago}</span>
                                <span style={{fontFamily:font.mono}}>${Number(a.valor).toLocaleString("es-CO")}</span>
                              </div>
                            ))}
                            {(d?.abonos||[]).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin abonos todavía.</div>}
                          </div>
                          <div style={{ display:"flex", justifyContent:"space-between", fontFamily:font.body, fontSize:13, fontWeight:700, color:saldoPendiente>0?C.amber:C.green, marginBottom:10 }}>
                            <span>Saldo pendiente</span><span style={{fontFamily:font.mono}}>${saldoPendiente.toLocaleString("es-CO")}</span>
                          </div>
                          {saldoPendiente>0 && (
                            abonoForm===v.id ? (
                              <div style={{ display:"flex", gap:8, marginBottom:10, alignItems:"end", flexWrap:"wrap" }}>
                                <div style={{ flex:1, minWidth:120 }}><Field label="Valor del abono" type="number" value={abonoValor} onChange={setAbonoValor} placeholder="0"/></div>
                                <div style={{ minWidth:160 }}><Field label="Medio del abono" value={abonoMedio} onChange={setAbonoMedio} options={VENTAS_MEDIOS_REALES}/></div>
                                <div style={{ marginBottom:14, display:"flex", gap:6 }}>
                                  <Btn onClick={()=>agregarAbono(v)} sm>Guardar</Btn>
                                  <Btn onClick={()=>{setAbonoForm(null);setAbonoValor("");setAbonoMedio("efectivo");}} variant="ghost" sm>Cancelar</Btn>
                                </div>
                              </div>
                            ) : (
                              <Btn onClick={()=>setAbonoForm(v.id)} sm style={{ marginBottom:10 }}>+ Agregar abono</Btn>
                            )
                          )}
                        </>
                      )}

                      <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", margin:"14px 0 6px" }}>Solicitudes de corrección</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:10 }}>
                        {(d?.solicitudes||[]).map(s=>(
                          <div key={s.id} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 10px" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                              <div style={{ fontFamily:font.body, fontSize:12, color:C.text }}>{s.motivo}</div>
                              <Badge color={s.estado==="pendiente"?C.amber:s.estado==="aprobada"?C.green:C.red} sm>{s.estado}{s.aplicada_at?" · aplicada":""}</Badge>
                            </div>
                            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:3 }}>Pidió: {s.solicitado_por} · {fmtFechaHora(s.fecha_solicitud)}{s.resuelto_por?` · Resolvió: ${s.resuelto_por}`:""}</div>
                            {esAdmin && s.estado==="pendiente" && (
                              <div style={{ display:"flex", gap:6, marginTop:8 }}>
                                <Btn onClick={()=>resolverSolicitud(s,"aprobada")} variant="success" sm>Aprobar</Btn>
                                <Btn onClick={()=>resolverSolicitud(s,"rechazada")} variant="danger" sm>Rechazar</Btn>
                              </div>
                            )}
                          </div>
                        ))}
                        {(d?.solicitudes||[]).length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>Sin solicitudes.</div>}
                      </div>

                      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                        {puedeEditar && !abiertoEdicion && <Btn onClick={()=>iniciarEdicion(v)} sm>✏️ Hacer la corrección aprobada</Btn>}
                        {mostrarSolicitud===v.id ? (
                          <div style={{ display:"flex", gap:8, flex:1, minWidth:220, alignItems:"end" }}>
                            <div style={{ flex:1 }}><Field label="¿Qué hay que corregir y por qué?" value={motivoSolicitud} onChange={setMotivoSolicitud} multiline rows={2}/></div>
                            <div style={{ marginBottom:14, display:"flex", gap:6 }}>
                              <Btn onClick={()=>enviarSolicitud(v.id)} sm>Enviar</Btn>
                              <Btn onClick={()=>{setMostrarSolicitud(null);setMotivoSolicitud("");}} variant="ghost" sm>Cancelar</Btn>
                            </div>
                          </div>
                        ) : (
                          <Btn onClick={()=>setMostrarSolicitud(v.id)} variant="ghost" sm>🔒 Solicitar corrección</Btn>
                        )}
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

function VentasMetricasScreen({ user, stores, users, ventas, ventasItems, metas, setMetas, esAdmin, puedeAsignarMetas, isMobile }) {
  const hoy = toColombiaDate();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mesIdx, setMesIdx] = useState(hoy.getMonth());
  const [tiendaSel, setTiendaSel] = useState("");
  const [metaInputs, setMetaInputs] = useState({});
  const [guardandoMeta, setGuardandoMeta] = useState(null);

  const mesKey = `${anio}-${String(mesIdx+1).padStart(2,"0")}`;
  const esMesActual = anio===hoy.getFullYear() && mesIdx===hoy.getMonth();
  const diasTotalesMes = diasDelMes(anio, mesIdx);
  const diasRestantes = esMesActual ? (diasTotalesMes - hoy.getDate() + 1) : 0;

  const irMesAnterior = () => { if(mesIdx===0){ setMesIdx(11); setAnio(a=>a-1); } else setMesIdx(m=>m-1); };
  const irMesSiguiente = () => { if(mesIdx===11){ setMesIdx(0); setAnio(a=>a+1); } else setMesIdx(m=>m+1); };

  const tiendasList = Object.values(stores);
  const asesores = users.filter(u=>u.role==="advisor" && u.active);

  const metaTiendaValor = (tiendaId) => Number(metas.find(m=>m.mes===mesKey && m.tienda_id===tiendaId)?.valor || 0);
  const metaAsesorValor = (asesorId) => Number(metas.find(m=>m.mes===mesKey && m.vendedor_id===asesorId)?.valor || 0);

  useEffect(()=>{
    const obj = {};
    tiendasList.forEach(t=>{ obj[`tienda:${t.id}`] = String(metaTiendaValor(t.id)||""); });
    asesores.forEach(a=>{ obj[`asesor:${a.id}`] = String(metaAsesorValor(a.id)||""); });
    setMetaInputs(obj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesKey, metas.length]);

  const guardarMeta = async (tipo, id) => {
    const key = `${tipo}:${id}`;
    const valor = Number(metaInputs[key]||0);
    setGuardandoMeta(key);
    const existente = metas.find(m=>m.mes===mesKey && (tipo==="tienda" ? m.tienda_id===id : m.vendedor_id===id));
    let data, error;
    if(existente){
      ({data,error} = await supabase.from("ventas_metas").update({ valor }).eq("id",existente.id).select().single());
    } else {
      const payload = tipo==="tienda" ? { mes:mesKey, tienda_id:id, vendedor_id:null, valor } : { mes:mesKey, tienda_id:null, vendedor_id:id, valor };
      ({data,error} = await supabase.from("ventas_metas").insert(payload).select().single());
    }
    if(data && !error){
      setMetas(prev => existente ? prev.map(m=>m.id===data.id?data:m) : [...prev, data]);
    }
    setGuardandoMeta(null);
  };

  const ventasDelMes = ventas.filter(v => v.fecha && v.fecha.slice(0,7)===mesKey && (!tiendaSel || v.tienda_id===tiendaSel));
  const idsVentasDelMes = new Set(ventasDelMes.map(v=>v.id));
  const itemsDelMes = ventasItems.filter(i => idsVentasDelMes.has(i.venta_id));
  const itemsDelMesProducto = itemsDelMes.filter(i=>i.tipo==="producto");

  const totalConServicios = ventasDelMes.reduce((a,v)=>a+Number(v.total||0),0);
  const totalSinServicios = itemsDelMesProducto.reduce((a,i)=>a+(Number(i.valor)-Number(i.descuento||0)),0);

  const metaTiendaTotal = tiendaSel ? metaTiendaValor(tiendaSel) : tiendasList.reduce((a,t)=>a+metaTiendaValor(t.id),0);
  const idcTienda = metaTiendaTotal>0 ? Math.round((totalSinServicios/metaTiendaTotal)*1000)/10 : null;
  const mdaTienda = esMesActual && diasRestantes>0 && metaTiendaTotal>0 ? Math.round((metaTiendaTotal-totalSinServicios)/diasRestantes) : null;

  const fechaPorVenta = {}; ventasDelMes.forEach(v=>{ fechaPorVenta[v.id]=v.fecha; });

  const dataAsesores = asesores.map(a=>{
    const ventasAsesor = ventasDelMes.filter(v=>v.vendedor_id===a.id);
    const idsAsesor = new Set(ventasAsesor.map(v=>v.id));
    const sinServicios = itemsDelMesProducto.filter(i=>idsAsesor.has(i.venta_id)).reduce((s,i)=>s+(Number(i.valor)-Number(i.descuento||0)),0);
    const conServicios = ventasAsesor.reduce((s,v)=>s+Number(v.total||0),0);
    const meta = metaAsesorValor(a.id);
    const idc = meta>0 ? Math.round((sinServicios/meta)*1000)/10 : null;
    const mda = esMesActual && diasRestantes>0 && meta>0 ? Math.round((meta-sinServicios)/diasRestantes) : null;
    return { asesor:a, sinServicios, conServicios, meta, idc, mda };
  });

  const ranking = [...dataAsesores].filter(d=>d.idc!==null).sort((a,b)=>b.idc-a.idc);

  const porDia = {};
  ventasDelMes.forEach(v=>{ porDia[v.fecha] = porDia[v.fecha] || { con:0, sin:0, count:0 }; porDia[v.fecha].con += Number(v.total||0); porDia[v.fecha].count += 1; });
  itemsDelMesProducto.forEach(i=>{ const f=fechaPorVenta[i.venta_id]; if(f){ porDia[f].sin += (Number(i.valor)-Number(i.descuento||0)); } });
  const diasList = Object.entries(porDia).sort((a,b)=>b[0].localeCompare(a[0]));

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
          <button onClick={()=>setTiendaSel("")} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${!tiendaSel?C.gold:C.border}`, background:!tiendaSel?`${C.gold}22`:"transparent", color:!tiendaSel?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12, cursor:"pointer" }}>Todas las tiendas</button>
          {tiendasList.map(t=>(
            <button key={t.id} onClick={()=>setTiendaSel(t.id)} style={{ padding:"6px 12px", borderRadius:20, border:`1px solid ${tiendaSel===t.id?C.gold:C.border}`, background:tiendaSel===t.id?`${C.gold}22`:"transparent", color:tiendaSel===t.id?C.goldLight:C.textMuted, fontFamily:font.body, fontSize:12, cursor:"pointer" }}>{t.name}</button>
          ))}
        </div>
      </Card>

      <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr 1fr":"repeat(5, 1fr)", gap:10, marginBottom:16 }}>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ingresos (con servicios)</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(totalConServicios)}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Ingresos (sin servicios)</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{fmtCOP(totalSinServicios)}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Meta {tiendaSel?"de la tienda":"total"}</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{metaTiendaTotal>0?fmtCOP(metaTiendaTotal):"—"}</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>IDC</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:idcTienda===null?C.textMuted:idcTienda>=100?C.green:C.amber }}>{idcTienda===null?"—":`${idcTienda}%`}</div>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:2 }}>sin servicios</div>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>MDA</div>
          <div style={{ fontFamily:font.mono, fontSize:18, fontWeight:700, color:C.text }}>{mdaTienda===null?"—":fmtCOP(mdaTienda)}</div>
          <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, marginTop:2 }}>por día, sin servicios</div>
        </div>
      </div>

      {puedeAsignarMetas && (
        <SeccionVenta icon="🎯" titulo="Metas del mes" subtitulo={`Asigna las metas para ${MESES_NOMBRE[mesIdx]} ${anio}`}>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Por tienda</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
            {tiendasList.map(t=>(
              <div key={t.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, fontFamily:font.body, fontSize:12, color:C.text }}>{t.name}</div>
                <div style={{ width:160 }}><Field type="number" value={metaInputs[`tienda:${t.id}`]||""} onChange={v=>setMetaInputs(prev=>({...prev,[`tienda:${t.id}`]:v}))} placeholder="0"/></div>
                <Btn onClick={()=>guardarMeta("tienda",t.id)} disabled={guardandoMeta===`tienda:${t.id}`} sm>{guardandoMeta===`tienda:${t.id}`?"...":"Guardar"}</Btn>
              </div>
            ))}
          </div>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Por asesor</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {asesores.map(a=>(
              <div key={a.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ flex:1, fontFamily:font.body, fontSize:12, color:C.text }}>{a.name}</div>
                <div style={{ width:160 }}><Field type="number" value={metaInputs[`asesor:${a.id}`]||""} onChange={v=>setMetaInputs(prev=>({...prev,[`asesor:${a.id}`]:v}))} placeholder="0"/></div>
                <Btn onClick={()=>guardarMeta("asesor",a.id)} disabled={guardandoMeta===`asesor:${a.id}`} sm>{guardandoMeta===`asesor:${a.id}`?"...":"Guardar"}</Btn>
              </div>
            ))}
            {asesores.length===0 && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted }}>No hay asesores activos.</div>}
          </div>
        </SeccionVenta>
      )}

      <SeccionVenta icon="🏆" titulo="Top asesores por cumplimiento" subtitulo="Ordenado por IDC, de mayor a menor">
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

      <SeccionVenta icon="👤" titulo="Ventas por asesor" subtitulo="Con y sin servicios, del mes seleccionado">
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontFamily:font.body, fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}`, color:C.textMuted, textAlign:"left" }}>
                <th style={{ padding:"6px 8px", fontWeight:500 }}>Asesor</th>
                <th style={{ padding:"6px 8px", fontWeight:500 }}>Sin servicios</th>
                <th style={{ padding:"6px 8px", fontWeight:500 }}>Con servicios</th>
                <th style={{ padding:"6px 8px", fontWeight:500 }}>Meta</th>
                <th style={{ padding:"6px 8px", fontWeight:500 }}>IDC</th>
                <th style={{ padding:"6px 8px", fontWeight:500 }}>MDA</th>
              </tr>
            </thead>
            <tbody>
              {dataAsesores.map(d=>(
                <tr key={d.asesor.id} style={{ borderBottom:`1px solid ${C.border}` }}>
                  <td style={{ padding:"7px 8px", color:C.text }}>{d.asesor.name}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.text }}>{fmtCOP(d.sinServicios)}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted }}>{fmtCOP(d.conServicios)}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted }}>{d.meta>0?fmtCOP(d.meta):"—"}</td>
                  <td style={{ padding:"7px 8px" }}>{d.idc===null?"—":<Badge color={d.idc>=100?C.green:d.idc>=70?C.amber:C.red} sm>{d.idc}%</Badge>}</td>
                  <td style={{ padding:"7px 8px", fontFamily:font.mono, color:C.textMuted }}>{d.mda===null?"—":fmtCOP(d.mda)}</td>
                </tr>
              ))}
              {dataAsesores.length===0 && <tr><td colSpan={6} style={{ padding:16, textAlign:"center", color:C.textMuted }}>No hay asesores activos.</td></tr>}
            </tbody>
          </table>
        </div>
      </SeccionVenta>

      <SeccionVenta icon="📅" titulo="Ventas por día" subtitulo={tiendaSel ? stores[tiendaSel]?.name : "Todas las tiendas"}>
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

// ── APP SHELL ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null),[area,setArea]=useState(null),[tab,setTab]=useState(null),[records,setRecords]=useState([]),[users,setUsers]=useState([]),[stores,setStores]=useState({}),[booting,setBooting]=useState(true),[refreshing,setRefreshing]=useState(false);
  const [juntaLideres,setJuntaLideres]=useState([]),[juntaCompromisos,setJuntaCompromisos]=useState([]),[juntaAcuerdos,setJuntaAcuerdos]=useState([]);
  const [juntaAreas,setJuntaAreas]=useState([]),[juntaLiderAreas,setJuntaLiderAreas]=useState([]);
  const [ventas,setVentas]=useState([]),[ventasItems,setVentasItems]=useState([]),[ventasMetas,setVentasMetas]=useState([]);
  const [mostrarCambiarPassword,setMostrarCambiarPassword]=useState(false);
  const isMobile=useIsMobile();

  const loadAll=async()=>{
    const[{data:t},{data:u},{data:r},{data:jl},{data:jc},{data:ja},{data:jar},{data:jla},{data:v},{data:vi},{data:vm}]=await Promise.all([
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
  };

  useEffect(()=>{ loadAll().then(()=>setBooting(false)); },[]);

  const login=(u)=>{setUser(u);setArea(null);setTab((esCuentaTienda(u)||esAdminFinanzas(u))?"registrar":puedeUsarAreas(u)?null:"checkin");};
  const logout=()=>{setUser(null);setArea(null);setTab(null);};
  const chooseArea=(a)=>{setArea(a);setTab(a==="junta"?"seguimiento":a==="ventas"?"registrar":"dashboard");};
  const backToAreas=()=>{setArea(null);setTab(null);};
  const addRecord=(r)=>setRecords(prev=>[r,...prev]);
  const refreshAll=async()=>{ setRefreshing(true); await loadAll(); setRefreshing(false); };
  const refreshUserRecords=(newRecs)=>{ setRecords(prev=>{ const otros=prev.filter(r=>!(r.user_id===user?.id&&r.date===todayStr)); return [...newRecs,...otros]; }); };

  useInactivityLogout(logout, 5);

  if(booting) return <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,color:C.textMuted,fontSize:14}}>Cargando...</div>;
  if(!user) return <LoginScreen onLogin={login}/>;

  if(passwordVencida(user)) return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16,gap:20}}>
      <img src="/logo.png" alt="OZEN" style={{width:120,height:"auto"}}/>
      <CambiarPasswordForm user={user} obligatorio onUpdated={setUser}/>
      <Btn onClick={logout} variant="ghost" sm>Cerrar sesión</Btn>
    </div>
  );

  if(puedeUsarAreas(user) && !area) return <AreaSelector user={user} onChoose={chooseArea} onLogout={logout}/>;

  const renderScreen=()=>{
    if(puedeUsarAreas(user)){
      if(area==="junta"){
        if(tab==="equipo")       return <JuntaEquipoTab lideres={juntaLideres} setLideres={setJuntaLideres} areas={juntaAreas} setAreas={setJuntaAreas} liderAreas={juntaLiderAreas} setLiderAreas={setJuntaLiderAreas} isMobile={isMobile}/>;
        if(tab==="seguimiento")  return <JuntaSeguimientoScreen lideres={juntaLideres} compromisos={juntaCompromisos} setCompromisos={setJuntaCompromisos}/>;
        if(tab==="indicadores")  return <JuntaIndicadoresTab lideres={juntaLideres} compromisos={juntaCompromisos} isMobile={isMobile}/>;
        if(tab==="guion")        return <JuntaGuionTab monitor={getMonitorActual(juntaLideres)} isMobile={isMobile}/>;
        if(tab==="acuerdos")     return <JuntaAcuerdosTab user={user} acuerdos={juntaAcuerdos} setAcuerdos={setJuntaAcuerdos}/>;
      } else if(area==="ventas"){
        if(tab==="registrar") return <VentasRegistrarScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} esAdmin={esAdminDeVentas(user)} isMobile={isMobile}/>;
        if(tab==="lista")     return <VentasListaScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} esAdmin={esAdminDeVentas(user)}/>;
        if(tab==="metricas")  return <VentasMetricasScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} metas={ventasMetas} setMetas={setVentasMetas} esAdmin={esAdminDeVentas(user)} puedeAsignarMetas={puedeAsignarMetas(user)} isMobile={isMobile}/>;
      } else {
        if(tab==="dashboard") return <DashboardScreen records={records} stores={stores} isMobile={isMobile}/>;
        if(tab==="records")   return <RecordsScreen records={records} stores={stores} users={users} isMobile={isMobile}/>;
        if(tab==="users")     return <UsersScreen users={users} setUsers={setUsers}/>;
        if(tab==="usuarios")  return <UsuariosScreen users={users} setUsers={setUsers}/>;
        if(tab==="stores")    return <StoresScreen stores={stores} setStores={setStores}/>;
        if(tab==="reports")   return <ReportsScreen records={records} users={users} stores={stores} isMobile={isMobile}/>;
      }
    } else if(esCuentaTienda(user) || esAdminFinanzas(user)){
      if(tab==="registrar") return <VentasRegistrarScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} esAdmin={false} isMobile={isMobile}/>;
      if(tab==="lista")     return <VentasListaScreen user={user} stores={stores} users={users} ventas={ventas} setVentas={setVentas} esAdmin={false}/>;
      if(tab==="metricas")  return <VentasMetricasScreen user={user} stores={stores} users={users} ventas={ventas} ventasItems={ventasItems} metas={ventasMetas} setMetas={setVentasMetas} esAdmin={false} puedeAsignarMetas={puedeAsignarMetas(user)} isMobile={isMobile}/>;
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

  if(isMobile) return (
    <ReadOnlyContext.Provider value={soloLectura}>
      <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.dark,overflow:"hidden"}}>
        <MobileHeader user={user} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onChangeArea={backToAreas} onCambiarPassword={()=>setMostrarCambiarPassword(true)}/>
        <main style={{flex:1,overflowY:"auto",padding:16}}>{renderScreen()}</main>
        <BottomNav tab={tab} setTab={setTab} user={user} area={area}/>
        {modalCambiarPassword}
      </div>
    </ReadOnlyContext.Provider>
  );

  return (
    <ReadOnlyContext.Provider value={soloLectura}>
      <div style={{display:"flex",height:"100vh",background:C.dark,fontFamily:font.body,overflow:"hidden"}}>
        <Sidebar tab={tab} setTab={setTab} user={user} area={area} onChangeArea={backToAreas} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onCambiarPassword={()=>setMostrarCambiarPassword(true)}/>
        <main style={{flex:1,overflowY:"auto",padding:"32px 36px"}}>{renderScreen()}</main>
        {modalCambiarPassword}
      </div>
    </ReadOnlyContext.Provider>
  );
}