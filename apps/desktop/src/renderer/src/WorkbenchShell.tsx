import { Activity, useCallback, useEffect, useState, type CSSProperties } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { Slider } from "@astryxdesign/core/Slider";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TopNav, TopNavHeading, TopNavItem, TopNavMenu } from "@astryxdesign/core/TopNav";
import { UserCircle } from "lucide-react";
import type { AuthFailure } from "./auth";
import { DataAssistantWorkspace } from "./DataAssistantWorkspace";
import { DataManagementWorkspace } from "./DataManagementWorkspace";
import { useAppToast } from "./useAppToast";
import type { useAuthStore } from "./useAuthStore";
import aiIcon from "./assets/ai.svg";
import dockIconDark512 from "./assets/cycle_probe_docker_icon_dark_512.png";
import dockIconLight512 from "./assets/cycle_probe_docker_icon_light_512.png";
import csvIcon from "./assets/csv.svg";
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
const WORKBENCH_SETTINGS_CACHE_KEY_PREFIX = "cycle-probe:workbench:settings";
const MODEL_CONFIG_PROMPT_CACHE_KEY_PREFIX = "cycle-probe:workbench:model-config-prompted";
const APP_THEME_MODE_CACHE_KEY = "cycle-probe:theme-mode";
const APP_THEME_MODE_EVENT = "cycle-probe:theme-mode-change";
const NEUTRAL_THEME_APPEARANCE_BY_MODE: Record<WorkbenchSettings["appearance"]["themeMode"], {
  themeMode: WorkbenchSettings["appearance"]["themeMode"];
  accentColor: string;
  backgroundColor: string;
  foregroundColor: string;
}> = {
  light: {
    themeMode: "light",
    accentColor: "#262626",
    backgroundColor: "#f1f1f1",
    foregroundColor: "#171717",
  },
  dark: {
    themeMode: "dark",
    accentColor: "#ebebeb",
    backgroundColor: "#1b1b1b",
    foregroundColor: "#fafafa",
  },
};
const DEFAULT_THEME_MODE: WorkbenchSettings["appearance"]["themeMode"] = "dark";
const DEFAULT_NEUTRAL_THEME_APPEARANCE = NEUTRAL_THEME_APPEARANCE_BY_MODE[DEFAULT_THEME_MODE];

const defaultSettings: WorkbenchSettings = {
  general: {
    language: "zh-CN",
    timezone: "Asia/Shanghai",
    notificationsEnabled: true,
  },
  appearance: {
    ...DEFAULT_NEUTRAL_THEME_APPEARANCE,
    fontFamily: "Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif",
    codeFontFamily: "JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace",
    uiFontSize: 14,
    codeFontSize: 13,
    translucentSidebar: false,
    contrast: "standard",
    dockIcon: "light",
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

function workbenchSettingsCacheKey(user: WorkbenchAuth["user"]) {
  return `${WORKBENCH_SETTINGS_CACHE_KEY_PREFIX}:${user?.id ?? "anonymous"}`;
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

function normalizeDockIconTheme(value: unknown): WorkbenchSettings["appearance"]["dockIcon"] {
  return value === "light" ? "light" : "dark";
}

function isThemeMode(value: unknown): value is WorkbenchSettings["appearance"]["themeMode"] {
  return value === "light" || value === "dark";
}

function readCachedThemeMode(): WorkbenchSettings["appearance"]["themeMode"] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cached = window.localStorage.getItem(APP_THEME_MODE_CACHE_KEY);
    return isThemeMode(cached) ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedThemeMode(themeMode: WorkbenchSettings["appearance"]["themeMode"]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(APP_THEME_MODE_CACHE_KEY, themeMode);
  } catch {
    // Ignore storage failures; the current session can still switch theme.
  }

  window.dispatchEvent(new CustomEvent(APP_THEME_MODE_EVENT, { detail: themeMode }));
}

function normalizeWorkbenchSettings(settings: WorkbenchSettings): WorkbenchSettings {
  const themeMode = readCachedThemeMode() ?? DEFAULT_THEME_MODE;
  return {
    general: { ...defaultSettings.general, ...settings.general },
    appearance: {
      ...defaultSettings.appearance,
      ...settings.appearance,
      ...NEUTRAL_THEME_APPEARANCE_BY_MODE[themeMode],
      dockIcon: normalizeDockIconTheme(settings.appearance?.dockIcon),
    },
    configuration: { ...defaultSettings.configuration, ...settings.configuration },
    personalization: { ...defaultSettings.personalization, ...settings.personalization },
  };
}

function readCachedWorkbenchSettings(user: WorkbenchAuth["user"]) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cached = window.localStorage.getItem(workbenchSettingsCacheKey(user));
    if (!cached) {
      return null;
    }
    return normalizeWorkbenchSettings(JSON.parse(cached) as WorkbenchSettings);
  } catch {
    return null;
  }
}

function writeCachedWorkbenchSettings(user: WorkbenchAuth["user"], settings: WorkbenchSettings) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(workbenchSettingsCacheKey(user), JSON.stringify(settings));
  } catch {
    // Ignore storage failures; server-side settings and in-memory state still apply.
  }
}

function mergeCachedWorkbenchSettings(serverSettings: WorkbenchSettings, cachedSettings: WorkbenchSettings | null) {
  const normalizedServerSettings = normalizeWorkbenchSettings(serverSettings);
  if (!cachedSettings) {
    return normalizedServerSettings;
  }

  return normalizeWorkbenchSettings({
    ...normalizedServerSettings,
    general: { ...normalizedServerSettings.general, ...cachedSettings.general },
    appearance: { ...normalizedServerSettings.appearance, ...cachedSettings.appearance },
    configuration: { ...normalizedServerSettings.configuration, ...cachedSettings.configuration },
    personalization: { ...normalizedServerSettings.personalization, ...cachedSettings.personalization },
  });
}

function withLocalModelApiKeyStatus(settings: WorkbenchSettings, hasLocalApiKey: boolean): WorkbenchSettings {
  return {
    ...settings,
    configuration: {
      ...settings.configuration,
      apiKeyStatus: hasLocalApiKey ? "configured" : "not_configured",
    },
  };
}

type AppIconVariant = WorkbenchSettings["appearance"]["dockIcon"];

const appIconAssets: Record<AppIconVariant, string> = {
  dark: dockIconDark512,
  light: dockIconLight512,
};

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

function NavAssetIcon({ src, size = "sm" }: { src: string; size?: "sm" | "lg" }) {
  return <span className={`nav-asset-icon ${size === "lg" ? "nav-asset-icon-lg" : ""}`} style={{ "--nav-icon-url": `url(${src})` } as CSSProperties} aria-hidden="true" />;
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
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settings, setSettings] = useState<WorkbenchSettings>(() => readCachedWorkbenchSettings(auth.user) ?? defaultSettings);
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
      const cachedSettings = readCachedWorkbenchSettings(auth.user);
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
        if (cachedSettings) {
          const nextSettings = withLocalModelApiKeyStatus(cachedSettings, localModelApiKeyConfigured);
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
      } else {
        const mergedSettings = mergeCachedWorkbenchSettings(settingsResult.settings, cachedSettings);
        const nextSettings = withLocalModelApiKeyStatus(mergedSettings, localModelApiKeyConfigured);
        setSettings(nextSettings);
        writeCachedWorkbenchSettings(auth.user, nextSettings);
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

  const activeAppIconVariant = settings.appearance.dockIcon;
  const activeAppIcon = appIconAssets[activeAppIconVariant];
  const workbenchStyle = {
    "--workbench-background": "var(--color-background-body)",
    "--workbench-foreground": "var(--color-text-primary)",
    "--workbench-accent": "var(--color-accent)",
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

  const activateDataManagement = (action: DataSourceMenuAction = "open-database") => {
    if (!auth.permissions.includes("datasource:read")) {
      toast({
        type: "error",
        body: "当前账号无数据管理访问权限。",
        uniqueID: "data-source-nav-denied",
        collisionBehavior: "overwrite",
      });
      return;
    }
    setActiveModule("data-management");
    setPendingDataSourceAction(action);
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

    const cachedSettings = withLocalModelApiKeyStatus(nextSettings, nextApiKey.length > 0 || await hasLocalModelApiKey(auth.user));
    writeCachedWorkbenchSettings(auth.user, cachedSettings);
    setSettings(cachedSettings);

    const result = await requestWithRefresh((token) => workbenchApi.updateSettings(token, nextSettings));
    setIsSavingSettings(false);
    if (isFailure(result)) {
      showError(result);
      return;
    }

    const savedSettings = withLocalModelApiKeyStatus(normalizeWorkbenchSettings(result.settings), nextApiKey.length > 0 || await hasLocalModelApiKey(auth.user));
    setSettings(savedSettings);
    writeCachedWorkbenchSettings(auth.user, savedSettings);
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
            <DataAssistantWorkspace
              user={auth.user}
              modelName={settings.configuration.modelName}
              isModelConfigured={isModelConfigurationReady(settings)}
              canReadDataSources={auth.permissions.includes("datasource:read")}
              requestWithRefresh={requestWithRefresh}
              onRequireModelConfig={() => setIsModelConfigRequiredOpen(true)}
            />
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

  const topNav = (
    <div className="workbench-top-nav-frame" style={workbenchStyle}>
      <TopNav
        label="Cycle Probe navigation"
        heading={<TopNavHeading heading="Cycle Probe" logo={<img className="workbench-brand-icon" src={activeAppIcon} alt="" />} />}
        startContent={
          <>
            {auth.permissions.includes("analysis:read") && (
              <TopNavItem
                label="Assistant"
                href="#assistant"
                icon={<NavAssetIcon src={aiIcon} />}
                isSelected={activeModule === "data-assistant"}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveModule("data-assistant");
                }}
              />
            )}
            {auth.permissions.includes("datasource:read") && (
              <TopNavMenu
                label="DataSource"
                items={[
                  {
                    title: "Database",
                    description: "Database Connection",
                    icon: <NavAssetIcon src={databaseIcon} size="lg" />,
                    href: "#database",
                    onClick: () => activateDataManagement("open-database"),
                  },
                  {
                    title: "CSV",
                    description: "Import CSV",
                    icon: <NavAssetIcon src={csvIcon} size="lg" />,
                    href: "#csv",
                    onClick: () => activateDataManagement("open-csv"),
                  },
                ]}
              />
            )}
          </>
        }
        endContent={
          <Button
            label="Profile"
            variant="ghost"
            icon={<UserCircle size={18} />}
            isIconOnly
            className="workbench-profile-button"
            onClick={() => openSettings("profile")}
          />
        }
      />
    </div>
  );

  return (
    <AppShell variant="section" topNav={topNav} contentPadding={0} mobileNav={{ breakpoint: "md" }}>
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
                  onChange={(themeMode) => {
                    const nextThemeMode = isThemeMode(themeMode) ? themeMode : DEFAULT_THEME_MODE;
                    writeCachedThemeMode(nextThemeMode);
                    setSettings((current) => ({
                      ...current,
                      appearance: {
                        ...current.appearance,
                        ...NEUTRAL_THEME_APPEARANCE_BY_MODE[nextThemeMode],
                      },
                    }));
                  }}
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
                    label="应用内图标主题"
                    value={settings.appearance.dockIcon}
                    options={[
                      { label: "深色主题图标", value: "dark" },
                      { label: "浅色主题图标", value: "light" },
                    ]}
                    onChange={(dockIcon) =>
                      setSettings((current) => ({
                        ...current,
                        appearance: { ...current.appearance, dockIcon: normalizeDockIconTheme(dockIcon) },
                      }))
                    }
                  />
                </HStack>
                <Section variant="muted" padding={3}>
                  <HStack gap={3} vAlign="center">
                    <img className="dock-icon-preview" src={activeAppIcon} alt="" />
                    <VStack gap={1} hAlign="stretch">
                      <Text type="body">当前应用内图标：{activeAppIconVariant}</Text>
                      <Text type="supporting" color="secondary">
                        程序坞图标固定使用浅色图标；工作台界面图标按当前设置显示。
                      </Text>
                    </VStack>
                  </HStack>
                </Section>
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
