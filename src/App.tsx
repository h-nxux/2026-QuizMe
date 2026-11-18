import { useEffect } from 'react';
import { initStore, setMeta, useStore } from './data/store';
import { startSync, stopSync } from './data/sync';
import { supabase } from './lib/supabase';
import { navigate, useRoute } from './lib/router';
import { AuthProvider, useAuthContext } from './state/auth';
import { TabBar } from './components/Chrome';
import { ToastHost } from './components/Toast';
import { Mascot } from './components/Mascot';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { DeckScreen } from './screens/DeckScreen';
import { Create } from './screens/Create';
import { Play } from './screens/Play';
import { Result } from './screens/Result';
import { Stats } from './screens/Stats';
import { Me } from './screens/Me';
import { Listen } from './screens/Listen';
import { Onboarding } from './screens/Onboarding';
import type { ThemePref } from './domain/types';
import { startStudy } from './state/derived';

void initStore();

function useTheme(pref: ThemePref) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || (pref === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1411' : '#fffbf6');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [pref]);
}

function useSyncLifecycle() {
  const auth = useAuthContext();
  const snap = useStore();
  const userId = auth.user?.id ?? null;
  useEffect(() => {
    if (!snap.ready || !auth.ready) return;
    if (supabase && userId) void startSync(supabase, userId);
    else stopSync();
  }, [snap.ready, auth.ready, userId]);
}

function Screens() {
  const route = useRoute();
  const snap = useStore();
  const auth = useAuthContext();
  useTheme(snap.settings.theme);
  useSyncLifecycle();

  // First run: introduce the app unless this device already has data (e.g. imported from v1)
  // or an account is signed in (its decks arrive with the first sync).
  useEffect(() => {
    if (!snap.ready || !auth.ready || snap.meta.onboarded) return;
    if (snap.decks.length > 0 || auth.user) setMeta({ onboarded: true });
    else if (route.name === 'home') navigate({ name: 'onboarding' }, { replace: true });
  }, [snap.ready, auth.ready, auth.user, snap.meta.onboarded, snap.decks.length, route.name]);

  // Home-screen shortcut "한 정거장 복습" opens /?start=review.
  useEffect(() => {
    if (!snap.ready || !new URLSearchParams(window.location.search).has('start')) return;
    window.history.replaceState(null, '', '/');
    startStudy({ mode: 'review', title: '한 정거장', stops: snap.settings.sessionStops }, '풀 카드가 없어요.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.ready]);

  if (!snap.ready) {
    return (
      <div className="boot">
        <Mascot mood="happy" size={88} />
      </div>
    );
  }

  const tabbed = ['home', 'library', 'stats', 'me', 'notFound'].includes(route.name);
  let screen;
  switch (route.name) {
    case 'library':
      screen = <Library />;
      break;
    case 'deck':
      screen = <DeckScreen key={route.id} id={route.id} />;
      break;
    case 'create':
      screen = <Create sharedText={route.text} />;
      break;
    case 'stats':
      screen = <Stats />;
      break;
    case 'me':
      screen = <Me />;
      break;
    case 'play':
      screen = <Play />;
      break;
    case 'result':
      screen = <Result />;
      break;
    case 'listen':
      screen = <Listen deckId={route.deckId} />;
      break;
    case 'onboarding':
      screen = <Onboarding />;
      break;
    default:
      screen = <Home />;
  }

  return (
    <div className={`app ${tabbed ? 'with-tabs' : ''}`}>
      {screen}
      {tabbed && <TabBar current={route.name === 'notFound' ? 'home' : route.name} />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Screens />
      <ToastHost />
    </AuthProvider>
  );
}
