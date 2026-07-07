import { useCallback, useEffect, useMemo, useState } from "react";
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

export function useAuthStore() {
  const [state, setState] = useState<AuthState>({
    status: "checking",
    accessToken: null,
    user: null,
    permissions: [],
    expiresAt: null,
    lastError: null,
  });

  const applySuccess = useCallback(async (result: Awaited<ReturnType<typeof authApi.loginPassword>>) => {
    if (!isAuthSuccess(result)) {
      setState((current) => ({ ...current, status: "anonymous", lastError: result }));
      return false;
    }

    await window.lifecycleX?.auth.setRefreshToken(result.refreshToken);
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
    const refreshToken = (await window.lifecycleX?.auth.getRefreshToken()) ?? null;
    if (!refreshToken) {
      setState((current) => ({ ...current, status: "anonymous" }));
      return;
    }

    const result = await authApi.refresh(refreshToken);
    if (isAuthSuccess(result)) {
      await applySuccess(result);
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
      const result = await authApi.loginPassword(identifier, password);
      return applySuccess(result);
    },
    [applySuccess],
  );

  const completeSso = useCallback(
    async (stateToken: string) => {
      const result = await authApi.completeSso(stateToken);
      return applySuccess(result);
    },
    [applySuccess],
  );

  const logout = useCallback(async () => {
    const refreshToken = (await window.lifecycleX?.auth.getRefreshToken()) ?? null;
    await authApi.logout(refreshToken ?? undefined);
    await window.lifecycleX?.auth.clearRefreshToken();
    setState({
      status: "anonymous",
      accessToken: null,
      user: null,
      permissions: [],
      expiresAt: null,
      lastError: null,
    });
  }, []);

  const refreshSession = useCallback(async (options: RefreshSessionOptions = {}): Promise<AuthSuccess | false> => {
    const clearOnFailure = options.clearOnFailure ?? true;
    const refreshToken = (await window.lifecycleX?.auth.getRefreshToken()) ?? null;
    if (!refreshToken) {
      if (clearOnFailure) {
        setState({
          status: "anonymous",
          accessToken: null,
          user: null,
          permissions: [],
          expiresAt: null,
          lastError: null,
        });
      }
      return false;
    }

    const result = await authApi.refresh(refreshToken);
    if (isAuthSuccess(result)) {
      await applySuccess(result);
      return result;
    }

    if (clearOnFailure) {
      await window.lifecycleX?.auth.clearRefreshToken();
      setState({
        status: "anonymous",
        accessToken: null,
        user: null,
        permissions: [],
        expiresAt: null,
        lastError: result,
      });
    }
    return false;
  }, [applySuccess]);

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
