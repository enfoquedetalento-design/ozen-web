import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabase";

const C = {
  gold: "#265D7F", goldLight: "#E5D5CC", goldDark: "#1a3b52",
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

const ORDEN = ["entrada", "inicio_almuerzo", "fin_almuerzo", "salida"];

const EVENT_LABELS = {
  entrada: "Entrada", inicio_almuerzo: "Inicio Almuerzo",
  fin_almuerzo: "Fin Almuerzo", salida: "Salida", omitido: "No registrado"
};
const EVENT_COLORS = {
  entrada: C.green, inicio_almuerzo: C.amber,
  fin_almuerzo: C.blue, salida: C.red, omitido: C.red
};

// Fecha y hora en zona horaria Colombia
const toColombiaDate = (d = new Date()) =>
  new Date(d.toLocaleString("en-US", { timeZone: "America/Bogota" }));

const fmt = (d) => {
  const c = toColombiaDate(d);
  return `${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-${String(c.getDate()).padStart(2,"0")}`;
};
const fmtTime = (d) => {
  const c = toColombiaDate(d);
  return `${String(c.getHours()).padStart(2,"0")}:${String(c.getMinutes()).padStart(2,"0")}`;
};
const todayStr = fmt(new Date());

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return isMobile;
}

const Badge = ({ color, children, sm }) => (
  <span style={{
    display: "inline-flex", alignItems: "center",
    padding: sm ? "2px 8px" : "3px 10px", borderRadius: 99,
    fontSize: sm ? 10 : 11, fontWeight: 600,
    background: `${color}20`, color, border: `1px solid ${color}40`,
    fontFamily: font.body, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap",
  }}>{children}</span>
);

const Btn = ({ onClick, children, variant = "primary", sm, disabled, full, style = {} }) => {
  const [hov, setHov] = useState(false);
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: sm ? "6px 14px" : "9px 18px", borderRadius: 8, border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: sm ? 12 : 13, fontWeight: 600, fontFamily: font.body,
    transition: "all 0.15s", opacity: disabled ? 0.4 : 1,
    width: full ? "100%" : undefined,
  };
  const styles = {
    primary: { background: hov ? "#1e4d6b" : C.gold, color: "#fff" },
    ghost:   { background: hov ? C.surfaceHover : "transparent", color: C.textSub, border: `1px solid ${C.border}` },
    danger:  { background: hov ? "rgba(231,76,60,0.22)" : C.redDim, color: C.red, border: `1px solid ${C.red}44` },
    success: { background: hov ? "rgba(46,204,113,0.22)" : C.greenDim, color: C.green, border: `1px solid ${C.green}44` },
  };
  return (
    <button style={{ ...base, ...styles[variant], ...style }}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {children}
    </button>
  );
};

const Card = ({ children, style = {}, glow, p = "20px" }) => (
  <div style={{
    background: C.surface, borderRadius: 10,
    border: `1px solid ${glow ? C.borderGold : C.border}`,
    padding: p, boxShadow: glow ? `0 0 20px ${C.gold}15` : "0 1px 3px rgba(0,0,0,0.3)",
    ...style
  }}>{children}</div>
);

const Field = ({ label, value, onChange, type = "text", placeholder, options, disabled }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <div style={{ fontSize: 11, color: C.textMuted, fontFamily: font.body, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>}
    {options ? (
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        style={{ width: "100%", background: disabled ? C.dark : C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "9px 11px", color: disabled ? C.textMuted : C.text, fontSize: 13, fontFamily: font.body, outline: "none", boxSizing: "border-box" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{ width: "100%", background: disabled ? C.dark : C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "9px 11px", color: disabled ? C.textMuted : C.text, fontSize: 13, fontFamily: font.body, outline: "none", boxSizing: "border-box" }}
      />
    )}
  </div>
);

const StatCard = ({ label, value, icon, color }) => (
  <Card style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <div style={{ width: 44, height: 44, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
    <div>
      <div style={{ fontFamily: font.mono, fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted, marginTop: 3 }}>{label}</div>
    </div>
  </Card>
);

const Divider = () => <div style={{ height: 1, background: C.border, margin: "12px 0" }} />;

const PageHeader = ({ title, subtitle, action }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 10 }}>
    <div>
      <h1 style={{ margin: 0, fontFamily: font.body, fontSize: 20, fontWeight: 700, color: C.text }}>{title}</h1>
      {subtitle && <div style={{ fontFamily: font.body, fontSize: 12, color: C.textMuted, marginTop: 3 }}>{subtitle}</div>}
    </div>
    {action}
  </div>
);

// ── Camera Modal ──────────────────────────────────────────────────────────────
function CameraModal({ eventLabel, onCapture, onCancel }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady]         = useState(false);
  const [captured, setCaptured]   = useState(null);
  const [error, setError]         = useState(null);
  const [countdown, setCountdown] = useState(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => { videoRef.current.play(); setReady(true); };
      }
    } catch { setError("No se pudo acceder a la cámara. Verifica los permisos."); }
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 16 }}>
      <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, width: "100%", maxWidth: 520, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: font.body, fontWeight: 600, fontSize: 14, color: C.text }}>📸 Foto de verificación</div>
            <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted, marginTop: 2 }}>Evento: <span style={{ color: C.amber, fontWeight: 600 }}>{eventLabel}</span></div>
          </div>
          <Btn onClick={() => { stopCamera(); onCancel(); }} variant="ghost" sm>✕</Btn>
        </div>
        <div style={{ padding: 16 }}>
          {error ? (
            <div style={{ background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: 8, padding: 16, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📵</div>
              <div style={{ fontFamily: font.body, fontSize: 13, color: C.red, fontWeight: 600 }}>Sin acceso a la cámara</div>
              <div style={{ fontFamily: font.body, fontSize: 12, color: C.textMuted, marginTop: 4 }}>{error}</div>
            </div>
          ) : (
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: C.dark, aspectRatio: "4/3" }}>
              {!captured && <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: ready ? "block" : "none" }} />}
              {!ready && !captured && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontFamily: font.body, fontSize: 13 }}>Iniciando cámara...</div>}
              {countdown !== null && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)" }}>
                  <div style={{ fontFamily: font.mono, fontSize: 80, fontWeight: 700, color: "#fff" }}>{countdown}</div>
                </div>
              )}
              {captured && <img src={captured} alt="Captura" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />}
              <canvas ref={canvasRef} style={{ display: "none" }} />
              {!captured && ready && countdown === null && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <div style={{ width: 140, height: 180, border: "2px dashed rgba(255,255,255,0.4)", borderRadius: "50%" }} />
                </div>
              )}
            </div>
          )}
          {!error && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              {!captured ? (
                <Btn onClick={takePhoto} disabled={!ready || countdown !== null} full>
                  📷 {countdown !== null ? `Fotografiando en ${countdown}...` : "Tomar foto (3s)"}
                </Btn>
              ) : (
                <>
                  <Btn onClick={() => { setCaptured(null); startCamera(); }} variant="ghost">↩ Repetir</Btn>
                  <Btn onClick={() => onCapture(captured)} variant="success">✓ Confirmar</Btn>
                </>
              )}
            </div>
          )}
          <div style={{ marginTop: 10, fontFamily: font.body, fontSize: 11, color: C.textMuted, textAlign: "center" }}>Ubica tu rostro dentro del óvalo.</div>
        </div>
      </div>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────
function Sidebar({ tab, setTab, user, onLogout, onRefresh, refreshing }) {
  const adminTabs   = [{ id: "dashboard", icon: "📊", label: "Panel" }, { id: "records", icon: "📋", label: "Registros" }, { id: "users", icon: "👥", label: "Asesores" }, { id: "stores", icon: "🏬", label: "Tiendas" }, { id: "reports", icon: "📈", label: "Informes" }];
  const advisorTabs = [{ id: "checkin", icon: "📍", label: "Marcar Asistencia" }, { id: "history", icon: "📋", label: "Mi Historial" }, { id: "schedule", icon: "📅", label: "Malla Horaria" }];
  const tabs = user.role === "admin" ? adminTabs : advisorTabs;
  return (
    <div style={{ width: 220, flexShrink: 0, background: C.sidebar, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "20px 16px", borderBottom: `1px solid ${C.border}` }}>
        <img src="/logo.png" alt="OZEN" style={{ width: 100, height: "auto", marginBottom: 4 }} />
        <div style={{ fontFamily: font.body, fontSize: 10, color: C.textMuted, letterSpacing: "0.15em", marginTop: 2 }}>CONTROL DE PERSONAL</div>
      </div>
      <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        {tabs.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, border: "none",
              background: active ? `${C.gold}18` : "transparent",
              borderLeft: active ? `3px solid ${C.goldLight}` : "3px solid transparent",
              color: active ? C.goldLight : C.textMuted,
              fontFamily: font.body, fontSize: 13, fontWeight: active ? 600 : 400,
              cursor: "pointer", textAlign: "left", transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "14px 16px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.body, fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{user.name[0]}</div>
          <div>
            <div style={{ fontFamily: font.body, fontSize: 12, color: C.text, fontWeight: 600 }}>{user.name.split(" ")[0]}</div>
            <div style={{ fontFamily: font.body, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{user.role === "admin" ? "Administrador" : "Asesor"}</div>
          </div>
          <button onClick={onRefresh} disabled={refreshing} title="Actualizar datos" style={{ marginLeft: "auto", background: "none", border: "none", cursor: refreshing ? "not-allowed" : "pointer", fontSize: 16, opacity: refreshing ? 0.4 : 1, transition: "transform 0.4s", transform: refreshing ? "rotate(180deg)" : "rotate(0deg)" }}>🔄</button>
        </div>
        <Btn onClick={onLogout} variant="ghost" full sm>Cerrar sesión</Btn>
      </div>
    </div>
  );
}

function BottomNav({ tab, setTab, isAdmin }) {
  const adminTabs   = [{ id: "dashboard", icon: "📊", label: "Panel" }, { id: "records", icon: "📋", label: "Registros" }, { id: "users", icon: "👥", label: "Asesores" }, { id: "stores", icon: "🏬", label: "Tiendas" }, { id: "reports", icon: "📈", label: "Informes" }];
  const advisorTabs = [{ id: "checkin", icon: "📍", label: "Asistencia" }, { id: "history", icon: "📋", label: "Historial" }, { id: "schedule", icon: "📅", label: "Turnos" }];
  const tabs = isAdmin ? adminTabs : advisorTabs;
  return (
    <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, background: C.sidebar, paddingBottom: "env(safe-area-inset-bottom, 8px)", flexShrink: 0 }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "10px 4px 8px", background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" }}>
            <div style={{ fontSize: 20 }}>{t.icon}</div>
            <div style={{ fontSize: 10, fontFamily: font.body, fontWeight: 600, color: active ? C.goldLight : C.textMuted }}>{t.label}</div>
            {active && <div style={{ width: 4, height: 4, borderRadius: 99, background: C.goldLight }} />}
          </button>
        );
      })}
    </div>
  );
}

function MobileHeader({ user, onLogout, onRefresh, refreshing }) {
  return (
    <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}`, background: C.sidebar, flexShrink: 0 }}>
      <img src="/logo.png" alt="OZEN" style={{ width: 70, height: "auto" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onRefresh} disabled={refreshing} style={{ background: "none", border: "none", cursor: refreshing ? "not-allowed" : "pointer", fontSize: 18, opacity: refreshing ? 0.4 : 1, transition: "transform 0.3s", transform: refreshing ? "rotate(180deg)" : "rotate(0deg)" }}>🔄</button>
        <div style={{ fontFamily: font.body, fontSize: 12, color: C.text }}>{user.name.split(" ")[0]}</div>
        <button onClick={onLogout} style={{ background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "5px 10px", color: C.textMuted, fontSize: 11, cursor: "pointer", fontFamily: font.body }}>Salir</button>
      </div>
    </div>
  );
}

// ── SCREEN: Dashboard ─────────────────────────────────────────────────────────
function DashboardScreen({ records, stores, isMobile }) {
  const todayRecs = records.filter(r => r.date === todayStr);

  // Quiénes tienen entrada hoy
  const conEntrada = new Set(todayRecs.filter(r => r.event === "entrada").map(r => r.user_id));

  // Quiénes tienen cierre (salida real O omitido de salida)
  const conCierre = new Set(
    todayRecs
      .filter(r => r.event === "salida" || (r.event === "omitido" && r.time === "salida"))
      .map(r => r.user_id)
  );

  const trabajaronHoy = conEntrada.size;
  const enTurnoAhora  = [...conEntrada].filter(id => !conCierre.has(id)).length;
  const incompletas   = new Set(todayRecs.filter(r => r.event === "omitido").map(r => r.user_id)).size;

  const byStore = Object.values(stores).map(s => ({
    ...s, count: todayRecs.filter(r => r.store === s.id && r.event !== "omitido").length
  }));

  const recent = [...records]
    .filter(r => r.event !== "omitido")
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
    .slice(0, 8);

  // Quiénes están activos ahora (entrada pero sin cierre)
  const activosAhora = todayRecs
    .filter(r => r.event === "entrada" && !conCierre.has(r.user_id))
    .reduce((acc, r) => { if (!acc.find(x => x.user_id === r.user_id)) acc.push(r); return acc; }, []);

  return (
    <div>
      <PageHeader title="Panel General" subtitle={new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
        <StatCard label="Trabajaron hoy"       value={trabajaronHoy} icon="👥" color={C.green} />
        <StatCard label="En turno ahora"       value={enTurnoAhora}  icon="🟢" color={enTurnoAhora > 0 ? C.blue : C.textMuted} />
        <StatCard label="Jornadas incompletas" value={incompletas}   icon="⚠️" color={incompletas > 0 ? C.red : C.textMuted} />
      </div>

      {activosAhora.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: font.body, fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>🟢 En turno ahora</div>
          {activosAhora.map((r, i) => (
            <div key={r.user_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: i < activosAhora.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div>
                <div style={{ fontFamily: font.body, fontSize: 13, color: C.text }}>{r.user_name}</div>
                <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted }}>{stores[r.store]?.name}</div>
              </div>
              <div style={{ fontFamily: font.mono, fontSize: 12, color: C.green }}>Entrada {r.time}</div>
            </div>
          ))}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
        <Card>
          <div style={{ fontFamily: font.body, fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>Actividad por tienda</div>
          {byStore.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: i < byStore.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ fontFamily: font.body, fontSize: 13, color: C.text }}>{s.name}</div>
              <Badge color={s.count > 0 ? C.green : C.textMuted} sm>{s.count} eventos</Badge>
            </div>
          ))}
        </Card>
        <Card>
          <div style={{ fontFamily: font.body, fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12 }}>Últimos eventos</div>
          {recent.map(r => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 99, background: EVENT_COLORS[r.event], flexShrink: 0 }} />
              <div style={{ flex: 1, fontFamily: font.body, fontSize: 13, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.user_name}</div>
              <Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge>
              <div style={{ fontFamily: font.mono, fontSize: 12, color: C.textMuted, flexShrink: 0 }}>{r.time}</div>
            </div>
          ))}
        </Card>
      </div>
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
    .filter(r => storeFilter === "all" || r.store === storeFilter)
    .filter(r => eventFilter === "all" || r.event === eventFilter)
    .filter(r => r.user_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

  return (
    <div>
      {viewPhoto && (
        <div onClick={() => setViewPhoto(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, cursor: "pointer", padding: 16 }}>
          <img src={viewPhoto} alt="Foto" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 10 }} />
        </div>
      )}
      <PageHeader title="Registros" subtitle={`${filtered.length} eventos`} />
      <Card style={{ marginBottom: 12 }} p="12px">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre..."
          style={{ width: "100%", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 12px", color: C.text, fontSize: 13, fontFamily: font.body, outline: "none", boxSizing: "border-box", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
            style={{ flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: 8, color: C.text, fontSize: 12, fontFamily: font.body, outline: "none" }}>
            <option value="all">Todas las tiendas</option>
            {Object.values(stores).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={eventFilter} onChange={e => setEventFilter(e.target.value)}
            style={{ flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: 8, color: C.text, fontSize: 12, fontFamily: font.body, outline: "none" }}>
            <option value="all">Todos</option>
            {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Card>

      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(r => (
            <Card key={r.id} p="12px" style={{ borderColor: r.event === "omitido" ? `${C.red}66` : C.border, background: r.event === "omitido" ? `${C.red}08` : C.surface }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontFamily: font.body, fontSize: 13, color: r.event === "omitido" ? C.red : C.text, fontWeight: 600 }}>{r.user_name}</div>
                <Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted }}>{stores[r.store]?.name} · {r.shift}</div>
                  <div style={{ fontFamily: font.mono, fontSize: 11, color: C.textMuted, marginTop: 2 }}>{r.date}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {r.photo_url && <button onClick={() => setViewPhoto(r.photo_url)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>📸</button>}
                  <div style={{ fontFamily: font.mono, fontSize: 16, color: EVENT_COLORS[r.event], fontWeight: 700 }}>{r.event === "omitido" ? "—" : r.time}</div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.textMuted, fontFamily: font.body, fontSize: 13 }}>Sin registros.</div>}
        </div>
      ) : (
        <Card p="0">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Asesor", "Tienda", "Turno", "Evento", "Fecha", "Hora", "Foto"].map(h => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontFamily: font.body, fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none", background: r.event === "omitido" ? `${C.red}10` : i % 2 === 0 ? "transparent" : `${C.surfaceAlt}44` }}>
                  <td style={{ padding: "12px 16px", fontFamily: font.body, fontSize: 13, color: r.event === "omitido" ? C.red : C.text, fontWeight: 500 }}>{r.user_name}</td>
                  <td style={{ padding: "12px 16px", fontFamily: font.body, fontSize: 13, color: C.textMuted }}>{stores[r.store]?.name}</td>
                  <td style={{ padding: "12px 16px", fontFamily: font.mono, fontSize: 12, color: C.textMuted }}>{r.shift}</td>
                  <td style={{ padding: "12px 16px" }}><Badge color={EVENT_COLORS[r.event]} sm>{EVENT_LABELS[r.event]}</Badge></td>
                  <td style={{ padding: "12px 16px", fontFamily: font.mono, fontSize: 12, color: C.textMuted }}>{r.date}</td>
                  <td style={{ padding: "12px 16px", fontFamily: font.mono, fontSize: 13, color: EVENT_COLORS[r.event], fontWeight: 600 }}>{r.event === "omitido" ? "—" : r.time}</td>
                  <td style={{ padding: "12px 16px" }}>
                    {r.photo_url ? <button onClick={() => setViewPhoto(r.photo_url)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18 }}>📸</button>
                      : <span style={{ color: C.border, fontSize: 12 }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: C.textMuted, fontFamily: font.body, fontSize: 13 }}>Sin registros.</div>}
        </Card>
      )}
    </div>
  );
}

// ── SCREEN: Users ─────────────────────────────────────────────────────────────
function UsersScreen({ users, setUsers }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ name: "", documento: "" });
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
    if (!error) { setUsers(prev => [...prev, data]); setForm({ name: "", documento: "" }); setShowForm(false); }
    setLoading(false);
  };

  const toggle = async (u) => {
    const { data } = await supabase.from("usuarios").update({ active: !u.active }).eq("id", u.id).select().single();
    if (data) setUsers(prev => prev.map(x => x.id === u.id ? data : x));
  };

  const saveEdit = async (id) => {
    if (!editVal.name.trim() || !editVal.documento.trim()) return;
    const { data } = await supabase.from("usuarios").update({ name: editVal.name.trim(), documento: editVal.documento.trim() }).eq("id", id).select().single();
    if (data) { setUsers(prev => prev.map(u => u.id === id ? data : u)); setEditing(null); }
  };

  const deleteUser = async (id) => {
    await supabase.from("usuarios").delete().eq("id", id);
    setUsers(prev => prev.filter(u => u.id !== id));
  };

  return (
    <div>
      <PageHeader title="Asesores" subtitle={`${advisors.length} asesores`}
        action={<Btn onClick={() => { setShowForm(!showForm); setEditing(null); }} sm>{showForm ? "Cancelar" : "+ Nuevo"}</Btn>}
      />
      {showForm && (
        <Card glow style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: font.body, fontSize: 13, fontWeight: 600, color: C.goldLight, marginBottom: 14 }}>Nuevo asesor</div>
          <Field label="Nombre completo" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Nombre Apellido" />
          <Field label="N.º de documento" value={form.documento} onChange={v => setForm(f => ({ ...f, documento: v }))} placeholder="Número de documento" />
          <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted, marginBottom: 12 }}>💡 La contraseña inicial será el número de documento.</div>
          <Btn onClick={add} disabled={loading} full>{loading ? "Guardando..." : "Crear asesor"}</Btn>
        </Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {advisors.map(u => (
          <Card key={u.id} p="14px" style={{ opacity: u.active ? 1 : 0.6 }}>
            {editing === u.id ? (
              <div>
                <Field label="Nombre" value={editVal.name} onChange={v => setEditVal(p => ({ ...p, name: v }))} />
                <Field label="Documento" value={editVal.documento} onChange={v => setEditVal(p => ({ ...p, documento: v }))} />
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn onClick={() => saveEdit(u.id)} variant="success" sm full>Guardar</Btn>
                  <Btn onClick={() => setEditing(null)} variant="ghost" sm full>Cancelar</Btn>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: C.gold, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.body, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: font.body, fontSize: 13, color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</div>
                  <div style={{ fontFamily: font.mono, fontSize: 11, color: C.textMuted }}>{u.documento}</div>
                </div>
                <Badge color={u.active ? C.green : C.red} sm>{u.active ? "Activo" : "Inactivo"}</Badge>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <Btn onClick={() => { setEditing(u.id); setEditVal({ name: u.name, documento: u.documento }); }} variant="ghost" sm>✏</Btn>
                  <Btn onClick={() => toggle(u)} variant={u.active ? "danger" : "success"} sm>{u.active ? "✕" : "✓"}</Btn>
                  <Btn onClick={() => deleteUser(u.id)} variant="danger" sm>🗑</Btn>
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
    const id = newName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (stores[id]) return;
    const { data } = await supabase.from("tiendas").insert({ id, name: newName.trim(), shifts: [] }).select().single();
    if (data) { setStores(prev => ({ ...prev, [data.id]: data })); setNewName(""); setShowForm(false); }
  };

  const deleteStore = async (id) => {
    await supabase.from("tiendas").delete().eq("id", id);
    setStores(prev => { const c = { ...prev }; delete c[id]; return c; });
  };

  const saveEdit = async (id) => {
    if (!editVal.name.trim()) return;
    const { data } = await supabase.from("tiendas").update({ name: editVal.name.trim() }).eq("id", id).select().single();
    if (data) { setStores(prev => ({ ...prev, [id]: data })); setEditing(null); }
  };

  const removeShift = async (sid, sh) => {
    const shifts = stores[sid].shifts.filter(x => x !== sh);
    const { data } = await supabase.from("tiendas").update({ shifts }).eq("id", sid).select().single();
    if (data) setStores(prev => ({ ...prev, [sid]: data }));
  };

  const addShift = async (sid) => {
    const sh = (newShift[sid] || "").trim();
    if (!sh || stores[sid].shifts.includes(sh)) return;
    const shifts = [...stores[sid].shifts, sh];
    const { data } = await supabase.from("tiendas").update({ shifts }).eq("id", sid).select().single();
    if (data) { setStores(prev => ({ ...prev, [sid]: data })); setNewShift(p => ({ ...p, [sid]: "" })); }
  };

  return (
    <div>
      <PageHeader title="Tiendas" subtitle="Puntos de venta y turnos"
        action={<Btn onClick={() => setShowForm(!showForm)} sm>{showForm ? "Cancelar" : "+ Nueva"}</Btn>}
      />
      {showForm && (
        <Card glow style={{ marginBottom: 16 }}>
          <Field label="Nombre de la tienda" value={newName} onChange={setNewName} placeholder="Ej: Centenario" />
          <Btn onClick={addStore} full>Crear tienda</Btn>
        </Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.values(stores).map(s => (
          <Card key={s.id} glow={editing === s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              {editing === s.id
                ? <input value={editVal.name} onChange={e => setEditVal(p => ({ ...p, name: e.target.value }))}
                    style={{ flex: 1, background: C.surfaceAlt, border: `1px solid ${C.gold}`, borderRadius: 7, padding: "7px 10px", color: C.text, fontSize: 15, fontFamily: font.body, outline: "none", fontWeight: 700 }} />
                : <div style={{ fontFamily: font.body, fontSize: 15, fontWeight: 700, color: C.goldLight }}>{s.name}</div>
              }
              <div style={{ display: "flex", gap: 6, marginLeft: 10, flexShrink: 0 }}>
                {editing === s.id
                  ? <><Btn onClick={() => saveEdit(s.id)} sm>Guardar</Btn><Btn onClick={() => setEditing(null)} variant="ghost" sm>✕</Btn></>
                  : <><Btn onClick={() => { setEditing(s.id); setEditVal({ name: s.name }); }} variant="ghost" sm>✏</Btn><Btn onClick={() => deleteStore(s.id)} variant="danger" sm>🗑</Btn></>
                }
              </div>
            </div>
            <Divider />
            <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Turnos ({s.shifts.length})</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {s.shifts.length === 0 && <span style={{ fontFamily: font.body, fontSize: 12, color: C.border }}>Sin turnos</span>}
              {s.shifts.map(sh => (
                <div key={sh} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Badge color={C.goldLight} sm>{sh}</Badge>
                  <button onClick={() => removeShift(s.id, sh)}
                    style={{ background: C.redDim, border: `1px solid ${C.red}33`, color: C.red, borderRadius: 4, width: 16, height: 16, cursor: "pointer", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newShift[s.id] || ""} onChange={e => setNewShift(p => ({ ...p, [s.id]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addShift(s.id)} placeholder="Nuevo turno"
                style={{ flex: 1, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 10px", color: C.text, fontSize: 12, fontFamily: font.body, outline: "none" }} />
              <Btn onClick={() => addShift(s.id)} sm>+ Agregar</Btn>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── SCREEN: CheckIn ───────────────────────────────────────────────────────────
function CheckInScreen({ user, records, onRecord, onRefresh, stores }) {
  const [selStore, setSelStore]     = useState("");
  const [selShift, setSelShift]     = useState("");
  const [locked, setLocked]         = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [recording, setRecording]   = useState(false);
  const [toast, setToast]           = useState(null);

  // Si ya tiene registros hoy, precargar tienda/turno y bloquear
  useEffect(() => {
    const hoy = records.filter(r => r.user_id === user.id && r.date === todayStr && r.event !== "omitido");
    if (hoy.length > 0) {
      setSelStore(hoy[0].store);
      setSelShift(hoy[0].shift);
      setLocked(true);
    }
  }, [records]);

  const todayRecs     = records.filter(r => r.user_id === user.id && r.date === todayStr);
  const eventosReales = todayRecs.filter(r => r.event !== "omitido").map(r => r.event);
  const ultimoReal    = [...ORDEN].reverse().find(e => eventosReales.includes(e));
  const nextEvent     = !ultimoReal ? "entrada"
    : ultimoReal === "entrada"         ? "inicio_almuerzo"
    : ultimoReal === "inicio_almuerzo" ? "fin_almuerzo"
    : ultimoReal === "fin_almuerzo"    ? "salida"
    : null;

  const refreshTodayRecs = async () => {
    const { data } = await supabase.from("registros").select("*").eq("user_id", user.id).eq("date", todayStr);
    if (data) onRefresh(data);
  };

  const handleCapture = async (photoBase64) => {
    setShowCamera(false); setRecording(true);
    let photo_url = null;
    try {
      const blob = await fetch(photoBase64).then(r => r.blob());
      const fileName = `${user.id}_${Date.now()}.jpg`;
      const { data: up } = await supabase.storage.from("fotos-registro").upload(fileName, blob, { contentType: "image/jpeg" });
      if (up) {
        const { data: ud } = supabase.storage.from("fotos-registro").getPublicUrl(fileName);
        photo_url = ud.publicUrl;
      }
    } catch (e) { console.error(e); }

    const { data, error } = await supabase.from("registros").insert({
      user_id: user.id, user_name: user.name, store: selStore, shift: selShift,
      event: nextEvent, date: todayStr, time: fmtTime(new Date()), photo_url,
    }).select().single();

    if (!error) {
      onRecord(data);
      setLocked(true);
      await refreshTodayRecs();
    }
    setRecording(false);
    setToast(`✓ ${EVENT_LABELS[nextEvent]} registrada`);
    setTimeout(() => setToast(null), 3000);
  };

  const canProceed = selStore && selShift && nextEvent;

  return (
    <div>
      {showCamera && <CameraModal eventLabel={EVENT_LABELS[nextEvent]} onCapture={handleCapture} onCancel={() => setShowCamera(false)} />}
      {toast && (
        <div style={{ position: "fixed", top: 16, right: 16, left: 16, background: C.greenDim, border: `1px solid ${C.green}`, borderRadius: 10, padding: "12px 16px", color: C.green, fontFamily: font.body, fontSize: 13, fontWeight: 600, zIndex: 200, textAlign: "center" }}>{toast}</div>
      )}
      <PageHeader title="Marcar Asistencia" subtitle={new Date().toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })} />

      <Card style={{ marginBottom: 12 }}>
        <Field label="Tienda" value={selStore} onChange={v => { setSelStore(v); setSelShift(""); }} disabled={locked}
          options={[{ value: "", label: "Selecciona tienda" }, ...Object.values(stores).map(s => ({ value: s.id, label: s.name }))]} />
        {selStore && stores[selStore]?.shifts?.length > 0 && (
          <Field label="Turno" value={selShift} onChange={setSelShift} disabled={locked}
            options={[{ value: "", label: "Selecciona turno" }, ...(stores[selStore]?.shifts || []).map(s => ({ value: s, label: s }))]} />
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: font.body, fontSize: 12, color: C.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Registro de hoy</div>
        {ORDEN.map((ev, i) => {
          const rec    = todayRecs.find(r => r.event === ev);
          const isNext = ev === nextEvent;
          return (
            <div key={ev} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < 3 ? `1px solid ${C.border}` : "none" }}>
              <div style={{ width: 12, height: 12, borderRadius: 99, background: rec ? EVENT_COLORS[ev] : C.border, boxShadow: rec ? `0 0 8px ${EVENT_COLORS[ev]}` : "none", flexShrink: 0 }} />
              <div style={{ flex: 1, fontFamily: font.body, fontSize: 13, color: rec ? C.text : C.textMuted }}>{EVENT_LABELS[ev]}</div>
              {isNext && !rec && <Badge color={C.gold} sm>Pendiente</Badge>}
              {rec?.photo_url && <span style={{ fontSize: 12 }}>📸</span>}
              <div style={{ fontFamily: font.mono, fontSize: 13, color: rec ? EVENT_COLORS[ev] : C.border, fontWeight: 700 }}>{rec ? rec.time : "--:--"}</div>
            </div>
          );
        })}
      </Card>

      {nextEvent ? (
        <Card>
          <div style={{ fontFamily: font.body, fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Próximo evento</div>
          <div style={{ fontFamily: font.body, fontSize: 18, fontWeight: 700, color: EVENT_COLORS[nextEvent], marginBottom: 14 }}>{EVENT_LABELS[nextEvent]}</div>
          <div style={{ background: `${C.gold}10`, border: `1px solid ${C.borderGold}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontFamily: font.body, fontSize: 12, color: C.textSub }}>
            📸 Se abrirá la cámara y se tomará una foto. Asegúrate de que tu rostro sea visible.
          </div>
          <Btn onClick={() => setShowCamera(true)} disabled={!canProceed || recording} full>
            {recording ? "Registrando..." : "📸 Abrir cámara y registrar"}
          </Btn>
        </Card>
      ) : (
        <Card>
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <div style={{ fontFamily: font.body, fontSize: 15, fontWeight: 600, color: C.text }}>Jornada completa</div>
            <div style={{ fontFamily: font.body, fontSize: 12, color: C.textMuted, marginTop: 4 }}>Todos los eventos del día registrados.</div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── SCREEN: History ───────────────────────────────────────────────────────────
function HistoryScreen({ user, records, stores }) {
  const [viewPhoto, setViewPhoto] = useState(null);
  const myRecs  = records.filter(r => r.user_id === user.id).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  const grouped = myRecs.reduce((acc, r) => { if (!acc[r.date]) acc[r.date] = []; acc[r.date].push(r); return acc; }, {});

  return (
    <div>
      {viewPhoto && (
        <div onClick={() => setViewPhoto(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, cursor: "pointer", padding: 16 }}>
          <img src={viewPhoto} alt="Foto" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 10 }} />
        </div>
      )}
      <PageHeader title="Mi Historial" subtitle="Mis registros de asistencia" />
      {Object.entries(grouped).map(([date, recs]) => (
        <div key={date} style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: font.body, fontSize: 11, color: C.gold, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontWeight: 600 }}>
            {new Date(date + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <Card p="0">
            {recs.map((r, i) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < recs.length - 1 ? `1px solid ${C.border}` : "none", background: r.event === "omitido" ? `${C.red}08` : "transparent" }}>
                <div style={{ width: 10, height: 10, borderRadius: 99, background: EVENT_COLORS[r.event], flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: font.body, fontSize: 13, color: r.event === "omitido" ? C.red : C.text }}>{EVENT_LABELS[r.event]}</div>
                  <div style={{ fontFamily: font.body, fontSize: 11, color: C.textMuted }}>{stores[r.store]?.name}</div>
                </div>
                {r.photo_url && <button onClick={() => setViewPhoto(r.photo_url)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16 }}>📸</button>}
                <div style={{ fontFamily: font.mono, fontSize: 14, color: EVENT_COLORS[r.event], fontWeight: 700 }}>{r.event === "omitido" ? "—" : r.time}</div>
              </div>
            ))}
          </Card>
        </div>
      ))}
      {myRecs.length === 0 && <div style={{ textAlign: "center", padding: 60, color: C.textMuted, fontFamily: font.body }}>Sin registros aún.</div>}
    </div>
  );
}

// ── SCREEN: Schedule ──────────────────────────────────────────────────────────
function ScheduleScreen() {
  return (
    <div>
      <PageHeader title="Malla Horaria" subtitle="Consulta tu programación semanal" />
      <Card glow>
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
          <div style={{ fontFamily: font.body, fontSize: 13, color: C.textMuted, marginBottom: 16 }}>Tu malla horaria está disponible en Google Sheets.</div>
          <a href="https://docs.google.com/spreadsheets/d/1dQ3aPmKrvZXl7Njqvt_F36SIulnV6aenArLBk1bcTe0/edit?usp=sharing"
            target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.gold, color: "#fff", fontFamily: font.body, fontWeight: 600, fontSize: 14, padding: "11px 22px", borderRadius: 8, textDecoration: "none" }}>
            Abrir malla horaria ↗
          </a>
        </div>
      </Card>
    </div>
  );
}

// ── SCREEN: Reports ──────────────────────────────────────────────────────────
function ReportsScreen({ records, users, stores, isMobile }) {
  const now = toColombiaDate();
  const [mes, setMes] = useState(now.getMonth());
  const [anio, setAnio] = useState(now.getFullYear());

  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  // Filtrar registros del mes seleccionado
  const prefix = `${anio}-${String(mes+1).padStart(2,"0")}`;
  const recsMes = records.filter(r => r.date.startsWith(prefix));

  // Asesores activos (solo advisors)
  const advisors = users.filter(u => u.role === "advisor" && u.active);

  // Por asesor
  const porAsesor = advisors.map(u => {
    const recs = recsMes.filter(r => r.user_id === u.id);
    const dias = new Set(recs.filter(r => r.event === "entrada").map(r => r.date));
    const completas = [...dias].filter(d => {
      const eventos = recs.filter(r => r.date === d && r.event !== "omitido").map(r => r.event);
      return ORDEN.every(e => eventos.includes(e));
    });
    const incompletas = [...dias].filter(d => {
      return recs.some(r => r.date === d && r.event === "omitido");
    });
    const entradas = recs.filter(r => r.event === "entrada").sort((a,b) => b.date.localeCompare(a.date));
    return {
      id: u.id, nombre: u.name,
      dias: dias.size,
      completas: completas.length,
      incompletas: incompletas.length,
      ultimoDia: entradas[0]?.date || null,
    };
  }).sort((a,b) => b.dias - a.dias);

  // Por tienda
  const porTienda = Object.values(stores).map(s => ({
    nombre: s.name,
    entradas: recsMes.filter(r => r.store === s.id && r.event === "entrada").length,
  })).sort((a,b) => b.entradas - a.entradas);

  // Jornadas incompletas detalle
  const jornadasIncompletas = [];
  recsMes.filter(r => r.event === "omitido").forEach(r => {
    if (!jornadasIncompletas.find(j => j.userId === r.user_id && j.date === r.date && j.evento === r.time)) {
      jornadasIncompletas.push({ userId: r.user_id, nombre: r.user_name, date: r.date, evento: r.time, tienda: stores[r.store]?.name });
    }
  });
  jornadasIncompletas.sort((a,b) => b.date.localeCompare(a.date));

  // Resumen general
  const totalDias      = porAsesor.reduce((s,a) => s + a.dias, 0);
  const totalCompletas = porAsesor.reduce((s,a) => s + a.completas, 0);
  const totalIncompletas = porAsesor.reduce((s,a) => s + a.incompletas, 0);
  const promDias = porAsesor.filter(a=>a.dias>0).length > 0
    ? (totalDias / porAsesor.filter(a=>a.dias>0).length).toFixed(1) : 0;

  // Calcular horas por asesor por día
  const calcHoras = (userId) => {
    const dias = [...new Set(recsMes.filter(r => r.user_id === userId && r.event === "entrada").map(r => r.date))];
    let totalBrutas = 0, totalAlmuerzo = 0;
    dias.forEach(d => {
      const rDia = recsMes.filter(r => r.user_id === userId && r.date === d);
      const entrada     = rDia.find(r => r.event === "entrada")?.time;
      const salida      = rDia.find(r => r.event === "salida")?.time;
      const iniAlmuerzo = rDia.find(r => r.event === "inicio_almuerzo")?.time;
      const finAlmuerzo = rDia.find(r => r.event === "fin_almuerzo")?.time;
      if (entrada && salida) {
        const [eh,em] = entrada.split(":").map(Number);
        const [sh,sm] = salida.split(":").map(Number);
        totalBrutas += (sh*60+sm) - (eh*60+em);
      }
      if (iniAlmuerzo && finAlmuerzo) {
        const [ih,im] = iniAlmuerzo.split(":").map(Number);
        const [fh,fm] = finAlmuerzo.split(":").map(Number);
        totalAlmuerzo += (fh*60+fm) - (ih*60+im);
      }
    });
    const netas = totalBrutas - totalAlmuerzo;
    const toHM = (min) => `${Math.floor(min/60)}h ${min%60}m`;
    return { brutas: toHM(totalBrutas), almuerzo: toHM(totalAlmuerzo), netas: toHM(netas), netasMin: netas };
  };

  // Export CSV con horas
  const exportCSV = () => {
    const rows = [["Asesor","Días trabajados","Jornadas completas","Jornadas incompletas","Horas brutas","Horas almuerzo","Horas netas","Último día"]];
    porAsesor.forEach(a => {
      const h = calcHoras(a.id);
      rows.push([a.nombre, a.dias, a.completas, a.incompletas, h.brutas, h.almuerzo, h.netas, a.ultimoDia || "—"]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `informe-${prefix}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const thStyle = { padding:"10px 14px", textAlign:"left", fontFamily:font.body, fontSize:11, color:C.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.07em", borderBottom:`1px solid ${C.border}` };
  const tdStyle = { padding:"11px 14px", fontFamily:font.body, fontSize:13, borderBottom:`1px solid ${C.border}` };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20, gap:10, flexWrap:"wrap" }}>
        <div>
          <h1 style={{ margin:0, fontFamily:font.body, fontSize:20, fontWeight:700, color:C.text }}>Informes</h1>
          <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, marginTop:3 }}>Análisis de asistencia del equipo</div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <select value={mes} onChange={e=>setMes(Number(e.target.value))}
            style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none" }}>
            {meses.map((m,i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={anio} onChange={e=>setAnio(Number(e.target.value))}
            style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:7, padding:"8px 12px", color:C.text, fontSize:13, fontFamily:font.body, outline:"none" }}>
            {[2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <Btn onClick={exportCSV} variant="ghost" sm>⬇ Exportar CSV</Btn>
        </div>
      </div>

      {/* Tarjetas resumen */}
      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap:10, marginBottom:20 }}>
        <StatCard label="Días trabajados" value={totalDias} icon="📅" color={C.green} />
        <StatCard label="Jornadas completas" value={totalCompletas} icon="✅" color={C.blue} />
        <StatCard label="Jornadas incompletas" value={totalIncompletas} icon="⚠️" color={totalIncompletas > 0 ? C.red : C.textMuted} />
      </div>

      {/* Tabla / tarjetas por asesor */}
      <Card p="0" style={{ marginBottom:16 }}>
        <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text }}>
          Resumen por asesor — {meses[mes]} {anio}
        </div>
        {isMobile ? (
          <div>
            {porAsesor.map((a,i) => {
              const h = calcHoras(a.id);
              return (
                <div key={a.id} style={{ padding:"12px 16px", borderBottom: i<porAsesor.length-1?`1px solid ${C.border}`:"none" }}>
                  <div style={{ fontFamily:font.body, fontSize:13, color:C.text, fontWeight:600, marginBottom:6 }}>{a.nombre}</div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:4 }}>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Días: <span style={{ color:C.text, fontFamily:font.mono }}>{a.dias}</span></div>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Completas: <Badge color={a.completas>0?C.green:C.textMuted} sm>{a.completas}</Badge></div>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Incompletas: <Badge color={a.incompletas>0?C.red:C.textMuted} sm>{a.incompletas}</Badge></div>
                  </div>
                  <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Horas netas: <span style={{ color:C.green, fontFamily:font.mono, fontWeight:600 }}>{h.netas}</span></div>
                    <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>Almuerzo: <span style={{ color:C.amber, fontFamily:font.mono }}>{h.almuerzo}</span></div>
                  </div>
                  {a.ultimoDia && <div style={{ fontFamily:font.mono, fontSize:11, color:C.textMuted, marginTop:4 }}>Último día: {a.ultimoDia}</div>}
                </div>
              );
            })}
            {porAsesor.length===0 && <div style={{ padding:20, textAlign:"center", color:C.textMuted, fontFamily:font.body, fontSize:13 }}>Sin registros para este mes.</div>}
          </div>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>{["Asesor","Días","Completas","Incompletas","Horas brutas","Almuerzo","Horas netas","Último día"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {porAsesor.map((a,i) => {
                const h = calcHoras(a.id);
                return (
                  <tr key={a.id} style={{ background: i%2===0?"transparent":`${C.surfaceAlt}44` }}>
                    <td style={{ ...tdStyle, color:C.text, fontWeight:500 }}>{a.nombre}</td>
                    <td style={{ ...tdStyle, color:C.text, fontFamily:font.mono }}>{a.dias}</td>
                    <td style={tdStyle}><Badge color={a.completas>0?C.green:C.textMuted} sm>{a.completas}</Badge></td>
                    <td style={tdStyle}><Badge color={a.incompletas>0?C.red:C.textMuted} sm>{a.incompletas}</Badge></td>
                    <td style={{ ...tdStyle, fontFamily:font.mono, fontSize:12, color:C.textMuted }}>{h.brutas}</td>
                    <td style={{ ...tdStyle, fontFamily:font.mono, fontSize:12, color:C.amber }}>{h.almuerzo}</td>
                    <td style={{ ...tdStyle, fontFamily:font.mono, fontSize:13, color:C.green, fontWeight:600 }}>{h.netas}</td>
                    <td style={{ ...tdStyle, color:C.textMuted, fontFamily:font.mono, fontSize:12 }}>{a.ultimoDia||"—"}</td>
                  </tr>
                );
              })}
              {porAsesor.length===0 && <tr><td colSpan={8} style={{ ...tdStyle, textAlign:"center", color:C.textMuted }}>Sin registros para este mes.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <div style={{ display:"grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap:16, marginBottom:16 }}>
        {/* Por tienda */}
        <Card>
          <div style={{ fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text, marginBottom:14 }}>Entradas por tienda</div>
          {porTienda.map((t,i) => {
            const max = porTienda[0]?.entradas || 1;
            return (
              <div key={t.nombre} style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <div style={{ fontFamily:font.body, fontSize:12, color:C.text }}>{t.nombre}</div>
                  <div style={{ fontFamily:font.mono, fontSize:12, color:C.gold }}>{t.entradas}</div>
                </div>
                <div style={{ height:6, borderRadius:99, background:C.border }}>
                  <div style={{ height:6, borderRadius:99, width:`${(t.entradas/max)*100}%`, background:`linear-gradient(90deg, ${C.gold}, ${C.goldLight})`, transition:"width 0.4s" }} />
                </div>
              </div>
            );
          })}
          {porTienda.every(t => t.entradas === 0) && <div style={{ fontFamily:font.body, fontSize:12, color:C.textMuted, textAlign:"center", padding:"20px 0" }}>Sin registros este mes.</div>}
        </Card>

        {/* Jornadas incompletas detalle */}
        <Card p="0">
          <div style={{ padding:"14px 16px", borderBottom:`1px solid ${C.border}`, fontFamily:font.body, fontSize:13, fontWeight:600, color:C.text }}>
            Detalle jornadas incompletas
          </div>
          <div style={{ maxHeight:260, overflowY:"auto" }}>
            {jornadasIncompletas.length === 0 && (
              <div style={{ padding:"20px", textAlign:"center", color:C.textMuted, fontFamily:font.body, fontSize:12 }}>Sin jornadas incompletas este mes. ✅</div>
            )}
            {jornadasIncompletas.map((j,i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderBottom:`1px solid ${C.border}`, background:`${C.red}06` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:font.body, fontSize:12, color:C.text, fontWeight:500 }}>{j.nombre}</div>
                  <div style={{ fontFamily:font.body, fontSize:11, color:C.textMuted }}>{j.tienda} · {j.date}</div>
                </div>
                <Badge color={C.red} sm>{EVENT_LABELS[j.evento] || j.evento}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
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
    const { data } = await supabase.from("usuarios").select("*")
      .eq("documento", documento.trim()).eq("password", pass).eq("active", true).single();
    if (data) onLogin(data);
    else setErr("Documento o contraseña incorrecta, o cuenta inactiva.");
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.dark, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <img src="/logo.png" alt="OZEN" style={{ width: 140, height: "auto", marginBottom: 12 }} />
          <div style={{ fontFamily: font.body, fontSize: 12, color: C.textMuted, letterSpacing: "0.2em" }}>CONTROL DE PERSONAL</div>
        </div>
        <Card glow>
          <div style={{ fontFamily: font.body, fontSize: 17, fontWeight: 600, color: C.text, marginBottom: 18 }}>Iniciar sesión</div>
          <Field label="N.º de documento" value={documento} onChange={setDocumento} placeholder="Número de documento" />
          <Field label="Contraseña" type="password" value={pass} onChange={setPass} placeholder="••••••••" />
          {err && <div style={{ background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: 7, padding: "9px 12px", color: C.red, fontSize: 12, marginBottom: 12, fontFamily: font.body }}>{err}</div>}
          <Btn onClick={handle} disabled={loading} full style={{ marginTop: 4 }}>
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

  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: u }, { data: r }] = await Promise.all([
        supabase.from("tiendas").select("*"),
        supabase.from("usuarios").select("*"),
        supabase.from("registros").select("*").order("date", { ascending: false }),
      ]);
      const storesMap = {};
      (t || []).forEach(s => storesMap[s.id] = s);
      setStores(storesMap); setUsers(u || []); setRecords(r || []);
      setBooting(false);
    };
    load();
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const login  = (u) => { setUser(u); setTab(u.role === "admin" ? "dashboard" : "checkin"); };
  const logout = () => { setUser(null); setTab(null); };
  const addRecord = (r) => setRecords(prev => [r, ...prev]);

  const refreshAll = async () => {
    setRefreshing(true);
    const [{ data: t }, { data: u }, { data: r }] = await Promise.all([
      supabase.from("tiendas").select("*"),
      supabase.from("usuarios").select("*"),
      supabase.from("registros").select("*").order("date", { ascending: false }),
    ]);
    const storesMap = {};
    (t || []).forEach(s => storesMap[s.id] = s);
    setStores(storesMap); setUsers(u || []); setRecords(r || []);
    setRefreshing(false);
  };
  const refreshUserRecords = (newRecs) => {
    setRecords(prev => {
      const otros = prev.filter(r => !(r.user_id === user?.id && r.date === todayStr));
      return [...newRecs, ...otros];
    });
  };

  if (booting) return (
    <div style={{ minHeight: "100vh", background: C.dark, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.body, color: C.textMuted, fontSize: 14 }}>
      Cargando...
    </div>
  );

  if (!user) return <LoginScreen onLogin={login} />;

  const renderScreen = () => {
    if (user.role === "admin") {
      if (tab === "dashboard") return <DashboardScreen records={records} stores={stores} isMobile={isMobile} />;
      if (tab === "records")   return <RecordsScreen records={records} stores={stores} isMobile={isMobile} />;
      if (tab === "users")     return <UsersScreen users={users} setUsers={setUsers} />;
      if (tab === "stores")    return <StoresScreen stores={stores} setStores={setStores} />;
      if (tab === "reports")   return <ReportsScreen records={records} users={users} stores={stores} isMobile={isMobile} />;
    } else {
      if (tab === "checkin")  return <CheckInScreen user={user} records={records} onRecord={addRecord} onRefresh={refreshUserRecords} stores={stores} />;
      if (tab === "history")  return <HistoryScreen user={user} records={records} stores={stores} />;
      if (tab === "schedule") return <ScheduleScreen />;
    }
    return null;
  };

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: C.dark, overflow: "hidden" }}>
        <MobileHeader user={user} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} />
        <main style={{ flex: 1, overflowY: "auto", padding: 16 }}>{renderScreen()}</main>
        <BottomNav tab={tab} setTab={setTab} isAdmin={user.role === "admin"} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: C.dark, fontFamily: font.body, overflow: "hidden" }}>
      <Sidebar tab={tab} setTab={setTab} user={user} onLogout={logout} onRefresh={refreshAll} refreshing={refreshing} />
      <main style={{ flex: 1, overflowY: "auto", padding: "32px 36px" }}>{renderScreen()}</main>
    </div>
  );
}
