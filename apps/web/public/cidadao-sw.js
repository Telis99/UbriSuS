// Service worker do aplicativo do cidadão (TR 1.2.41.1, 1.2.41.2): instalação como aplicativo,
// atualização automática (rede primeiro) e tela inicial disponível mesmo com conexão instável.
const VERSAO = 'cidadao-v1';
const SHELL = '/cidadao/';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSAO).then((c) => c.add(SHELL)).catch(() => undefined));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k.startsWith('cidadao-') && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Dados pessoais da API nunca ficam em cache.
  if (url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(SHELL, copia));
          return r;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }
  // Recursos estáticos: rede primeiro, cópia em cache para uso sem conexão.
  e.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(req, copia));
        }
        return r;
      })
      .catch(() => caches.match(req)),
  );
});
