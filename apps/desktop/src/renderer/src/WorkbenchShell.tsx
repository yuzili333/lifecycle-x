import { Activity, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu, type DropdownMenuOption } from "@astryxdesign/core/DropdownMenu";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Slider } from "@astryxdesign/core/Slider";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { DatabasePlus, Ellipsis, LogOut, MessageCirclePlus, Pencil, Settings, Trash2 } from "lucide-react";
import type { AuthFailure } from "./auth";
import {
  DataAssistantWorkspace,
  type AssistantNavigationSnapshot,
  type DataAssistantWorkspaceHandle,
} from "./DataAssistantWorkspace";
import { DataManagementWorkspace } from "./DataManagementWorkspace";
import { SkillManagementPanel } from "./SkillManagementPanel";
import { useAppToast } from "./useAppToast";
import type { useAuthStore } from "./useAuthStore";
import { workbenchApi, type ApiResult, type UserProfile, type WorkbenchSettings } from "./workbenchApi";
import type { DataSourceMenuAction } from "../../preload";
import type { SkillSummary } from "../../shared/skills";
import {
  WORKBENCH_ROUTE_HASH,
  canAccessWorkbenchRoute,
  fallbackWorkbenchRoute,
  parseWorkbenchRoute,
  type WorkbenchRoute,
} from "./workbench-route";

type WorkbenchAuth = ReturnType<typeof useAuthStore>;

type WorkbenchShellProps = {
  auth: WorkbenchAuth;
  runtimeLabel: string;
};

type SettingsTab = "profile" | "appearance" | "skills" | "agent";
type SessionExpiredPromptPhase = "idle" | "prompting" | "logging-out" | "handled";
type PendingAssistantNavigationAction =
  | { type: "start" }
  | { type: "select" | "rename" | "delete"; conversationId: string };

const WORKBENCH_SETTINGS_CACHE_KEY_PREFIX = "cycle-probe:workbench:settings";
const MODEL_CONFIG_PROMPT_CACHE_KEY_PREFIX = "cycle-probe:workbench:model-config-prompted";
const APP_THEME_MODE_CACHE_KEY = "cycle-probe:theme-mode";
const APP_THEME_MODE_EVENT = "cycle-probe:theme-mode-change";
const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SESSION_ACTIVITY_THROTTLE_MS = 1000;
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
    executionModelName: "",
    dualModelOrchestrationEnabled: true,
    thinkingOptimizationEnabled: true,
    apiKeyStatus: "not_configured",
    skillEnabled: true,
    mcpEnabled: false,
  },
  personalization: {
    defaultModule: "data-assistant",
    compactNavigation: false,
  },
};

function workbenchSettingsCacheKey(user: WorkbenchAuth["user"]) {
  return `${WORKBENCH_SETTINGS_CACHE_KEY_PREFIX}:${user?.id ?? "anonymous"}`;
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
    configuration: { ...defaultSettings.configuration, ...settings.configuration, skillEnabled: true },
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
  { id: "appearance", label: "外观", description: "主题、颜色和字体" },
  { id: "skills", label: "技能", description: "系统与个人 Skill" },
  { id: "agent", label: "模型配置", description: "大模型和 API Key" },
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

function formatConversationHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SideNavActionMenu({
  label,
  items,
  className,
}: {
  label: string;
  items: DropdownMenuOption[];
  className?: string;
}) {
  return (
    <span className={className}>
      <DropdownMenu
        button={{
          label,
          icon: <Ellipsis />,
          variant: "ghost",
          size: "sm",
          isIconOnly: true,
        }}
        items={items}
        hasChevron={false}
      />
    </span>
  );
}

function ConversationMarqueeTitle({ title }: { title: string }) {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const updateOverflowDistance = () => {
      const viewport = viewportRef.current;
      const content = contentRef.current;
      if (!viewport || !content) {
        return;
      }
      const nextDistance = Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth));
      setOverflowDistance((currentDistance) => currentDistance === nextDistance ? currentDistance : nextDistance);
    };

    updateOverflowDistance();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOverflowDistance);
      return () => window.removeEventListener("resize", updateOverflowDistance);
    }

    const observer = new ResizeObserver(updateOverflowDistance);
    if (viewportRef.current) {
      observer.observe(viewportRef.current);
    }
    if (contentRef.current) {
      observer.observe(contentRef.current);
    }
    return () => observer.disconnect();
  }, [title]);

  const animationDuration = Math.max(4, overflowDistance / 30);
  const marqueeStyle = {
    "--conversation-marquee-distance": `-${overflowDistance}px`,
    "--conversation-marquee-duration": `${animationDuration.toFixed(2)}s`,
  } as CSSProperties;

  return (
    <strong
      ref={viewportRef}
      className="workbench-conversation-title"
      data-overflowing={overflowDistance > 0 ? "true" : undefined}
      style={marqueeStyle}
    >
      <span ref={contentRef} className="workbench-conversation-title-content">
        {title}
      </span>
    </strong>
  );
}

export function WorkbenchShell({ auth }: WorkbenchShellProps) {
  const toast = useAppToast();
  const sessionExpiredPromptPhaseRef = useRef<SessionExpiredPromptPhase>("idle");
  const sessionIdleTimerRef = useRef<number | null>(null);
  const lastSessionActivityAtRef = useRef(0);
  const skillCatalogUserIdRef = useRef<string | null>(null);
  const skillLoadRequestIdRef = useRef(0);
  const assistantNavigationHandleRef = useRef<DataAssistantWorkspaceHandle | null>(null);
  const pendingAssistantNavigationActionRef = useRef<PendingAssistantNavigationAction | null>(null);
  const [route, setRoute] = useState<WorkbenchRoute>(() =>
    typeof window === "undefined"
      ? fallbackWorkbenchRoute(auth.permissions)
      : parseWorkbenchRoute(window.location.hash, auth.permissions));
  const [assistantNavigationSnapshot, setAssistantNavigationSnapshot] = useState<AssistantNavigationSnapshot>({
    conversations: [],
    activeConversationId: "",
    isLoading: true,
  });
  const [assistantNavigationRevision, setAssistantNavigationRevision] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isSessionExpiredConfirmOpen, setIsSessionExpiredConfirmOpen] = useState(false);
  const [isSessionExpiredLogoutPending, setIsSessionExpiredLogoutPending] = useState(false);
  const [isModelConfigRequiredOpen, setIsModelConfigRequiredOpen] = useState(false);
  const [pendingDataSourceAction, setPendingDataSourceAction] = useState<DataSourceMenuAction | null>(null);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(() => fallbackProfile(auth.user));
  const [avatarDraft, setAvatarDraft] = useState(auth.user?.avatarUrl ?? "");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [settings, setSettings] = useState<WorkbenchSettings>(() => readCachedWorkbenchSettings(auth.user) ?? defaultSettings);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [isInstallingSkill, setIsInstallingSkill] = useState(false);
  const [pendingSkillId, setPendingSkillId] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    const userId = auth.user?.id ?? null;
    const requestId = ++skillLoadRequestIdRef.current;
    if (skillCatalogUserIdRef.current !== userId) {
      skillCatalogUserIdRef.current = userId;
      setSkills([]);
    }
    if (!userId || !window.lifecycleX?.skills) {
      setIsLoadingSkills(false);
      return;
    }
    setIsLoadingSkills(true);
    const result = await window.lifecycleX.skills.list(userId);
    if (requestId !== skillLoadRequestIdRef.current || skillCatalogUserIdRef.current !== userId) {
      return;
    }
    setIsLoadingSkills(false);
    if (!result.success) {
      setSkills([]);
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "skill-list-error",
        collisionBehavior: "overwrite",
      });
      return;
    }
    setSkills(result.data);
  }, [auth.user?.id, toast]);

  const openSessionExpiredConfirm = useCallback(() => {
    if (auth.status !== "authenticated") {
      return;
    }
    if (sessionExpiredPromptPhaseRef.current !== "idle") {
      return;
    }
    sessionExpiredPromptPhaseRef.current = "prompting";
    setIsSessionExpiredConfirmOpen(true);
  }, [auth.status]);

  const clearSessionIdleTimer = useCallback(() => {
    if (sessionIdleTimerRef.current !== null) {
      window.clearTimeout(sessionIdleTimerRef.current);
      sessionIdleTimerRef.current = null;
    }
  }, []);

  const scheduleSessionIdleTimeout = useCallback(() => {
    clearSessionIdleTimer();
    if (auth.status !== "authenticated" || sessionExpiredPromptPhaseRef.current !== "idle") {
      return;
    }
    sessionIdleTimerRef.current = window.setTimeout(() => {
      sessionIdleTimerRef.current = null;
      openSessionExpiredConfirm();
    }, SESSION_IDLE_TIMEOUT_MS);
  }, [auth.status, clearSessionIdleTimer, openSessionExpiredConfirm]);

  const refreshSessionIdleTimer = useCallback((options?: { force?: boolean }) => {
    if (auth.status !== "authenticated" || sessionExpiredPromptPhaseRef.current !== "idle") {
      return;
    }
    const now = Date.now();
    if (!options?.force && now - lastSessionActivityAtRef.current < SESSION_ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastSessionActivityAtRef.current = now;
    scheduleSessionIdleTimeout();
  }, [auth.status, scheduleSessionIdleTimeout]);

  const requestWithRefresh = useCallback(
    async <T extends { success: true }>(call: (accessToken: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      refreshSessionIdleTimer({ force: true });
      if (sessionExpiredPromptPhaseRef.current === "logging-out" || sessionExpiredPromptPhaseRef.current === "handled") {
        return {
          success: false,
          error: {
            code: "SESSION_EXPIRED",
            message: "登录态已过期，请重新登录。",
            traceId: "client-session-expired-handled",
          },
        };
      }

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
    [auth, openSessionExpiredConfirm, refreshSessionIdleTimer],
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
    if (auth.status !== "authenticated") {
      clearSessionIdleTimer();
      lastSessionActivityAtRef.current = 0;
      return undefined;
    }

    refreshSessionIdleTimer({ force: true });
    const handleActivity = () => refreshSessionIdleTimer();
    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "click",
      "keydown",
      "wheel",
      "scroll",
      "touchstart",
      "pointerdown",
    ];
    for (const eventName of events) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }
    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, handleActivity);
      }
      clearSessionIdleTimer();
    };
  }, [auth.status, clearSessionIdleTimer, refreshSessionIdleTimer]);

  useEffect(() => {
    const syncRouteFromHash = () => {
      const nextRoute = parseWorkbenchRoute(window.location.hash, auth.permissions);
      setRoute(nextRoute);
      const normalizedHash = WORKBENCH_ROUTE_HASH[nextRoute];
      if (window.location.hash !== normalizedHash) {
        window.history.replaceState(null, "", normalizedHash);
      }
    };
    syncRouteFromHash();
    window.addEventListener("hashchange", syncRouteFromHash);
    return () => window.removeEventListener("hashchange", syncRouteFromHash);
  }, [auth.permissions]);

  useEffect(() => {
    let isMounted = true;

    async function loadWorkbench() {
      const cachedSettings = readCachedWorkbenchSettings(auth.user);
      const profileResult = await requestWithRefresh(workbenchApi.profile);
      const settingsResult = isFailure(profileResult) && profileResult.error.code === "SESSION_EXPIRED"
        ? null
        : await requestWithRefresh(workbenchApi.settings);
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

      if (settingsResult === null) {
        if (cachedSettings) {
          setSettings(withLocalModelApiKeyStatus(cachedSettings, localModelApiKeyConfigured));
        }
      } else if (isFailure(settingsResult)) {
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
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    const dispose = window.lifecycleX?.dataSource.onAction((action) => {
      const nextRoute = parseWorkbenchRoute(WORKBENCH_ROUTE_HASH.database, auth.permissions);
      setRoute(nextRoute);
      window.location.hash = WORKBENCH_ROUTE_HASH[nextRoute];
      setPendingDataSourceAction(nextRoute === "database" ? action : null);
    });

    return () => dispose?.();
  }, [auth.permissions]);

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
    if (tab === "skills") {
      void loadSkills();
    }
  };

  const openAgentSettingsFromPrompt = () => {
    setIsModelConfigRequiredOpen(false);
    openSettings("agent");
  };

  const navigateToRoute = useCallback((nextRoute: WorkbenchRoute) => {
    if (!canAccessWorkbenchRoute(nextRoute, auth.permissions)) {
      toast({
        type: "error",
        body: nextRoute === "database" ? "当前账号无数据库访问权限。" : "当前账号无助手访问权限。",
        uniqueID: "workbench-route-denied",
        collisionBehavior: "overwrite",
      });
      return;
    }
    setRoute(nextRoute);
    if (window.location.hash !== WORKBENCH_ROUTE_HASH[nextRoute]) {
      window.location.hash = WORKBENCH_ROUTE_HASH[nextRoute];
    }
  }, [auth.permissions, toast]);

  const handleAssistantNavigationHandleChange = useCallback((handle: DataAssistantWorkspaceHandle | null) => {
    assistantNavigationHandleRef.current = handle;
    if (handle && pendingAssistantNavigationActionRef.current) {
      setAssistantNavigationRevision((current) => current + 1);
    }
  }, []);

  const requestAssistantNavigation = useCallback((action: PendingAssistantNavigationAction) => {
    pendingAssistantNavigationActionRef.current = action;
    navigateToRoute("home");
    setAssistantNavigationRevision((current) => current + 1);
  }, [navigateToRoute]);

  useEffect(() => {
    if (route !== "home") {
      return;
    }
    const action = pendingAssistantNavigationActionRef.current;
    const handle = assistantNavigationHandleRef.current;
    if (!action || !handle) {
      return;
    }
    pendingAssistantNavigationActionRef.current = null;
    if (action.type === "start") {
      void handle.startConversation();
      return;
    }
    if (action.type === "select") {
      handle.selectConversation(action.conversationId);
      return;
    }
    if (action.type === "rename") {
      handle.openRenameConversation(action.conversationId);
      return;
    }
    handle.requestDeleteConversation(action.conversationId);
  }, [assistantNavigationRevision, route]);

  const requestLogout = () => {
    setIsLogoutConfirmOpen(true);
  };

  const installSkill = async () => {
    if (!auth.user?.id || !window.lifecycleX?.skills) return;
    setIsInstallingSkill(true);
    const result = await window.lifecycleX.skills.pickAndInstall(auth.user.id);
    setIsInstallingSkill(false);
    if (!result.success) {
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "skill-install-error",
        collisionBehavior: "overwrite",
      });
      return;
    }
    if (result.data.status === "installed") {
      await loadSkills();
      toast({
        type: "info",
        body: `已安装并启用 ${result.data.skill.displayName}。`,
        uniqueID: "skill-install-success",
        collisionBehavior: "overwrite",
      });
    }
  };

  const setSkillEnabled = async (skill: SkillSummary, enabled: boolean) => {
    if (!auth.user?.id || !window.lifecycleX?.skills) return;
    setPendingSkillId(skill.skillId);
    const result = await window.lifecycleX.skills.setEnabled(auth.user.id, skill.skillId, enabled);
    setPendingSkillId(null);
    if (!result.success) {
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "skill-toggle-error",
        collisionBehavior: "overwrite",
      });
      return;
    }
    setSkills((current) => current.map((item) =>
      item.origin === "personal" && item.skillId === result.data.skillId ? result.data : item));
  };

  const removeSkill = async (skill: SkillSummary) => {
    if (!auth.user?.id || !window.lifecycleX?.skills) return;
    setPendingSkillId(skill.skillId);
    const result = await window.lifecycleX.skills.remove(auth.user.id, skill.skillId);
    setPendingSkillId(null);
    if (!result.success) {
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "skill-remove-error",
        collisionBehavior: "overwrite",
      });
      return;
    }
    setSkills((current) => current.filter((item) =>
      !(item.origin === "personal" && item.skillId === skill.skillId)));
    toast({
      type: "info",
      body: `已删除 ${skill.displayName}。`,
      uniqueID: "skill-remove-success",
      collisionBehavior: "overwrite",
    });
  };

  const dismissSessionExpiredPrompt = () => {
    sessionExpiredPromptPhaseRef.current = "handled";
    setIsSessionExpiredConfirmOpen(false);
    setIsSessionExpiredLogoutPending(false);
  };

  const beginSessionExpiredLogout = () => {
    sessionExpiredPromptPhaseRef.current = "logging-out";
    setIsSessionExpiredConfirmOpen(false);
    setIsSessionExpiredLogoutPending(true);
  };

  const confirmLogout = async () => {
    setIsLogoutConfirmOpen(false);
    dismissSessionExpiredPrompt();
    await auth.logout();
  };

  const confirmSessionExpiredLogout = async () => {
    if (sessionExpiredPromptPhaseRef.current === "logging-out" || sessionExpiredPromptPhaseRef.current === "handled") {
      return;
    }
    beginSessionExpiredLogout();
    try {
      await auth.logout({ remote: false });
    } finally {
      sessionExpiredPromptPhaseRef.current = "handled";
      setIsSessionExpiredLogoutPending(false);
    }
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
        <Activity mode={route === "home" ? "visible" : "hidden"} name="workbench-data-assistant">
          <div className="workbench-module">
            <DataAssistantWorkspace
              user={auth.user}
              modelName={settings.configuration.modelName}
              executionModelName={settings.configuration.executionModelName?.trim() || ""}
              dualModelOrchestrationEnabled={settings.configuration.dualModelOrchestrationEnabled !== false}
              thinkingOptimizationEnabled={settings.configuration.thinkingOptimizationEnabled !== false}
              isModelConfigured={isModelConfigurationReady(settings)}
              canReadDataSources={auth.permissions.includes("datasource:read")}
              skills={skills.filter((skill) => skill.enabled && skill.availability === "ready")}
              requestWithRefresh={requestWithRefresh}
              onRequireModelConfig={() => setIsModelConfigRequiredOpen(true)}
              onNavigationSnapshotChange={setAssistantNavigationSnapshot}
              onNavigationHandleChange={handleAssistantNavigationHandleChange}
            />
          </div>
        </Activity>
        <Activity mode={route === "database" ? "visible" : "hidden"} name="workbench-data-management">
          <div className="workbench-module">
            {auth.permissions.includes("datasource:read") && (
              <DataManagementWorkspace
                isActive={route === "database"}
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
    <SideNav
      className="workbench-side-nav"
      data-theme-mode={settings.appearance.themeMode}
      style={workbenchStyle}
      header={<SideNavHeading className="workbench-side-nav-heading" heading="溯据" />}
      topContent={
        <SideNavSection title="导航">
          <div className="workbench-primary-navigation">
            {auth.permissions.includes("analysis:read") && (
              <SideNavItem
                label="新建对话"
                icon={<MessageCirclePlus />}
                isDisabled={assistantNavigationSnapshot.isLoading}
                onClick={() => requestAssistantNavigation({ type: "start" })}
              />
            )}
            {auth.permissions.includes("datasource:read") && (
              <SideNavItem
                label="数据库"
                icon={<DatabasePlus />}
                isSelected={route === "database"}
                onClick={() => navigateToRoute("database")}
              />
            )}
          </div>
        </SideNavSection>
      }
      footerIcons={
        <HStack hAlign="between" vAlign="center" gap={2} className="workbench-side-nav-user">
          <HStack vAlign="center" gap={2} className="workbench-side-nav-user-identity">
            <Avatar
              src={profile?.avatarUrl ?? auth.user?.avatarUrl}
              name={profile?.displayName ?? auth.user?.displayName ?? auth.user?.username}
              size={32}
            />
            <Text type="body" weight="semibold" maxLines={1}>
              {profile?.displayName ?? auth.user?.displayName ?? auth.user?.username ?? "用户"}
            </Text>
          </HStack>
          <SideNavActionMenu
            label="用户操作"
            items={[
              {
                label: "设置",
                icon: <Settings size={16} />,
                onClick: () => openSettings("profile"),
              },
              {
                label: "退出登录",
                icon: <LogOut size={16} />,
                onClick: requestLogout,
              },
            ]}
          />
        </HStack>
      }
    >
      {auth.permissions.includes("analysis:read") && (
        <SideNavSection title="最近" className="workbench-recent-section">
          <section className="workbench-recent-conversations" aria-label="最近会话">
            {assistantNavigationSnapshot.conversations.map((conversation) => (
              <article
                key={conversation.id}
                className={
                  conversation.id === assistantNavigationSnapshot.activeConversationId
                    ? "workbench-recent-conversation active"
                    : "workbench-recent-conversation"
                }
              >
                <button
                  type="button"
                  className="workbench-recent-conversation-select"
                  onClick={() => requestAssistantNavigation({ type: "select", conversationId: conversation.id })}
                >
                  <ConversationMarqueeTitle title={conversation.title} />
                  <span className="workbench-conversation-timestamp">
                    {formatConversationHistoryTime(conversation.updatedAt)}
                  </span>
                </button>
                <SideNavActionMenu
                  label={`${conversation.title} 操作`}
                  className="workbench-recent-conversation-menu"
                  items={[
                    {
                      label: "重命名",
                      icon: <Pencil size={16} />,
                      onClick: () => requestAssistantNavigation({ type: "rename", conversationId: conversation.id }),
                    },
                    {
                      label: "删除",
                      icon: <Trash2 size={16} />,
                      onClick: () => requestAssistantNavigation({ type: "delete", conversationId: conversation.id }),
                    },
                  ]}
                />
              </article>
            ))}
          </section>
        </SideNavSection>
      )}
    </SideNav>
  );

  return (
    <AppShell variant="section" sideNav={sideNav} contentPadding={0} mobileNav={false}>
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
              </VStack>
            )}

            {activeSettingsTab === "agent" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  模型配置
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
                      label="推理模型名称"
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
                    <TextInput
                      label="执行模型名称"
                      value={settings.configuration.executionModelName ?? ""}
                      placeholder="留空时使用系统配置的 Qwen 执行模型"
                      width="100%"
                      onChange={(executionModelName) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, executionModelName },
                        }))
                      }
                    />
                    <Switch
                      label="启用双模型编排"
                      value={settings.configuration.dualModelOrchestrationEnabled !== false}
                      onChange={(dualModelOrchestrationEnabled) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, dualModelOrchestrationEnabled },
                        }))
                      }
                    />
                    <Switch
                      label="启用动态 Thinking"
                      value={settings.configuration.thinkingOptimizationEnabled !== false}
                      onChange={(thinkingOptimizationEnabled) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, thinkingOptimizationEnabled },
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
                  </VStack>
                </Section>
              </VStack>
            )}

            {activeSettingsTab === "skills" && (
              <section className="settings-skill-content">
                <SkillManagementPanel
                  skills={skills}
                  isLoading={isLoadingSkills}
                  pendingSkillId={pendingSkillId}
                  isInstalling={isInstallingSkill}
                  onInstall={() => void installSkill()}
                  onSetEnabled={(skill, enabled) => void setSkillEnabled(skill, enabled)}
                  onRemove={(skill) => void removeSkill(skill)}
                />
              </section>
            )}

            <div className="settings-footer">
              <Button label="关闭" variant="secondary" onClick={() => setIsSettingsOpen(false)} />
              {activeSettingsTab !== "profile" && activeSettingsTab !== "skills" && (
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
            <Button label="打开模型配置" variant="primary" onClick={openAgentSettingsFromPrompt} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog
        isOpen={isSessionExpiredConfirmOpen && sessionExpiredPromptPhaseRef.current === "prompting"}
        onOpenChange={(open) => {
          if (open && sessionExpiredPromptPhaseRef.current === "idle") {
            sessionExpiredPromptPhaseRef.current = "prompting";
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
            <Button label="退出登录" variant="destructive" isDisabled={isSessionExpiredLogoutPending} onClick={confirmSessionExpiredLogout} />
          </HStack>
        </VStack>
      </Dialog>
    </AppShell>
  );
}
