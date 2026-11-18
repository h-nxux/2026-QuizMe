// Tiny history-API router. Paths are real URLs (vercel.json rewrites them to index.html), so
// the Android back gesture moves between screens instead of leaving the app.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'deck'; id: string }
  | { name: 'create'; text?: string }
  | { name: 'stats' }
  | { name: 'me' }
  | { name: 'play' }
  | { name: 'result' }
  | { name: 'listen'; deckId?: string }
  | { name: 'onboarding' }
  | { name: 'notFound' };

export function parse(pathname: string, search = ''): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const q = new URLSearchParams(search);
  switch (parts[0]) {
    case undefined:
      return { name: 'home' };
    case 'library':
      return { name: 'library' };
    case 'deck':
      return parts[1] ? { name: 'deck', id: decodeURIComponent(parts[1]) } : { name: 'library' };
    case 'create': {
      // Web Share Target sends title/text/url as query params.
      const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n');
      return { name: 'create', text: shared || undefined };
    }
    case 'stats':
      return { name: 'stats' };
    case 'me':
      return { name: 'me' };
    case 'play':
      return { name: 'play' };
    case 'result':
      return { name: 'result' };
    case 'listen':
      return { name: 'listen', deckId: q.get('deck') ?? undefined };
    case 'welcome':
      return { name: 'onboarding' };
    default:
      return { name: 'notFound' };
  }
}

export function pathOf(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'deck':
      return `/deck/${encodeURIComponent(route.id)}`;
    case 'onboarding':
      return '/welcome';
    case 'create':
      return '/create';
    case 'listen':
      return route.deckId ? `/listen?deck=${encodeURIComponent(route.deckId)}` : '/listen';
    case 'notFound':
      return '/';
    default:
      return `/${route.name}`;
  }
}

const listeners = new Set<() => void>();
let current = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';

function update() {
  current = window.location.pathname + window.location.search;
  listeners.forEach(l => l());
}

if (typeof window !== 'undefined') window.addEventListener('popstate', update);

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const path = pathOf(route);
  if (opts.replace) window.history.replaceState({ depth: depth() }, '', path);
  else window.history.pushState({ depth: depth() + 1 }, '', path);
  update();
  window.scrollTo(0, 0);
}

function depth() {
  return (window.history.state as { depth?: number } | null)?.depth ?? 0;
}

// Back within the app when there is in-app history, otherwise go to a sensible parent.
export function goBack(fallback: Route = { name: 'home' }) {
  if (depth() > 0) window.history.back();
  else navigate(fallback, { replace: true });
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const [pathname, search = ''] = path.split('?');
  return parse(pathname, search ? `?${search}` : '');
}
