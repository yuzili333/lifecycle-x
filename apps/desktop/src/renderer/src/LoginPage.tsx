import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { authApi, errorMessage, type AuthFailure } from "./auth";
import { useAppToast } from "./useAppToast";

type LoginPageProps = {
  onPasswordLogin: (identifier: string, password: string) => Promise<boolean>;
  onSsoComplete: (stateToken: string) => Promise<boolean>;
  lastError: AuthFailure | null;
  onError: (error: AuthFailure | null) => void;
};

type LoginStep = "credentials" | "sso-confirm";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function LoginPage({ onPasswordLogin, onSsoComplete, lastError, onError }: LoginPageProps) {
  const [step, setStep] = useState<LoginStep>("credentials");
  const [identifier, setIdentifier] = useState("yuzili");
  const [password, setPassword] = useState("yuzili");
  const [ssoState, setSsoState] = useState<{ token: string; providerName: string; email: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const toast = useAppToast();
  const lastToastTraceId = useRef<string | null>(null);

  const canPasswordLogin = identifier.trim().length > 0 && password.length > 0;
  const canSsoLogin = isEmail(identifier.trim());

  const identifierStatus = useMemo(() => {
    if (lastError?.error.fields?.identifier) {
      return { type: "error" as const, message: lastError.error.fields.identifier };
    }
    return undefined;
  }, [lastError]);

  const passwordStatus = useMemo(() => {
    if (lastError?.error.fields?.password) {
      return { type: "error" as const, message: lastError.error.fields.password };
    }
    return undefined;
  }, [lastError]);

  useEffect(() => {
    if (!lastError || lastToastTraceId.current === lastError.error.traceId) {
      return;
    }
    if (lastError.error.code === "SESSION_EXPIRED") {
      lastToastTraceId.current = lastError.error.traceId;
      onError(null);
      return;
    }

    lastToastTraceId.current = lastError.error.traceId;
    toast({
      type: "error",
      body: `${errorMessage(lastError)} Trace: ${lastError.error.traceId}`,
      uniqueID: "login-error",
      collisionBehavior: "overwrite",
    });
  }, [lastError, onError, toast]);

  const handlePasswordLogin = async () => {
    if (!canPasswordLogin || isLoading) {
      return;
    }
    setIsLoading(true);
    const ok = await onPasswordLogin(identifier.trim(), password);
    setIsLoading(false);
    if (!ok) {
      setPassword("");
    }
  };

  const handleCredentialsKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) {
      return;
    }

    event.preventDefault();
    void handlePasswordLogin();
  };

  const handleSsoStart = async () => {
    setIsLoading(true);
    onError(null);
    const result = await authApi.startSso(identifier.trim());
    setIsLoading(false);

    if (!result.success) {
      onError(result);
      return;
    }

    setSsoState({
      token: result.state,
      providerName: result.provider.name,
      email: identifier.trim(),
    });
    setStep("sso-confirm");
    await window.lifecycleX?.openExternal(result.authorizationUrl);
    toast({
      type: "info",
      body: `已打开 ${result.provider.name} 企业认证页面，请完成授权后返回客户端。`,
      uniqueID: "sso-started",
      collisionBehavior: "overwrite",
    });
  };

  const handleSsoComplete = async () => {
    if (!ssoState) {
      return;
    }
    setIsLoading(true);
    const ok = await onSsoComplete(ssoState.token);
    setIsLoading(false);
    if (!ok) {
      setStep("credentials");
      setSsoState(null);
    }
  };

  const handleForgotPassword = async () => {
    const email = identifier.trim();
    if (!isEmail(email)) {
      onError({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "请输入邮箱后再发起找回密码。",
          traceId: "client-validation",
          fields: { identifier: "找回密码需要邮箱地址。" },
        },
      });
      return;
    }

    const result = await authApi.forgotPassword(email);
    if (!result.success) {
      onError(result);
      return;
    }
    onError(null);
    toast({
      type: "info",
      body: "如果该邮箱已开通账号，系统已发送密码重置指引。",
      uniqueID: "password-reset-requested",
      collisionBehavior: "overwrite",
    });
  };

  return (
    <Center axis="both" className="login-page">
      <Card padding={8} width="100%" maxWidth={420}>
        <VStack gap={4} hAlign="stretch">
          {step === "credentials" && (
            <form className="login-form" onKeyDown={handleCredentialsKeyDown}>
              <VStack gap={1} hAlign="center">
                <Text type="display-3" as="h1">
                  Cycle Probe
                </Text>
                <Text type="body" color="secondary" size="sm">
                  使用内部账号或企业SSO登录
                </Text>
              </VStack>

              <VStack gap={2}>
                <TextInput
                  label="账号或邮箱"
                  type="email"
                  placeholder="请输入账号或企业邮箱"
                  value={identifier}
                  size="lg"
                  hasAutoFocus
                  status={identifierStatus}
                  onChange={(value) => {
                    setIdentifier(value);
                    onError(null);
                  }}
                />
                <TextInput
                  label="密码"
                  type="password"
                  placeholder="请输入密码"
                  value={password}
                  size="lg"
                  status={passwordStatus}
                  onChange={(value) => {
                    setPassword(value);
                    onError(null);
                  }}
                />
              </VStack>

              <Button
                label="登录"
                variant="primary"
                size="lg"
                isLoading={isLoading}
                isDisabled={!canPasswordLogin}
                onClick={handlePasswordLogin}
              />

              <Divider label="或" />

              <Button
                label="使用企业 SSO 登录"
                variant="secondary"
                size="lg"
                isLoading={isLoading}
                isDisabled={!canSsoLogin}
                onClick={handleSsoStart}
              />

              <HStack hAlign="between" vAlign="center">
                <Link href="#" type="supporting" onClick={handleForgotPassword}>
                  找回密码
                </Link>
                <Text type="supporting" color="secondary">
                  内部注册用户专用
                </Text>
              </HStack>
            </form>
          )}

          {step === "sso-confirm" && ssoState && (
            <>
              <VStack gap={2} hAlign="center">
                <Avatar name={ssoState.providerName} size={48} />
                <Text type="display-3" as="h1">
                  企业 SSO 认证
                </Text>
                <Text type="body" color="secondary" size="sm">
                  已在系统浏览器打开 {ssoState.providerName} 授权页。
                </Text>
              </VStack>

              <Section variant="muted" padding={4}>
                <VStack gap={1}>
                  <Text type="label">{ssoState.providerName}</Text>
                  <Text type="supporting" color="secondary">
                    {ssoState.email}
                  </Text>
                </VStack>
              </Section>

              <Button
                label="完成企业认证"
                variant="primary"
                size="lg"
                isLoading={isLoading}
                onClick={handleSsoComplete}
              />
              <Button
                label="使用其他账号"
                variant="ghost"
                size="lg"
                onClick={() => {
                  setStep("credentials");
                  setSsoState(null);
                  onError(null);
                }}
              />
            </>
          )}
        </VStack>
      </Card>
    </Center>
  );
}
