import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { AuthUser, ClientInfo, LoginMethod } from "./types.js";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 30;
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SSO_STATE_TTL_MS = 10 * 60 * 1000;

type InternalUser = AuthUser & {
  passwordHash?: string;
  failedAttempts: number;
  lockedUntil?: number;
  ssoProviderId?: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  accessToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  revokedAt?: number;
  clientInfo?: ClientInfo;
};

export type AuditLog = {
  id: string;
  traceId: string;
  userId?: string;
  identifier?: string;
  method: LoginMethod | "refresh" | "logout" | "password-reset" | "password-change";
  result: "success" | "failure";
  reason?: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
};

export type SsoState = {
  state: string;
  nonce: string;
  email: string;
  providerId: string;
  expiresAt: number;
};

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) {
    return false;
  }

  const actual = Buffer.from(hashPassword(password, salt).split(":")[1], "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function token(prefix: string) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export class AuthStore {
  private users = new Map<string, InternalUser>();
  private sessions = new Map<string, SessionRecord>();
  private accessIndex = new Map<string, string>();
  private resetTokens = new Map<string, { userId: string; expiresAt: number; usedAt?: number }>();
  private ssoStates = new Map<string, SsoState>();
  readonly auditLogs: AuditLog[] = [];

  constructor() {
    this.seedUsers();
  }

  findUserByIdentifier(identifier: string) {
    const normalized = identifier.trim().toLowerCase();
    return Array.from(this.users.values()).find(
      (user) => user.email.toLowerCase() === normalized || user.username.toLowerCase() === normalized,
    );
  }

  findUserById(userId: string) {
    return this.users.get(userId);
  }

  isPasswordValid(user: InternalUser, password: string) {
    return Boolean(user.passwordHash && verifyPassword(password, user.passwordHash));
  }

  isLocked(user: InternalUser, now = Date.now()) {
    return Boolean(user.lockedUntil && user.lockedUntil > now);
  }

  registerFailure(user: InternalUser, now = Date.now()) {
    user.failedAttempts += 1;
    if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = now + LOCK_MINUTES * 60 * 1000;
    }
  }

  clearFailures(user: InternalUser) {
    user.failedAttempts = 0;
    user.lockedUntil = undefined;
  }

  createSession(user: AuthUser, clientInfo?: ClientInfo) {
    const now = Date.now();
    const accessToken = token("lx_at");
    const refreshToken = token("lx_rt");
    const session: SessionRecord = {
      id: token("lx_session"),
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      accessToken,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
      refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
      clientInfo,
    };
    this.sessions.set(session.id, session);
    this.accessIndex.set(accessToken, session.id);

    return { session, accessToken, refreshToken };
  }

  resolveAccessToken(accessToken: string, now = Date.now()) {
    const sessionId = this.accessIndex.get(accessToken);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!session || session.revokedAt || session.expiresAt <= now) {
      return null;
    }

    const user = this.users.get(session.userId);
    if (!user || user.status !== "active" || this.isLocked(user, now)) {
      return null;
    }

    return { session, user };
  }

  refreshSession(refreshToken: string, now = Date.now()) {
    const refreshTokenHash = hashToken(refreshToken);
    const session = Array.from(this.sessions.values()).find(
      (candidate) =>
        candidate.refreshTokenHash === refreshTokenHash &&
        !candidate.revokedAt &&
        candidate.refreshExpiresAt > now,
    );
    if (!session) {
      return null;
    }

    const user = this.users.get(session.userId);
    if (!user || user.status !== "active" || this.isLocked(user, now)) {
      return null;
    }

    this.accessIndex.delete(session.accessToken);
    session.accessToken = token("lx_at");
    session.expiresAt = now + ACCESS_TOKEN_TTL_MS;
    this.accessIndex.set(session.accessToken, session.id);
    return { session, user, accessToken: session.accessToken };
  }

  revokeRefreshToken(refreshToken: string) {
    const refreshTokenHash = hashToken(refreshToken);
    const session = Array.from(this.sessions.values()).find(
      (candidate) => candidate.refreshTokenHash === refreshTokenHash,
    );
    if (session) {
      session.revokedAt = Date.now();
      this.accessIndex.delete(session.accessToken);
    }
  }

  revokeOtherSessions(userId: string, keepRefreshToken?: string) {
    const keepHash = keepRefreshToken ? hashToken(keepRefreshToken) : undefined;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.refreshTokenHash !== keepHash) {
        session.revokedAt = Date.now();
        this.accessIndex.delete(session.accessToken);
      }
    }
  }

  createPasswordResetToken(email: string) {
    const user = this.findUserByIdentifier(email);
    if (!user) {
      return null;
    }

    const rawToken = token("lx_reset");
    this.resetTokens.set(hashToken(rawToken), {
      userId: user.id,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    return rawToken;
  }

  resetPassword(resetToken: string, newPassword: string) {
    const tokenHash = hashToken(resetToken);
    const record = this.resetTokens.get(tokenHash);
    if (!record || record.usedAt || record.expiresAt <= Date.now()) {
      return null;
    }

    const user = this.users.get(record.userId);
    if (!user) {
      return null;
    }

    user.passwordHash = hashPassword(newPassword);
    this.clearFailures(user);
    record.usedAt = Date.now();
    this.revokeOtherSessions(user.id);
    return user;
  }

  changePassword(userId: string, oldPassword: string, newPassword: string, keepRefreshToken?: string) {
    const user = this.users.get(userId);
    if (!user || !this.isPasswordValid(user, oldPassword)) {
      return null;
    }

    user.passwordHash = hashPassword(newPassword);
    this.clearFailures(user);
    this.revokeOtherSessions(user.id, keepRefreshToken);
    return user;
  }

  createSsoState(email: string, providerId: string) {
    const state: SsoState = {
      state: token("lx_sso_state"),
      nonce: token("lx_sso_nonce"),
      email: email.trim().toLowerCase(),
      providerId,
      expiresAt: Date.now() + SSO_STATE_TTL_MS,
    };
    this.ssoStates.set(state.state, state);
    return state;
  }

  consumeSsoState(stateValue: string) {
    const state = this.ssoStates.get(stateValue);
    this.ssoStates.delete(stateValue);
    if (!state || state.expiresAt <= Date.now()) {
      return null;
    }
    return state;
  }

  appendAudit(log: Omit<AuditLog, "id" | "createdAt">) {
    this.auditLogs.push({
      ...log,
      id: token("lx_audit"),
      createdAt: new Date().toISOString(),
    });
  }

  permissionsFor(user: AuthUser) {
    const shared = ["analysis:read", "analysis:run", "datasource:read", "report:read"];
    return user.role === "admin"
      ? [...shared, "user:manage", "audit:read", "datasource:manage", "report:export"]
      : shared;
  }

  private seedUsers() {
    const users: InternalUser[] = [
      {
        id: "usr_admin",
        username: "admin",
        email: "admin@bank.example.com",
        displayName: "系统管理员",
        role: "admin",
        status: "active",
        passwordHash: hashPassword("Lifecycle@123"),
        failedAttempts: 0,
        ssoProviderId: "bank-oidc",
      },
      {
        id: "usr_analyst",
        username: "analyst",
        email: "analyst@bank.example.com",
        displayName: "贷后分析员",
        role: "user",
        status: "active",
        passwordHash: hashPassword("Lifecycle@123"),
        failedAttempts: 0,
        ssoProviderId: "bank-oidc",
      },
      {
        id: "usr_disabled",
        username: "disabled",
        email: "disabled@bank.example.com",
        displayName: "已停用用户",
        role: "user",
        status: "disabled",
        passwordHash: hashPassword("Lifecycle@123"),
        failedAttempts: 0,
        ssoProviderId: "bank-oidc",
      },
    ];

    for (const user of users) {
      this.users.set(user.id, user);
    }
  }
}
