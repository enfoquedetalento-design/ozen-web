// Sonidos cortos para eventos clave de la app — sintetizados con Web Audio (sin archivos de
// audio externos, así no hay que descargar/licenciar nada y pesan cero). Son obligatorios, no
// se pueden silenciar desde la app.

let ctx = null;
const getCtx = () => {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

// Una nota simple: sube y baja el volumen suavemente (evita el "click" seco de encendido/apagado
// brusco de un oscilador). `ataque` es cuánto tarda en subir al volumen máximo — con el valor por
// defecto (0.012s, casi instantáneo) la nota entra de golpe y se siente "punzante"; un ataque más
// largo (0.04-0.08s) la hace sonar más suave y natural, sin perder el volumen.
const nota = (audioCtx, freq, inicio, duracion, tipo = "sine", volumen = 0.16, ataque = 0.012) => {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime + inicio);
  gain.gain.setValueAtTime(0, audioCtx.currentTime + inicio);
  gain.gain.linearRampToValueAtTime(volumen, audioCtx.currentTime + inicio + ataque);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + inicio + duracion);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + inicio);
  osc.stop(audioCtx.currentTime + inicio + duracion + 0.03);
};

const reproducir = (notas) => {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  try { notas.forEach(([freq, inicio, duracion, tipo, vol, ataque]) => nota(audioCtx, freq, inicio, duracion, tipo, vol, ataque)); } catch (e) { /* nunca debe romper el flujo de la app */ }
};

// 🛎️ Venta registrada — pequeño festejo: un arpegio ascendente alegre (como un "¡lograste la
// venta!") que resuelve en un acorde brillante y cálido que se sostiene un momento, en vez del
// "cha-ching" seco y cortísimo de antes.
export const sonidoVenta = () => reproducir([
  [523,  0,    0.14, "triangle", 0.13, 0.008],
  [659,  0.08, 0.14, "triangle", 0.14, 0.008],
  [784,  0.16, 0.16, "triangle", 0.15, 0.008],
  [1046, 0.25, 0.22, "triangle", 0.17, 0.008],
  [1319, 0.34, 0.50, "sine",     0.13, 0.015],
  [784,  0.34, 0.50, "sine",     0.09, 0.015],
]);

// 📍 Marcar entrada — un "blip" corto que sube.
export const sonidoEntrada = () => reproducir([
  [660, 0,    0.09, "sine", 0.15],
  [880, 0.07, 0.13, "sine", 0.13],
]);

// 📍 Marcar salida — un "blip" corto que baja (espejo del de entrada).
export const sonidoSalida = () => reproducir([
  [880, 0,    0.09, "sine", 0.15],
  [660, 0.07, 0.13, "sine", 0.13],
]);

// 💰 Cierre de caja registrado con éxito — acorde ascendente cálido, 3 notas.
export const sonidoCierreCaja = () => reproducir([
  [523, 0,    0.16, "sine", 0.14],
  [659, 0.09, 0.16, "sine", 0.14],
  [784, 0.18, 0.30, "sine", 0.16],
]);

// 📦 Flexipago completado — un poco más elaborado que una venta normal, se siente como un logro.
export const sonidoFlexipagoCompletado = () => reproducir([
  [523,  0,    0.12, "triangle", 0.13],
  [659,  0.08, 0.12, "triangle", 0.13],
  [784,  0.16, 0.12, "triangle", 0.13],
  [1046, 0.24, 0.32, "triangle", 0.17],
]);

// ✅ Tarea marcada como cumplida (Seguimiento semanal) — un "pop" breve.
export const sonidoTareaCumplida = () => reproducir([
  [900, 0, 0.08, "sine", 0.14],
]);

// ⚠️ Error al guardar — dos tonos bajos, neutros, no agresivos (solo para fallas reales, no para
// avisos de "falta llenar un campo").
export const sonidoError = () => reproducir([
  [220, 0,    0.11, "square", 0.06],
  [196, 0.10, 0.18, "square", 0.06],
]);

// ✨ Bienvenida al iniciar sesión — más larga y con ataque suave en cada nota (nada de golpes
// secos), como una bocanada de aire fresco al entrar: una base cálida que sostiene toda la frase,
// un arpegio que sube con calma y una nota final resonante que se apaga despacio.
export const sonidoBienvenida = () => reproducir([
  [392,  0,    0.9,  "sine",     0.06, 0.05],
  [523,  0.05, 0.45, "sine",     0.08, 0.05],
  [659,  0.20, 0.45, "sine",     0.08, 0.05],
  [784,  0.36, 0.55, "sine",     0.09, 0.05],
  [988,  0.54, 0.70, "triangle", 0.07, 0.06],
  [1175, 0.74, 0.95, "sine",     0.06, 0.07],
]);

// ── Navidad (1 nov – 6 ene) ─────────────────────────────────────────────────────────────────────
// Campanas sintetizadas (parciales inarmónicos de campana/glockenspiel) + cascabeles (ruido
// filtrado en ráfagas) con una reverberación corta. Melodías de dominio público. Van sincronizadas
// con la animación de la venta (la estrella empieza a dibujar el ensō a los 0,62 s y se abre en
// destellos a los 1,62 s). Ver src/navidad.jsx.
let salidaNavidad = null;
const navidadOut = (audioCtx) => {
  if (salidaNavidad && salidaNavidad.ctx === audioCtx) return salidaNavidad.master;
  const master = audioCtx.createGain(); master.gain.value = 1.4; master.connect(audioCtx.destination);
  try {
    const len = Math.floor(audioCtx.sampleRate * 1.8), imp = audioCtx.createBuffer(2, len, audioCtx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const conv = audioCtx.createConvolver(); conv.buffer = imp; const wet = audioCtx.createGain(); wet.gain.value = 0.28;
    master.connect(conv).connect(wet).connect(audioCtx.destination);
  } catch { /* sin reverberación, igual suena */ }
  salidaNavidad = { ctx: audioCtx, master };
  return master;
};
const campana = (audioCtx, out, t, f, vol = 0.2, dur = 1.6) => {
  const g0 = audioCtx.createGain(); g0.gain.value = vol; g0.connect(out);
  [[1, 1, 1], [2.76, 0.42, 0.5], [5.4, 0.2, 0.3], [8.93, 0.08, 0.18]].forEach(([m, amp, dk]) => {
    const o = audioCtx.createOscillator(); o.type = "sine"; o.frequency.value = f * m;
    const g = audioCtx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * dk);
    o.connect(g).connect(g0); o.start(t); o.stop(t + dur * dk + 0.05);
  });
};
const cascabeles = (audioCtx, out, t, dur = 0.7, vol = 0.07) => {
  const buf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * dur), audioCtx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource(); src.buffer = buf;
  const bp = audioCtx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 7500; bp.Q.value = 0.9;
  const g = audioCtx.createGain(); g.gain.setValueAtTime(0, t);
  for (let k = 0; k < dur / 0.055; k++) { const tk = t + k * 0.055, v = vol * Math.pow(1 - (k * 0.055) / dur, 1.5) * (0.6 + Math.random() * 0.4); g.gain.setValueAtTime(v, tk); g.gain.exponentialRampToValueAtTime(0.0005, tk + 0.045); }
  src.connect(bp).connect(g).connect(out); src.start(t); src.stop(t + dur);
};
const NOTAS = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093, A6: 1760 };
const navidad = (fn) => { const audioCtx = getCtx(); if (!audioCtx) return; try { fn(audioCtx, navidadOut(audioCtx), audioCtx.currentTime + 0.03); } catch { /* nunca debe romper el flujo */ } };
const arpegioVenta = (a, o, t) => [["G5", 0.62], ["C6", 0.87], ["E6", 1.12], ["G6", 1.37]].forEach(([n, dt]) => campana(a, o, t + dt, NOTAS[n], 0.16, 1.4));

// 🎄 Venta registrada: cuatro campanitas que suben con la estrella y un brillo con cascabeles.
export const sonidoNavidadVenta = () => navidad((a, o, t) => { arpegioVenta(a, o, t); campana(a, o, t + 1.62, NOTAS.C7, 0.18, 2.2); cascabeles(a, o, t + 1.62, 0.8, 0.06); });
// 🎄 La venta encendió una estrella de la meta (cada 10 %): igual, pero cierra más brillante.
export const sonidoNavidadEstrella = () => navidad((a, o, t) => { arpegioVenta(a, o, t); campana(a, o, t + 1.62, NOTAS.A6, 0.2, 2.6); campana(a, o, t + 1.74, NOTAS.E6 * 2, 0.12, 2.2); cascabeles(a, o, t + 1.62, 1.0, 0.07); });
// 🎄 Meta del mes cumplida: «Jingle Bells» (J. Pierpont, 1857 — dominio público) en campanas con cascabeles.
export const sonidoNavidadMeta = () => navidad((a, o, t0) => {
  const t = t0 + 0.62, q = 0.21; let x = t;
  [["E5", 1], ["E5", 1], ["E5", 2], ["E5", 1], ["E5", 1], ["E5", 2], ["E5", 1], ["G5", 1], ["C5", 1.5], ["D5", 0.5], ["E5", 4]].forEach(([n, d]) => { campana(a, o, x, NOTAS[n] * 2, 0.2, 1.5); x += d * q; });
  for (let k = 0; k < 8; k++) cascabeles(a, o, t + k * q * 2, 0.18, 0.05);
  campana(a, o, x - 4 * q, NOTAS.C5, 0.12, 3); cascabeles(a, o, x - 4 * q + 0.05, 1.2, 0.06);
});
// 🎄 Al entrar: un destello corto.
export const sonidoNavidadIngreso = () => navidad((a, o, t) => { campana(a, o, t, NOTAS.E6, 0.12, 1.6); campana(a, o, t + 0.12, NOTAS.G6, 0.12, 1.8); cascabeles(a, o, t, 0.4, 0.035); });
