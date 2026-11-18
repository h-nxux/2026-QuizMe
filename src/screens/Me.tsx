import { useRef, useState } from 'react';
import { addSampleDeck, updateSettings, useStore, wipeLocal } from '../data/store';
import { fullResync, syncNow } from '../data/sync';
import { exportBackup, importBackup } from '../data/backup';
import { useAuthContext } from '../state/auth';
import { Icon } from '../components/Icon';
import { Mascot } from '../components/Mascot';
import { toast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { isIos, isStandalone, useInstall } from '../lib/install';
import { STOP_SIZE, type Settings, type ThemePref } from '../domain/types';
import { navigate } from '../lib/router';

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg seg-sm" role="group" aria-label={label}>
      {options.map(o => (
        <button key={String(o.v)} className={value === o.v ? 'on' : ''} aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function timeAgo(t?: number) {
  if (!t) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.round(s / 60)}분 전`;
  return `${Math.round(s / 3600)}시간 전`;
}

export function Me() {
  const snap = useStore();
  const auth = useAuthContext();
  const install = useInstall();
  const [iosHelp, setIosHelp] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const s = snap.settings;
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const name = (auth.user?.user_metadata?.full_name as string | undefined) ?? auth.user?.email ?? '';
  const avatar = auth.user?.user_metadata?.avatar_url as string | undefined;
  const sync = snap.sync;
  const syncText =
    sync.status === 'syncing' ? '동기화 중…' :
    sync.status === 'error' ? `동기화 오류: ${sync.error}` :
    sync.status === 'offline' ? '오프라인' :
    sync.status === 'idle' ? `동기화됨 · ${timeAgo(sync.lastSyncedAt)}` : '';

  return (
    <div className="screen me">
      <header className="page-head">
        <h1>나</h1>
      </header>

      <section className="card account">
        {auth.user ? (
          <>
            <div className="account-row">
              {avatar ? <img className="avatar" src={avatar} alt="" referrerPolicy="no-referrer" /> : <span className="avatar avatar-fallback">{name.slice(0, 1)}</span>}
              <div className="account-info">
                <strong>{name}</strong>
                <span className={`small ${sync.status === 'error' ? 'danger-text' : 'muted'}`}>
                  <Icon name={sync.status === 'error' || sync.status === 'offline' ? 'cloudOff' : 'cloud'} size={14} /> {syncText}
                </span>
              </div>
            </div>
            <div className="row-2">
              <button className="btn btn-ghost btn-sm" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
                <Icon name="refresh" size={18} /> 지금 동기화
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void auth.signOut()}>
                <Icon name="logout" size={18} /> 로그아웃
              </button>
            </div>
          </>
        ) : auth.enabled ? (
          <div className="account-guest">
            <Mascot mood="wow" size={64} />
            <div>
              <strong>게스트로 쓰는 중</strong>
              <p className="muted small">AI 생성과 기기 간 동기화는 로그인 후 사용할 수 있어요.</p>
            </div>
            <button className="btn btn-primary btn-block" onClick={auth.signIn} disabled={!auth.ready}>Google로 로그인</button>
          </div>
        ) : (
          <p className="muted small">개발 모드: 로그인 서버가 설정되지 않아 이 기기에만 저장돼요.</p>
        )}
      </section>

      <section className="settings-group">
        <h2 className="section-title">학습</h2>
        <div className="setting">
          <div><strong>하루 목표</strong><span className="muted small">{s.dailyGoalStops * STOP_SIZE}문제</span></div>
          <Seg label="하루 목표" value={s.dailyGoalStops} onChange={v => set({ dailyGoalStops: v })} options={[2, 4, 6, 10].map(v => ({ v, label: `${v}` }))} />
        </div>
        <div className="setting">
          <div><strong>한 번에 풀 정거장</strong><span className="muted small">{s.sessionStops * STOP_SIZE}문제</span></div>
          <Seg label="세션 길이" value={s.sessionStops} onChange={v => set({ sessionStops: v })} options={[1, 2, 3].map(v => ({ v, label: `${v}` }))} />
        </div>
        <div className="setting">
          <div><strong>하루 새 카드</strong></div>
          <Seg label="새 카드 상한" value={s.newPerDay} onChange={v => set({ newPerDay: v })} options={[10, 20, 30, 50].map(v => ({ v, label: `${v}` }))} />
        </div>
      </section>

      <section className="settings-group">
        <h2 className="section-title">화면·소리</h2>
        <div className="setting">
          <div><strong>진동</strong><span className="muted small">안드로이드만 지원</span></div>
          <Toggle label="진동" checked={s.haptics} onChange={v => set({ haptics: v })} />
        </div>
        <div className="setting">
          <div><strong>효과음</strong></div>
          <Toggle label="효과음" checked={s.sound} onChange={v => set({ sound: v })} />
        </div>
        <div className="setting">
          <div><strong>테마</strong></div>
          <Seg<ThemePref> label="테마" value={s.theme} onChange={v => set({ theme: v })} options={[{ v: 'system', label: '자동' }, { v: 'light', label: '라이트' }, { v: 'dark', label: '다크' }]} />
        </div>
      </section>

      {!isStandalone() && (
        <section className="card install-card">
          <Icon name="download" />
          <div>
            <strong>홈 화면에 추가</strong>
          </div>
          {install.available ? (
            <button className="btn btn-sm btn-choco" onClick={() => void install.prompt()}>설치</button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={() => setIosHelp(true)}>방법</button>
          )}
        </section>
      )}

      <section className="settings-group">
        <h2 className="section-title">데이터</h2>
        <button className="list-btn" onClick={exportBackup}><Icon name="download" size={20} /> 백업 파일로 내보내기</button>
        <button className="list-btn" onClick={() => importInput.current?.click()}><Icon name="upload" size={20} /> 백업 파일 가져오기</button>
        <input
          ref={importInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const r = await importBackup(file);
              toast(`덱 ${r.decks}개, 카드 ${r.cards}장, 기록 ${r.logs}개를 가져왔어요.`, { tone: 'good' });
            } catch (error) {
              toast(error instanceof Error ? error.message : '가져오지 못했어요.', { tone: 'error' });
            }
          }}
        />
        <button
          className="list-btn"
          onClick={() => {
            const deck = addSampleDeck();
            toast('샘플 덱 추가됨', { action: { label: '보기', run: () => navigate({ name: 'deck', id: deck.id }) } });
          }}
        >
          <Icon name="plus" size={20} /> 샘플 덱 추가
        </button>
        {auth.user && (
          <button className="list-btn" onClick={() => void fullResync().then(() => toast('동기화 완료'))}>
            <Icon name="refresh" size={20} /> 전체 다시 동기화
          </button>
        )}
        {!auth.user && (
          <button className="list-btn danger" onClick={() => setResetOpen(true)}><Icon name="trash" size={20} /> 이 기기 데이터 모두 지우기</button>
        )}
      </section>

      <p className="muted tiny center about">퀴즈미 v2</p>

      <Sheet open={iosHelp} onClose={() => setIosHelp(false)} title="홈 화면에 추가하기">
        <ol className="howto">
          {isIos() ? (
            <>
              <li>사파리 아래쪽 <b>공유</b> 버튼(□↑)을 눌러요.</li>
              <li><b>홈 화면에 추가</b>를 골라요.</li>
              <li>오른쪽 위 <b>추가</b>를 누르면 끝!</li>
            </>
          ) : (
            <>
              <li>브라우저 메뉴(⋮)를 열어요.</li>
              <li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 골라요.</li>
            </>
          )}
        </ol>
        <button className="btn btn-primary btn-block" onClick={() => setIosHelp(false)}>확인</button>
      </Sheet>

      <Sheet open={resetOpen} onClose={() => setResetOpen(false)} title="모두 지울까요?">
        <p className="muted">이 기기의 덱, 카드, 기록이 모두 삭제되며 되돌릴 수 없어요.</p>
        <div className="row-2">
          <button className="btn btn-ghost" onClick={() => setResetOpen(false)}>취소</button>
          <button
            className="btn btn-berry"
            onClick={async () => {
              await wipeLocal();
              setResetOpen(false);
              toast('삭제됨');
            }}
          >
            지우기
          </button>
        </div>
      </Sheet>
    </div>
  );
}
