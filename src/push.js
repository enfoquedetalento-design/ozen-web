// Suscripción a notificaciones push reales (llegan aunque la app/pestaña esté cerrada) — usadas
// para avisar a los admins de Turnos cuando alguien marca entrada. La llave pública VAPID es
// segura de tener en el cliente (solo la privada, que vive en el Edge Function, es secreta).
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = "BATM-jztB6zm9sDRVNSm7JMBnPL_0qkPz2bSYi11GWt9xp88EGyXuJviNcpWWcP6wzfk2VHDloOaT9v4layxpqE";

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
};

// true/false — para saber si el navegador soporta esto antes de mostrar el botón.
export const notificacionesSoportadas = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// Devuelve el estado actual sin pedir nada: "granted" | "denied" | "default" (nunca preguntado).
export const permisoNotificaciones = () => (notificacionesSoportadas() ? Notification.permission : "no-soportado");

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
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: "error", error: e };
  }
};
