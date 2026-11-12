self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  const cachesToRemove = (await caches.keys()).filter(name => name.startsWith("validastock-shell-"));
  await Promise.all(cachesToRemove.map(name => caches.delete(name)));
  await self.registration.unregister();
})()));
