// ── NAVIDAD (temporada) ────────────────────────────────────────────────────────────────────────
// «La estrella de OZEN»: la estrella del propio logo es la estrella de la temporada. Se prende sola
// del 1 de noviembre al 6 de enero (según la fecha del dispositivo) y se apaga sola el 7 de enero —
// no hay que acordarse de quitarla. Solo colores del manual (Sombra, Base y Tinta) más un brillo
// suave; sin rojo, verde ni Papá Noel. No toca tablas, Caja, fotos ni colores de tienda. Con
// «reducir movimiento» activado, todo queda quieto. Para verla fuera de temporada: ?navidad en el link.
// Piezas: brillo en la estrella del logo (arriba y en el ingreso), destellos que caen en el ingreso,
// guirnalda bajo la barra de arriba, cuenta regresiva en el saludo, celebración al registrar una
// venta (la estrella dibuja el ensō) y la guirnalda de la meta del mes (10 estrellas).
/* eslint-disable react-refresh/only-export-components -- módulo de temporada: comparte constantes y componentes */
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

const SOMBRA = "#1A3B52", BASE = "#265D7F", TINTA = "#E5D5CC", FONT = "'Josefin Sans', 'Segoe UI', system-ui, sans-serif";

export const NAVIDAD = (() => {
  try { if (new URLSearchParams(window.location.search).has("navidad")) return true; } catch { /* sin URL */ }
  const d = new Date(), m = d.getMonth(), dia = d.getDate();
  return m === 10 || m === 11 || (m === 0 && dia <= 6);
})();

// Sonidos de Navidad: cada quien los puede apagar en su menú de cuenta (se guarda en este
// dispositivo). Apagados, la app vuelve a sus sonidos de siempre.
const CLAVE_SONIDOS = "ozen-sonidos-navidad";
export const sonidosNavidadActivos = () => { try { return localStorage.getItem(CLAVE_SONIDOS) !== "off"; } catch { return true; } };
export const guardarSonidosNavidad = (on) => { try { localStorage.setItem(CLAVE_SONIDOS, on ? "on" : "off"); } catch { /* sin almacenamiento */ } };

const reduceMov = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const pathEstrella = (r, k = 0.24) => { const i = r * k; return `M0 ${-r} L${i} ${-i} L${r} 0 L${i} ${i} L0 ${r} L${-i} ${i} L${-r} 0 L${-i} ${-i}Z`; };
export const EstrellaSvg = ({ size = 14, color = TINTA, style, className }) => (
  <svg width={size} height={size} viewBox="-10 -10 20 20" style={style} className={className} aria-hidden="true"><path d={pathEstrella(10)} fill={color}/></svg>
);

// Animaciones compartidas — un solo <style>, se monta donde haga falta (repetirlo no hace daño).
export const EstilosNavidad = () => (
  <style>{`
    @keyframes ozenNavLate { 0%,100% { transform:scale(.75); opacity:.7 } 50% { transform:scale(1.12); opacity:1 } }
    @keyframes ozenNavGira { to { transform:rotate(360deg) } }
    @keyframes ozenNavTitila { from { opacity:.25 } to { opacity:1 } }
    @keyframes ozenNavEnciende { 0%,100% { opacity:.25 } 50% { opacity:1 } }
    @keyframes ozenNavCae { from { top:-4%; transform:translateX(0) rotate(0) } to { top:104%; transform:translateX(var(--dx)) rotate(var(--r)) } }
    @media (prefers-reduced-motion: reduce) {
      .ozen-nav-anim, .ozen-nav-anim * { animation:none !important; }
      .ozen-nav-cae { display:none; }
    }
  `}</style>
);

// Brillo sobre la estrella del logo. `donde` = posición de la estrella dentro de la imagen del logo
// (en % del ancho/alto de la imagen): wordmark → 5.4 % / 21 %; logo horizontal → 5.4 % / 14.2 %.
export const BrilloEstrellaLogo = ({ x = "5.4%", y = "21%", tam = 28, rayos = false, color = "rgba(38,93,127,.35)" }) => (
  <span aria-hidden="true" className="ozen-nav-anim" style={{ position:"absolute", left:x, top:y, width:0, height:0, pointerEvents:"none" }}>
    <span style={{ position:"absolute", left:-tam/2, top:-tam/2, width:tam, height:tam, borderRadius:"50%", background:`radial-gradient(circle, ${color} 0%, rgba(0,0,0,0) 65%)`, animation:"ozenNavLate 2.8s ease-in-out infinite" }}/>
    {rayos && (
      <span style={{ position:"absolute", left:-tam*0.38, top:-tam*0.38, width:tam*0.76, height:tam*0.76, animation:"ozenNavGira 14s linear infinite", opacity:.85 }}>
        <svg viewBox="-50 -50 100 100" width="100%" height="100%"><g fill="rgba(255,244,230,.55)"><path d="M0-50 L2.5-4 L0 0 L-2.5-4Z"/><path d="M0 50 L2.5 4 L0 0 L-2.5 4Z"/><path d="M-50 0 L-4 2.5 L0 0 L-4-2.5Z"/><path d="M50 0 L4 2.5 L0 0 L4-2.5Z"/></g></svg>
      </span>
    )}
  </span>
);

// Destellos (con la forma de la estrella del logo) que caen despacio sobre el panel del ingreso.
export const DestellosQueCaen = ({ cantidad = 26 }) => {
  const [d] = useState(() => Array.from({ length:cantidad }, () => {
    const dur = 9 + Math.random() * 9;
    return { left:Math.random()*100, s:6 + Math.random()*12, dur, delay:-Math.random()*dur, dx:Math.random()*80 - 40, r:Math.random()*180 - 90, op:.35 + Math.random()*.55, tit:.8 + Math.random()*1.6 };
  }));
  return (
    <div aria-hidden="true" className="ozen-nav-anim" style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
      {d.map((x, i) => (
        <span key={i} className="ozen-nav-cae" style={{ position:"absolute", left:`${x.left}%`, top:"-4%", opacity:x.op, "--dx":`${x.dx}px`, "--r":`${x.r}deg`, animation:`ozenNavCae ${x.dur}s ${x.delay}s linear infinite` }}>
          <EstrellaSvg size={x.s} style={{ display:"block", animation:`ozenNavTitila ${x.tit}s ease-in-out infinite alternate` }}/>
        </span>
      ))}
    </div>
  );
};

// Guirnalda fina que cuelga debajo de la barra de arriba (dentro de un contenedor position:relative).
// Al entrar a un módulo o cambiar de pestaña, las estrellas se encienden en ola de izquierda a
// derecha (la app avisa con el evento "ozen-navidad-ola"; ver avisarOlaNavidad).
export const avisarOlaNavidad = () => { try { window.dispatchEvent(new Event("ozen-navidad-ola")); } catch { /* sin window */ } };
export const GuirnaldaBarra = ({ isMobile }) => {
  const n = isMobile ? 12 : 30, alto = isMobile ? 15 : 16;
  const fila = useRef(null);
  useEffect(() => {
    const ola = () => {
      if (reduceMov() || !fila.current) return;
      [...fila.current.children].forEach((e, i) => e.animate(
        [{ transform:"scale(1)", filter:"none" }, { transform:"scale(1.9)", filter:"drop-shadow(0 0 4px rgba(38,93,127,.9))", opacity:1 }, { transform:"scale(1)", filter:"none" }],
        { duration:420, delay:i*(isMobile?40:22), easing:"ease-out" }));
    };
    window.addEventListener("ozen-navidad-ola", ola);
    return () => window.removeEventListener("ozen-navidad-ola", ola);
  }, [isMobile]);
  let p = "M0 2"; for (let i = 0; i < n; i++) { const x0 = i*1000/n, x1 = (i+1)*1000/n; p += ` Q${(x0+x1)/2} 22 ${x1} 2`; }
  return (
    <div aria-hidden="true" className="ozen-nav-anim" style={{ position:"absolute", left:0, right:0, top:"100%", height:alto, pointerEvents:"none", zIndex:1 }}>
      <svg viewBox="0 0 1000 24" preserveAspectRatio="none" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}><path d={p} fill="none" stroke="rgba(26,59,82,.22)" strokeWidth="1.1" vectorEffect="non-scaling-stroke"/></svg>
      <div ref={fila} style={{ position:"absolute", inset:0, display:"flex", justifyContent:"space-around", alignItems:"flex-start" }}>
        {Array.from({ length:n }, (_, i) => (
          <EstrellaSvg key={i} size={8} color={i%3===1?SOMBRA:BASE} style={{ marginTop:alto*0.5 - 4, animation:`ozenNavEnciende 2.4s ${(i*0.18).toFixed(2)}s ease-in-out infinite` }}/>
        ))}
      </div>
    </div>
  );
};

// Cuenta regresiva del saludo — cambia sola.
export const textoCuentaNavidad = (d) => {
  const y = d.getFullYear(), m = d.getMonth(), dia = d.getDate(), ms = 86400000, base = new Date(y, m, dia);
  if (m === 11 && dia === 24) return "Hoy es Nochebuena";
  if (m === 11 && dia === 25) return "¡Feliz Navidad!";
  if (m === 11 && dia === 31) return "Hoy es fin de año";
  if (m === 11 && dia > 25) { const n = Math.round((new Date(y+1, 0, 1) - base)/ms); return `Faltan ${n} día${n===1?"":"s"} para el Año Nuevo`; }
  if (m === 0) return `¡Feliz ${y}!`;
  const n = Math.round((new Date(y, 11, 25) - base)/ms); return `Faltan ${n} día${n===1?"":"s"} para Navidad`;
};
export const ChipCuentaNavidad = ({ fecha }) => (
  <span className="ozen-nav-anim" style={{ display:"inline-flex", alignItems:"center", gap:8, background:SOMBRA, color:TINTA, borderRadius:99, padding:"7px 14px", fontFamily:FONT, fontSize:13.5, fontWeight:600, marginBottom:10 }}>
    <EstrellaSvg size={13} style={{ animation:"ozenNavTitila 1.3s ease-in-out infinite alternate" }}/>{textoCuentaNavidad(fecha)}
  </span>
);

// Guirnalda de la meta: 10 estrellas — cada una es un 10 % de la meta del mes y se va llenando
// (la que está en curso queda llena a medias, así se lee el avance exacto como en una barra). Va en
// el color de la tienda. `esperado` (opcional): marquita de "lo que debería llevar hoy". Al 100 %
// titilan todas.
const rgba = (hex, a) => { const h = String(hex||"").replace("#",""); if(h.length!==6) return `rgba(38,93,127,${a})`; return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`; };
let idGuirnalda = 0;
export const GuirnaldaMeta = ({ pct, alto = 54, color = BASE, esperado = null, colorEsperado = "#B7791F" }) => {
  const [uid] = useState(() => `ozg${++idGuirnalda}`);
  const llena = pct >= 100, tam = Math.round(alto*0.46);
  let p = "M10 10"; for (let i = 0; i < 10; i++) { const x0 = 10 + i*98, x1 = 10 + (i+1)*98; p += ` Q${(x0+x1)/2} 34 ${x1} 10`; }
  return (
    <div className="ozen-nav-anim" style={{ position:"relative", height:alto + (esperado!=null ? 16 : 0) }}>
      <svg viewBox="0 0 1000 40" preserveAspectRatio="none" style={{ position:"absolute", left:0, right:0, top:0, width:"100%", height:alto*0.62 }}><path d={p} fill="none" stroke={rgba(color,.35)} strokeWidth="1.4" vectorEffect="non-scaling-stroke"/></svg>
      <div style={{ position:"absolute", left:"1%", right:"1%", top:0, height:alto, display:"flex", justifyContent:"space-around", alignItems:"center" }}>
        {Array.from({ length:10 }, (_, i) => { const f = Math.max(0, Math.min(1, pct/10 - i)); return (
          <svg key={i} width={tam} height={tam} viewBox="-10 -10 20 20" aria-hidden="true" style={{ marginTop:alto*0.14, overflow:"visible", filter:f>=1?`drop-shadow(0 0 4px ${rgba(color,.55)})`:"none", animation:llena?`ozenNavTitila .9s ${(i*0.07).toFixed(2)}s ease-in-out infinite alternate`:"none" }}>
            <defs><clipPath id={`${uid}-${i}`}><rect x="-10" y="-10" width={20*f} height="20"/></clipPath></defs>
            <path d={pathEstrella(10)} fill="#E7DCD4"/>
            {f>0 && <path d={pathEstrella(10)} fill={color} clipPath={`url(#${uid}-${i})`}/>}
          </svg>
        ); })}
      </div>
      {esperado!=null && esperado>0 && esperado<100 && (
        <div title={`Debería llevar ${esperado}%`} style={{ position:"absolute", left:`calc(1% + 98% * ${esperado/100})`, top:alto - 4, transform:"translateX(-50%)", display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ width:0, height:0, borderLeft:"5px solid transparent", borderRight:"5px solid transparent", borderBottom:`7px solid ${colorEsperado}` }}/>
          <span style={{ fontFamily:FONT, fontSize:9.5, fontWeight:700, color:colorEsperado }}>hoy</span>
        </div>
      )}
    </div>
  );
};

// Celebración al registrar una venta: desde abajo sube una estrella, recorre el círculo del logo
// dibujándolo (el ensō) y termina donde está en el logo — arriba a la izquierda, en la abertura —
// ahí brilla y se abre en destellos. Va en el centro de la pantalla, encima de todo (portal al
// <body>) y no recibe clics. `tipo`: "venta" | "estrella" (encendió una estrella de la meta) |
// "meta" (llegó al 100 % del mes). Se monta con key distinta en cada venta.
const FRASES = ["Un regalo más esta Navidad", "Alguien va a sonreír el 24", "Un momento presente para regalar", "Una estrella más para la meta", "Gracias por hacer brillar la temporada"];
let ultimaFrase = -1;
export const CelebracionVenta = ({ tipo = "venta", detalle }) => {
  const capa = useRef(null);
  const [frase] = useState(() => { ultimaFrase = (ultimaFrase + 1) % FRASES.length; return FRASES[ultimaFrase]; });
  useEffect(() => {
    const el = capa.current; if (!el) return;
    const W = window.innerWidth, H = window.innerHeight, NS = "http://www.w3.org/2000/svg";
    const R = Math.min(78, W*0.18), cx = W/2, cy = H*0.42, A_GAP = -135, HUECO = 34;
    const a0 = A_GAP + HUECO/2, barrido = 360 - HUECO, rad = d => d*Math.PI/180, pt = d => [cx + R*Math.cos(rad(d)), cy + R*Math.sin(rad(d))];
    const quieto = reduceMov(), timers = [];
    // Velo suave detrás del ensō, para que se lea bien encima de cualquier pantalla.
    const velo = document.createElement("div"); const rv = R*2.6;
    velo.style.cssText = `position:absolute;left:${cx-rv}px;top:${cy-rv}px;width:${rv*2}px;height:${rv*2}px;border-radius:50%;background:radial-gradient(circle, rgba(255,255,255,.92) 0%, rgba(246,240,235,.75) 42%, rgba(246,240,235,0) 70%)`;
    el.appendChild(velo); velo.animate([{ opacity:0 }, { opacity:1 }], { duration:350, fill:"forwards" });
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", W); svg.setAttribute("height", H); svg.style.cssText = "position:absolute;inset:0;overflow:visible";
    const L = 2*Math.PI*R, c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", R); c.setAttribute("fill", "none"); c.setAttribute("stroke", BASE);
    c.setAttribute("stroke-width", Math.max(5, R*0.09)); c.setAttribute("stroke-linecap", "round"); c.setAttribute("transform", `rotate(${a0} ${cx} ${cy})`);
    c.style.strokeDasharray = `${L} ${L}`; c.style.strokeDashoffset = quieto ? L*HUECO/360 : L; svg.appendChild(c); el.appendChild(svg);
    const st = document.createElement("div"); st.style.cssText = "position:absolute;left:0;top:0;width:0;height:0";
    st.innerHTML = `<div style="position:absolute;left:-18px;top:-18px;width:36px;height:36px;filter:drop-shadow(0 0 9px rgba(38,93,127,.6))"><svg width="36" height="36" viewBox="-10 -10 20 20"><path d="${pathEstrella(10)}" fill="${BASE}"/></svg></div>`;
    el.appendChild(st);
    const [gx, gy] = pt(A_GAP);
    const toast = el.querySelector("[data-toast]"); el.appendChild(toast);
    toast.style.top = `${cy + R + 26}px`;
    const destellos = () => {
      const halo = document.createElement("div"); halo.style.cssText = `position:absolute;left:${gx-50}px;top:${gy-50}px;width:100px;height:100px;border-radius:50%;background:radial-gradient(circle,rgba(38,93,127,.35),rgba(38,93,127,0) 65%)`; el.appendChild(halo);
      halo.animate([{ transform:"scale(.3)", opacity:0 }, { transform:"scale(1.3)", opacity:1, offset:.3 }, { transform:"scale(1.8)", opacity:0 }], { duration:1100, fill:"forwards" });
      const n = tipo === "meta" ? 40 : tipo === "estrella" ? 28 : 20;
      for (let i = 0; i < n; i++) {
        const sp = document.createElement("div"), a = Math.random()*Math.PI*2, r = 50 + Math.random()*(tipo==="meta"?200:130), z = 8 + Math.random()*12;
        sp.style.cssText = `position:absolute;left:${gx-z/2}px;top:${gy-z/2}px;width:${z}px;height:${z}px`;
        sp.innerHTML = `<svg width="${z}" height="${z}" viewBox="-10 -10 20 20"><path d="${pathEstrella(10)}" fill="${i%3?BASE:SOMBRA}"/></svg>`; el.appendChild(sp);
        sp.animate([{ transform:"translate(0,0) scale(.3)", opacity:1 }, { transform:`translate(${Math.cos(a)*r}px,${Math.sin(a)*r+30}px) scale(1) rotate(${Math.random()*220}deg)`, opacity:0 }], { duration:1200 + Math.random()*700, easing:"cubic-bezier(.2,.7,.3,1)", fill:"forwards" });
      }
      toast.animate([{ opacity:0, transform:"translate(-50%,8px)" }, { opacity:1, transform:"translate(-50%,0)", offset:.12 }, { opacity:1, offset:.82 }, { opacity:0 }], { duration:tipo==="meta"?3600:2400, fill:"forwards" });
    };
    if (quieto) {
      st.style.transform = `translate(${gx}px,${gy}px) scale(1.25)`;
      toast.animate([{ opacity:0 }, { opacity:1, offset:.12 }, { opacity:1, offset:.82 }, { opacity:0 }], { duration:2600, fill:"forwards" });
      timers.push(setTimeout(() => { [svg, st, velo].forEach(x => x.animate([{ opacity:1 }, { opacity:0 }], { duration:500, fill:"forwards" })); }, 2100));
    } else {
      const SUBE = 620, DIBUJA = 1000, [sx, sy] = pt(a0), ease = "cubic-bezier(.45,.05,.4,1)";
      st.animate([{ transform:`translate(${cx}px,${H-70}px) scale(.5) rotate(0)`, opacity:0 }, { opacity:1, offset:.2 }, { transform:`translate(${sx}px,${sy}px) scale(1) rotate(200deg)`, opacity:1 }], { duration:SUBE, easing:"cubic-bezier(.3,.6,.3,1)", fill:"forwards" });
      const kf = []; for (let i = 0; i <= 40; i++) { const [x, y] = pt(a0 + barrido*i/40); kf.push({ transform:`translate(${x}px,${y}px) scale(1) rotate(${200+i*9}deg)` }); }
      timers.push(setTimeout(() => { st.animate(kf, { duration:DIBUJA, easing:ease, fill:"forwards" }); c.animate([{ strokeDashoffset:L }, { strokeDashoffset:L*HUECO/360 }], { duration:DIBUJA, easing:ease, fill:"forwards" }); }, SUBE));
      timers.push(setTimeout(() => {
        st.animate([{ transform:kf[40].transform }, { transform:`translate(${gx}px,${gy}px) scale(1.7) rotate(560deg)`, offset:.35 }, { transform:`translate(${gx}px,${gy}px) scale(1.25) rotate(580deg)` }], { duration:700, easing:"ease-out", fill:"forwards" });
        destellos();
      }, SUBE + DIBUJA));
      timers.push(setTimeout(() => { [svg, st, velo].forEach(x => x.animate([{ opacity:1 }, { opacity:0 }], { duration:600, fill:"forwards" })); }, SUBE + DIBUJA + (tipo==="meta"?2600:1500)));
    }
    return () => timers.forEach(clearTimeout);
  }, [tipo]);
  const titulo = tipo === "meta" ? "✦ ¡Meta del mes cumplida!" : "✦ ¡Venta registrada!";
  const sub = tipo === "meta" ? (detalle || "¡Feliz Navidad, equipo!") : tipo === "estrella" ? (detalle || "Se encendió una estrella de la meta") : frase;
  return createPortal(
    <div ref={capa} aria-hidden="true" style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9999, overflow:"hidden" }}>
      <div data-toast="" style={{ position:"absolute", left:"50%", transform:"translateX(-50%)", opacity:0, textAlign:"center", color:SOMBRA, background:"#fff", border:"1px solid rgba(26,59,82,.14)", borderRadius:14, padding:"9px 18px", whiteSpace:"nowrap", boxShadow:"0 14px 30px -18px rgba(26,59,82,.5)", fontFamily:FONT }}>
        <b style={{ display:"block", fontSize:19 }}>{titulo}</b><small style={{ fontSize:13.5, color:"#75604F" }}>{sub}</small>
      </div>
    </div>,
    document.body
  );
};

// ── Magia de vez en cuando ───────────────────────────────────────────────────────────────────────
// Con la app abierta (y la pestaña a la vista), de vez en cuando cruza una estrella fugaz (cada 4 a
// 8 minutos) o un venado saltando por la parte de abajo (cada 12 a 20 minutos). No tapan nada ni
// reciben clics; con «reducir movimiento» no salen. Para probar rápido: ?navidad=demo en el link.
const DEMO = (() => { try { return new URLSearchParams(window.location.search).get("navidad") === "demo"; } catch { return false; } })();
const azar = (a, b) => a + Math.random() * (b - a);

const EstrellaFugaz = ({ onFin }) => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current, W = window.innerWidth, H = window.innerHeight;
    const izq = Math.random() < 0.5, x0 = izq ? azar(-0.05, 0.35)*W : azar(0.65, 1.05)*W, y0 = azar(0.04, 0.22)*H;
    const largo = Math.min(W, 900) * azar(0.5, 0.8), rad = azar(18, 30) * Math.PI / 180, dirX = izq ? 1 : -1;
    const tx = Math.cos(rad) * largo * dirX, dy = Math.sin(rad) * largo;
    el.style.left = `${x0}px`; el.style.top = `${y0}px`;
    el.style.transform = `rotate(${Math.atan2(dy, tx) * 180 / Math.PI}deg)`;
    const a = el.animate([{ translate:"0 0", opacity:0 }, { opacity:1, offset:0.15 }, { opacity:1, offset:0.7 }, { translate:`${tx}px ${dy}px`, opacity:0 }], { duration:1300, easing:"cubic-bezier(.3,.1,.5,1)", fill:"forwards" });
    a.onfinish = onFin;
    return () => a.cancel();
  }, [onFin]);
  return createPortal(
    <div aria-hidden="true" style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9998, overflow:"hidden" }}>
      <div ref={ref} style={{ position:"absolute", width:0, height:0, transformOrigin:"0 0" }}>
        <div style={{ position:"absolute", right:4, top:-1.5, width:150, height:3, borderRadius:3, background:"linear-gradient(90deg, rgba(38,93,127,0), rgba(38,93,127,.55))" }}/>
        <div style={{ position:"absolute", left:-11, top:-11, width:22, height:22, filter:"drop-shadow(0 0 6px rgba(38,93,127,.8))" }}><EstrellaSvg size={22} color={BASE}/></div>
      </div>
    </div>, document.body);
};

// Venado saltando — silueta en Sombra, cruza la parte de abajo dando saltos y suelta destellos.
const PARTES_VENADO = [
  "M30 38 C40 30 70 30 82 34 C88 36 90 42 86 46 C78 50 50 50 36 48 C30 47 26 42 30 38 Z",
  "M80 37 C84 29 88 23 92 19 L100 16 C104 16 106 19 104 21 L98 24 C95 28 92 34 88 41 Z",
  "M95 20 L90 16 L93 21 Z",
  "M30 38 L23 33 L28 41 Z",
  "M82 43 L96 51 L105 49 L106 51.5 L96 55 L80 47 Z",
  "M78 45 L90 57 L98 59 L97.5 61.5 L88 61 L75 48 Z",
  "M36 43 L22 51 L10 53 L10 55.5 L24 55.5 L40 46.5 Z",
  "M40 45 L28 57 L18 61 L19 63.5 L30 61 L44 47.5 Z",
];
const VenadoSvg = ({ w = 110, color = SOMBRA }) => (
  <svg width={w} height={w * 66 / 112} viewBox="0 0 112 66" aria-hidden="true">
    {PARTES_VENADO.map((d, i) => <path key={i} d={d} fill={color}/>)}
    <path d="M96 17 C94 10 92 6 88 2 M94.5 11 L99.5 6.5 M92.5 7.5 L87.5 8.5 M99 16 C100 9 103 5 108 2 M101 9.5 L106.5 9 M102.5 6 L100.5 1.5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);
const VenadoSaltando = ({ onFin }) => {
  const ref = useRef(null), cuerpo = useRef(null);
  useEffect(() => {
    const el = ref.current, W = window.innerWidth, H = window.innerHeight, movil = W < 700;
    const haciaDerecha = Math.random() < 0.6, w = movil ? 70 : 96, dur = movil ? 6500 : 8500, saltos = movil ? 7 : 10;
    const base = H - (movil ? 150 : 70);
    el.style.top = `${base}px`;
    if (!haciaDerecha) cuerpo.current.style.transform = "scaleX(-1)";
    const x0 = haciaDerecha ? -w - 20 : W + 20, x1 = haciaDerecha ? W + 20 : -w - 20;
    const cruza = el.animate([{ transform:`translateX(${x0}px)` }, { transform:`translateX(${x1}px)` }], { duration:dur, easing:"linear", fill:"forwards" });
    const salto = cuerpo.current.firstChild.animate(
      [{ transform:"translateY(0) rotate(4deg)" }, { transform:"translateY(-34px) rotate(-7deg)", offset:0.45 }, { transform:"translateY(-30px) rotate(0deg)", offset:0.6 }, { transform:"translateY(0) rotate(6deg)" }],
      { duration:dur / saltos, iterations:saltos, easing:"ease-in-out" });
    // Al caer cada salto, un par de destellos que se quedan atrás.
    const capa = el.parentNode, timers = [];
    for (let k = 1; k < saltos; k++) timers.push(setTimeout(() => {
      const r = el.getBoundingClientRect();
      for (let j = 0; j < 2; j++) {
        const z = 6 + Math.random() * 7, sp = document.createElement("div");
        sp.style.cssText = `position:absolute;left:${r.left + w / 2 + azar(-20, 20)}px;top:${base + w * 0.5 + azar(-6, 10)}px;width:${z}px;height:${z}px`;
        sp.innerHTML = `<svg width="${z}" height="${z}" viewBox="-10 -10 20 20"><path d="${pathEstrella(10)}" fill="${BASE}"/></svg>`;
        capa.appendChild(sp);
        sp.animate([{ opacity:0.9, transform:"scale(1)" }, { opacity:0, transform:`translateY(${azar(-25, -8)}px) scale(.4) rotate(90deg)` }], { duration:1100, fill:"forwards" }).onfinish = () => sp.remove();
      }
    }, (dur / saltos) * k));
    cruza.onfinish = onFin;
    return () => { cruza.cancel(); salto.cancel(); timers.forEach(clearTimeout); };
  }, [onFin]);
  return createPortal(
    <div aria-hidden="true" style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9998, overflow:"hidden" }}>
      <div ref={ref} style={{ position:"absolute", left:0, opacity:0.85 }}>
        <div ref={cuerpo}><div><VenadoSvg w={window.innerWidth < 700 ? 70 : 96}/></div></div>
      </div>
    </div>, document.body);
};

export const MagiaNavidad = () => {
  const [actual, setActual] = useState(null); // { tipo, k }
  const fin = useCallback(() => setActual(null), []);
  useEffect(() => {
    if (reduceMov()) return;
    const timers = [];
    const programar = (tipo, min, max) => {
      const ms = DEMO ? (tipo === "fugaz" ? azar(5, 9) : azar(11, 15)) * 1000 : azar(min, max) * 60000;
      timers.push(setTimeout(() => {
        if (!document.hidden) setActual(a => a || { tipo, k:Math.random() });
        programar(tipo, min, max);
      }, ms));
    };
    programar("fugaz", 4, 8);
    programar("venado", 12, 20);
    return () => timers.forEach(clearTimeout);
  }, []);
  if (!actual) return null;
  return actual.tipo === "fugaz" ? <EstrellaFugaz key={actual.k} onFin={fin}/> : <VenadoSaltando key={actual.k} onFin={fin}/>;
};

// Al marcar asistencia: destellos que caen desde arriba y un saludo de temporada según el evento.
const SALUDOS_ASISTENCIA = {
  entrada: ["✦ ¡Buen turno!", null],
  inicio_almuerzo: ["✦ ¡Buen provecho!", "Recarga energías para la temporada"],
  fin_almuerzo: ["✦ ¡De vuelta!", "A seguir regalando momentos"],
  salida: ["✦ ¡Gracias por hoy!", "Descansa, la Navidad también es tuya"],
};
export const CelebracionAsistencia = ({ evento }) => {
  const capa = useRef(null);
  useEffect(() => {
    const el = capa.current; if (!el) return;
    const W = window.innerWidth, H = window.innerHeight, quieto = reduceMov();
    const toast = el.querySelector("[data-toast]");
    toast.animate([{ opacity:0, transform:"translate(-50%,-10px)" }, { opacity:1, transform:"translate(-50%,0)", offset:0.12 }, { opacity:1, offset:0.85 }, { opacity:0 }], { duration:3200, fill:"forwards" });
    if (quieto) return;
    const n = W < 700 ? 22 : 34;
    for (let i = 0; i < n; i++) {
      const z = 7 + Math.random() * 13, sp = document.createElement("div");
      sp.style.cssText = `position:absolute;left:${Math.random() * W}px;top:-20px;width:${z}px;height:${z}px`;
      sp.innerHTML = `<svg width="${z}" height="${z}" viewBox="-10 -10 20 20"><path d="${pathEstrella(10)}" fill="${i % 3 ? BASE : SOMBRA}"/></svg>`;
      el.appendChild(sp);
      sp.animate([{ transform:"translateY(0) rotate(0)", opacity:0 }, { opacity:0.9, offset:0.1 }, { transform:`translate(${azar(-40, 40)}px, ${H * azar(0.45, 0.8)}px) rotate(${azar(-160, 160)}deg)`, opacity:0 }],
        { duration:azar(1800, 2800), delay:azar(0, 600), easing:"cubic-bezier(.25,.5,.45,1)", fill:"forwards" });
    }
  }, [evento]);
  const [titulo, sub] = SALUDOS_ASISTENCIA[evento] || SALUDOS_ASISTENCIA.entrada;
  return createPortal(
    <div ref={capa} aria-hidden="true" style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:9999, overflow:"hidden" }}>
      <div data-toast="" style={{ position:"absolute", left:"50%", top:"calc(96px + env(safe-area-inset-top, 0px))", transform:"translateX(-50%)", opacity:0, textAlign:"center", color:TINTA, background:SOMBRA, borderRadius:16, padding:"10px 20px", whiteSpace:"nowrap", boxShadow:"0 16px 34px -18px rgba(26,59,82,.7)", fontFamily:FONT, zIndex:2 }}>
        <b style={{ display:"block", fontSize:18 }}>{titulo}</b><small style={{ fontSize:13, opacity:.85 }}>{sub || textoCuentaNavidad(new Date())}</small>
      </div>
    </div>, document.body);
};
