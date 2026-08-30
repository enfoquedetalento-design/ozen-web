// Service worker mínimo, solo para recibir notificaciones push reales (funciona aunque la app
// esté cerrada). No cachea nada ni interfiere con Vite/el resto de la app — su único trabajo es
// escuchar el evento "push" que manda el navegador cuando llega un aviso, y mostrarlo.

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Ozen", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Ozen";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
    tag: data.tag || undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al tocar la notificación: si ya hay una pestaña de Ozen abierta, la enfoca; si no, abre una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
