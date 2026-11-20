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
import { useState, useEffect, useRef } from "react";
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
export const GuirnaldaBarra = ({ isMobile }) => {
  const n = isMobile ? 12 : 30, alto = isMobile ? 15 : 16;
  let p = "M0 2"; for (let i = 0; i < n; i++) { const x0 = i*1000/n, x1 = (i+1)*1000/n; p += ` Q${(x0+x1)/2} 22 ${x1} 2`; }
  return (
    <div aria-hidden="true" className="ozen-nav-anim" style={{ position:"absolute", left:0, right:0, top:"100%", height:alto, pointerEvents:"none", zIndex:1 }}>
      <svg viewBox="0 0 1000 24" preserveAspectRatio="none" style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}><path d={p} fill="none" stroke="rgba(26,59,82,.22)" strokeWidth="1.1" vectorEffect="non-scaling-stroke"/></svg>
      <div style={{ position:"absolute", inset:0, display:"flex", justifyContent:"space-around", alignItems:"flex-start" }}>
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

// Guirnalda de la meta: 10 estrellas, cada 10 % de la meta del mes enciende una; al 100 % titilan todas.
export const GuirnaldaMeta = ({ pct, alto = 54 }) => {
  const on = Math.max(0, Math.min(10, Math.floor(pct/10))), llena = pct >= 100;
  let p = "M10 10"; for (let i = 0; i < 10; i++) { const x0 = 10 + i*98, x1 = 10 + (i+1)*98; p += ` Q${(x0+x1)/2} 34 ${x1} 10`; }
  return (
    <div className="ozen-nav-anim" style={{ position:"relative", height:alto }}>
      <svg viewBox="0 0 1000 40" preserveAspectRatio="none" style={{ position:"absolute", left:0, right:0, top:0, width:"100%", height:alto*0.62 }}><path d={p} fill="none" stroke="rgba(26,59,82,.28)" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/></svg>
      <div style={{ position:"absolute", left:"1%", right:"1%", top:0, bottom:0, display:"flex", justifyContent:"space-around", alignItems:"center" }}>
        {Array.from({ length:10 }, (_, i) => (
          <EstrellaSvg key={i} size={Math.round(alto*0.46)} color={i<on?BASE:"#E7DCD4"} style={{ marginTop:alto*0.14, filter:i<on?"drop-shadow(0 0 5px rgba(38,93,127,.55))":"none", animation:llena?`ozenNavTitila .9s ${(i*0.07).toFixed(2)}s ease-in-out infinite alternate`:"none", transition:"fill .3s" }}/>
        ))}
      </div>
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
