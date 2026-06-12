self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const defaults = {
    title: "Symphony",
    body: "Update",
    url: "/tracker/",
    tag: "symphony",
  };

  let payload = defaults;

  if (event.data) {
    try {
      payload = { ...defaults, ...JSON.parse(event.data.text()) };
    } catch (_error) {
      payload = { ...defaults, body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || defaults.tag,
      data: { url: payload.url || defaults.url },
      icon: "/tracker/favicon.svg",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const path = event.notification.data?.url || "/tracker/";
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(target) && "focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(target);
      }

      return undefined;
    }),
  );
});
