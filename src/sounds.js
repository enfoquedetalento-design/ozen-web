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
