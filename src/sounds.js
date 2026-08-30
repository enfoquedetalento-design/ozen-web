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
// brusco de un oscilador).
const nota = (audioCtx, freq, inicio, duracion, tipo = "sine", volumen = 0.16) => {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime + inicio);
  gain.gain.setValueAtTime(0, audioCtx.currentTime + inicio);
  gain.gain.linearRampToValueAtTime(volumen, audioCtx.currentTime + inicio + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + inicio + duracion);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(audioCtx.currentTime + inicio);
  osc.stop(audioCtx.currentTime + inicio + duracion + 0.03);
};

const reproducir = (notas) => {
  const audioCtx = getCtx();
  if (!audioCtx) return;
  try { notas.forEach(([freq, inicio, duracion, tipo, vol]) => nota(audioCtx, freq, inicio, duracion, tipo, vol)); } catch (e) { /* nunca debe romper el flujo de la app */ }
};

// 🛎️ Venta registrada — "cha-ching": dos campanadas agudas rápidas, tipo caja registradora.
export const sonidoVenta = () => reproducir([
  [1568, 0,    0.14, "triangle", 0.16],
  [2093, 0.06, 0.22, "triangle", 0.14],
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
