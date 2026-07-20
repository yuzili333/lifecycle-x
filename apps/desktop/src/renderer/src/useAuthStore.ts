import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authApi, isAuthSuccess, type AuthFailure, type AuthSuccess, type AuthUser } from "./auth";

export type AuthStatus = "checking" | "anonymous" | "authenticated";

export type AuthState = {
  status: AuthStatus;
  accessToken: string | null;
  user: AuthUser | null;
  permissions: string[];
  expiresAt: string | null;
  lastError: AuthFailure | null;
};

type RefreshSessionOptions = {
  clearOnFailure?: boolean;
};

type LogoutOptions = {
  remote?: boolean;
};

export function useAuthStore() {
  const logoutPromiseRef = useRef<Promise<void> | null>(null);
  const authEpochRef = useRef(0);
  const [state, setState] = useState<AuthState>({
    status: "checking",
    accessToken: null,
    user: null,
    permissions: [],
    expiresAt: null,
    lastError: null,
  });

  const applySuccess = useCallback(async (result: Awaited<ReturnType<typeof authApi.loginPassword>>, epoch = authEpochRef.current) => {
    if (epoch !== authEpochRef.current) {
      return false;
    }

    if (!isAuthSuccess(result)) {
      setState((current) => ({ ...current, status: "anonymous", lastError: result }));
      return false;
    }

    await window.lifecycleX?.auth.setRefreshToken(result.refreshToken);
    if (epoch !== authEpochRef.current) {
      try {
        await window.lifecycleX?.auth.clearRefreshToken();
      } catch {
        // A stale login or refresh response must not keep the authenticated route alive.
      }
      return false;
    }

    setState({
      status: "authenticated",
      accessToken: result.accessToken,
      user: result.user,
      permissions: result.permissions,
      expiresAt: result.expiresAt,
      lastError: null,
    });
    return true;
  }, []);

  const initialize = useCallback(async () => {
    const epoch = authEpochRef.current;
    const refreshToken = (await window.lifecycleX?.auth.getRefreshToken()) ?? null;
    if (epoch !== authEpochRef.current) {
      return;
    }
    if (!refreshToken) {
      setState((current) => ({ ...current, status: "anonymous" }));
      return;
    }

    const result = await authApi.refresh(refreshToken);
    if (epoch !== authEpochRef.current) {
      return;
    }
    if (isAuthSuccess(result)) {
      await applySuccess(result, epoch);
      return;
    }

    await window.lifecycleX?.auth.clearRefreshToken();
    setState({
      status: "anonymous",
      accessToken: null,
      user: null,
      permissions: [],
      expiresAt: null,
      lastError: result,
    });
  }, [applySuccess]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const loginWithPassword = useCallback(
    async (identifier: string, password: string) => {
      const epoch = authEpochRef.current + 1;
      authEpochRef.current = epoch;
      const result = await authApi.loginPassword(identifier, password);
      return applySuccess(result, epoch);
    },
    [applySuccess],
  );

  const completeSso = useCallback(
    async (stateToken: string) => {
      const epoch = authEpochRef.current + 1;
      authEpochRef.current = epoch;
      const result = await authApi.completeSso(stateToken);
      return applySuccess(result, epoch);
    },
    [applySuccess],
  );

  const clearLocalAuth = useCallback(async (lastError: AuthFailure | null = null) => {
    setState((current) => {
      const next: AuthState = {
        status: "anonymous",
        accessToken: null,
        user: null,
        permissions: [],
        expiresAt: null,
        lastError,
      };
      if (
        current.status === next.status &&
        current.accessToken === next.accessToken &&
        current.user === next.user &&
        current.expiresAt === next.expiresAt &&
        current.lastError === next.lastError &&
        current.permissions.length === 0
      ) {
        return current;
      }
      return next;
    });

    try {
      await window.lifecycleX?.auth.clearRefreshToken();
    } catch {
      // The renderer must leave the authenticated route even if token storage cleanup fails.
    }
  }, []);

  const logout = useCallback(async (options: LogoutOptions = {}) => {
    if (logoutPromiseRef.current) {
      return logoutPromiseRef.current;
    }

    const shouldLogoutRemote = options.remote ?? true;
    const logoutPromise = (async () => {
      authEpochRef.current += 1;
      let refreshToken: string | null = null;
      if (shouldLogoutRemote) {
        try {
          refreshToken = (await window.lifecycleX?.auth.getRefreshToken()) ?? null;
        } catch {
          refreshToken = null;
        }
      }

      await clearLocalAuth();
      if (shouldLogoutRemote && refreshToken) {
        await authApi.logout(refreshToken);
      }
    })().finally(() => {
      logoutPromiseRef.current = null;
    });

    logoutPromiseRef.current = logoutPromise;
    return logoutPromise;
  }, [clearLocalAuth]);

  const refreshSession = useCallback(async (options: RefreshSessionOptions = {}): Promise<AuthSuccess | false> => {
    const epoch = authEpochRef.current;
    const clearOnFailure = options.clearOnFailure ?? true;
    const refreshToken = (await window.lifecycleX?.auth.getRefreshToken()) ?? null;
    if (epoch !== authEpochRef.current) {
      return false;
    }
    if (!refreshToken) {
      if (clearOnFailure) {
        await clearLocalAuth();
      }
      return false;
    }

    const result = await authApi.refresh(refreshToken);
    if (epoch !== authEpochRef.current) {
      return false;
    }
    if (isAuthSuccess(result)) {
      await applySuccess(result, epoch);
      return result;
    }

    if (clearOnFailure) {
      await clearLocalAuth(result);
    }
    return false;
  }, [applySuccess, clearLocalAuth]);

  const updateUser = useCallback((userPatch: Partial<AuthUser>) => {
    setState((current) => ({
      ...current,
      user: current.user ? { ...current.user, ...userPatch } : current.user,
    }));
  }, []);

  return useMemo(
    () => ({
      ...state,
      loginWithPassword,
      completeSso,
      logout,
      refreshSession,
      updateUser,
      setLastError: (lastError: AuthFailure | null) =>
        setState((current) => ({
          ...current,
          lastError,
        })),
    }),
    [completeSso, loginWithPassword, logout, refreshSession, state, updateUser],
  );
}
