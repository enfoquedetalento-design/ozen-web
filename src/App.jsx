import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabase";

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
// El Monitor rota cada 2 meses entre los líderes, en el orden de la lista
// (se edita desde la pestaña Equipo y perfiles: agregar/quitar/orden).
// Arranca el 21 de julio de 2026 (primer martes del protocolo).
const JUNTA_ROTATION_EPOCH = "2026-07-21";
const mesesEntre = (ini, fin) => {
  const a = new Date(ini + "T12:00:00"), b = new Date(fin + "T12:00:00");
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};
const getMonitorActual = (lideres) => {
  if (!lideres.length) return null;
  const ordenados = [...lideres].sort((x, y) => (x.orden ?? 999) - (y.orden ?? 999));
  const meses = Math.max(0, mesesEntre(JUNTA_ROTATION_EPOCH, todayStr));
  const ciclo = Math.floor(meses / 2);
  return ordenados[ciclo % ordenados.length];
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

const Field = ({ label, value, onChange, type="text", placeholder, options, disabled }) => (
  <div style={{ marginBottom:14 }}>
    {label && <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>}
    {options ? (
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{ width:"100%", background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} style={{ width:"100%", background:disabled?C.dark:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:disabled?C.textMuted:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }} />
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
const ADMIN_TABS_JUNTA      = [{ id:"equipo",icon:"👥",label:"Equipo y perfiles" },{ id:"seguimiento",icon:"✅",label:"Seguimiento semanal" },{ id:"guion",icon:"📖",label:"Explicación del rol" },{ id:"acuerdos",icon:"🔒",label:"Acuerdos y decisiones" }];
const ADVISOR_TABS          = [{ id:"checkin",icon:"📍",label:"Marcar Asistencia" },{ id:"history",icon:"📋",label:"Mi Historial" },{ id:"schedule",icon:"📅",label:"Malla Horaria" }];

function Sidebar({ tab, setTab, user, area, onChangeArea, onLogout, onRefresh, refreshing }) {
  const tabs = user.role!=="admin" ? ADVISOR_TABS : (area==="junta" ? ADMIN_TABS_JUNTA : ADMIN_TABS_ASISTENCIA);
  const areaLabel = user.role!=="admin" ? "CONTROL DE PERSONAL" : (area==="junta" ? "JUNTA ADMIN" : "REGISTRO DE ASISTENCIA");
  return (
    <div style={{ width:220, flexShrink:0, background:C.sidebar, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"20px 16px", borderBottom:`1px solid ${C.border}` }}>
        <img src="/logo.png" alt="OZEN" style={{ width:100, height:"auto", marginBottom:4 }} />
        <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, letterSpacing:"0.15em", marginTop:2 }}>{areaLabel}</div>
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
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>{user.role==="admin"?"Administrador":"Asesor"}</div>
          </div>
          <button onClick={onRefresh} disabled={refreshing} title="Actualizar" style={{ marginLeft:"auto", background:"none", border:"none", cursor:refreshing?"not-allowed":"pointer", fontSize:16, opacity:refreshing?0.4:1, transition:"transform 0.4s", transform:refreshing?"rotate(180deg)":"rotate(0deg)" }}>🔄</button>
        </div>
        {user.role==="admin" && <Btn onClick={onChangeArea} variant="ghost" full sm style={{ marginBottom:8 }}>🔀 Cambiar de área</Btn>}
        <Btn onClick={onLogout} variant="ghost" full sm>Cerrar sesión</Btn>
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab, isAdmin, area }) {
  const tabs = !isAdmin ? ADVISOR_TABS : (area==="junta" ? ADMIN_TABS_JUNTA : ADMIN_TABS_ASISTENCIA);
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

function MobileHeader({ user, onLogout, onRefresh, refreshing, onChangeArea }) {
  return (
    <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${C.border}`, background:C.sidebar, flexShrink:0 }}>
      <img src="/logo.png" alt="OZEN" style={{ width:70, height:"auto" }} />
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {user.role==="admin" && <button onClick={onChangeArea} title="Cambiar de área" style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>🔀</button>}
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
      <PageHeader title="Asesores" subtitle={`${advisors.length} asesores`} action={<Btn onClick={()=>{setShowForm(!showForm);setEditing(null);}} sm>{showForm?"Cancelar":"+ Nuevo"}</Btn>} />
      {showForm&&(<Card glow style={{marginBottom:16}}><div style={{fontFamily:font.body,fontSize:13,fontWeight:600,color:C.goldLight,marginBottom:14}}>Nuevo asesor</div><Field label="Nombre completo" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="Nombre Apellido" /><Field label="N.º de documento" value={form.documento} onChange={v=>setForm(f=>({...f,documento:v}))} placeholder="Número de documento" /><div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,marginBottom:12}}>💡 La contraseña inicial será el número de documento.</div><Btn onClick={add} disabled={loading} full>{loading?"Guardando...":"Crear asesor"}</Btn></Card>)}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {advisors.map(u=>(
          <Card key={u.id} p="14px" style={{opacity:u.active?1:0.6}}>
            {editing===u.id?(
              <div><Field label="Nombre" value={editVal.name} onChange={v=>setEditVal(p=>({...p,name:v}))} /><Field label="Documento" value={editVal.documento} onChange={v=>setEditVal(p=>({...p,documento:v}))} /><div style={{display:"flex",gap:8}}><Btn onClick={()=>saveEdit(u.id)} variant="success" sm full>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm full>Cancelar</Btn></div></div>
            ):(
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:8,background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,fontWeight:700,color:"#fff",flexShrink:0}}>{u.name[0]}</div>
                <div style={{flex:1,minWidth:0}}><div style={{fontFamily:font.body,fontSize:13,color:C.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div><div style={{fontFamily:font.mono,fontSize:11,color:C.textMuted}}>{u.documento}</div></div>
                <Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <Btn onClick={()=>{setEditing(u.id);setEditVal({name:u.name,documento:u.documento});}} variant="ghost" sm>✏</Btn>
                  <Btn onClick={()=>toggle(u)} variant={u.active?"danger":"success"} sm>{u.active?"✕":"✓"}</Btn>
                  <Btn onClick={()=>deleteUser(u.id)} variant="danger" sm>🗑</Btn>
                </div>
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
      <PageHeader title="Tiendas" subtitle="Puntos de venta y turnos" action={<Btn onClick={()=>setShowForm(!showForm)} sm>{showForm?"Cancelar":"+ Nueva"}</Btn>} />
      {showForm&&(<Card glow style={{marginBottom:16}}><Field label="Nombre de la tienda" value={newName} onChange={setNewName} placeholder="Ej: Centenario" /><Btn onClick={addStore} full>Crear tienda</Btn></Card>)}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {Object.values(stores).map(s=>(
          <Card key={s.id} glow={editing===s.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              {editing===s.id?<input value={editVal.name} onChange={e=>setEditVal(p=>({...p,name:e.target.value}))} style={{flex:1,background:C.surfaceAlt,border:`1px solid ${C.gold}`,borderRadius:7,padding:"7px 10px",color:C.text,fontSize:15,fontFamily:font.body,outline:"none",fontWeight:700}}/>:<div style={{fontFamily:font.body,fontSize:15,fontWeight:700,color:C.goldLight}}>{s.name}</div>}
              <div style={{display:"flex",gap:6,marginLeft:10,flexShrink:0}}>
                {editing===s.id?<><Btn onClick={()=>saveEdit(s.id)} sm>Guardar</Btn><Btn onClick={()=>setEditing(null)} variant="ghost" sm>✕</Btn></>:<><Btn onClick={()=>{setEditing(s.id);setEditVal({name:s.name});}} variant="ghost" sm>✏</Btn><Btn onClick={()=>deleteStore(s.id)} variant="danger" sm>🗑</Btn></>}
              </div>
            </div>
            <Divider />
            <div style={{fontFamily:font.body,fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Turnos ({s.shifts.length})</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {s.shifts.length===0&&<span style={{fontFamily:font.body,fontSize:12,color:C.border}}>Sin turnos</span>}
              {s.shifts.map(sh=>(
                <div key={sh} style={{display:"flex",alignItems:"center",gap:4}}>
                  <Badge color={C.goldLight} sm>{sh}</Badge>
                  <button onClick={()=>removeShift(s.id,sh)} style={{background:C.redDim,border:`1px solid ${C.red}33`,color:C.red,borderRadius:4,width:16,height:16,cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8}}>
              <input value={newShift[s.id]||""} onChange={e=>setNewShift(p=>({...p,[s.id]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addShift(s.id)} placeholder="Nuevo turno" style={{flex:1,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 10px",color:C.text,fontSize:12,fontFamily:font.body,outline:"none"}}/>
              <Btn onClick={()=>addShift(s.id)} sm>+ Agregar</Btn>
            </div>
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
function JuntaEquipoTab({ lideres, setLideres }) {
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState({ nombre:"", objetivo:"", procesos_macro:"" });

  const ordenados = [...lideres].sort((a,b)=>(a.orden??999)-(b.orden??999));

  const agregar = async () => {
    const siguienteOrden = lideres.length ? Math.max(...lideres.map(l=>l.orden??0)) + 1 : 1;
    const { data, error } = await supabase.from("junta_lideres").insert({ orden:siguienteOrden, nombre:"", objetivo:"", procesos_macro:"" }).select().single();
    if (!error && data) setLideres(prev=>[...prev, data]);
  };
  const quitar = async (id) => {
    if (!window.confirm("¿Quitar este liderazgo de la Junta? Esto no se puede deshacer.")) return;
    await supabase.from("junta_lideres").delete().eq("id", id);
    setLideres(prev=>prev.filter(l=>l.id!==id));
  };
  const marcarLiderEquipo = async (id) => {
    await supabase.from("junta_lideres").update({ lider_equipo:false }).not("id","is",null);
    const { data } = await supabase.from("junta_lideres").update({ lider_equipo:true }).eq("id", id).select().single();
    if (data) setLideres(prev=>prev.map(l=>({ ...l, lider_equipo: l.id===id })));
  };
  const guardar = async (id) => {
    const { data, error } = await supabase.from("junta_lideres").update({ nombre:editVal.nombre.trim(), objetivo:editVal.objetivo.trim(), procesos_macro:editVal.procesos_macro.trim(), updated_at:new Date().toISOString() }).eq("id", id).select().single();
    if (!error && data) { setLideres(prev=>prev.map(l=>l.id===id?data:l)); setEditingId(null); }
  };

  return (
    <div>
      <PageHeader title="Equipo y perfiles" subtitle="Los liderazgos que componen la Junta Admin" action={<Btn onClick={agregar} sm>+ Agregar líder</Btn>} />
      {ordenados.map((l,i)=>(
        <Card key={l.id} style={{ marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10, flexWrap:"wrap", gap:8 }}>
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Líder {i+1}</div>
            <div style={{ display:"flex", gap:6 }}>
              <Btn onClick={()=>marcarLiderEquipo(l.id)} variant={l.lider_equipo?"success":"ghost"} sm>{l.lider_equipo?"✓ Líder del equipo":"Marcar como líder del equipo"}</Btn>
              <Btn onClick={()=>quitar(l.id)} variant="danger" sm>🗑</Btn>
            </div>
          </div>
          {editingId===l.id ? (
            <div>
              <Field label="Nombre de quien ocupa este liderazgo" value={editVal.nombre} onChange={v=>setEditVal(p=>({...p,nombre:v}))} placeholder="Nombre Apellido"/>
              <Field label="Objetivo" value={editVal.objetivo} onChange={v=>setEditVal(p=>({...p,objetivo:v}))} placeholder="¿Cuál es su objetivo dentro del equipo?"/>
              <Field label="Procesos macro" value={editVal.procesos_macro} onChange={v=>setEditVal(p=>({...p,procesos_macro:v}))} placeholder="¿Qué procesos macro lidera?"/>
              <div style={{ display:"flex", gap:8 }}><Btn onClick={()=>guardar(l.id)} sm full>Guardar</Btn><Btn onClick={()=>setEditingId(null)} variant="ghost" sm full>Cancelar</Btn></div>
            </div>
          ):(
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.goldLight }}>{l.nombre || "— sin nombre asignado"}</div>
                {l.lider_equipo && <Badge color={C.gold} sm>Líder del equipo</Badge>}
              </div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Objetivo</div>
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:10 }}>{l.objetivo || "— sin definir"}</div>
              <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4 }}>Procesos macro</div>
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textSub, marginBottom:10 }}>{l.procesos_macro || "— sin definir"}</div>
              <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:10, fontFamily:font.body, fontSize:10, color:C.border }}>
                <span>Creado: {fmtFechaHora(l.created_at)}</span>
                <span>Última actualización: {fmtFechaHora(l.updated_at||l.created_at)}</span>
              </div>
              <Btn onClick={()=>{ setEditingId(l.id); setEditVal({ nombre:l.nombre||"", objetivo:l.objetivo||"", procesos_macro:l.procesos_macro||"" }); }} variant="ghost" sm>✏ Editar</Btn>
            </div>
          )}
        </Card>
      ))}
      {ordenados.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin líderes agregados todavía. Usa "+ Agregar líder" para empezar.</div>}
    </div>
  );
}

// ── SCREEN: Junta Admin — Acuerdos y decisiones (registro permanente) ───────
function JuntaAcuerdosTab({ user, acuerdos, setAcuerdos }) {
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
      <PageHeader title="Acuerdos y decisiones" subtitle="Registro permanente de la Junta — una vez guardado, no se puede editar ni borrar" action={<Btn onClick={()=>setShowNuevo(true)} sm>+ Nuevo acuerdo</Btn>} />
      {showNuevo && (
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
          <Card key={a.id} p="14px">
            <div style={{ fontFamily:font.body, fontSize:13, color:C.text, marginBottom:8, lineHeight:1.5 }}>{a.texto}</div>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", fontFamily:font.body, fontSize:11, color:C.textMuted }}>
              <span>📅 Fecha del acuerdo: {a.fecha}</span>
              {a.registrado_por && <span>✍️ Registrado por {a.registrado_por}</span>}
              <span>🔒 Guardado el {fmtFechaHora(a.created_at)}</span>
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
  const [semana, setSemana] = useState(martesDeSemana(todayStr));
  const [showNueva, setShowNueva] = useState(false);
  const [nueva, setNueva] = useState({ descripcion:"", lider_id:"", fecha_estimada:"", comentarios:"" });

  const tareas = compromisos.filter(c=>c.semana===semana);
  const nombreLider = (id) => lideres.find(l=>l.id===id)?.nombre || "— sin asignar";

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
      <Card style={{ marginBottom:16 }} p="12px">
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em" }}>Semana del martes</div>
          <input type="date" value={semana} onChange={e=>setSemana(e.target.value)} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}/>
          <Btn onClick={()=>setSemana(martesDeSemana(todayStr))} variant="ghost" sm>Esta semana</Btn>
          <Btn onClick={()=>setShowNueva(true)} sm style={{ marginLeft:"auto" }}>+ Nueva tarea</Btn>
        </div>
      </Card>

      {showNueva && (
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
              <button onClick={()=>actualizar(t.id,{completado:!t.completado})} style={{ width:22, height:22, borderRadius:6, border:`2px solid ${t.completado?C.green:C.border}`, background:t.completado?C.green:"transparent", cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", fontSize:13, marginTop:2 }}>{t.completado?"✓":""}</button>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, textDecoration:t.completado?"line-through":"none" }}>{t.descripcion}</div>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:4 }}>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>👤 {nombreLider(t.lider_id)}</div>
                  {t.fecha_estimada && <div style={{ fontFamily:font.mono, fontSize:11, color:C.amber }}>📅 {t.fecha_estimada}</div>}
                </div>
                <input placeholder="Comentarios / avance..." defaultValue={t.comentarios||""} onBlur={e=>{ if(e.target.value!==t.comentarios) actualizar(t.id,{comentarios:e.target.value}); }} style={{ width:"100%", marginTop:8, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"6px 8px", color:C.text, fontSize:11, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}/>
              </div>
              <Btn onClick={()=>eliminar(t.id)} variant="ghost" sm>🗑</Btn>
            </div>
          </Card>
        ))}
        {tareas.length===0 && <div style={{ textAlign:"center", padding:40, color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin tareas para esta semana. Usa "+ Nueva tarea".</div>}
      </div>
    </div>
  );
}

// ── SCREEN: Junta Admin — Explicación del rol ────────────────────────────────
function JuntaGuionTab({ monitor, liderEquipo }) {
  const guion = [
    { t:"1. Revisión de la semana anterior", qs:["¿Qué te comprometiste a hacer la semana pasada?","¿Qué quedó hecho y qué no?","¿Cuál es la evidencia de lo hecho?"] },
    { t:"2. Planeación individual de la semana", qs:["¿Qué vas a hacer esta semana?","¿Cómo, día por día?","¿Qué queda como resultado verificable de cada tarea?"] },
    { t:"3. Operacionalización (cuando una tarea llega vaga)", qs:["Eso concretamente, ¿es hacer qué? ¿Cuánto tiempo toma? ¿Con quién/dónde/con qué?","¿Qué evidencia deja? Si no deja nada, ¿cómo sabremos que se hizo?"] },
    { t:"4. Trabajo grupal", qs:["¿Quién toma qué parte?","¿De qué o de quién depende cada parte?","¿Acuerdo concreto y para cuándo? → queda registrado."] },
    { t:"5. Cierre — lo no previsto", qs:["Además de lo planeado, ¿qué te cayó la semana pasada que no estaba previsto?","(Mucho del trabajo real es reactivo — esta pregunta existe para que también cuente y sea visible.)"] },
  ];
  return (
    <div>
      <PageHeader title="Explicación del rol" subtitle="Monitor, líder del equipo y guion de la reunión" />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        <Card glow>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Monitor de turno (rota cada 2 meses)</div>
          <div style={{ fontFamily:font.body, fontSize:18, fontWeight:700, color:C.goldLight }}>{monitor ? (monitor.nombre || "— sin nombre") : "— sin líderes configurados"}</div>
        </Card>
        <Card>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:6 }}>Líder del equipo (fijo)</div>
          <div style={{ fontFamily:font.body, fontSize:18, fontWeight:700, color:C.text }}>{liderEquipo ? (liderEquipo.nombre || "— sin nombre") : "— márcalo en Equipo y perfiles"}</div>
        </Card>
      </div>

      <Card style={{ marginBottom:16 }}>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:10 }}>Funciones del Monitor</div>
        <div style={{ fontFamily:font.body, fontSize:12, color:C.green, fontWeight:600, marginBottom:6 }}>✓ Sí hace</div>
        <ul style={{ margin:"0 0 12px", paddingLeft:18, fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.7 }}>
          <li>Garantiza que la reunión pase siempre el martes 9:00am; si hay que reprogramar, lo resuelve el mismo día.</li>
          <li>Conduce la sesión con el guion fijo de 5 momentos, sin improvisar.</li>
          <li>Operacionaliza tareas vagas: qué es exactamente, cómo, cuánto tiempo, qué resultado queda.</li>
          <li>Registra todo (plan de cada uno, cumplimiento, evidencia, acuerdos) — aquí, en este módulo.</li>
          <li>Ante algo incumplido, ayuda a destrabarlo ("¿cómo lo resolvemos?"), no pregunta el porqué.</li>
        </ul>
        <div style={{ fontFamily:font.body, fontSize:12, color:C.red, fontWeight:600, marginBottom:6 }}>✕ No hace</div>
        <ul style={{ margin:0, paddingLeft:18, fontFamily:font.body, fontSize:12, color:C.textSub, lineHeight:1.7 }}>
          <li>No juzga ni reprocha.</li>
          <li>No lidera el equipo (eso es del líder) — solo hace seguimiento de la semana.</li>
          <li>No ejecuta el trabajo de otros, solo lo hace visible.</li>
          <li>No reporta hacia arriba ni interpreta — el reporte es a la propia Junta, en vivo.</li>
        </ul>
      </Card>

      <Card>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>Guion fijo de cada martes — 5 momentos</div>
        {guion.map((m,i)=>(
          <div key={i} style={{ marginBottom:i<guion.length-1?14:0 }}>
            <div style={{ fontFamily:font.body, fontSize:12, fontWeight:600, color:C.goldLight, marginBottom:4 }}>{m.t}</div>
            <ul style={{ margin:0, paddingLeft:18, fontFamily:font.body, fontSize:12, color:C.textMuted, lineHeight:1.6 }}>
              {m.qs.map((q,j)=><li key={j}>{q}</li>)}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [documento,setDocumento]=useState(""),[pass,setPass]=useState(""),[err,setErr]=useState(""),[loading,setLoading]=useState(false);
  const handle=async()=>{ if(!documento.trim()||!pass){setErr("Completa todos los campos.");return;} setLoading(true);setErr(""); const{data}=await supabase.from("usuarios").select("*").eq("documento",documento.trim()).eq("password",pass).eq("active",true).single(); if(data)onLogin(data); else setErr("Documento o contraseña incorrecta, o cuenta inactiva."); setLoading(false); };
  return (
    <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <img src="/logo.png" alt="OZEN" style={{width:140,height:"auto",marginBottom:12}}/>
          <div style={{fontFamily:font.body,fontSize:12,color:C.textMuted,letterSpacing:"0.2em"}}>CONTROL DE PERSONAL</div>
        </div>
        <Card glow>
          <div style={{fontFamily:font.body,fontSize:17,fontWeight:600,color:C.text,marginBottom:18}}>Iniciar sesión</div>
          <Field label="N.º de documento" value={documento} onChange={setDocumento} placeholder="Número de documento"/>
          <Field label="Contraseña" type="password" value={pass} onChange={setPass} placeholder="••••••••"/>
          {err&&<div style={{background:C.redDim,border:`1px solid ${C.red}44`,borderRadius:7,padding:"9px 12px",color:C.red,fontSize:12,marginBottom:12,fontFamily:font.body}}>{err}</div>}
          <Btn onClick={handle} disabled={loading} full style={{marginTop:4}}>{loading?"Verificando...":"Ingresar"}</Btn>
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
                <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.goldLight }}>La Junta Admin</div>
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
        </div>
        <div style={{ textAlign:"center", marginTop:20 }}>
          <Btn onClick={onLogout} variant="ghost" sm>Cerrar sesión</Btn>
        </div>
      </div>
    </div>
  );
}

// ── APP SHELL ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null),[area,setArea]=useState(null),[tab,setTab]=useState(null),[records,setRecords]=useState([]),[users,setUsers]=useState([]),[stores,setStores]=useState({}),[booting,setBooting]=useState(true),[refreshing,setRefreshing]=useState(false);
  const [juntaLideres,setJuntaLideres]=useState([]),[juntaCompromisos,setJuntaCompromisos]=useState([]),[juntaAcuerdos,setJuntaAcuerdos]=useState([]);
  const isMobile=useIsMobile();

  const loadAll=async()=>{
    const[{data:t},{data:u},{data:r},{data:jl},{data:jc},{data:ja}]=await Promise.all([
      supabase.from("tiendas").select("*"),
      supabase.from("usuarios").select("*"),
      supabase.from("registros").select("*").order("date",{ascending:false}),
      supabase.from("junta_lideres").select("*").order("orden",{ascending:true}),
      supabase.from("junta_compromisos").select("*").order("semana",{ascending:false}),
      supabase.from("junta_acuerdos").select("*").order("fecha",{ascending:false}),
    ]);
    const sm={}; (t||[]).forEach(s=>sm[s.id]=s);
    setStores(sm);setUsers(u||[]);setRecords(r||[]);
    setJuntaLideres(jl||[]);
    setJuntaCompromisos(jc||[]);
    setJuntaAcuerdos(ja||[]);
  };

  useEffect(()=>{ loadAll().then(()=>setBooting(false)); },[]);

  const login=(u)=>{setUser(u);setArea(null);setTab(u.role==="admin"?null:"checkin");};
  const logout=()=>{setUser(null);setArea(null);setTab(null);};
  const chooseArea=(a)=>{setArea(a);setTab(a==="junta"?"equipo":"dashboard");};
  const backToAreas=()=>{setArea(null);setTab(null);};
  const addRecord=(r)=>setRecords(prev=>[r,...prev]);
  const refreshAll=async()=>{ setRefreshing(true); await loadAll(); setRefreshing(false); };
  const refreshUserRecords=(newRecs)=>{ setRecords(prev=>{ const otros=prev.filter(r=>!(r.user_id===user?.id&&r.date===todayStr)); return [...newRecs,...otros]; }); };

  useInactivityLogout(logout, 5);

  if(booting) return <div style={{minHeight:"100vh",background:C.dark,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:font.body,color:C.textMuted,fontSize:14}}>Cargando...</div>;
  if(!user) return <LoginScreen onLogin={login}/>;
  if(user.role==="admin" && !area) return <AreaSelector user={user} onChoose={chooseArea} onLogout={logout}/>;

  const renderScreen=()=>{
    if(user.role==="admin"){
      if(area==="junta"){
        if(tab==="equipo")       return <JuntaEquipoTab lideres={juntaLideres} setLideres={setJuntaLideres}/>;
        if(tab==="seguimiento")  return <JuntaSeguimientoScreen lideres={juntaLideres} compromisos={juntaCompromisos} setCompromisos={setJuntaCompromisos}/>;
        if(tab==="guion")        return <JuntaGuionTab monitor={getMonitorActual(juntaLideres)} liderEquipo={juntaLideres.find(l=>l.lider_equipo)}/>;
        if(tab==="acuerdos")     return <JuntaAcuerdosTab user={user} acuerdos={juntaAcuerdos} setAcuerdos={setJuntaAcuerdos}/>;
      } else {
        if(tab==="dashboard") return <DashboardScreen records={records} stores={stores} isMobile={isMobile}/>;
        if(tab==="records")   return <RecordsScreen records={records} stores={stores} users={users} isMobile={isMobile}/>;
        if(tab==="users")     return <UsersScreen users={users} setUsers={setUsers}/>;
        if(tab==="stores")    return <StoresScreen stores={stores} setStores={setStores}/>;
        if(tab==="reports")   return <ReportsScreen records={records} users={users} stores={stores} isMobile={isMobile}/>;
      }
    } else {
      if(tab==="checkin")  return <CheckInScreen user={user} records={records} onRecord={addRecord} onRefresh={refreshUserRecords} stores={stores}/>;
      if(tab==="history")  return <HistoryScreen user={user} records={records} stores={stores}/>;
      if(tab==="schedule") return <ScheduleScreen/>;
    }
    return null;
  };

  if(isMobile) return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.dark,overflow:"hidden"}}>
      <MobileHeader user={user} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} onChangeArea={backToAreas}/>
      <main style={{flex:1,overflowY:"auto",padding:16}}>{renderScreen()}</main>
      <BottomNav tab={tab} setTab={setTab} isAdmin={user.role==="admin"} area={area}/>
    </div>
  );

  return (
    <div style={{display:"flex",height:"100vh",background:C.dark,fontFamily:font.body,overflow:"hidden"}}>
      <Sidebar tab={tab} setTab={setTab} user={user} area={area} onChangeArea={backToAreas} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing}/>
      <main style={{flex:1,overflowY:"auto",padding:"32px 36px"}}>{renderScreen()}</main>
    </div>
  );
}