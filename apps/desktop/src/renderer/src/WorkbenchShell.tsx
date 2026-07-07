import { Activity, useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
  useSideNavCollapse,
} from "@astryxdesign/core/SideNav";
import { Slider } from "@astryxdesign/core/Slider";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import type { AuthFailure } from "./auth";
import { DataManagementWorkspace } from "./DataManagementWorkspace";
import { useAppToast } from "./useAppToast";
import type { useAuthStore } from "./useAuthStore";
import aiIcon from "./assets/ai.svg";
import databaseIcon from "./assets/database.svg";
import { workbenchApi, type ApiResult, type UserProfile, type WorkbenchSettings } from "./workbenchApi";
import type { DataSourceMenuAction } from "../../preload";

type WorkbenchAuth = ReturnType<typeof useAuthStore>;

type WorkbenchShellProps = {
  auth: WorkbenchAuth;
  runtimeLabel: string;
};

type WorkbenchModule = "data-assistant" | "data-management";
type SettingsTab = "profile" | "general" | "appearance" | "agent" | "logout";

const DEFAULT_WORKBENCH_MODULE: WorkbenchModule = "data-assistant";
const WORKBENCH_NAV_CACHE_KEY_PREFIX = "cycle-probe:workbench:last-module";
const MODEL_CONFIG_PROMPT_CACHE_KEY_PREFIX = "cycle-probe:workbench:model-config-prompted";

const defaultSettings: WorkbenchSettings = {
  general: {
    language: "zh-CN",
    timezone: "Asia/Shanghai",
    notificationsEnabled: true,
  },
  appearance: {
    themeMode: "dark",
    accentColor: "#65d6d2",
    backgroundColor: "#0f1724",
    foregroundColor: "#e6edf6",
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif",
    codeFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace",
    uiFontSize: 14,
    codeFontSize: 13,
    translucentSidebar: false,
    contrast: "standard",
    dockIcon: "default",
  },
  configuration: {
    modelProvider: "Siliconflow",
    modelName: "",
    apiKeyStatus: "not_configured",
    skillEnabled: false,
    mcpEnabled: false,
  },
  personalization: {
    defaultModule: "data-assistant",
    compactNavigation: false,
  },
};

function isWorkbenchModule(value: string | null): value is WorkbenchModule {
  return value === "data-assistant" || value === "data-management";
}

function canAccessWorkbenchModule(module: WorkbenchModule, permissions: string[]) {
  if (module === "data-assistant") {
    return permissions.includes("analysis:read");
  }
  return permissions.includes("datasource:read");
}

function fallbackWorkbenchModule(permissions: string[]): WorkbenchModule {
  if (canAccessWorkbenchModule(DEFAULT_WORKBENCH_MODULE, permissions)) {
    return DEFAULT_WORKBENCH_MODULE;
  }
  if (canAccessWorkbenchModule("data-management", permissions)) {
    return "data-management";
  }
  return DEFAULT_WORKBENCH_MODULE;
}

function workbenchNavCacheKey(user: WorkbenchAuth["user"]) {
  return `${WORKBENCH_NAV_CACHE_KEY_PREFIX}:${user?.id ?? "anonymous"}`;
}

function readCachedWorkbenchModule(user: WorkbenchAuth["user"], permissions: string[]): WorkbenchModule {
  const fallback = fallbackWorkbenchModule(permissions);
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const cached = window.localStorage.getItem(workbenchNavCacheKey(user));
    if (isWorkbenchModule(cached) && canAccessWorkbenchModule(cached, permissions)) {
      return cached;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function writeCachedWorkbenchModule(user: WorkbenchAuth["user"], module: WorkbenchModule) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(workbenchNavCacheKey(user), module);
  } catch {
    // Ignore storage failures; navigation state still works in memory.
  }
}

function modelConfigPromptCacheKey(user: WorkbenchAuth["user"]) {
  return `${MODEL_CONFIG_PROMPT_CACHE_KEY_PREFIX}:${user?.id ?? "anonymous"}`;
}

function hasPromptedModelConfiguration(user: WorkbenchAuth["user"]) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(modelConfigPromptCacheKey(user)) === "1";
  } catch {
    return false;
  }
}

function markModelConfigurationPrompted(user: WorkbenchAuth["user"]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(modelConfigPromptCacheKey(user), "1");
  } catch {
    // Ignore storage failures; the settings prompt can still be shown in this session.
  }
}

function isModelConfigurationReady(settings: WorkbenchSettings) {
  return (
    settings.configuration.modelProvider.trim().length > 0 &&
    settings.configuration.modelName.trim().length > 0 &&
    settings.configuration.apiKeyStatus === "configured"
  );
}

function normalizeWorkbenchSettings(settings: WorkbenchSettings): WorkbenchSettings {
  return {
    general: { ...defaultSettings.general, ...settings.general },
    appearance: { ...defaultSettings.appearance, ...settings.appearance },
    configuration: { ...defaultSettings.configuration, ...settings.configuration },
    personalization: { ...defaultSettings.personalization, ...settings.personalization },
  };
}

async function hasLocalModelApiKey(user: WorkbenchAuth["user"]) {
  if (!user?.id || !window.lifecycleX?.modelApiKey) {
    return false;
  }

  try {
    return await window.lifecycleX.modelApiKey.has(user.id);
  } catch {
    return false;
  }
}

const settingsTabs: Array<{ id: SettingsTab; label: string; description: string }> = [
  { id: "profile", label: "个人资料", description: "头像和企业主数据" },
  { id: "general", label: "常规", description: "语言、时区和通知" },
  { id: "appearance", label: "外观", description: "主题、颜色、字体和侧栏" },
  { id: "agent", label: "智能体配置", description: "大模型、API Key、Skill 和 MCP" },
  { id: "logout", label: "退出登录", description: "结束当前登录态" },
];

function isFailure<T extends { success: true }>(result: ApiResult<T>): result is AuthFailure {
  return result.success === false;
}

function fallbackProfile(user: WorkbenchAuth["user"]): UserProfile | null {
  if (!user) {
    return null;
  }
  return {
    ...user,
    department: user.role === "admin" ? "系统管理部" : "贷后管理部",
    title: user.role === "admin" ? "系统管理员" : "贷后分析员",
    phone: "企业通讯录同步",
  };
}

function roleLabel(role?: string) {
  return role === "admin" ? "管理员" : "普通用户";
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <TextInput
      label={label}
      value={value}
      placeholder=""
      isDisabled
      disabledMessage="该字段来自企业内部主数据，禁止在客户端修改。"
      width="100%"
    />
  );
}

function PlaceholderView({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="empty-module" aria-labelledby={`${title}-title`}>
      <div className="empty-module-mark" aria-hidden="true">
        LX
      </div>
      <Text type="display-3" as="h2" id={`${title}-title`}>
        {title}
      </Text>
      <Text type="body" color="secondary">
        {description}
      </Text>
      {children}
    </section>
  );
}

function NavAssetIcon({ src }: { src: string }) {
  return <span className="nav-asset-icon" style={{ "--nav-icon-url": `url(${src})` } as CSSProperties} aria-hidden="true" />;
}

function SideNavUserCard({
  profile,
  user,
  onOpenSettings,
  onLogout,
}: {
  profile: UserProfile | null;
  user: WorkbenchAuth["user"];
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const { isCollapsed } = useSideNavCollapse();
  const displayName = profile?.displayName ?? user?.displayName ?? "用户";
  const email = profile?.email ?? user?.email ?? "";

  return (
    <DropdownMenu
      button={{
        label: "用户菜单",
        variant: "ghost",
        size: "md",
        className: isCollapsed ? "side-user-menu-trigger collapsed" : "side-user-menu-trigger",
        children: (
          <span className={isCollapsed ? "side-user-avatar-only" : "side-user"}>
            <Avatar src={profile?.avatarUrl} name={displayName} size={isCollapsed ? 32 : 36} />
            {!isCollapsed && (
              <span className="side-user-copy">
                <strong>{displayName}</strong>
                <span>{email}</span>
              </span>
            )}
          </span>
        ),
      }}
      hasChevron={false}
      menuWidth={180}
      placement="above"
      items={[
        { label: "设置", onClick: onOpenSettings },
        { type: "divider" },
        { label: "退出登录", onClick: onLogout },
      ]}
    />
  );
}

export function WorkbenchShell({ auth }: WorkbenchShellProps) {
  const toast = useAppToast();
  const [activeModule, setActiveModule] = useState<WorkbenchModule>(() => readCachedWorkbenchModule(auth.user, auth.permissions));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isSessionExpiredConfirmOpen, setIsSessionExpiredConfirmOpen] = useState(false);
  const [isModelConfigRequiredOpen, setIsModelConfigRequiredOpen] = useState(false);
  const [pendingDataSourceAction, setPendingDataSourceAction] = useState<DataSourceMenuAction | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(() => fallbackProfile(auth.user));
  const [avatarDraft, setAvatarDraft] = useState(auth.user?.avatarUrl ?? "");
  const [assistantDraft, setAssistantDraft] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settings, setSettings] = useState<WorkbenchSettings>(defaultSettings);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const openSessionExpiredConfirm = useCallback(() => {
    setIsSessionExpiredConfirmOpen(true);
  }, []);

  const requestWithRefresh = useCallback(
    async <T extends { success: true }>(call: (accessToken: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      if (!auth.accessToken) {
        openSessionExpiredConfirm();
        return {
          success: false,
          error: {
            code: "SESSION_EXPIRED",
            message: "登录态已过期，请重新登录。",
            traceId: "client-missing-token",
          },
        };
      }

      const result = await call(auth.accessToken);
      if (!isFailure(result) || result.error.code !== "SESSION_EXPIRED") {
        return result;
      }

      const refreshed = await auth.refreshSession({ clearOnFailure: false });
      if (!refreshed) {
        openSessionExpiredConfirm();
        return result;
      }

      const retryResult = await call(refreshed.accessToken);
      if (isFailure(retryResult) && retryResult.error.code === "SESSION_EXPIRED") {
        openSessionExpiredConfirm();
      }
      return retryResult;
    },
    [auth, openSessionExpiredConfirm],
  );

  const showError = useCallback(
    (result: AuthFailure) => {
      if (result.error.code === "SESSION_EXPIRED") {
        openSessionExpiredConfirm();
        return;
      }
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "workbench-error",
        collisionBehavior: "overwrite",
      });
    },
    [openSessionExpiredConfirm, toast],
  );

  useEffect(() => {
    setActiveModule(readCachedWorkbenchModule(auth.user, auth.permissions));
  }, [auth.permissions, auth.user]);

  useEffect(() => {
    if (!canAccessWorkbenchModule(activeModule, auth.permissions)) {
      setActiveModule(readCachedWorkbenchModule(auth.user, auth.permissions));
      return;
    }
    writeCachedWorkbenchModule(auth.user, activeModule);
  }, [activeModule, auth.permissions, auth.user]);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkbench() {
      const profileResult = await requestWithRefresh(workbenchApi.profile);
      const settingsResult = await requestWithRefresh(workbenchApi.settings);
      const localModelApiKeyConfigured = await hasLocalModelApiKey(auth.user);

      if (!isMounted) {
        return;
      }

      if (isFailure(profileResult)) {
        showError(profileResult);
        setProfile(fallbackProfile(auth.user));
      } else {
        setProfile(profileResult.profile);
        setAvatarDraft(profileResult.profile.avatarUrl ?? "");
      }

      if (isFailure(settingsResult)) {
        showError(settingsResult);
      } else {
        const normalizedSettings = normalizeWorkbenchSettings(settingsResult.settings);
        const nextSettings: WorkbenchSettings = {
          ...normalizedSettings,
          configuration: {
            ...normalizedSettings.configuration,
            apiKeyStatus: localModelApiKeyConfigured ? "configured" : "not_configured",
          },
        };
        setSettings(nextSettings);
        if (!isModelConfigurationReady(nextSettings) && !hasPromptedModelConfiguration(auth.user)) {
          markModelConfigurationPrompted(auth.user);
          setActiveSettingsTab("agent");
          setIsSettingsOpen(true);
          toast({
            type: "info",
            body: "请先完成大模型配置后再使用数据助手对话功能。",
            uniqueID: "model-config-required",
            collisionBehavior: "overwrite",
          });
        }
      }
    }

    void loadWorkbench();
    return () => {
      isMounted = false;
    };
  }, [auth.user, requestWithRefresh, showError, toast]);

  useEffect(() => {
    const dispose = window.lifecycleX?.dataSource.onAction((action) => {
      setActiveModule("data-management");
      setPendingDataSourceAction(action);
    });

    return () => dispose?.();
  }, []);

  const navItems = useMemo(
    () => [
      { id: "data-assistant" as const, label: "数据助手", permission: "analysis:read", icon: aiIcon },
      { id: "data-management" as const, label: "数据管理", permission: "datasource:read", icon: databaseIcon },
    ],
    [],
  );

  const visibleNavItems = navItems.filter((item) => auth.permissions.includes(item.permission));
  const workbenchStyle = {
    "--workbench-background": settings.appearance.backgroundColor,
    "--workbench-foreground": settings.appearance.foregroundColor,
    "--workbench-accent": settings.appearance.accentColor,
    "--workbench-font": settings.appearance.fontFamily,
    "--workbench-code-font": settings.appearance.codeFontFamily,
    "--workbench-ui-font-size": `${settings.appearance.uiFontSize}px`,
    "--workbench-code-font-size": `${settings.appearance.codeFontSize}px`,
  } as CSSProperties;

  const openSettings = (tab: SettingsTab) => {
    setActiveSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  const openAgentSettingsFromPrompt = () => {
    setIsModelConfigRequiredOpen(false);
    openSettings("agent");
  };

  const requestLogout = () => {
    setIsLogoutConfirmOpen(true);
  };

  const confirmLogout = async () => {
    setIsLogoutConfirmOpen(false);
    await auth.logout();
  };

  const confirmSessionExpiredLogout = async () => {
    setIsSessionExpiredConfirmOpen(false);
    await auth.logout();
  };

  const handleAssistantSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isModelConfigurationReady(settings)) {
      setIsModelConfigRequiredOpen(true);
      return;
    }

    toast({
      type: "info",
      body: `已使用 ${settings.configuration.modelName} 接收对话请求，数据助手对话能力待接入。`,
      uniqueID: "assistant-chat-pending",
      collisionBehavior: "overwrite",
    });
  };

  const handleAvatarSave = async () => {
    const nextAvatar = avatarDraft.trim();
    if (!nextAvatar) {
      toast({
        type: "error",
        body: "头像地址不能为空。",
        uniqueID: "avatar-empty",
        collisionBehavior: "overwrite",
      });
      return;
    }

    setIsSavingAvatar(true);
    const result = await requestWithRefresh((token) => workbenchApi.updateAvatar(token, nextAvatar));
    setIsSavingAvatar(false);
    if (isFailure(result)) {
      showError(result);
      return;
    }

    setProfile(result.profile);
    auth.updateUser({ avatarUrl: result.profile.avatarUrl });
    toast({
      type: "info",
      body: "头像已更新，其他个人资料继续与企业内部数据保持一致。",
      uniqueID: "avatar-updated",
      collisionBehavior: "overwrite",
    });
  };

  const handleSettingsSave = async () => {
    const nextApiKey = apiKeyDraft.trim();
    setIsSavingSettings(true);

    if (nextApiKey.length > 0) {
      const localApiKeySaved = auth.user?.id && window.lifecycleX?.modelApiKey
        ? await window.lifecycleX.modelApiKey.set(auth.user.id, nextApiKey)
        : false;

      if (!localApiKeySaved) {
        setIsSavingSettings(false);
        toast({
          type: "error",
          body: "模型 API Key 本地保存失败，请稍后重试。",
          uniqueID: "model-api-key-save-failed",
          collisionBehavior: "overwrite",
        });
        return;
      }
    }

    const nextSettings =
      nextApiKey.length > 0
        ? {
            ...settings,
            configuration: {
              ...settings.configuration,
              apiKeyStatus: "configured" as const,
            },
          }
        : settings;

    const result = await requestWithRefresh((token) => workbenchApi.updateSettings(token, nextSettings));
    setIsSavingSettings(false);
    if (isFailure(result)) {
      showError(result);
      return;
    }

    setSettings(normalizeWorkbenchSettings(result.settings));
    setApiKeyDraft("");
    toast({
      type: "info",
      body: "用户设置已保存。",
      uniqueID: "settings-saved",
      collisionBehavior: "overwrite",
    });
  };

  const renderContent = () => {
    return (
      <div className="workbench-module-stack">
        <Activity mode={activeModule === "data-assistant" ? "visible" : "hidden"} name="workbench-data-assistant">
          <div className="workbench-module">
            <PlaceholderView title="数据助手" description="对话能力依赖大模型配置，完成配置后即可接入智能体交互。">
              <form className="assistant-chat-entry" onSubmit={handleAssistantSubmit}>
                <TextInput
                  label="对话内容"
                  value={assistantDraft}
                  placeholder="输入需要分析或查询的问题"
                  width="100%"
                  hasClear
                  onChange={setAssistantDraft}
                />
                <Button label="发送" variant="primary" type="submit" />
              </form>
              <Text type="supporting" color="secondary">
                {isModelConfigurationReady(settings) ? `当前模型：${settings.configuration.modelName}` : "尚未完成大模型配置"}
              </Text>
            </PlaceholderView>
          </div>
        </Activity>
        <Activity mode={activeModule === "data-management" ? "visible" : "hidden"} name="workbench-data-management">
          <div className="workbench-module">
            {auth.permissions.includes("datasource:read") && (
              <DataManagementWorkspace
                isActive={activeModule === "data-management"}
                canManage={auth.permissions.includes("datasource:manage")}
                requestWithRefresh={requestWithRefresh}
                menuAction={pendingDataSourceAction}
                onMenuActionHandled={() => setPendingDataSourceAction(null)}
              />
            )}
          </div>
        </Activity>
      </div>
    );
  };

  const sideNav = (
    <div className="workbench-side-theme" style={workbenchStyle}>
      <SideNav
        className="workbench-side-nav"
        header={<SideNavHeading heading="Cycle Probe" icon={<div className="workbench-brand-mark">CP</div>} />}
        footer={<SideNavUserCard profile={profile} user={auth.user} onOpenSettings={() => openSettings("general")} onLogout={requestLogout} />}
        collapsible={{ defaultIsCollapsed: false, buttonLabel: "折叠工作台导航" }}
      >
        <SideNavSection title="主导航" isHeaderHidden>
          {visibleNavItems.map((item) => (
            <SideNavItem
              key={item.id}
              label={item.label}
              icon={<NavAssetIcon src={item.icon} />}
              selectedIcon={<NavAssetIcon src={item.icon} />}
              isSelected={activeModule === item.id}
              size="sm"
              onClick={() => setActiveModule(item.id)}
            />
          ))}
        </SideNavSection>
      </SideNav>
    </div>
  );

  return (
    <AppShell variant="section" sideNav={sideNav} contentPadding={0} mobileNav={{ breakpoint: "md" }}>
      <section className="workbench-main" data-theme-mode={settings.appearance.themeMode} style={workbenchStyle}>
        <div className="workbench-content">{renderContent()}</div>
      </section>

      <Dialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} width={860} maxHeight="82vh" purpose="info" padding={0}>
        <section className="settings-sidebar-shell" style={workbenchStyle}>
          <aside className="settings-sidebar-nav" aria-label="用户设置分类">
            <div className="settings-sidebar-heading">
              <Text type="display-3" as="h2">
                用户设置
              </Text>
              <Button label="关闭" variant="ghost" size="sm" onClick={() => setIsSettingsOpen(false)} />
            </div>
            <div className="settings-tab-list">
              {settingsTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={activeSettingsTab === tab.id ? "settings-tab active" : "settings-tab"}
                  onClick={() => setActiveSettingsTab(tab.id)}
                >
                  <strong>{tab.label}</strong>
                  <span>{tab.description}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="settings-sidebar-content">
            {activeSettingsTab === "profile" && (
              <VStack gap={4} hAlign="stretch">
                <HStack hAlign="between" vAlign="start">
                  <div>
                    <Text type="display-3" as="h3">
                      个人资料
                    </Text>
                    <Text type="body" color="secondary">
                      仅支持更新个人头像，其他字段由企业内部主数据同步。
                    </Text>
                  </div>
                  <Avatar src={profile?.avatarUrl} name={profile?.displayName ?? auth.user?.displayName} size={64} />
                </HStack>

                <TextInput
                  label="头像地址"
                  value={avatarDraft}
                  placeholder="https://example.com/avatar.png"
                  width="100%"
                  hasClear
                  onChange={setAvatarDraft}
                />

                <div className="profile-readonly-grid">
                  <ReadOnlyField label="姓名" value={profile?.displayName ?? ""} />
                  <ReadOnlyField label="邮箱" value={profile?.email ?? ""} />
                  <ReadOnlyField label="角色" value={roleLabel(profile?.role)} />
                  <ReadOnlyField label="部门" value={profile?.department ?? ""} />
                  <ReadOnlyField label="职务" value={profile?.title ?? ""} />
                  <ReadOnlyField label="联系方式" value={profile?.phone ?? ""} />
                </div>

                <HStack hAlign="end" gap={2}>
                  <Button label="保存头像" variant="primary" isLoading={isSavingAvatar} onClick={handleAvatarSave} />
                </HStack>
              </VStack>
            )}

            {activeSettingsTab === "general" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  常规
                </Text>
                <Selector
                  label="语言"
                  value={settings.general.language}
                  options={[
                    { label: "简体中文", value: "zh-CN" },
                    { label: "English", value: "en-US" },
                  ]}
                  onChange={(language) =>
                    setSettings((current) => ({
                      ...current,
                      general: { ...current.general, language: language as WorkbenchSettings["general"]["language"] },
                    }))
                  }
                />
                <Selector
                  label="时区"
                  value={settings.general.timezone}
                  options={["Asia/Shanghai", "UTC", "America/New_York"]}
                  onChange={(timezone) =>
                    setSettings((current) => ({ ...current, general: { ...current.general, timezone } }))
                  }
                />
                <Switch
                  label="接收工作台通知"
                  description="用于登录态、配置保存和后续任务状态提示。"
                  value={settings.general.notificationsEnabled}
                  onChange={(notificationsEnabled) =>
                    setSettings((current) => ({
                      ...current,
                      general: { ...current.general, notificationsEnabled },
                    }))
                  }
                />
              </VStack>
            )}

            {activeSettingsTab === "appearance" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  外观
                </Text>
                <Selector
                  label="主题"
                  value={settings.appearance.themeMode}
                  options={[
                    { label: "浅色主题", value: "light" },
                    { label: "深色主题", value: "dark" },
                  ]}
                  onChange={(themeMode) =>
                    setSettings((current) => ({
                      ...current,
                      appearance: { ...current.appearance, themeMode: themeMode as WorkbenchSettings["appearance"]["themeMode"] },
                    }))
                  }
                />
                <TextInput
                  label="强调色"
                  value={settings.appearance.accentColor}
                  placeholder="#108387"
                  onChange={(accentColor) =>
                    setSettings((current) => ({ ...current, appearance: { ...current.appearance, accentColor } }))
                  }
                />
                <HStack gap={3} vAlign="start">
                  <TextInput
                    label="背景"
                    value={settings.appearance.backgroundColor}
                    placeholder="#f7fafc"
                    onChange={(backgroundColor) =>
                      setSettings((current) => ({ ...current, appearance: { ...current.appearance, backgroundColor } }))
                    }
                  />
                  <TextInput
                    label="前景"
                    value={settings.appearance.foregroundColor}
                    placeholder="#172033"
                    onChange={(foregroundColor) =>
                      setSettings((current) => ({ ...current, appearance: { ...current.appearance, foregroundColor } }))
                    }
                  />
                </HStack>
                <TextInput
                  label="字体"
                  value={settings.appearance.fontFamily}
                  placeholder="Inter, PingFang SC, system-ui, sans-serif"
                  onChange={(fontFamily) =>
                    setSettings((current) => ({ ...current, appearance: { ...current.appearance, fontFamily } }))
                  }
                />
                <TextInput
                  label="代码字体"
                  value={settings.appearance.codeFontFamily}
                  placeholder="JetBrains Mono, SFMono-Regular, Menlo, monospace"
                  onChange={(codeFontFamily) =>
                    setSettings((current) => ({ ...current, appearance: { ...current.appearance, codeFontFamily } }))
                  }
                />
                <Slider
                  label="UI 字号"
                  min={12}
                  max={18}
                  value={settings.appearance.uiFontSize}
                  valueDisplay="text"
                  formatValue={(value) => `${value}px`}
                  onChange={(uiFontSize: number) =>
                    setSettings((current) => ({ ...current, appearance: { ...current.appearance, uiFontSize } }))
                  }
                />
                <Slider
                  label="代码字号"
                  min={12}
                  max={18}
                  value={settings.appearance.codeFontSize}
                  valueDisplay="text"
                  formatValue={(value) => `${value}px`}
                  onChange={(codeFontSize: number) =>
                    setSettings((current) => ({ ...current, appearance: { ...current.appearance, codeFontSize } }))
                  }
                />
                <Switch
                  label="半透明侧边栏"
                  value={settings.appearance.translucentSidebar}
                  onChange={(translucentSidebar) =>
                    setSettings((current) => ({
                      ...current,
                      appearance: { ...current.appearance, translucentSidebar },
                    }))
                  }
                />
                <HStack gap={3} vAlign="start">
                  <Selector
                    label="对比度"
                    value={settings.appearance.contrast}
                    options={[
                      { label: "标准", value: "standard" },
                      { label: "高对比", value: "high" },
                    ]}
                    onChange={(contrast) =>
                      setSettings((current) => ({
                        ...current,
                        appearance: { ...current.appearance, contrast: contrast as WorkbenchSettings["appearance"]["contrast"] },
                      }))
                    }
                  />
                  <Selector
                    label="程序坞图标"
                    value={settings.appearance.dockIcon}
                    options={[
                      { label: "默认", value: "default" },
                      { label: "浅色", value: "light" },
                      { label: "深度", value: "deep" },
                    ]}
                    onChange={(dockIcon) =>
                      setSettings((current) => ({
                        ...current,
                        appearance: { ...current.appearance, dockIcon: dockIcon as WorkbenchSettings["appearance"]["dockIcon"] },
                      }))
                    }
                  />
                </HStack>
              </VStack>
            )}

            {activeSettingsTab === "agent" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  智能体配置
                </Text>
                <Section variant="muted" padding={4}>
                  <VStack gap={3} hAlign="stretch">
                    <Selector
                      label="模型渠道"
                      value={settings.configuration.modelProvider}
                      options={["Siliconflow"]}
                      onChange={(modelProvider) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, modelProvider },
                        }))
                      }
                    />
                    <TextInput
                      label="模型名称"
                      value={settings.configuration.modelName}
                      placeholder="例如 gpt-4.1、qwen-max、deepseek-chat"
                      width="100%"
                      onChange={(modelName) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, modelName },
                        }))
                      }
                    />
                    <Text type="supporting" color="secondary">
                      API Key 状态：
                      {settings.configuration.apiKeyStatus === "configured" ? "已配置（脱敏）" : "未配置"}
                    </Text>
                    <TextInput
                      label="模型 API Key"
                      type="password"
                      value={apiKeyDraft}
                      placeholder={settings.configuration.apiKeyStatus === "configured" ? "已本地保存，如需更新请输入新密钥" : "输入密钥后将加密保存到本地"}
                      onChange={setApiKeyDraft}
                    />
                    <Switch
                      label="启用 Skill"
                      value={settings.configuration.skillEnabled}
                      onChange={(skillEnabled) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, skillEnabled },
                        }))
                      }
                    />
                    <Switch
                      label="启用 MCP"
                      value={settings.configuration.mcpEnabled}
                      onChange={(mcpEnabled) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, mcpEnabled },
                        }))
                      }
                    />
                  </VStack>
                </Section>
              </VStack>
            )}

            {activeSettingsTab === "logout" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  退出登录
                </Text>
                <Section variant="muted" padding={4}>
                  <VStack gap={3} hAlign="stretch">
                    <Text type="body" color="secondary">
                      退出后会清理本地刷新令牌和当前运行时访问令牌，并返回登录页。
                    </Text>
                    <Button label="退出登录" variant="destructive" onClick={requestLogout} />
                  </VStack>
                </Section>
              </VStack>
            )}

            <div className="settings-footer">
              <Button label="关闭" variant="secondary" onClick={() => setIsSettingsOpen(false)} />
              {activeSettingsTab !== "profile" && activeSettingsTab !== "logout" && (
                <Button label="保存设置" variant="primary" isLoading={isSavingSettings} onClick={handleSettingsSave} />
              )}
            </div>
          </div>
        </section>
      </Dialog>

      <Dialog
        isOpen={isLogoutConfirmOpen}
        onOpenChange={setIsLogoutConfirmOpen}
        width={420}
        purpose="info"
        padding={5}
      >
        <VStack gap={4} hAlign="stretch">
          <div className="dialog-copy-stack">
            <Text type="display-3" as="h2" display="block">
              确认退出登录
            </Text>
            <Text type="body" color="secondary" display="block">
              退出后会清理当前登录态，并返回登录页。
            </Text>
          </div>
          <HStack hAlign="end" gap={2}>
            <Button label="取消" variant="secondary" onClick={() => setIsLogoutConfirmOpen(false)} />
            <Button label="确认退出" variant="destructive" onClick={confirmLogout} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={isModelConfigRequiredOpen}
        onOpenChange={setIsModelConfigRequiredOpen}
        width={460}
        purpose="info"
        padding={5}
      >
        <VStack gap={4} hAlign="stretch">
          <div className="dialog-copy-stack">
            <Text type="display-3" as="h2" display="block">
              需要先配置大模型
            </Text>
            <Text type="body" color="secondary" display="block">
              数据助手对话功能依赖大模型能力，请先配置模型渠道、模型名称和 API Key。
            </Text>
          </div>
          <HStack hAlign="end" gap={2}>
            <Button label="稍后配置" variant="secondary" onClick={() => setIsModelConfigRequiredOpen(false)} />
            <Button label="打开智能体配置" variant="primary" onClick={openAgentSettingsFromPrompt} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={isSessionExpiredConfirmOpen}
        onOpenChange={(open) => {
          if (open) {
            setIsSessionExpiredConfirmOpen(true);
          }
        }}
        width={440}
        purpose="info"
        padding={5}
      >
        <VStack gap={4} hAlign="stretch">
          <div className="dialog-copy-stack">
            <Text type="display-3" as="h2" display="block">
              登录态已过期
            </Text>
            <Text type="body" color="secondary" display="block">
              当前登录态已失效，请退出登录后重新进行身份验证。
            </Text>
          </div>
          <HStack hAlign="end" gap={2}>
            <Button label="退出登录" variant="destructive" onClick={confirmSessionExpiredLogout} />
          </HStack>
        </VStack>
      </Dialog>
    </AppShell>
  );
}
