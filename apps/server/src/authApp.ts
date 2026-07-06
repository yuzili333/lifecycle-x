import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { AuthStore, MAX_FAILED_ATTEMPTS, type WorkbenchSettings } from "./authStore.js";
import type { AuthErrorCode, AuthFailure, AuthSuccess, AuthUser, ClientInfo } from "./types.js";

const DEFAULT_PORT = 4317;
const SSO_PROVIDERS: Record<string, { id: string; name: string; issuer: string }> = {
  "bank.example.com": {
    id: "bank-oidc",
    name: "Bank Enterprise SSO",
    issuer: "https://idp.bank.example.com",
  },
};

function authFailure(
  code: AuthErrorCode,
  message: string,
  traceId: string,
  extra: Partial<AuthFailure["error"]> = {},
): AuthFailure {
  return {
    success: false,
    error: {
      code,
      message,
      traceId,
      ...extra,
    },
  };
}

function sendFailure(
  response: Response,
  status: number,
  code: AuthErrorCode,
  message: string,
  traceId: string,
  extra: Partial<AuthFailure["error"]> = {},
) {
  response.status(status).json(authFailure(code, message, traceId, extra));
}

function sanitizeUser(user: AuthUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl,
  };
}

function successPayload(store: AuthStore, user: AuthUser, accessToken: string, refreshToken: string, expiresAt: number): AuthSuccess {
  return {
    success: true,
    accessToken,
    refreshToken,
    user: sanitizeUser(user),
    permissions: store.permissionsFor(user),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function clientInfo(body: unknown): ClientInfo | undefined {
  if (!body || typeof body !== "object" || !("clientInfo" in body)) {
    return undefined;
  }
  const value = (body as { clientInfo?: ClientInfo }).clientInfo;
  return value && typeof value === "object" ? value : undefined;
}

function bearerToken(request: Request) {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}

function requestMeta(request: Request) {
  return {
    ip: request.ip,
    userAgent: request.header("user-agent"),
  };
}

function resolveAuthenticatedRequest(store: AuthStore, request: Request) {
  const accessToken = bearerToken(request);
  return accessToken ? store.resolveAccessToken(accessToken) : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidSettingsPatch(value: unknown): value is Partial<WorkbenchSettings> {
  if (!isPlainObject(value)) {
    return false;
  }

  const allowedRootKeys = new Set(["general", "appearance", "configuration", "personalization"]);
  return Object.keys(value).every((key) => allowedRootKeys.has(key) && isPlainObject(value[key]));
}

export function createAuthApp(store = new AuthStore()) {
  const app = express();

  app.use(express.json({ limit: "256kb" }));
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "lifecycle-x-auth" });
  });

  app.post("/auth/login/password", (request, response) => {
    const traceId = randomUUID();
    const { identifier, password } = request.body as { identifier?: string; password?: string };
    const meta = requestMeta(request);

    if (!identifier || !password) {
      sendFailure(response, 400, "VALIDATION_ERROR", "请输入账号/邮箱和密码。", traceId, {
        fields: {
          ...(!identifier ? { identifier: "账号或邮箱不能为空。" } : {}),
          ...(!password ? { password: "密码不能为空。" } : {}),
        },
      });
      return;
    }

    const user = store.findUserByIdentifier(identifier);
    if (!user) {
      store.appendAudit({ traceId, identifier, method: "password", result: "failure", reason: "USER_NOT_FOUND", ...meta });
      sendFailure(response, 401, "INVALID_CREDENTIALS", "账号或密码错误。", traceId);
      return;
    }

    if (user.status !== "active") {
      store.appendAudit({ traceId, userId: user.id, identifier, method: "password", result: "failure", reason: "ACCOUNT_DISABLED", ...meta });
      sendFailure(response, 403, "ACCOUNT_DISABLED", "账号已停用，请联系系统管理员。", traceId);
      return;
    }

    if (store.isLocked(user)) {
      store.appendAudit({ traceId, userId: user.id, identifier, method: "password", result: "failure", reason: "ACCOUNT_LOCKED", ...meta });
      sendFailure(response, 423, "ACCOUNT_LOCKED", "账号已锁定，请通过找回密码解锁或联系管理员。", traceId);
      return;
    }

    if (!store.isPasswordValid(user, password)) {
      store.registerFailure(user);
      const remainingAttempts = Math.max(MAX_FAILED_ATTEMPTS - user.failedAttempts, 0);
      const code = store.isLocked(user) ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS";
      store.appendAudit({ traceId, userId: user.id, identifier, method: "password", result: "failure", reason: code, ...meta });
      sendFailure(
        response,
        code === "ACCOUNT_LOCKED" ? 423 : 401,
        code,
        code === "ACCOUNT_LOCKED" ? "连续认证失败，账号已锁定。" : "账号或密码错误。",
        traceId,
        { remainingAttempts },
      );
      return;
    }

    store.clearFailures(user);
    const { session, accessToken, refreshToken } = store.createSession(user, clientInfo(request.body));
    store.appendAudit({ traceId, userId: user.id, identifier, method: "password", result: "success", ...meta });
    response.json(successPayload(store, user, accessToken, refreshToken, session.expiresAt));
  });

  app.get("/auth/sso/start", (request, response) => {
    const traceId = randomUUID();
    const email = String(request.query.email ?? "").trim().toLowerCase();
    const providerId = String(request.query.providerId ?? "");
    const domain = email.split("@")[1];
    const provider = (domain && SSO_PROVIDERS[domain]) || Object.values(SSO_PROVIDERS).find((item) => item.id === providerId);

    if (!email && !providerId) {
      sendFailure(response, 400, "VALIDATION_ERROR", "请输入企业邮箱或选择 SSO 提供方。", traceId);
      return;
    }
    if (!provider) {
      sendFailure(response, 400, "SSO_FAILED", "未找到匹配的企业 SSO 配置。", traceId);
      return;
    }

    const state = store.createSsoState(email, provider.id);
    const authorizationUrl = `${provider.issuer}/authorize?response_type=code&client_id=lifecycle-x&scope=openid%20email%20profile&state=${encodeURIComponent(state.state)}&nonce=${encodeURIComponent(state.nonce)}&login_hint=${encodeURIComponent(email)}`;
    response.json({
      success: true,
      authorizationUrl,
      provider: { id: provider.id, name: provider.name },
      state: state.state,
      expiresAt: new Date(state.expiresAt).toISOString(),
    });
  });

  app.post("/auth/sso/callback", (request, response) => {
    const traceId = randomUUID();
    const { code, state } = request.body as { code?: string; state?: string; redirectUri?: string };
    const meta = requestMeta(request);

    if (!code || !state) {
      sendFailure(response, 400, "VALIDATION_ERROR", "SSO 回调参数不完整。", traceId);
      return;
    }

    const ssoState = store.consumeSsoState(state);
    if (!ssoState) {
      sendFailure(response, 401, "SSO_FAILED", "SSO 登录状态已失效，请重新发起登录。", traceId);
      return;
    }

    if (!code.startsWith("mock:")) {
      store.appendAudit({ traceId, identifier: ssoState.email, method: "sso", result: "failure", reason: "SSO_FAILED", ...meta });
      sendFailure(response, 401, "SSO_FAILED", "企业 SSO 登录失败。", traceId);
      return;
    }

    const user = store.findUserByIdentifier(ssoState.email);
    if (!user) {
      store.appendAudit({ traceId, identifier: ssoState.email, method: "sso", result: "failure", reason: "SSO_USER_NOT_REGISTERED", ...meta });
      sendFailure(response, 403, "SSO_USER_NOT_REGISTERED", "企业账号未开通系统访问权限。", traceId);
      return;
    }
    if (user.status !== "active") {
      store.appendAudit({ traceId, userId: user.id, identifier: ssoState.email, method: "sso", result: "failure", reason: "ACCOUNT_DISABLED", ...meta });
      sendFailure(response, 403, "ACCOUNT_DISABLED", "账号已停用，请联系系统管理员。", traceId);
      return;
    }

    store.clearFailures(user);
    const { session, accessToken, refreshToken } = store.createSession(user, clientInfo(request.body));
    store.appendAudit({ traceId, userId: user.id, identifier: ssoState.email, method: "sso", result: "success", ...meta });
    response.json(successPayload(store, user, accessToken, refreshToken, session.expiresAt));
  });

  app.get("/auth/session", (request, response) => {
    const traceId = randomUUID();
    const accessToken = bearerToken(request);
    const resolved = accessToken ? store.resolveAccessToken(accessToken) : null;
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }
    response.json({
      success: true,
      user: sanitizeUser(resolved.user),
      permissions: store.permissionsFor(resolved.user),
      expiresAt: new Date(resolved.session.expiresAt).toISOString(),
    });
  });

  app.post("/auth/refresh", (request, response) => {
    const traceId = randomUUID();
    const { refreshToken } = request.body as { refreshToken?: string };
    if (!refreshToken) {
      sendFailure(response, 400, "VALIDATION_ERROR", "刷新令牌不能为空。", traceId);
      return;
    }

    const refreshed = store.refreshSession(refreshToken);
    if (!refreshed) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }
    store.appendAudit({ traceId, userId: refreshed.user.id, method: "refresh", result: "success", ...requestMeta(request) });
    response.json({
      success: true,
      accessToken: refreshed.accessToken,
      refreshToken,
      user: sanitizeUser(refreshed.user),
      permissions: store.permissionsFor(refreshed.user),
      expiresAt: new Date(refreshed.session.expiresAt).toISOString(),
    });
  });

  app.post("/auth/logout", (request, response) => {
    const traceId = randomUUID();
    const { refreshToken } = request.body as { refreshToken?: string };
    if (refreshToken) {
      store.revokeRefreshToken(refreshToken);
    }
    store.appendAudit({ traceId, method: "logout", result: "success", ...requestMeta(request) });
    response.json({ success: true });
  });

  app.post("/auth/password/forgot", (request, response) => {
    const traceId = randomUUID();
    const { email } = request.body as { email?: string };
    if (!email) {
      sendFailure(response, 400, "VALIDATION_ERROR", "邮箱不能为空。", traceId, {
        fields: { email: "邮箱不能为空。" },
      });
      return;
    }
    store.createPasswordResetToken(email);
    store.appendAudit({ traceId, identifier: email, method: "password-reset", result: "success", ...requestMeta(request) });
    response.json({ success: true });
  });

  app.post("/auth/password/reset", (request, response) => {
    const traceId = randomUUID();
    const { resetToken, newPassword } = request.body as { resetToken?: string; newPassword?: string };
    if (!resetToken || !newPassword) {
      sendFailure(response, 400, "VALIDATION_ERROR", "重置令牌和新密码不能为空。", traceId);
      return;
    }
    const user = store.resetPassword(resetToken, newPassword);
    if (!user) {
      sendFailure(response, 401, "SESSION_EXPIRED", "密码重置链接无效或已过期。", traceId);
      return;
    }
    store.appendAudit({ traceId, userId: user.id, method: "password-reset", result: "success", ...requestMeta(request) });
    response.json({ success: true });
  });

  app.post("/auth/password/change", (request, response) => {
    const traceId = randomUUID();
    const accessToken = bearerToken(request);
    const resolved = accessToken ? store.resolveAccessToken(accessToken) : null;
    const { oldPassword, newPassword, refreshToken } = request.body as {
      oldPassword?: string;
      newPassword?: string;
      refreshToken?: string;
    };
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }
    if (!oldPassword || !newPassword) {
      sendFailure(response, 400, "VALIDATION_ERROR", "原密码和新密码不能为空。", traceId);
      return;
    }
    const user = store.changePassword(resolved.user.id, oldPassword, newPassword, refreshToken);
    if (!user) {
      store.appendAudit({ traceId, userId: resolved.user.id, method: "password-change", result: "failure", reason: "INVALID_CREDENTIALS", ...requestMeta(request) });
      sendFailure(response, 401, "INVALID_CREDENTIALS", "原密码不正确。", traceId);
      return;
    }
    store.appendAudit({ traceId, userId: user.id, method: "password-change", result: "success", ...requestMeta(request) });
    response.json({ success: true });
  });

  app.get("/auth/audit/logs", (request, response) => {
    const traceId = randomUUID();
    const accessToken = bearerToken(request);
    const resolved = accessToken ? store.resolveAccessToken(accessToken) : null;
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }
    if (!store.permissionsFor(resolved.user).includes("audit:read")) {
      sendFailure(response, 403, "PERMISSION_DENIED", "当前用户无权查看审计日志。", traceId);
      return;
    }
    response.json({ success: true, logs: store.auditLogs });
  });

  app.get("/users/me/profile", (request, response) => {
    const traceId = randomUUID();
    const resolved = resolveAuthenticatedRequest(store, request);
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }

    const profile = store.profileFor(resolved.user.id);
    if (!profile) {
      sendFailure(response, 500, "INTERNAL_ERROR", "用户资料暂不可用。", traceId);
      return;
    }
    response.json({ success: true, profile });
  });

  app.patch("/users/me/avatar", (request, response) => {
    const traceId = randomUUID();
    const resolved = resolveAuthenticatedRequest(store, request);
    const meta = requestMeta(request);
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }

    if (!isPlainObject(request.body)) {
      sendFailure(response, 400, "VALIDATION_ERROR", "头像更新参数不完整。", traceId);
      return;
    }

    const allowedKeys = new Set(["avatarUrl"]);
    const rejectedFields = Object.keys(request.body).filter((key) => !allowedKeys.has(key));
    const { avatarUrl } = request.body as { avatarUrl?: unknown };
    if (rejectedFields.length > 0) {
      store.appendAudit({
        traceId,
        userId: resolved.user.id,
        method: "avatar-update",
        result: "failure",
        reason: "READONLY_PROFILE_FIELDS",
        ...meta,
      });
      sendFailure(response, 400, "VALIDATION_ERROR", "个人资料仅允许更新头像。", traceId, {
        fields: Object.fromEntries(rejectedFields.map((field) => [field, "该字段来自企业内部主数据，禁止在客户端修改。"])),
      });
      return;
    }

    if (typeof avatarUrl !== "string" || avatarUrl.trim().length === 0) {
      sendFailure(response, 400, "VALIDATION_ERROR", "头像地址不能为空。", traceId, {
        fields: { avatarUrl: "头像地址不能为空。" },
      });
      return;
    }

    const profile = store.updateAvatar(resolved.user.id, avatarUrl.trim());
    if (!profile) {
      sendFailure(response, 500, "INTERNAL_ERROR", "头像更新失败。", traceId);
      return;
    }
    store.appendAudit({ traceId, userId: resolved.user.id, method: "avatar-update", result: "success", ...meta });
    response.json({ success: true, profile });
  });

  app.get("/users/me/settings", (request, response) => {
    const traceId = randomUUID();
    const resolved = resolveAuthenticatedRequest(store, request);
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }

    const settings = store.settingsFor(resolved.user.id);
    if (!settings) {
      sendFailure(response, 500, "INTERNAL_ERROR", "用户设置暂不可用。", traceId);
      return;
    }
    response.json({ success: true, settings });
  });

  app.patch("/users/me/settings", (request, response) => {
    const traceId = randomUUID();
    const resolved = resolveAuthenticatedRequest(store, request);
    const meta = requestMeta(request);
    if (!resolved) {
      sendFailure(response, 401, "SESSION_EXPIRED", "登录态已过期，请重新登录。", traceId);
      return;
    }

    if (!isValidSettingsPatch(request.body)) {
      store.appendAudit({
        traceId,
        userId: resolved.user.id,
        method: "settings-update",
        result: "failure",
        reason: "VALIDATION_ERROR",
        ...meta,
      });
      sendFailure(response, 400, "VALIDATION_ERROR", "用户设置参数不合法。", traceId);
      return;
    }

    const settings = store.updateSettings(resolved.user.id, request.body);
    if (!settings) {
      sendFailure(response, 500, "INTERNAL_ERROR", "用户设置保存失败。", traceId);
      return;
    }
    store.appendAudit({ traceId, userId: resolved.user.id, method: "settings-update", result: "success", ...meta });
    response.json({ success: true, settings });
  });

  return { app, store };
}

export function startAuthServer(port = Number(process.env.PORT ?? DEFAULT_PORT)) {
  const { app, store } = createAuthApp();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Lifecycle X auth server listening on http://127.0.0.1:${port}`);
  });
  return { server, store };
}
