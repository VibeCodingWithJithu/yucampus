'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { PlatformAdminView, PlatformSession } from '@yucampus/types';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { platformApi, refreshPlatformSession, setPlatformSignedOutHandler, setPlatformToken } from '@/lib/platform-api';

type State = { status: 'loading'; admin: null } | { status: 'signedOut'; admin: null } | { status: 'signedIn'; admin: PlatformAdminView };

type Value = State & { signIn(session: PlatformSession): void; signOut(): Promise<void> };

const PlatformContext = createContext<Value | null>(null);

/** The YuCampus team member's session, separate from any college session on the same browser. */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading', admin: null });
  const queryClient = useQueryClient();

  useEffect(() => {
    setPlatformSignedOutHandler(() => {
      queryClient.removeQueries({ queryKey: ['platform'] });
      setState({ status: 'signedOut', admin: null });
    });
    let cancelled = false;
    void refreshPlatformSession().then((session) => {
      if (!cancelled) setState(session ? { status: 'signedIn', admin: session.admin } : { status: 'signedOut', admin: null });
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const signIn = useCallback((session: PlatformSession) => {
    setPlatformToken(session.accessToken);
    setState({ status: 'signedIn', admin: session.admin });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await platformApi('/auth/logout', { method: 'POST', auth: false });
    } finally {
      setPlatformToken(null);
      queryClient.removeQueries({ queryKey: ['platform'] });
      setState({ status: 'signedOut', admin: null });
    }
  }, [queryClient]);

  const value = useMemo<Value>(() => ({ ...state, signIn, signOut }), [state, signIn, signOut]);
  return <PlatformContext value={value}>{children}</PlatformContext>;
}

export function usePlatform(): Value {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside <PlatformProvider>.');
  return value;
}
