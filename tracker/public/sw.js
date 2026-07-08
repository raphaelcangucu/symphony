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

  // Skip the OS notification when a tracker window is focused: the user is
  // already watching (live channels update the UI), so a popup is just noise.
  // Chrome explicitly allows suppressing push notifications in this case.
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const focused = windowClients.some(
          (client) => client.focused && client.visibilityState === "visible",
        );

        if (focused) {
          return undefined;
        }

        return self.registration.showNotification(payload.title, {
          body: payload.body,
          tag: payload.tag || defaults.tag,
          data: { url: payload.url || defaults.url },
          icon: "/tracker/favicon.svg",
        });
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
