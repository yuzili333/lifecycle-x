import { describe, expect, it } from "vitest";
import { AuthStore, MAX_FAILED_ATTEMPTS } from "./authStore.js";

describe("AuthStore", () => {
  it("validates seeded user passwords and returns role permissions", () => {
    const store = new AuthStore();
    const user = store.findUserByIdentifier("analyst");

    expect(user).toBeDefined();
    expect(user && store.isPasswordValid(user, "Lifecycle@123")).toBe(true);
    expect(user && store.permissionsFor(user)).toContain("analysis:run");
    expect(user && store.permissionsFor(user)).not.toContain("audit:read");
  });

  it("locks an account after five failed attempts", () => {
    const store = new AuthStore();
    const user = store.findUserByIdentifier("analyst");
    expect(user).toBeDefined();

    for (let index = 0; user && index < MAX_FAILED_ATTEMPTS; index += 1) {
      store.registerFailure(user);
    }

    expect(user && store.isLocked(user)).toBe(true);
  });

  it("creates, refreshes, validates and revokes sessions", () => {
    const store = new AuthStore();
    const user = store.findUserByIdentifier("admin");
    expect(user).toBeDefined();
    if (!user) {
      return;
    }

    const session = store.createSession(user, { platform: "test" });
    expect(store.resolveAccessToken(session.accessToken)?.user.email).toBe("admin@bank.example.com");

    const refreshed = store.refreshSession(session.refreshToken);
    expect(refreshed?.accessToken).toMatch(/^lx_at_/);

    store.revokeRefreshToken(session.refreshToken);
    expect(refreshed && store.resolveAccessToken(refreshed.accessToken)).toBeNull();
  });

  it("resets passwords and clears account lock state", () => {
    const store = new AuthStore();
    const user = store.findUserByIdentifier("analyst");
    expect(user).toBeDefined();
    if (!user) {
      return;
    }

    for (let index = 0; index < MAX_FAILED_ATTEMPTS; index += 1) {
      store.registerFailure(user);
    }
    expect(store.isLocked(user)).toBe(true);

    const resetToken = store.createPasswordResetToken(user.email);
    expect(resetToken).toMatch(/^lx_reset_/);
    expect(resetToken && store.resetPassword(resetToken, "NewLifecycle@123")).toBeDefined();
    expect(store.isLocked(user)).toBe(false);
    expect(store.isPasswordValid(user, "NewLifecycle@123")).toBe(true);
  });

  it("records SSO state and audit logs", () => {
    const store = new AuthStore();
    const state = store.createSsoState("analyst@bank.example.com", "bank-oidc");

    expect(store.consumeSsoState(state.state)?.email).toBe("analyst@bank.example.com");
    expect(store.consumeSsoState(state.state)).toBeNull();

    store.appendAudit({
      traceId: "trace-test",
      userId: "usr_analyst",
      method: "sso",
      result: "success",
    });
    expect(store.auditLogs[0]?.traceId).toBe("trace-test");
  });
});
