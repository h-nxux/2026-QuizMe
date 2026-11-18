import { createContext, useContext, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '../hooks/useAuth';
import { Sheet } from '../components/Sheet';
import { Mascot } from '../components/Mascot';
import { toast } from '../components/Toast';
import { signOutCleanup } from '../data/sync';
import { abandon } from './sessionStore';

type AuthValue = {
  enabled: boolean;
  ready: boolean;
  user: User | null;
  // AI generation needs an account (API cost) unless Supabase isn't configured (local dev).
  canGenerate: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  requireLogin: (reason: string) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [loginReason, setLoginReason] = useState<string | null>(null);

  const signIn = () => {
    auth.signIn().catch(error => toast(`로그인하지 못했어요: ${error instanceof Error ? error.message : ''}`, { tone: 'error' }));
  };

  const value: AuthValue = {
    enabled: auth.enabled,
    ready: auth.ready,
    user: auth.user,
    canGenerate: !auth.enabled || auth.user !== null,
    signIn,
    signOut: async () => {
      // Push what's pending, clear this device (the account keeps everything), then sign out.
      await signOutCleanup();
      abandon();
      await auth.signOut();
      toast('로그아웃했어요');
    },
    requireLogin: setLoginReason,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Sheet open={loginReason !== null} onClose={() => setLoginReason(null)} title="로그인이 필요해요">
        <div className="login-sheet">
          <Mascot mood="wow" size={88} />
          <p>{loginReason}</p>
          <button className="btn btn-primary btn-block" onClick={signIn}>Google로 계속하기</button>
          <button className="btn btn-ghost btn-block" onClick={() => setLoginReason(null)}>나중에</button>
        </div>
      </Sheet>
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
