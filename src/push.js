// Suscripción a notificaciones push reales (llegan aunque la app/pestaña esté cerrada) — usadas
// para avisar a los admins de Turnos cuando alguien marca entrada. La llave pública VAPID es
// segura de tener en el cliente (solo la privada, que vive en el Edge Function, es secreta).
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = "BItJU0T1cB_aGuvrquwQxscuxsA1p6jIAYKCzf6iuFSGmv_Ra3nFe8636RNSs590OOiePDw5V3bX4QA7mmyCDxo";

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
};

// true/false — para saber si el navegador soporta esto antes de mostrar el botón.
export const notificacionesSoportadas = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// En iPhone/iPad, Apple SOLO entrega push a sitios abiertos como app instalada desde la pantalla
// de inicio (Compartir ▸ Agregar a pantalla de inicio) — un sitio abierto normal en Safari puede
// pedir el permiso y crear la suscripción sin ningún error (por eso "decía que estaba activada"),
// pero el push nunca llega porque iOS lo bloquea en segundo plano para pestañas normales de
// Safari. `window.navigator.standalone` es la forma que da Apple para detectar si se está
// corriendo como esa app instalada.
export const requiereInstalarEnIOS = () => {
  if (typeof navigator === "undefined") return false;
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const yaInstalada = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  return esIOS && !yaInstalada;
};

// Devuelve el estado actual sin pedir nada: "granted" | "denied" | "default" (nunca preguntado).
export const permisoNotificaciones = () => (notificacionesSoportadas() ? Notification.permission : "no-soportado");

// El botón "Activar notificaciones" se oculta solo cuando de verdad quedó una suscripción
// guardada en Supabase (ver activarNotificacionesPush) — NO solo cuando el navegador reporta el
// permiso como "granted". En Safari/macOS se vio un caso real donde el permiso queda en
// "granted" pero el registro de la suscripción falla igual (por ejemplo si el sistema tiene las
// notificaciones del navegador bloqueadas a nivel de Ajustes del Sistema) — si el botón se
// ocultara solo por el permiso, la persona se queda sin forma de reintentar.
const LS_PUSH_ACTIVO = "ozen_push_activo";
export const pushActivo = () => {
  try { return localStorage.getItem(LS_PUSH_ACTIVO) === "1"; } catch (e) { return false; }
};

// Pide permiso (si hace falta) y guarda la suscripción en Supabase, ligada al usuario. Debe
// llamarse desde un clic real del usuario — los navegadores bloquean el pedido de permiso si no.
export const activarNotificacionesPush = async (user) => {
  if (!notificacionesSoportadas()) return { ok: false, motivo: "no_soportado" };
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return { ok: false, motivo: "permiso_denegado" };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, updated_at: new Date().toISOString() },
      { onConflict: "endpoint" }
    );
    if (error) return { ok: false, motivo: "error_guardando", error };
    try { localStorage.setItem(LS_PUSH_ACTIVO, "1"); } catch (e) { /* sin localStorage, no pasa nada */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: "error", error: e };
  }
};
