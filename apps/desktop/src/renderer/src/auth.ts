export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "USER_NOT_FOUND"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "SSO_FAILED"
  | "SSO_USER_NOT_REGISTERED"
  | "SESSION_EXPIRED"
  | "PERMISSION_DENIED"
  | "QUERY_BLOCKED"
  | "QUERY_TIMEOUT"
  | "DATA_SOURCE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  avatarUrl?: string;
};

export type AuthSuccess = {
  success: true;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  permissions: string[];
  expiresAt: string;
};

export type AuthFailure = {
  success: false;
  error: {
    code: AuthErrorCode;
    message: string;
    traceId: string;
    fields?: Record<string, string>;
    remainingAttempts?: number;
  };
};

export type AuthSession = {
  success: true;
  user: AuthUser;
  permissions: string[];
  expiresAt: string;
};

type ApiResult<T> = T | AuthFailure;

export const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL ?? "http://127.0.0.1:4317";

export async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${AUTH_API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const text = await response.text();
    if (!text) {
      if (response.ok) {
        return { success: true } as ApiResult<T>;
      }
      return {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `认证服务返回空响应，HTTP ${response.status}。`,
          traceId: `client-http-${response.status}`,
        },
      };
    }

    try {
      return JSON.parse(text) as ApiResult<T>;
    } catch {
      return {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `认证服务返回了无法解析的响应，HTTP ${response.status}。`,
          traceId: `client-http-${response.status}`,
        },
      };
    }
  } catch {
    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "认证服务暂不可用，请确认服务端已启动。",
        traceId: "client-network-error",
      },
    };
  }
}

export const authApi = {
  loginPassword(identifier: string, password: string) {
    return request<AuthSuccess>("/auth/login/password", {
      method: "POST",
      body: JSON.stringify({
        identifier,
        password,
        clientInfo: {
          platform: navigator.platform,
          appVersion: "desktop",
        },
      }),
    });
  },

  startSso(email: string) {
    return request<{
      success: true;
      authorizationUrl: string;
      provider: { id: string; name: string };
      state: string;
      expiresAt: string;
    }>(`/auth/sso/start?email=${encodeURIComponent(email)}`);
  },

  completeSso(state: string) {
    return request<AuthSuccess>("/auth/sso/callback", {
      method: "POST",
      body: JSON.stringify({
        code: "mock:desktop-oidc-code",
        state,
        redirectUri: "lifecycle-x://auth/callback",
        clientInfo: {
          platform: navigator.platform,
          appVersion: "desktop",
        },
      }),
    });
  },

  session(accessToken: string) {
    return request<AuthSession>("/auth/session", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  },

  refresh(refreshToken: string) {
    return request<AuthSuccess>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  },

  logout(refreshToken?: string) {
    return request<{ success: true }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    });
  },

  forgotPassword(email: string) {
    return request<{ success: true }>("/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
};

export function isAuthSuccess(result: ApiResult<AuthSuccess>): result is AuthSuccess {
  return result.success === true && "accessToken" in result;
}

export function errorMessage(result: AuthFailure) {
  const attempts = result.error.remainingAttempts;
  return typeof attempts === "number" && attempts > 0
    ? `${result.error.message} 还可尝试 ${attempts} 次。`
    : result.error.message;
}
