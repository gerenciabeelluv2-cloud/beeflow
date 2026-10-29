/*
 * Service worker do Beeflow. Só existe para a notificação no celular de quem
 * usa o painel (criadora vencendo ou caindo, ausência no turno). Ver o cartão
 * de notificações em painel.js e, na API, src/lib/push.ts.
 *
 * NÃO tem handler de `fetch` de propósito: ele não intercepta nenhuma
 * requisição, não guarda cache e não muda nada no carregamento do site.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { corpo: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(dados.titulo || "Beeflow", {
      body: dados.corpo || "",
      tag: dados.tag || undefined,
      icon: "/assets/app/apple-touch-icon.png",
      data: { url: dados.url || "/painel.html" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/painel.html", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const abertas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const janela = abertas[0];
      if (janela) {
        await janela.focus();
        try {
          await janela.navigate(url);
        } catch {
          /* janela que o worker não controla: só traz para frente */
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
