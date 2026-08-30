// Edge Function: manda una notificación push real a todos los admins de Turnos (role "master" o
// "admin_turnos") que tengan una suscripción guardada — se llama desde el cliente justo después
// de registrar una entrada (ver handleCapture en App.jsx). No hace nada más que eso: buscar a
// quién avisar y mandarles el aviso.
//
// Variables de entorno necesarias (se configuran con `supabase secrets set`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — el par de llaves de este proyecto (ver README de push).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente, no hay que
// configurarlos a mano.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails("mailto:soporte@ozenpiel.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "VAPID keys no configuradas" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { title, body, url } = await req.json();

    const { data: admins, error: errAdmins } = await supabaseAdmin
      .from("users")
      .select("id")
      .in("role", ["master", "admin_turnos"]);
    if (errAdmins) throw errAdmins;
    const ids = (admins || []).map((a) => a.id);
    if (ids.length === 0) {
      return new Response(JSON.stringify({ ok: true, enviados: 0, motivo: "sin_admins" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: subs, error: errSubs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .in("user_id", ids);
    if (errSubs) throw errSubs;

    let enviados = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: title || "Ozen", body: body || "", url: url || "/" })
        );
        enviados++;
      } catch (e) {
        // 404/410 = la suscripción ya no es válida (el usuario desinstaló, cambió de navegador,
        // etc.) — se borra para no seguir intentando en vano.
        const status = e?.statusCode;
        if (status === 404 || status === 410) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, enviados, destinatarios: (subs || []).length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
