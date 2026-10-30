'use client';

import { useQueryClient } from '@tanstack/react-query';
import { type Grant, type Permission, type Role, type Scope, type SessionResponse, type SessionUser, can } from '@yucampus/types';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSignedOutHandler } from '@/lib/api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: SessionUser };

type AuthContextValue = AuthState & {
  /** The distinct roles the person holds, across all departments. */
  roles: Role[];
  /** What the person may do (from the server). Hiding things is a courtesy; the API enforces it. */
  grants: Grant[];
  can(permission: Permission, scopes?: readonly Scope[]): boolean;
  /** Reads the person again, e.g. after their college changed permissions. */
  reloadUser(): Promise<void>;
  signIn(session: SessionResponse): void;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const queryClient = useQueryClient();

  useEffect(() => {
    setSignedOutHandler(() => {
      queryClient.clear();
      setState({ status: 'signedOut', user: null });
    });
    // On every page load, try to pick the session back up from the refresh cookie.
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      setState(session ? { status: 'signedIn', user: session.user } : { status: 'signedOut', user: null });
    });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const signIn = useCallback((session: SessionResponse) => {
    setAccessToken(session.accessToken);
    setState({ status: 'signedIn', user: session.user });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', auth: false });
    } finally {
      setAccessToken(null);
      // Nothing from this person's session may show to whoever signs in next on this device.
      queryClient.clear();
      setState({ status: 'signedOut', user: null });
    }
  }, [queryClient]);

  const reloadUser = useCallback(async () => {
    const user = await api<SessionUser>('/auth/me');
    setState({ status: 'signedIn', user });
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const roles = [...new Set(state.user?.roles.map((assignment) => assignment.role) ?? [])];
    const grants = state.user?.permissions ?? [];
    return {
      ...state,
      roles,
      grants,
      can: (permission, scopes) => can(grants, permission, scopes),
      reloadUser,
      signIn,
      signOut,
    };
  }, [state, signIn, signOut, reloadUser]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
