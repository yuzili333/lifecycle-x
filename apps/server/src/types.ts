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
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type UserRole = "user" | "admin";

export type LoginMethod = "password" | "sso";

export type UserStatus = "active" | "disabled";

export type AuthUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
};

export type AuthSuccess = {
  success: true;
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  permissions: string[];
  expiresAt: string;
  auditWritePending?: boolean;
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

export type AuthResponse = AuthSuccess | AuthFailure;

export type ClientInfo = {
  deviceId?: string;
  appVersion?: string;
  platform?: string;
};
