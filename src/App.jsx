
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabase";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  gold: "#193C53", goldLight: "#E5D5CC", goldDark: "#102938",
  dark: "#0D1117", surface: "#161B22",
  surfaceAlt: "#1C2430", surfaceHover: "#21262D", border: "#2D3748",
  borderGold: "rgba(229,213,204,0.18)", text: "#E6EDF3",
  textMuted: "#8B949E", textSub: "#C9D1D9",
  green: "#2ECC71", greenDim: "rgba(46,204,113,0.12)",
  red: "#E74C3C",   redDim: "rgba(231,76,60,0.12)",
  blue: "#3498DB",  blueDim: "rgba(52,152,219,0.12)",
  amber: "#F39C12", amberDim: "rgba(243,156,18,0.12)",
  sidebar: "#13191F",
};
const font = { body: "'Segoe UI', system-ui, sans-serif", mono: "monospace" };

const today    = new Date();
const fmt      = (d) => d.toISOString().split("T")[0];
const fmtTime  = (d) => d.toTimeString().slice(0, 5);
const todayStr = fmt(today);

const EVENT_LABELS = { entrada:"Entrada", inicio_almuerzo:"Inicio Almuerzo", fin_almuerzo:"Fin Almuerzo", salida:"Salida", omitido:"No registrado" };
const EVENT_COLORS = { entrada:C.green, inicio_almuerzo:C.amber, fin_almuerzo:C.blue, salida:C.red, omitido:C.red };

// ── Hook responsive ───────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ── UI Primitives ─────────────────────────────────────────────────────────────
const Badge = ({ color, children, sm }) => (
  <span style={{
    display:"inline-flex", alignItems:"center",
    padding: sm ? "2px 8px" : "3px 10px", borderRadius:99,
    fontSize: sm ? 10 : 11, fontWeight:600,
    background:`${color}20`, color, border:`1px solid ${color}40`,
    fontFamily:font.body, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap",
  }}>{children}</span>
);

const Btn = ({ onClick, children, variant="primary", sm, disabled, full, style={} }) => {
  const [hov, setHov] = useState(false);
  const base = {
    display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
    padding: sm ? "6px 14px" : "9px 18px", borderRadius:8, border:"none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: sm ? 12 : 13, fontWeight:600, fontFamily:font.body,
    transition:"all 0.15s", letterSpacing:"0.02em",
    opacity: disabled ? 0.4 : 1, width: full ? "100%" : undefined,
  };
  const styles = {
    primary: { background: hov ? "#1e4d6b" : C.gold, color:"#fff" },
    ghost:   { background: hov ? C.surfaceHover : "transparent", color:C.textSub, border:`1px solid ${C.border}` },
    danger:  { background: hov ? "rgba(231,76,60,0.22)" : C.redDim, color:C.red, border:`1px solid ${C.red}44` },
    success: { background: hov ? "rgba(46,204,113,0.22)" : C.greenDim, color:C.green, border:`1px solid ${C.green}44` },
  };
  return (
    <button style={{...base,...styles[variant],...style}}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      {children}
    </button>
  );
};

const Card = ({ children, style={}, glow, p="20px" }) => (
  <div style={{
    background:C.surface, borderRadius:10,
    border:`1px solid ${glow ? C.borderGold : C.border}`,
    padding:p,
    boxShadow: glow ? `0 0 20px ${C.gold}15` : "0 1px 3px rgba(0,0,0,0.3)",
    ...style
  }}>{children}</div>
);

const Field = ({ label, value, onChange, type="text", placeholder, options, disabled }) => (
  <div style={{ marginBottom:14 }}>
    {label && <div style={{ fontSize:11, color:C.textMuted, fontFamily:font.body, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.07em" }}>{label}</div>}
    {options ? (
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
        style={{ width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}>
        {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{ width:"100%", background: disabled ? C.dark : C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"9px 11px", color: disabled ? C.textMuted : C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box" }}
      />
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
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const [ready, setReady]         = useState(false);
  const [captured, setCaptured]   = useState(null);
  const [error, setError]         = useState(null);
  const [countdown, setCountdown] = useState(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, facingMode:"user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); };
      }
    } catch { setError("No se pudo acceder a la cámara. Verifica los permisos del navegador."); }
  }, []);

  const stopCamera = useCallback(() => { streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

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
        setCaptured(canvas.toDataURL("image/jpeg", 0.85));
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
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginTop:2 }}>Registro: <span style={{ color:C.amber, fontWeight:600 }}>{eventLabel}</span></div>
          </div>
          <Btn onClick={()=>{ stopCamera(); onCancel(); }} variant="ghost" sm>✕</Btn>
        </div>
        <div style={{ padding:16 }}>
          {error ? (
            <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:8, padding:"16px", textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>📵</div>
              <div style={{ fontFamily:font.body, fontSize:13, color:C.red, fontWeight:600 }}>Sin acceso a la cámara</div>
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:4 }}>{error}</div>
            </div>
          ) : (
            <div style={{ position:"relative", borderRadius:10, overflow:"hidden", background:C.dark, aspectRatio:"4/3" }}>
              {!captured && <video ref={videoRef} autoPlay muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)", display: ready ? "block" : "none" }} />}
              {!ready && !captured && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Iniciando cámara...</div>}
              {countdown !== null && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.45)" }}>
                  <div style={{ fontFamily:font.mono, fontSize:80, fontWeight:700, color:"#fff" }}>{countdown}</div>
                </div>
              )}
              {captured && <img src={captured} alt="Captura" style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)" }} />}
              <canvas ref={canvasRef} style={{ display:"none" }} />
              {!captured && ready && countdown === null && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                  <div style={{ width:140, height:180, border:"2px dashed rgba(255,255,255,0.4)", borderRadius:"50%" }} />
                </div>
              )}
            </div>
          )}
          {!error && (
            <div style={{ marginTop:12, display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
              {!captured ? (
                <Btn onClick={takePhoto} disabled={!ready || countdown !== null} full>
                  📷 {countdown !== null ? `Fotografiando en ${countdown}...` : "Tomar foto (3s)"}
                </Btn>
              ) : (
                <>
                  <Btn onClick={()=>{ setCaptured(null); startCamera(); }} variant="ghost">↩ Repetir</Btn>
                  <Btn onClick={()=>onCapture(captured)} variant="success">✓ Confirmar</Btn>
                </>
              )}
            </div>
          )}
          <div style={{ marginTop:10, fontFamily:font.body, fontSize:11, color:C.textMuted, textAlign:"center" }}>
            Ubica tu rostro dentro del óvalo.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bottom Nav (móvil) ────────────────────────────────────────────────────────
function BottomNav({ tab, setTab, isAdmin }) {
  const adminTabs   = [
    { id:"dashboard", icon:"📊", label:"Panel" },
    { id:"records",   icon:"📋", label:"Registros" },
    { id:"users",     icon:"👥", label:"Asesores" },
    { id:"stores",    icon:"🏬", label:"Tiendas" },
  ];
  const advisorTabs = [
    { id:"checkin",  icon:"📍", label:"Asistencia" },
    { id:"history",  icon:"📋", label:"Historial" },
    { id:"schedule", icon:"📅", label:"Turnos" },
  ];
  const tabs = isAdmin ? adminTabs : advisorTabs;

  return (
    <div style={{ display:"flex", borderTop:`1px solid ${C.border}`, background:C.sidebar, paddingBottom:"env(safe-area-inset-bottom, 8px)", flexShrink:0 }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            flex:1, padding:"10px 4px 8px", background:"none", border:"none",
            display:"flex", flexDirection:"column", alignItems:"center", gap:3,
            cursor:"pointer",
          }}>
            <div style={{ fontSize:20 }}>{t.icon}</div>
            <div style={{ fontSize:10, fontFamily:font.body, fontWeight:600, color: active ? C.goldLight : C.textMuted }}>{t.label}</div>
            {active && <div style={{ width:4, height:4, borderRadius:99, background:C.goldLight }} />}
          </button>
        );
      })}
    </div>
  );
}

// ── Sidebar (escritorio) ──────────────────────────────────────────────────────
function Sidebar({ tab, setTab, user, onLogout }) {
  const adminTabs   = [
    { id:"dashboard", icon:"📊", label:"Panel" },
    { id:"records",   icon:"📋", label:"Registros" },
    { id:"users",     icon:"👥", label:"Asesores" },
    { id:"stores",    icon:"🏬", label:"Tiendas" },
  ];
  const advisorTabs = [
    { id:"checkin",  icon:"📍", label:"Marcar Asistencia" },
    { id:"history",  icon:"📋", label:"Mi Historial" },
    { id:"schedule", icon:"📅", label:"Malla Horaria" },
  ];
  const tabs = user.role === "admin" ? adminTabs : advisorTabs;

  return (
    <div style={{ width:220, flexShrink:0, background:C.sidebar, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", height:"100%" }}>
      <div style={{ padding:"20px 16px", borderBottom:`1px solid ${C.border}` }}>
        <img src="/logo.png" alt="OZEN" style={{ width:100, height:"auto", marginBottom:4 }} />
        <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, letterSpacing:"0.15em", marginTop:2 }}>CONTROL DE PERSONAL</div>
      </div>
      <nav style={{ flex:1, padding:"12px 10px", display:"flex", flexDirection:"column", gap:2 }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:8, border:"none",
              background: active ? `${C.gold}18` : "transparent",
              borderLeft: active ? `3px solid ${C.goldLight}` : "3px solid transparent",
              color: active ? C.goldLight : C.textMuted,
              fontFamily:font.body, fontSize:13, fontWeight: active ? 600 : 400,
              cursor:"pointer", textAlign:"left", transition:"all 0.15s",
            }}>
              <span style={{ fontSize:16 }}>{t.icon}</span>{t.label}
            </button>
          );
        })}
      </nav>
      <div style={{ padding:"14px 16px", borderTop:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{user.name[0]}</div>
          <div>
            <div style={{ fontFamily:font.body, fontSize:12, color:C.text, fontWeight:600 }}>{user.name.split(" ")[0]}</div>
            <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.06em" }}>{user.role==="admin" ? "Administrador" : "Asesor"}</div>
          </div>
        </div>
        <Btn onClick={onLogout} variant="ghost" full sm>Cerrar sesión</Btn>
      </div>
    </div>
  );
}

// ── Mobile Header ─────────────────────────────────────────────────────────────
function MobileHeader({ user, onLogout }) {
  return (
    <div style={{ padding:"12px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:`1px solid ${C.border}`, background:C.sidebar, flexShrink:0 }}>
      <img src="/logo.png" alt="OZEN" style={{ width:70, height:"auto" }} />
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ fontFamily:font.body, fontSize:12, color:C.text }}>{user.name.split(" ")[0]}</div>
        <button onClick={onLogout} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"5px 10px", color:C.textMuted, fontSize:11, cursor:"pointer", fontFamily:font.body }}>Salir</button>
      </div>
    </div>
  );
}

// ── SCREEN: Dashboard ─────────────────────────────────────────────────────────
function DashboardScreen({ records, stores, isMobile }) {
  const todayRecs      = records.filter(r => r.date === todayStr);
  const activeAdvisors = new Set(todayRecs.map(r => r.user_id)).size;
  const byStore        = Object.values(stores).map(s => ({ ...s, count: todayRecs.filter(r => r.store === s.id && r.event !== "omitido").length }));
  const recent         = [...records].sort((a,b) => b.time.localeCompare(a.time)).slice(0, 8);

  // Jornadas incompletas: usuarios con al menos un evento omitido hoy
  const incompletas = new Set(todayRecs.filter(r => r.event === "omitido").map(r => r.user_id)).size;

  return (
    <div>
      <PageHeader title="Panel General" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} />
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4,1fr)", gap:10, marginBottom:16 }}>
        <StatCard label="Registros hoy"       value={todayRecs.filter(r=>r.event!=="omitido").length} icon="📋" color={C.blue}  />
        <StatCard label="Asesores activos"    value={activeAdvisors}                                  icon="👥" color={C.green} />
        <StatCard label="Jornadas incompletas" value={incompletas}                                    icon="⚠️" color={incompletas > 0 ? C.red : C.textMuted} />
        <StatCard label="Con foto"            value={todayRecs.filter(r=>r.photo_url).length}         icon="📸" color={C.amber} />
      </div>

      <Card style={{ marginBottom:16 }}>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>Actividad por tienda</div>
        {byStore.map((s,i)=>(
          <div key={s.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom: i<byStore.length-1?`1px solid ${C.border}`:"none" }}>
            <div style={{ fontFamily:font.body, fontSize:13, color:C.text }}>{s.name}</div>
            <Badge color={s.count>0?C.green:C.textMuted} sm>{s.count} eventos</Badge>
          </div>
        ))}
      </Card>

      <Card>
        <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:12 }}>Últimos eventos</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {recent.map(r=>(
            <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:8, height:8, borderRadius:99, background:EVENT_COLORS[r.event], flexShrink:0 }} />
              <div style={{ flex:1, fontFamily:font.body, fontSize:13, color:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.user_name}</div>
              {r.photo_url && <span style={{ fontSize:12 }}>📸</span>}
              <Badge color={EVENT_COLORS[r.event]} sm>{isMobile ? r.event.split("_")[0] : EVENT_LABELS[r.event]}</Badge>
              <div style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted, flexShrink:0 }}>{r.time}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── SCREEN: Records ───────────────────────────────────────────────────────────
function RecordsScreen({ records, stores, isMobile }) {
  const [storeFilter, setStoreFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [search, setSearch]           = useState("");
  const [viewPhoto, setViewPhoto]     = useState(null);

  const filtered = records
    .filter(r => storeFilter==="all" || r.store===storeFilter)
    .filter(r => eventFilter==="all" || r.event===eventFilter)
    .filter(r => r.user_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  return (
    <div>
      {viewPhoto && (
        <div onClick={()=>setViewPhoto(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, cursor:"pointer", padding:16 }}>
          <img src={viewPhoto} alt="Foto" style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:10 }} />
        </div>
      )}
      <PageHeader title="Registros" subtitle={`${filtered.length} eventos`} />

      {/* Filtros */}
      <Card style={{ marginBottom:12 }} p="12px">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nombre..."
          style={{ width:"100%", background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", boxSizing:"border-box", marginBottom:8 }} />
        <div style={{ display:"flex", gap:8 }}>
          <select value={storeFilter} onChange={e=>setStoreFilter(e.target.value)}
            style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}>
            <option value="all">Todas las tiendas</option>
            {Object.values(stores).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={eventFilter} onChange={e=>setEventFilter(e.target.value)}
            style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }}>
            <option value="all">Todos</option>
            {Object.entries(EVENT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Card>

      {/* En móvil: tarjetas. En escritorio: tabla */}
      {isMobile ? (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {filtered.map(r=>(
            <Card key={r.id} p="12px" style={{ borderColor: r.event==="omitido" ? `${C.red}66` : C.border, background: r.event==="omitido" ? `${C.red}08` : C.surface }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:6 }}>
                <div style={{ fontFamily:font.body, fontSize:13, color: r.event==="omitido" ? C.red : C.text, fontWeight:600 }}>{r.user_name}</div>
                <Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge>
              </div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{stores[r.store]?.name} · {r.shift}</div>
                  <div style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, marginTop:2 }}>{r.date}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {r.photo_url && <button onClick={()=>setViewPhoto(r.photo_url)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18 }}>📸</button>}
                  <div style={{ fontFamily:font.mono, fontSize:16, color:EVENT_COLORS[r.event], fontWeight:700 }}>{r.event==="omitido" ? "—" : r.time}</div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length===0 && <div style={{ textAlign:"center", padding:"40px", color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin registros.</div>}
        </div>
      ) : (
        <Card p="0">
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {["Asesor","Tienda","Turno","Evento","Fecha","Hora","Foto"].map(h=>(
                  <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontFamily:font.body, fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r,i)=>(
                <tr key={r.id} style={{ borderBottom: i<filtered.length-1?`1px solid ${C.border}`:"none", background: r.event==="omitido" ? `${C.red}10` : i%2===0?"transparent":`${C.surfaceAlt}44` }}>
                  <td style={{ padding:"12px 16px", fontFamily:font.body, fontSize:13, color: r.event==="omitido" ? C.red : C.text, fontWeight:500 }}>{r.user_name}</td>
                  <td style={{ padding:"12px 16px", fontFamily:font.body, fontSize:13, color:C.textMuted }}>{stores[r.store]?.name}</td>
                  <td style={{ padding:"12px 16px", fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{r.shift}</td>
                  <td style={{ padding:"12px 16px" }}><Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge></td>
                  <td style={{ padding:"12px 16px", fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{r.date}</td>
                  <td style={{ padding:"12px 16px", fontFamily:font.mono, fontSize:13, color:EVENT_COLORS[r.event], fontWeight:600 }}>{r.event==="omitido" ? "—" : r.time}</td>
                  <td style={{ padding:"12px 16px" }}>
                    {r.photo_url
                      ? <button onClick={()=>setViewPhoto(r.photo_url)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18 }}>📸</button>
                      : <span style={{ color:C.border, fontSize:12 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length===0 && <div style={{ textAlign:"center", padding:"40px", color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin registros.</div>}
        </Card>
      )}
    </div>
  );
}

// ── SCREEN: Users ─────────────────────────────────────────────────────────────
function UsersScreen({ users, setUsers, isMobile }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ name:"", documento:"" });
  const [editing, setEditing]   = useState(null);
  const [editVal, setEditVal]   = useState({});
  const [loading, setLoading]   = useState(false);
  const advisors = users.filter(u => u.role === "advisor");

  const add = async () => {
    if (!form.name.trim() || !form.documento.trim()) return;
    setLoading(true);
    const { data, error } = await supabase.from("usuarios").insert({
      name: form.name.trim(), documento: form.documento.trim(),
      password: form.documento.trim(), role: "advisor", active: true
    }).select().single();
    if (!error) { setUsers(prev => [...prev, data]); setForm({ name:"", documento:"" }); setShowForm(false); }
    setLoading(false);
  };

  const toggle = async (u) => {
    const { data } = await supabase.from("usuarios").update({ active: !u.active }).eq("id", u.id).select().single();
    if (data) setUsers(prev => prev.map(x => x.id===u.id ? data : x));
  };

  const saveEdit = async (id) => {
    if (!editVal.name.trim() || !editVal.documento.trim()) return;
    const { data } = await supabase.from("usuarios").update({ name:editVal.name.trim(), documento:editVal.documento.trim() }).eq("id", id).select().single();
    if (data) { setUsers(prev => prev.map(u => u.id===id ? data : u)); setEditing(null); }
  };

  const deleteUser = async (id) => {
    await supabase.from("usuarios").delete().eq("id", id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <div>
      <PageHeader title="Asesores" subtitle={`${advisors.length} asesores`}
        action={<Btn onClick={()=>{ setShowForm(!showForm); setEditing(null); }} sm>{showForm?"Cancelar":"+ Nuevo"}</Btn>}
      />
      {showForm && (
        <Card glow style={{ marginBottom:16 }}>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.goldLight, marginBottom:14 }}>Nuevo asesor</div>
          <Field label="Nombre completo" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="Nombre Apellido" />
          <Field label="N.º de documento" value={form.documento} onChange={v=>setForm(f=>({...f,documento:v}))} placeholder="Número de documento" />
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:12 }}>💡 La contraseña inicial será el número de documento.</div>
          <Btn onClick={add} disabled={loading} full>{loading ? "Guardando..." : "Crear asesor"}</Btn>
        </Card>
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {advisors.map(u=>(
          <Card key={u.id} p="14px" style={{ opacity: u.active?1:0.6 }}>
            {editing===u.id ? (
              <div>
                <Field label="Nombre" value={editVal.name} onChange={v=>setEditVal(p=>({...p,name:v}))} />
                <Field label="Documento" value={editVal.documento} onChange={v=>setEditVal(p=>({...p,documento:v}))} />
                <div style={{ display:"flex", gap:8 }}>
                  <Btn onClick={()=>saveEdit(u.id)} variant="success" sm full>Guardar</Btn>
                  <Btn onClick={()=>setEditing(null)} variant="ghost" sm full>Cancelar</Btn>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, fontWeight:700, color:"#fff", flexShrink:0 }}>{u.name[0]}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name}</div>
                  <div style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted }}>{u.documento}</div>
                </div>
                <Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge>
                <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                  <Btn onClick={()=>{ setEditing(u.id); setEditVal({ name:u.name, documento:u.documento }); }} variant="ghost" sm>✏</Btn>
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
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName]   = useState("");
  const [editing, setEditing]   = useState(null);
  const [editVal, setEditVal]   = useState({});
  const [newShift, setNewShift] = useState({});

  const addStore = async () => {
    if (!newName.trim()) return;
    const id = newName.trim().toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"");
    if (stores[id]) return;
    const { data } = await supabase.from("tiendas").insert({ id, name:newName.trim(), shifts:[] }).select().single();
    if (data) { setStores(prev=>({ ...prev, [data.id]:data })); setNewName(""); setShowForm(false); }
  };

  const deleteStore = async (id) => {
    await supabase.from("tiendas").delete().eq("id", id);
    setStores(prev=>{ const c={...prev}; delete c[id]; return c; });
  };

  const saveEdit = async (id) => {
    if (!editVal.name.trim()) return;
    const { data } = await supabase.from("tiendas").update({ name:editVal.name.trim() }).eq("id", id).select().single();
    if (data) { setStores(prev=>({ ...prev, [id]:data })); setEditing(null); }
  };

  const removeShift = async (sid, sh) => {
    const shifts = stores[sid].shifts.filter(x=>x!==sh);
    const { data } = await supabase.from("tiendas").update({ shifts }).eq("id", sid).select().single();
    if (data) setStores(prev=>({ ...prev, [sid]:data }));
  };

  const addShift = async (sid) => {
    const sh = (newShift[sid]||"").trim();
    if (!sh || stores[sid].shifts.includes(sh)) return;
    const shifts = [...stores[sid].shifts, sh];
    const { data } = await supabase.from("tiendas").update({ shifts }).eq("id", sid).select().single();
    if (data) { setStores(prev=>({ ...prev, [sid]:data })); setNewShift(p=>({...p,[sid]:""})); }
  };

  return (
    <div>
      <PageHeader title="Tiendas" subtitle="Puntos de venta y turnos"
        action={<Btn onClick={()=>setShowForm(!showForm)} sm>{showForm?"Cancelar":"+ Nueva"}</Btn>}
      />
      {showForm && (
        <Card glow style={{ marginBottom:16 }}>
          <Field label="Nombre de la tienda" value={newName} onChange={setNewName} placeholder="Ej: Centenario" />
          <Btn onClick={addStore} full>Crear tienda</Btn>
        </Card>
      )}
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {Object.values(stores).map(s=>(
          <Card key={s.id} glow={editing===s.id}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              {editing===s.id
                ? <input value={editVal.name} onChange={e=>setEditVal(p=>({...p,name:e.target.value}))}
                    style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.gold}`, borderRadius:7, padding:"7px 10px", color:C.text, fontSize:15, fontFamily:font.body, outline:"none", fontWeight:700 }} />
                : <div style={{ fontFamily:font.body, fontSize:15, fontWeight:700, color:C.goldLight }}>{s.name}</div>
              }
              <div style={{ display:"flex", gap:6, marginLeft:10, flexShrink:0 }}>
                {editing===s.id ? (
                  <>
                    <Btn onClick={()=>saveEdit(s.id)} sm>Guardar</Btn>
                    <Btn onClick={()=>setEditing(null)} variant="ghost" sm>✕</Btn>
                  </>
                ) : (
                  <>
                    <Btn onClick={()=>{ setEditing(s.id); setEditVal({ name:s.name }); }} variant="ghost" sm>✏</Btn>
                    <Btn onClick={()=>deleteStore(s.id)} variant="danger" sm>🗑</Btn>
                  </>
                )}
              </div>
            </div>
            <Divider />
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Turnos ({s.shifts.length})</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
              {s.shifts.length===0 && <span style={{ fontFamily:font.body, fontSize:12, color:C.border }}>Sin turnos</span>}
              {s.shifts.map(sh=>(
                <div key={sh} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <Badge color={C.goldLight} sm>{sh}</Badge>
                  <button onClick={()=>removeShift(s.id,sh)}
                    style={{ background:C.redDim, border:`1px solid ${C.red}33`, color:C.red, borderRadius:4, width:16, height:16, cursor:"pointer", fontSize:9, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={newShift[s.id]||""} onChange={e=>setNewShift(p=>({...p,[s.id]:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&addShift(s.id)} placeholder="Nuevo turno"
                style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"6px 10px", color:C.text, fontSize:12, fontFamily:font.body, outline:"none" }} />
              <Btn onClick={()=>addShift(s.id)} sm>+ Agregar</Btn>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN: Check-in ──────────────────────────────────────────────────────────
function CheckInScreen({ user, records, onRecord, stores }) {
  const [selStore, setSelStore]     = useState("");
  const [selShift, setSelShift]     = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [recording, setRecording]   = useState(false);
  const [toast, setToast]           = useState(null);

  const todayRecs = records.filter(r => r.user_id===user.id && r.date===todayStr);
  const lastEvent = todayRecs[todayRecs.length-1]?.event;
  const nextEvent = !lastEvent ? "entrada"
    : lastEvent==="entrada"         ? "inicio_almuerzo"
    : lastEvent==="inicio_almuerzo" ? "fin_almuerzo"
    : lastEvent==="fin_almuerzo"    ? "salida"
    : null;

  const handleCapture = async (photoBase64) => {
    setShowCamera(false); setRecording(true);
    let photo_url = null;
    try {
      const blob = await fetch(photoBase64).then(r => r.blob());
      const fileName = `${user.id}_${Date.now()}.jpg`;
      const { data: uploadData } = await supabase.storage.from("fotos-registro").upload(fileName, blob, { contentType:"image/jpeg" });
      if (uploadData) {
        const { data: urlData } = supabase.storage.from("fotos-registro").getPublicUrl(fileName);
        photo_url = urlData.publicUrl;
      }
    } catch(e) { console.error("Error subiendo foto:", e); }

    const { data, error } = await supabase.from("registros").insert({
      user_id: user.id, user_name: user.name, store: selStore, shift: selShift,
      event: nextEvent, date: todayStr, time: fmtTime(new Date()), photo_url,
    }).select().single();

    if (!error) onRecord(data);
    setRecording(false);
    setToast(`✓ ${EVENT_LABELS[nextEvent]} registrada`);
    setTimeout(()=>setToast(null), 3000);
  };

  return (
    <div>
      {showCamera && <CameraModal eventLabel={EVENT_LABELS[nextEvent]} onCapture={handleCapture} onCancel={()=>setShowCamera(false)} />}
      {toast && (
        <div style={{ position:"fixed", top:16, right:16, left:16, background:C.greenDim, border:`1px solid ${C.green}`, borderRadius:10, padding:"12px 16px", color:C.green, fontFamily:font.body, fontSize:13, fontWeight:600, zIndex:200, textAlign:"center" }}>{toast}</div>
      )}

      <PageHeader title="Marcar Asistencia" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})} />

      <Card style={{ marginBottom:12 }}>
        <Field label="Tienda" value={selStore} onChange={v=>{setSelStore(v);setSelShift("");}}
          options={[{value:"",label:"Selecciona tienda"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]} />
        {selStore && stores[selStore]?.shifts?.length > 0 && (
          <Field label="Turno" value={selShift} onChange={setSelShift}
            options={[{value:"",label:"Selecciona turno"},...(stores[selStore]?.shifts||[]).map(s=>({value:s,label:s}))]} />
        )}
      </Card>

      <Card style={{ marginBottom:12 }}>
        <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.07em" }}>Registro de hoy</div>
        {["entrada","inicio_almuerzo","fin_almuerzo","salida"].map((ev,i)=>{
          const rec = todayRecs.find(r=>r.event===ev);
          const isNext = ev===nextEvent;
          return (
            <div key={ev} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom: i<3?`1px solid ${C.border}`:"none" }}>
              <div style={{ width:12, height:12, borderRadius:99, background: rec?EVENT_COLORS[ev]:C.border, boxShadow: rec?`0 0 8px ${EVENT_COLORS[ev]}`:"none", flexShrink:0 }} />
              <div style={{ flex:1, fontFamily:font.body, fontSize:13, color: rec?C.text:C.textMuted }}>{EVENT_LABELS[ev]}</div>
              {isNext && !rec && <Badge color={C.gold} sm>Pendiente</Badge>}
              {rec?.photo_url && <span style={{ fontSize:12 }}>📸</span>}
              <div style={{ fontFamily:font.mono, fontSize:13, color: rec?EVENT_COLORS[ev]:C.border, fontWeight:700 }}>{rec?rec.time:"--:--"}</div>
            </div>
          );
        })}
      </Card>

      {nextEvent ? (
        <Card>
          <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginBottom:4 }}>Próximo evento</div>
          <div style={{ fontFamily:font.body, fontSize:18, fontWeight:700, color:EVENT_COLORS[nextEvent], marginBottom:14 }}>{EVENT_LABELS[nextEvent]}</div>
          <div style={{ background:`${C.gold}10`, border:`1px solid ${C.borderGold}`, borderRadius:8, padding:"10px 12px", marginBottom:14, fontFamily:font.body, fontSize:12, color:C.textSub }}>
            📸 Se abrirá la cámara y se tomará una foto. Asegúrate de que tu rostro sea visible.
          </div>
          <Btn onClick={()=>setShowCamera(true)} disabled={!selStore||!selShift||recording} full>
            {recording ? "Registrando..." : "📸 Abrir cámara y registrar"}
          </Btn>
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            <div style={{ fontSize:36, marginBottom:8 }}>✅</div>
            <div style={{ fontFamily:font.body, fontSize:15, fontWeight:600, color:C.text }}>Jornada completa</div>
            <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:4 }}>Todos los eventos del día registrados.</div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── SCREEN: History ───────────────────────────────────────────────────────────
function HistoryScreen({ user, records, stores }) {
  const [viewPhoto, setViewPhoto] = useState(null);
  const myRecs  = records.filter(r=>r.user_id===user.id).sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));
  const grouped = myRecs.reduce((acc,r)=>{ if(!acc[r.date])acc[r.date]=[]; acc[r.date].push(r); return acc; },{});

  return (
    <div>
      {viewPhoto && (
        <div onClick={()=>setViewPhoto(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, cursor:"pointer", padding:16 }}>
          <img src={viewPhoto} alt="Foto" style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:10 }} />
        </div>
      )}
      <PageHeader title="Mi Historial" subtitle="Mis registros de asistencia" />
      {Object.entries(grouped).map(([date,recs])=>(
        <div key={date} style={{ marginBottom:16 }}>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.gold, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8, fontWeight:600 }}>
            {new Date(date+"T12:00:00").toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})}
          </div>
          <Card p="0">
            {recs.map((r,i)=>(
              <div key={r.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderBottom: i<recs.length-1?`1px solid ${C.border}`:"none" }}>
                <div style={{ width:10, height:10, borderRadius:99, background:EVENT_COLORS[r.event], flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text }}>{EVENT_LABELS[r.event]}</div>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{stores[r.store]?.name}</div>
                </div>
                {r.photo_url && <button onClick={()=>setViewPhoto(r.photo_url)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:16 }}>📸</button>}
                <div style={{ fontFamily:font.mono, fontSize:14, color:EVENT_COLORS[r.event], fontWeight:700 }}>{r.time}</div>
              </div>
            ))}
          </Card>
        </div>
      ))}
      {myRecs.length===0 && <div style={{ textAlign:"center", padding:"60px 0", color:C.textMuted, fontFamily:font.body }}>Sin registros aún.</div>}
    </div>
  );
}

// ── SCREEN: Schedule ──────────────────────────────────────────────────────────
function ScheduleScreen() {
  return (
    <div>
      <PageHeader title="Malla Horaria" subtitle="Consulta tu programación semanal" />
      <Card glow>
        <div style={{ textAlign:"center", padding:"24px 0" }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
          <div style={{ fontFamily:font.body, fontSize:13, color:C.textMuted, marginBottom:16 }}>Tu malla horaria está disponible en Google Sheets.</div>
          <a href="https://docs.google.com/spreadsheets/d/1dQ3aPmKrvZXl7Njqvt_F36SIulnV6aenArLBk1bcTe0/edit?usp=sharing"
            target="_blank" rel="noreferrer"
            style={{ display:"inline-flex", alignItems:"center", gap:8, background:C.gold, color:"#fff", fontFamily:font.body, fontWeight:600, fontSize:14, padding:"11px 22px", borderRadius:8, textDecoration:"none" }}>
            Abrir malla horaria ↗
          </a>
        </div>
      </Card>
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [documento, setDocumento] = useState("");
  const [pass, setPass]           = useState("");
  const [err, setErr]             = useState("");
  const [loading, setLoading]     = useState(false);

  const handle = async () => {
    if (!documento.trim() || !pass) { setErr("Completa todos los campos."); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase.from("usuarios").select("*")
      .eq("documento", documento.trim()).eq("password", pass).eq("active", true).single();
    if (data) window.__loginCallback(data);
    else setErr("Documento o contraseña incorrecta, o cuenta inactiva.");
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ width:"100%", maxWidth:380 }}>
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <img src="/logo.png" alt="OZEN" style={{ width:140, height:"auto", marginBottom:12 }} />
          <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, letterSpacing:"0.2em" }}>CONTROL DE PERSONAL</div>
        </div>
        <Card glow>
          <div style={{ fontFamily:font.body, fontSize:17, fontWeight:600, color:C.text, marginBottom:18 }}>Iniciar sesión</div>
          <Field label="N.º de documento" value={documento} onChange={setDocumento} placeholder="Número de documento" />
          <Field label="Contraseña" type="password" value={pass} onChange={setPass} placeholder="••••••••" />
          {err && <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:7, padding:"9px 12px", color:C.red, fontSize:12, marginBottom:12, fontFamily:font.body }}>{err}</div>}
          <Btn onClick={handle} disabled={loading} full style={{marginTop:4}}>
            {loading ? "Verificando..." : "Ingresar"}
          </Btn>
        </Card>
      </div>
    </div>
  );
}

// ── APP SHELL ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]       = useState(null);
  const [tab, setTab]         = useState(null);
  const [records, setRecords] = useState([]);
  const [users, setUsers]     = useState([]);
  const [stores, setStores]   = useState({});
  const [booting, setBooting] = useState(true);
  const isMobile = useIsMobile();

  window.__loginCallback = (u) => { setUser(u); setTab(u.role==="admin" ? "dashboard" : "checkin"); };

  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: u }, { data: r }] = await Promise.all([
        supabase.from("tiendas").select("*"),
        supabase.from("usuarios").select("*"),
        supabase.from("registros").select("*").order("date", { ascending:false }),
      ]);
      const storesMap = {};
      (t||[]).forEach(s => storesMap[s.id] = s);
      setStores(storesMap); setUsers(u||[]); setRecords(r||[]);
      setBooting(false);
    };
    load();
  }, []);

  const logout    = () => { setUser(null); setTab(null); };
  const addRecord = (r) => setRecords(prev => [r, ...prev]);

  if (booting) return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, color:C.textMuted, fontSize:14 }}>
      Cargando...
    </div>
  );

  if (!user) return <LoginScreen />;

  const renderScreen = () => {
    if (user.role==="admin") {
      if (tab==="dashboard") return <DashboardScreen records={records} stores={stores} isMobile={isMobile} />;
      if (tab==="records")   return <RecordsScreen records={records} stores={stores} isMobile={isMobile} />;
      if (tab==="users")     return <UsersScreen users={users} setUsers={setUsers} isMobile={isMobile} />;
      if (tab==="stores")    return <StoresScreen stores={stores} setStores={setStores} />;
    } else {
      if (tab==="checkin")  return <CheckInScreen user={user} records={records} onRecord={addRecord} stores={stores} />;
      if (tab==="history")  return <HistoryScreen user={user} records={records} stores={stores} />;
      if (tab==="schedule") return <ScheduleScreen />;
    }
    return null;
  };

  // ── Layout móvil
  if (isMobile) {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100vh", background:C.dark, overflow:"hidden" }}>
        <MobileHeader user={user} onLogout={logout} />
        <main style={{ flex:1, overflowY:"auto", padding:"16px" }}>
          {renderScreen()}
        </main>
        <BottomNav tab={tab} setTab={setTab} isAdmin={user.role==="admin"} />
      </div>
    );
  }

  // ── Layout escritorio
  return (
    <div style={{ display:"flex", height:"100vh", background:C.dark, fontFamily:font.body, overflow:"hidden" }}>
      <Sidebar tab={tab} setTab={setTab} user={user} onLogout={logout} />
      <main style={{ flex:1, overflowY:"auto", padding:"32px 36px" }}>
        {renderScreen()}
      </main>
    </div>
  );
}