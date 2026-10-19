// Service worker do aplicativo do ACS: execução off-line (TR 1.2.49.1) e atualização automática,
// sem intervenção do ACS (TR 1.2.49.4). Os dados do território ficam no IndexedDB cifrado; aqui só
// a aplicação (HTML, scripts, estilos e imagens do mapa já vistas) é guardada em cache.
const VERSAO = 'acs-v1';
const SHELL = '/acs/';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll([SHELL, '/icone.svg', '/acs-manifest.json'])).catch(() => undefined));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k.startsWith('acs-') && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// O aplicativo informa os recursos já carregados antes do service worker assumir o controle,
// para que a próxima abertura funcione inteiramente sem conexão.
self.addEventListener('message', (e) => {
  if (e.data?.tipo !== 'precache' || !Array.isArray(e.data.urls)) return;
  e.waitUntil(
    caches.open(VERSAO).then((c) =>
      Promise.all(
        e.data.urls
          .filter((u) => { try { const x = new URL(u); return x.origin === self.location.origin && !x.pathname.startsWith('/api/'); } catch { return false; } })
          .map((u) => c.match(u).then((tem) => tem || fetch(u).then((r) => r.ok && c.put(u, r)).catch(() => undefined))),
      ),
    ),
  );
});

const guardar = (req, r) => {
  if (r && (r.ok || r.type === 'opaque')) {
    const copia = r.clone();
    caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => undefined);
  }
  return r;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // A API nunca é servida do cache (dados sempre do servidor ou do cofre local).
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(SHELL, copia)).catch(() => undefined);
          return r;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }
  // Recursos da aplicação e blocos do mapa: rede primeiro (versão mais nova), cache sem conexão.
  if (url.origin === self.location.origin || /tile\.openstreetmap\.org|arcgisonline\.com/.test(url.hostname)) {
    e.respondWith(fetch(req).then((r) => guardar(req, r)).catch(() => caches.match(req, { ignoreVary: true })));
  }
});
