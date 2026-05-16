
import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabaseClient";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  gold: "#193C53", goldLight: "#E5D5CC", goldDark: "#102938",
  black: "#0A0A0A", dark: "#0D1117", surface: "#161B22",
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

const EVENT_LABELS = { entrada:"Entrada", inicio_almuerzo:"Inicio Almuerzo", fin_almuerzo:"Fin Almuerzo", salida:"Salida" };
const EVENT_COLORS = { entrada:C.green, inicio_almuerzo:C.amber, fin_almuerzo:C.blue, salida:C.red };

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
    <div style={{ width:48, height:48, borderRadius:10, background:`${color}18`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>{icon}</div>
    <div>
      <div style={{ fontFamily:font.mono, fontSize:28, fontWeight:700, color, lineHeight:1 }}>{value}</div>
      <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:3 }}>{label}</div>
    </div>
  </Card>
);

const Divider = () => <div style={{ height:1, background:C.border, margin:"12px 0" }} />;

const PageHeader = ({ title, subtitle, action }) => (
  <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24 }}>
    <div>
      <h1 style={{ margin:0, fontFamily:font.body, fontSize:22, fontWeight:700, color:C.text }}>{title}</h1>
      {subtitle && <div style={{ fontFamily:font.body, fontSize:13, color:C.textMuted, marginTop:3 }}>{subtitle}</div>}
    </div>
    {action}
  </div>
);

// ── Camera Modal ──────────────────────────────────────────────────────────────
function CameraModal({ eventLabel, onCapture, onCancel }) {
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const streamRef  = useRef(null);
  const [ready, setReady]       = useState(false);
  const [captured, setCaptured] = useState(null);
  const [error, setError]       = useState(null);
  const [countdown, setCountdown] = useState(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width:640, height:480, facingMode:"user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); };
      }
    } catch {
      setError("No se pudo acceder a la cámara. Verifica los permisos del navegador.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  useEffect(() => { startCamera(); return () => stopCamera(); }, []);

  const takePhoto = () => {
    let c = 3;
    setCountdown(c);
    const iv = setInterval(() => {
      c--;
      if (c > 0) { setCountdown(c); }
      else {
        clearInterval(iv); setCountdown(null);
        const canvas = canvasRef.current;
        const video  = videoRef.current;
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0);
        setCaptured(canvas.toDataURL("image/jpeg", 0.85));
        stopCamera();
      }
    }, 1000);
  };

  const retake  = () => { setCaptured(null); startCamera(); };
  const confirm = () => onCapture(captured);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300 }}>
      <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, width:560, overflow:"hidden" }}>
        <div style={{ padding:"16px 20px", borderBottom:`1px solid ${C.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontFamily:font.body, fontWeight:600, fontSize:15, color:C.text }}>📸 Foto de verificación</div>
            <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:2 }}>Registro: <span style={{ color:C.amber, fontWeight:600 }}>{eventLabel}</span></div>
          </div>
          <Btn onClick={()=>{ stopCamera(); onCancel(); }} variant="ghost" sm>✕ Cancelar</Btn>
        </div>
        <div style={{ padding:20 }}>
          {error ? (
            <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:8, padding:"16px", textAlign:"center" }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📵</div>
              <div style={{ fontFamily:font.body, fontSize:13, color:C.red, fontWeight:600 }}>Sin acceso a la cámara</div>
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:4 }}>{error}</div>
            </div>
          ) : (
            <div style={{ position:"relative", borderRadius:10, overflow:"hidden", background:C.dark, aspectRatio:"4/3" }}>
              {!captured && <video ref={videoRef} autoPlay muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)", display: ready ? "block" : "none" }} />}
              {!ready && !captured && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Iniciando cámara...</div>}
              {countdown !== null && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.45)" }}>
                  <div style={{ fontFamily:font.mono, fontSize:96, fontWeight:700, color:"#fff" }}>{countdown}</div>
                </div>
              )}
              {captured && <img src={captured} alt="Captura" style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)" }} />}
              <canvas ref={canvasRef} style={{ display:"none" }} />
              {!captured && ready && countdown === null && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                  <div style={{ width:180, height:220, border:"2px dashed rgba(255,255,255,0.4)", borderRadius:"50%" }} />
                </div>
              )}
            </div>
          )}
          {!error && (
            <div style={{ marginTop:16, display:"flex", gap:10, justifyContent:"flex-end" }}>
              {!captured ? (
                <Btn onClick={takePhoto} disabled={!ready || countdown !== null}>
                  📷 {countdown !== null ? `Fotografiando en ${countdown}...` : "Tomar foto (3s)"}
                </Btn>
              ) : (
                <>
                  <Btn onClick={retake} variant="ghost">↩ Repetir</Btn>
                  <Btn onClick={confirm} variant="success">✓ Confirmar y registrar</Btn>
                </>
              )}
            </div>
          )}
          <div style={{ marginTop:12, fontFamily:font.body, fontSize:11, color:C.textMuted, textAlign:"center" }}>
            Ubica tu rostro dentro del óvalo antes de tomar la foto.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
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
      <div style={{ padding:"24px 20px 16px", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:font.body, fontWeight:800, fontSize:22, color:C.goldLight, letterSpacing:"0.12em" }}>OZEN</div>
        <div style={{ fontFamily:font.body, fontSize:10, color:C.textMuted, letterSpacing:"0.15em", marginTop:2 }}>JOYERÍA · CONTROL DE PERSONAL</div>
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
          <div style={{ width:34, height:34, borderRadius:8, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, fontSize:14, fontWeight:700, color:"#fff", flexShrink:0 }}>{user.name[0]}</div>
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

// ── SCREEN: Dashboard ─────────────────────────────────────────────────────────
function DashboardScreen({ records, stores }) {
  const todayRecs     = records.filter(r => r.date === todayStr);
  const activeAdvisors = new Set(todayRecs.map(r => r.user_id)).size;
  const byStore       = Object.values(stores).map(s => ({ ...s, count: todayRecs.filter(r => r.store === s.id).length }));
  const recent        = [...records].sort((a,b) => b.time.localeCompare(a.time)).slice(0, 8);

  return (
    <div>
      <PageHeader title="Panel General" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} />
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        <StatCard label="Registros hoy"    value={todayRecs.length}                        icon="📋" color={C.blue}  />
        <StatCard label="Asesores activos" value={activeAdvisors}                          icon="👥" color={C.green} />
        <StatCard label="Tiendas"          value={Object.keys(stores).length}              icon="🏬" color={C.gold}  />
        <StatCard label="Con foto"         value={todayRecs.filter(r=>r.photo_url).length} icon="📸" color={C.amber} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <Card>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:14 }}>Actividad por tienda</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>{["Tienda","Eventos"].map(h=><th key={h} style={{ textAlign:"left", fontFamily:font.body, fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em", paddingBottom:10, borderBottom:`1px solid ${C.border}` }}>{h}</th>)}</tr></thead>
            <tbody>
              {byStore.map((s,i)=>(
                <tr key={s.id}>
                  <td style={{ padding:"10px 0", fontFamily:font.body, fontSize:13, color:C.text, borderBottom: i<byStore.length-1?`1px solid ${C.border}`:"none" }}>{s.name}</td>
                  <td style={{ padding:"10px 0", borderBottom: i<byStore.length-1?`1px solid ${C.border}`:"none" }}><Badge color={s.count>0?C.green:C.textMuted} sm>{s.count} eventos</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:14 }}>Últimos eventos</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {recent.map(r=>(
              <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:8, height:8, borderRadius:99, background:EVENT_COLORS[r.event], flexShrink:0 }} />
                <div style={{ flex:1, fontFamily:font.body, fontSize:13, color:C.text }}>{r.user_name}</div>
                {r.photo_url && <span title="Con foto" style={{ fontSize:12 }}>📸</span>}
                <Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge>
                <div style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted, minWidth:40, textAlign:"right" }}>{r.time}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── SCREEN: Records ───────────────────────────────────────────────────────────
function RecordsScreen({ records, stores }) {
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
        <div onClick={()=>setViewPhoto(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, cursor:"pointer" }}>
          <div>
            <img src={viewPhoto} alt="Foto" style={{ maxWidth:"80vw", maxHeight:"80vh", borderRadius:10 }} />
            <div style={{ textAlign:"center", marginTop:12, fontFamily:font.body, fontSize:12, color:C.textMuted }}>Clic para cerrar</div>
          </div>
        </div>
      )}
      <PageHeader title="Registros de Asistencia" subtitle={`${filtered.length} eventos encontrados`} />
      <Card style={{ marginBottom:16 }} p="14px 16px">
        <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nombre..."
            style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", minWidth:200 }} />
          <select value={storeFilter} onChange={e=>setStoreFilter(e.target.value)}
            style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none" }}>
            <option value="all">Todas las tiendas</option>
            {Object.values(stores).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={eventFilter} onChange={e=>setEventFilter(e.target.value)}
            style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none" }}>
            <option value="all">Todos los eventos</option>
            {Object.entries(EVENT_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Card>
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
              <tr key={r.id} style={{ borderBottom: i<filtered.length-1?`1px solid ${C.border}`:"none", background: i%2===0?"transparent":`${C.surfaceAlt}44` }}>
                <td style={{ padding:"12px 16px", fontFamily:font.body, fontSize:13, color:C.text, fontWeight:500 }}>{r.user_name}</td>
                <td style={{ padding:"12px 16px", fontFamily:font.body, fontSize:13, color:C.textMuted }}>{stores[r.store]?.name}</td>
                <td style={{ padding:"12px 16px", fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{r.shift}</td>
                <td style={{ padding:"12px 16px" }}><Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge></td>
                <td style={{ padding:"12px 16px", fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{r.date}</td>
                <td style={{ padding:"12px 16px", fontFamily:font.mono, fontSize:13, color:EVENT_COLORS[r.event], fontWeight:600 }}>{r.time}</td>
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
    </div>
  );
}

// ── SCREEN: Users ─────────────────────────────────────────────────────────────
function UsersScreen({ users, setUsers }) {
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
      password: form.documento.trim(), // contraseña inicial = documento
      role: "advisor", active: true
    }).select().single();
    if (!error) { setUsers(prev => [...prev, data]); setForm({ name:"", documento:"" }); setShowForm(false); }
    setLoading(false);
  };

  const toggle = async (u) => {
    const { data } = await supabase.from("usuarios").update({ active: !u.active }).eq("id", u.id).select().single();
    if (data) setUsers(prev => prev.map(x => x.id===u.id ? data : x));
  };

  const startEdit = (u) => { setEditing(u.id); setEditVal({ name:u.name, documento:u.documento }); };

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
      <PageHeader title="Asesores" subtitle={`${advisors.length} asesores registrados`}
        action={<Btn onClick={()=>{ setShowForm(!showForm); setEditing(null); }}>{showForm?"Cancelar":"+ Nuevo asesor"}</Btn>}
      />
      {showForm && (
        <Card glow style={{ marginBottom:20, maxWidth:520 }}>
          <div style={{ fontFamily:font.body, fontSize:14, fontWeight:600, color:C.goldLight, marginBottom:16 }}>Nuevo asesor</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Nombre completo" value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="Nombre Apellido" />
            <Field label="N.º de documento" value={form.documento} onChange={v=>setForm(f=>({...f,documento:v}))} placeholder="Número de documento" />
          </div>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, marginBottom:12 }}>
            💡 La contraseña inicial será el mismo número de documento.
          </div>
          <Btn onClick={add} disabled={loading}>{loading ? "Guardando..." : "Crear asesor"}</Btn>
        </Card>
      )}
      <Card p="0">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              {["Asesor","Documento","Estado","Acciones"].map(h=>(
                <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontFamily:font.body, fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {advisors.map((u,i)=>(
              <tr key={u.id} style={{ borderBottom: i<advisors.length-1?`1px solid ${C.border}`:"none", opacity: u.active?1:0.55 }}>
                <td style={{ padding:"14px 16px" }}>
                  {editing===u.id
                    ? <input value={editVal.name} onChange={e=>setEditVal(p=>({...p,name:e.target.value}))}
                        style={{ background:C.surfaceAlt, border:`1px solid ${C.gold}`, borderRadius:6, padding:"6px 10px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none", width:180 }} />
                    : <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:34, height:34, borderRadius:8, background:C.gold, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, fontWeight:700, color:"#fff", flexShrink:0 }}>{u.name[0]}</div>
                        <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:500 }}>{u.name}</div>
                      </div>
                  }
                </td>
                <td style={{ padding:"14px 16px" }}>
                  {editing===u.id
                    ? <input value={editVal.documento} onChange={e=>setEditVal(p=>({...p,documento:e.target.value}))}
                        style={{ background:C.surfaceAlt, border:`1px solid ${C.gold}`, borderRadius:6, padding:"6px 10px", color:C.text, fontSize:13, fontFamily:font.mono, outline:"none", width:140 }} />
                    : <span style={{ fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{u.documento}</span>
                  }
                </td>
                <td style={{ padding:"14px 16px" }}><Badge color={u.active?C.green:C.red} sm>{u.active?"Activo":"Inactivo"}</Badge></td>
                <td style={{ padding:"14px 16px" }}>
                  <div style={{ display:"flex", gap:6 }}>
                    {editing===u.id ? (
                      <>
                        <Btn onClick={()=>saveEdit(u.id)} variant="success" sm>Guardar</Btn>
                        <Btn onClick={()=>setEditing(null)} variant="ghost" sm>Cancelar</Btn>
                      </>
                    ) : (
                      <>
                        <Btn onClick={()=>startEdit(u)} variant="ghost" sm>✏ Editar</Btn>
                        <Btn onClick={()=>toggle(u)} variant={u.active?"danger":"success"} sm>{u.active?"Desactivar":"Activar"}</Btn>
                        <Btn onClick={()=>deleteUser(u.id)} variant="danger" sm>🗑</Btn>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
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

  const startEdit = (s) => { setEditing(s.id); setEditVal({ name:s.name }); };

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
      <PageHeader title="Tiendas" subtitle="Administra los puntos de venta y sus turnos"
        action={<Btn onClick={()=>setShowForm(!showForm)}>{showForm?"Cancelar":"+ Nueva tienda"}</Btn>}
      />
      {showForm && (
        <Card glow style={{ marginBottom:20, maxWidth:400 }}>
          <div style={{ fontFamily:font.body, fontSize:14, fontWeight:600, color:C.goldLight, marginBottom:14 }}>Nueva tienda</div>
          <Field label="Nombre de la tienda" value={newName} onChange={setNewName} placeholder="Ej: Centenario" />
          <Btn onClick={addStore}>Crear tienda</Btn>
        </Card>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {Object.values(stores).map(s=>(
          <Card key={s.id} glow={editing===s.id}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
              <div style={{ flex:1 }}>
                {editing===s.id
                  ? <input value={editVal.name} onChange={e=>setEditVal(p=>({...p,name:e.target.value}))}
                      style={{ background:C.surfaceAlt, border:`1px solid ${C.gold}`, borderRadius:7, padding:"7px 11px", color:C.text, fontSize:16, fontFamily:font.body, outline:"none", width:"100%", fontWeight:700 }} />
                  : <div style={{ fontFamily:font.body, fontSize:16, fontWeight:700, color:C.goldLight }}>{s.name}</div>
                }
              </div>
              <div style={{ display:"flex", gap:6, marginLeft:10, flexShrink:0 }}>
                {editing===s.id ? (
                  <>
                    <Btn onClick={()=>saveEdit(s.id)} sm>Guardar</Btn>
                    <Btn onClick={()=>setEditing(null)} variant="ghost" sm>Cancelar</Btn>
                  </>
                ) : (
                  <>
                    <Btn onClick={()=>startEdit(s)} variant="ghost" sm>✏ Editar</Btn>
                    <Btn onClick={()=>deleteStore(s.id)} variant="danger" sm>🗑</Btn>
                  </>
                )}
              </div>
            </div>
            <Divider />
            <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:8 }}>Turnos ({s.shifts.length})</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10, minHeight:28 }}>
              {s.shifts.length===0 && <span style={{ fontFamily:font.body, fontSize:12, color:C.border }}>Sin turnos aún</span>}
              {s.shifts.map(sh=>(
                <div key={sh} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <Badge color={C.goldLight} sm>{sh}</Badge>
                  <button onClick={()=>removeShift(s.id,sh)}
                    style={{ background:C.redDim, border:`1px solid ${C.red}33`, color:C.red, borderRadius:4, width:18, height:18, cursor:"pointer", fontSize:10, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={newShift[s.id]||""} onChange={e=>setNewShift(p=>({...p,[s.id]:e.target.value}))}
                onKeyDown={e=>e.key==="Enter"&&addShift(s.id)} placeholder="Código turno (ej: UT5)"
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
  const [selStore, setSelStore]   = useState("");
  const [selShift, setSelShift]   = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toast, setToast]         = useState(null);

  const todayRecs = records.filter(r => r.user_id===user.id && r.date===todayStr);
  const lastEvent = todayRecs[todayRecs.length-1]?.event;
  const nextEvent = !lastEvent ? "entrada"
    : lastEvent==="entrada"         ? "inicio_almuerzo"
    : lastEvent==="inicio_almuerzo" ? "fin_almuerzo"
    : lastEvent==="fin_almuerzo"    ? "salida"
    : null;

  const handleCapture = async (photoBase64) => {
    setShowCamera(false);
    setRecording(true);

    let photo_url = null;
    try {
      const blob     = await fetch(photoBase64).then(r => r.blob());
      const fileName = `${user.id}_${Date.now()}.jpg`;
      const { data: uploadData } = await supabase.storage
        .from("fotos-registro").upload(fileName, blob, { contentType:"image/jpeg" });
      if (uploadData) {
        const { data: urlData } = supabase.storage.from("fotos-registro").getPublicUrl(fileName);
        photo_url = urlData.publicUrl;
      }
    } catch (e) { console.error("Error subiendo foto:", e); }

    const { data, error } = await supabase.from("registros").insert({
      user_id:   user.id,
      user_name: user.name,
      store:     selStore,
      shift:     selShift,
      event:     nextEvent,
      date:      todayStr,
      time:      fmtTime(new Date()),
      photo_url,
    }).select().single();

    if (!error) onRecord(data);
    setRecording(false);
    setToast(`✓ ${EVENT_LABELS[nextEvent]} registrada`);
    setTimeout(()=>setToast(null), 3000);
  };

  const canProceed = selStore && selShift && nextEvent;

  return (
    <div>
      {showCamera && <CameraModal eventLabel={EVENT_LABELS[nextEvent]} onCapture={handleCapture} onCancel={()=>setShowCamera(false)} />}
      {toast && (
        <div style={{ position:"fixed", top:20, right:20, background:C.greenDim, border:`1px solid ${C.green}`, borderRadius:10, padding:"12px 20px", color:C.green, fontFamily:font.body, fontSize:13, fontWeight:600, zIndex:200 }}>{toast}</div>
      )}
      <PageHeader title="Marcar Asistencia" subtitle={new Date().toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})} />
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          <Card>
            <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:14 }}>Seleccionar turno</div>
            <Field label="Tienda" value={selStore} onChange={v=>{setSelStore(v);setSelShift("");}}
              options={[{value:"",label:"Selecciona tienda"},...Object.values(stores).map(s=>({value:s.id,label:s.name}))]} />
            {selStore && stores[selStore]?.shifts?.length > 0 && (
              <Field label="Turno" value={selShift} onChange={setSelShift}
                options={[{value:"",label:"Selecciona turno"},...(stores[selStore]?.shifts||[]).map(s=>({value:s,label:s}))]} />
            )}
          </Card>
          {nextEvent ? (
            <Card>
              <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginBottom:4 }}>Próximo evento</div>
              <div style={{ fontFamily:font.body, fontSize:18, fontWeight:700, color:EVENT_COLORS[nextEvent], marginBottom:16 }}>{EVENT_LABELS[nextEvent]}</div>
              <div style={{ background:`${C.gold}10`, border:`1px solid ${C.borderGold}`, borderRadius:8, padding:"12px 14px", marginBottom:16, fontFamily:font.body, fontSize:12, color:C.textSub }}>
                📸 Se abrirá la cámara y se tomará una foto automáticamente. Asegúrate de que tu rostro sea visible.
              </div>
              <Btn onClick={()=>setShowCamera(true)} disabled={!canProceed||recording} full>
                {recording ? "Registrando..." : "📸 Abrir cámara y registrar"}
              </Btn>
            </Card>
          ) : (
            <Card>
              <div style={{ textAlign:"center", padding:"20px 0" }}>
                <div style={{ fontSize:40, marginBottom:10 }}>✅</div>
                <div style={{ fontFamily:font.body, fontSize:16, fontWeight:600, color:C.text }}>Jornada completa</div>
                <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:4 }}>Todos los eventos del día han sido registrados.</div>
              </div>
            </Card>
          )}
        </div>
        <Card>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:16 }}>Registro de hoy</div>
          {["entrada","inicio_almuerzo","fin_almuerzo","salida"].map((ev,i)=>{
            const rec    = todayRecs.find(r=>r.event===ev);
            const isNext = ev===nextEvent;
            return (
              <div key={ev} style={{ display:"flex", alignItems:"flex-start", gap:14, padding:"14px 0", borderBottom: i<3?`1px solid ${C.border}`:"none" }}>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:16, paddingTop:2 }}>
                  <div style={{ width:14, height:14, borderRadius:99, background: rec?EVENT_COLORS[ev]:C.border, boxShadow: rec?`0 0 10px ${EVENT_COLORS[ev]}`:"none" }} />
                  {i<3 && <div style={{ width:2, height:22, background: rec?EVENT_COLORS[ev]:C.border, marginTop:2, opacity:0.4 }} />}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color: rec?C.text:C.textMuted, fontWeight: rec?500:400 }}>{EVENT_LABELS[ev]}</div>
                  {isNext && !rec && <div style={{ fontFamily:font.body, fontSize:11, color:C.gold, marginTop:2 }}>Pendiente</div>}
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {rec?.photo_url && <span style={{ fontSize:14 }}>📸</span>}
                  <div style={{ fontFamily:font.mono, fontSize:14, color: rec?EVENT_COLORS[ev]:C.border, fontWeight:700 }}>{rec?rec.time:"--:--"}</div>
                </div>
              </div>
            );
          })}
        </Card>
      </div>
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
        <div onClick={()=>setViewPhoto(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:400, cursor:"pointer" }}>
          <img src={viewPhoto} alt="Foto" style={{ maxWidth:"80vw", maxHeight:"80vh", borderRadius:10 }} />
        </div>
      )}
      <PageHeader title="Mi Historial" subtitle="Todos mis registros de asistencia" />
      {Object.entries(grouped).map(([date,recs])=>(
        <div key={date} style={{ marginBottom:20 }}>
          <div style={{ fontFamily:font.body, fontSize:11, color:C.gold, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8, fontWeight:600 }}>
            {new Date(date+"T12:00:00").toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long"})}
          </div>
          <Card p="0">
            {recs.map((r,i)=>(
              <div key={r.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", borderBottom: i<recs.length-1?`1px solid ${C.border}`:"none" }}>
                <div style={{ width:36, height:36, borderRadius:8, background:`${EVENT_COLORS[r.event]}18`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <div style={{ width:10, height:10, borderRadius:99, background:EVENT_COLORS[r.event] }} />
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text }}>{EVENT_LABELS[r.event]}</div>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{stores[r.store]?.name} · Turno {r.shift}</div>
                </div>
                {r.photo_url && <button onClick={()=>setViewPhoto(r.photo_url)} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18 }}>📸</button>}
                <Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge>
                <div style={{ fontFamily:font.mono, fontSize:14, color:EVENT_COLORS[r.event], fontWeight:700, minWidth:50, textAlign:"right" }}>{r.time}</div>
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
      <Card glow style={{ maxWidth:480 }}>
        <div style={{ textAlign:"center", padding:"30px 0" }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
          <div style={{ fontFamily:font.body, fontSize:14, color:C.textMuted, marginBottom:16 }}>Tu malla horaria está disponible en Google Sheets.</div>
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
function LoginScreen({ onLogin }) {
  const [documento, setDocumento] = useState("");
  const [pass, setPass]           = useState("");
  const [err, setErr]             = useState("");
  const [loading, setLoading]     = useState(false);

  const handle = async () => {
    if (!documento.trim() || !pass) { setErr("Completa todos los campos."); return; }
    setLoading(true); setErr("");
    const { data, error } = await supabase
      .from("usuarios")
      .select("*")
      .eq("documento", documento.trim())
      .eq("password", pass)
      .eq("active", true)
      .single();
    if (data) onLogin(data);
    else if (error?.code === "PGRST116") setErr("Documento o contraseña incorrecta, o cuenta inactiva.");
    else setErr("Error de conexión. Intenta de nuevo.");
    setLoading(false);
  };

  const handleKey = (e) => { if (e.key === "Enter") handle(); };

  return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ width:400 }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontFamily:font.body, fontWeight:800, fontSize:36, color:C.goldLight, letterSpacing:"0.15em" }}>OZEN</div>
          <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, letterSpacing:"0.2em", marginTop:4 }}>JOYERÍA · CONTROL DE PERSONAL</div>
        </div>
        <Card glow>
          <div style={{ fontFamily:font.body, fontSize:18, fontWeight:600, color:C.text, marginBottom:20 }}>Iniciar sesión</div>
          <Field label="N.º de documento" value={documento} onChange={setDocumento} placeholder="Número de documento" />
          <Field label="Contraseña" type="password" value={pass} onChange={setPass} placeholder="••••••••" />
          {err && <div style={{ background:C.redDim, border:`1px solid ${C.red}44`, borderRadius:7, padding:"9px 12px", color:C.red, fontSize:12, marginBottom:12, fontFamily:font.body }}>{err}</div>}
          <Btn onClick={handle} disabled={loading} full style={{marginTop:4}} onKeyDown={handleKey}>
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

  // Cargar datos iniciales
  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: u }, { data: r }] = await Promise.all([
        supabase.from("tiendas").select("*"),
        supabase.from("usuarios").select("*"),
        supabase.from("registros").select("*").order("date", { ascending:false }),
      ]);
      const storesMap = {};
      (t||[]).forEach(s => storesMap[s.id] = s);
      setStores(storesMap);
      setUsers(u||[]);
      setRecords(r||[]);
      setBooting(false);
    };
    load();
  }, []);

  const login  = (u) => { setUser(u); setTab(u.role==="admin" ? "dashboard" : "checkin"); };
  const logout = () => { setUser(null); setTab(null); };
  const addRecord = (r) => setRecords(prev => [r, ...prev]);

  if (booting) return (
    <div style={{ minHeight:"100vh", background:C.dark, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.body, color:C.textMuted, fontSize:14 }}>
      Cargando...
    </div>
  );

  if (!user) return <LoginScreen onLogin={login} />;

  const renderScreen = () => {
    if (user.role==="admin") {
      if (tab==="dashboard") return <DashboardScreen records={records} stores={stores} />;
      if (tab==="records")   return <RecordsScreen records={records} stores={stores} />;
      if (tab==="users")     return <UsersScreen users={users} setUsers={setUsers} />;
      if (tab==="stores")    return <StoresScreen stores={stores} setStores={setStores} />;
    } else {
      if (tab==="checkin")  return <CheckInScreen user={user} records={records} onRecord={addRecord} stores={stores} />;
      if (tab==="history")  return <HistoryScreen user={user} records={records} stores={stores} />;
      if (tab==="schedule") return <ScheduleScreen />;
    }
    return null;
  };

  return (
    <div style={{ display:"flex", height:"100vh", background:C.dark, fontFamily:font.body, overflow:"hidden" }}>
      <Sidebar tab={tab} setTab={setTab} user={user} onLogout={logout} />
      <main style={{ flex:1, overflowY:"auto", padding:"32px 36px" }}>
        {renderScreen()}
      </main>
    </div>
  );
}