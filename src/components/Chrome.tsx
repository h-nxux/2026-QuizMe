import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { goBack, navigate, type Route } from '../lib/router';
import { cue } from '../lib/feedback';

type Tab = { route: Route; label: string; icon: IconName };
const TABS: Tab[] = [
  { route: { name: 'home' }, label: '홈', icon: 'home' },
  { route: { name: 'library' }, label: '서재', icon: 'library' },
  { route: { name: 'stats' }, label: '기록', icon: 'chart' },
  { route: { name: 'me' }, label: '나', icon: 'user' },
];

export function TabBar({ current }: { current: Route['name'] }) {
  const tab = (t: Tab) => (
    <button
      key={t.label}
      className={`tab ${current === t.route.name ? 'active' : ''}`}
      aria-current={current === t.route.name ? 'page' : undefined}
      onClick={() => navigate(t.route, { replace: true })}
    >
      <Icon name={t.icon} size={22} />
      <span>{t.label}</span>
    </button>
  );
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      {tab(TABS[0])}
      {tab(TABS[1])}
      <button
        className="tab-create"
        aria-label="새 덱 만들기"
        onClick={() => {
          cue('tap');
          navigate({ name: 'create' });
        }}
      >
        <Icon name="plus" size={28} />
      </button>
      {tab(TABS[2])}
      {tab(TABS[3])}
    </nav>
  );
}

type TopBarProps = { title?: ReactNode; back?: Route | true; actions?: ReactNode; transparent?: boolean };

export function TopBar({ title, back, actions, transparent }: TopBarProps) {
  return (
    <header className={`topbar ${transparent ? 'topbar-clear' : ''}`}>
      {back ? (
        <button className="icon-btn" aria-label="뒤로" onClick={() => goBack(back === true ? { name: 'home' } : back)}>
          <Icon name="back" />
        </button>
      ) : (
        <span className="topbar-spacer" />
      )}
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">{actions ?? <span className="topbar-spacer" />}</div>
    </header>
  );
}

export function EmptyState({ mascot, title, body, action }: { mascot: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {mascot}
      <h3>{title}</h3>
      {body && <p className="muted">{body}</p>}
      {action}
    </div>
  );
}
