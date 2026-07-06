import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Slider } from "@astryxdesign/core/Slider";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import type { AuthFailure } from "./auth";
import type { useAuthStore } from "./useAuthStore";
import { workbenchApi, type ApiResult, type UserProfile, type WorkbenchSettings } from "./workbenchApi";

type WorkbenchAuth = ReturnType<typeof useAuthStore>;

type WorkbenchShellProps = {
  auth: WorkbenchAuth;
  runtimeLabel: string;
};

type WorkbenchModule = "data-assistant" | "data-management" | "reports" | "audit";
type SettingsTab = "general" | "appearance" | "configuration" | "personalization";

const defaultSettings: WorkbenchSettings = {
  general: {
    language: "zh-CN",
    timezone: "Asia/Shanghai",
    notificationsEnabled: true,
  },
  appearance: {
    themeMode: "light",
    accentColor: "#108387",
    uiFontSize: 14,
    codeFontSize: 13,
    translucentSidebar: false,
    contrast: "standard",
    dockIcon: "default",
  },
  configuration: {
    modelProvider: "OpenAI Compatible",
    apiKeyStatus: "not_configured",
    skillEnabled: false,
    mcpEnabled: false,
  },
  personalization: {
    defaultModule: "data-assistant",
    compactNavigation: false,
  },
};

const settingsTabs: Array<{ id: SettingsTab; label: string; description: string }> = [
  { id: "general", label: "常规", description: "语言、时区和通知" },
  { id: "appearance", label: "外观", description: "主题、字号和侧栏表现" },
  { id: "configuration", label: "配置", description: "模型、Skill 和 MCP" },
  { id: "personalization", label: "个性化", description: "默认入口和导航偏好" },
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

export function WorkbenchShell({ auth, runtimeLabel }: WorkbenchShellProps) {
  const toast = useToast();
  const [activeModule, setActiveModule] = useState<WorkbenchModule>("data-assistant");
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("general");
  const [profile, setProfile] = useState<UserProfile | null>(() => fallbackProfile(auth.user));
  const [avatarDraft, setAvatarDraft] = useState(auth.user?.avatarUrl ?? "");
  const [settings, setSettings] = useState<WorkbenchSettings>(defaultSettings);
  const [isLoadingWorkbench, setIsLoadingWorkbench] = useState(true);
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const requestWithRefresh = useCallback(
    async <T extends { success: true }>(call: (accessToken: string) => Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
      if (!auth.accessToken) {
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

      const refreshed = await auth.refreshSession();
      return refreshed ? call(refreshed.accessToken) : result;
    },
    [auth],
  );

  const showError = useCallback(
    (result: AuthFailure) => {
      toast({
        type: "error",
        body: `${result.error.message} Trace: ${result.error.traceId}`,
        uniqueID: "workbench-error",
        collisionBehavior: "overwrite",
      });
    },
    [toast],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadWorkbench() {
      setIsLoadingWorkbench(true);
      const profileResult = await requestWithRefresh(workbenchApi.profile);
      const settingsResult = await requestWithRefresh(workbenchApi.settings);

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
        setSettings(settingsResult.settings);
      }

      setIsLoadingWorkbench(false);
    }

    void loadWorkbench();
    return () => {
      isMounted = false;
    };
  }, [auth.user, requestWithRefresh, showError]);

  const navItems = useMemo(
    () => [
      { id: "data-assistant" as const, label: "数据助手", permission: "analysis:read" },
      { id: "data-management" as const, label: "数据管理", permission: "datasource:read" },
      { id: "reports" as const, label: "报告库", permission: "report:read" },
      { id: "audit" as const, label: "审计追踪", permission: "audit:read" },
    ],
    [],
  );

  const visibleNavItems = navItems.filter((item) => auth.permissions.includes(item.permission));
  const currentTitle = visibleNavItems.find((item) => item.id === activeModule)?.label ?? "数据助手";

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
    setIsSavingSettings(true);
    const result = await requestWithRefresh((token) => workbenchApi.updateSettings(token, settings));
    setIsSavingSettings(false);
    if (isFailure(result)) {
      showError(result);
      return;
    }

    setSettings(result.settings);
    toast({
      type: "info",
      body: "用户设置已保存。",
      uniqueID: "settings-saved",
      collisionBehavior: "overwrite",
    });
  };

  const renderContent = () => {
    if (activeModule === "data-management") {
      return (
        <PlaceholderView title="数据管理" description="数据源连接、字段口径和数据资产管理能力将在后续 Goal 中拆分建设。" />
      );
    }

    if (activeModule === "reports") {
      return <PlaceholderView title="报告库" description="报告归档和导出能力沿用权限控制，后续按报告模块需求开发。" />;
    }

    if (activeModule === "audit") {
      return <PlaceholderView title="审计追踪" description="审计日志入口仅对管理员展示，具体列表能力后续接入。" />;
    }

    return <PlaceholderView title="数据助手" description="默认首页已预留，功能需求确认后再接入智能体交互。" />;
  };

  const sideNav = (
    <SideNav
      header={
        <SideNavHeading
          heading="Lifecycle X"
          superheading="存续期数据探针"
          subheading={auth.user ? `${auth.user.displayName} · ${roleLabel(auth.user.role)}` : "已认证用户"}
          icon={<div className="workbench-brand-mark">LX</div>}
        />
      }
      footer={
        <div className="side-user">
          <Avatar src={profile?.avatarUrl} name={profile?.displayName ?? auth.user?.displayName} size={36} />
          <div className="side-user-copy">
            <strong>{profile?.displayName ?? auth.user?.displayName}</strong>
            <span>{profile?.email ?? auth.user?.email}</span>
          </div>
        </div>
      }
      collapsible={{ defaultIsCollapsed: false, buttonLabel: "折叠工作台导航" }}
    >
      <SideNavSection title="主导航">
        {visibleNavItems.map((item) => (
          <SideNavItem
            key={item.id}
            label={item.label}
            isSelected={activeModule === item.id}
            onClick={() => setActiveModule(item.id)}
          />
        ))}
      </SideNavSection>
    </SideNav>
  );

  return (
    <AppShell variant="section" sideNav={sideNav} contentPadding={0} mobileNav={{ breakpoint: "md" }}>
      <section className="workbench-main">
        <header className="workbench-topbar">
          <div>
            <Text type="display-3" as="h1">
              {currentTitle}
            </Text>
            <Text type="body" color="secondary">
              {auth.user?.displayName} · {roleLabel(auth.user?.role)} · {runtimeLabel}
            </Text>
          </div>

          <div className="workbench-actions">
            {isLoadingWorkbench && <Spinner size="sm" />}
            <DropdownMenu
              button={{
                label: profile?.displayName ?? auth.user?.displayName ?? "用户菜单",
                variant: "secondary",
                size: "md",
                children: (
                  <HStack vAlign="center" gap={2}>
                    <Avatar src={profile?.avatarUrl} name={profile?.displayName ?? auth.user?.displayName} size={24} />
                    <span>{profile?.displayName ?? auth.user?.displayName}</span>
                  </HStack>
                ),
              }}
              menuWidth={220}
              placement="below"
              items={[
                { label: "数据助手", onClick: () => setActiveModule("data-assistant") },
                { label: "数据管理", onClick: () => setActiveModule("data-management") },
                { type: "divider" },
                { label: "个人资料", onClick: () => setIsProfileOpen(true) },
                { label: "用户设置", onClick: () => setIsSettingsOpen(true) },
                { type: "divider" },
                { label: "退出登录", onClick: auth.logout },
              ]}
            />
          </div>
        </header>

        <div className="workbench-content">{renderContent()}</div>
      </section>

      <Dialog isOpen={isProfileOpen} onOpenChange={setIsProfileOpen} width={560} purpose="form" padding={5}>
        <VStack gap={4} hAlign="stretch">
          <HStack hAlign="between" vAlign="start">
            <div>
              <Text type="display-3" as="h2">
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
            <Button label="关闭" variant="secondary" onClick={() => setIsProfileOpen(false)} />
            <Button label="保存头像" variant="primary" isLoading={isSavingAvatar} onClick={handleAvatarSave} />
          </HStack>
        </VStack>
      </Dialog>

      <Dialog isOpen={isSettingsOpen} onOpenChange={setIsSettingsOpen} width={860} maxHeight="82vh" purpose="form" padding={0}>
        <section className="settings-sidebar-shell">
          <aside className="settings-sidebar-nav" aria-label="用户设置分类">
            <Text type="display-3" as="h2">
              用户设置
            </Text>
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

            {activeSettingsTab === "configuration" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  配置
                </Text>
                <Section variant="muted" padding={4}>
                  <VStack gap={3} hAlign="stretch">
                    <Selector
                      label="大模型"
                      value={settings.configuration.modelProvider}
                      options={["OpenAI Compatible", "Enterprise Gateway", "本地模型网关"]}
                      onChange={(modelProvider) =>
                        setSettings((current) => ({
                          ...current,
                          configuration: { ...current.configuration, modelProvider },
                        }))
                      }
                    />
                    <Text type="supporting" color="secondary">
                      API Key 状态：
                      {settings.configuration.apiKeyStatus === "configured" ? "已配置（脱敏）" : "未配置"}
                    </Text>
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

            {activeSettingsTab === "personalization" && (
              <VStack gap={4} hAlign="stretch">
                <Text type="display-3" as="h3">
                  个性化
                </Text>
                <Selector
                  label="默认入口"
                  value={settings.personalization.defaultModule}
                  options={[
                    { label: "数据助手", value: "data-assistant" },
                    { label: "数据管理", value: "data-management" },
                  ]}
                  onChange={(defaultModule) =>
                    setSettings((current) => ({
                      ...current,
                      personalization: {
                        ...current.personalization,
                        defaultModule: defaultModule as WorkbenchSettings["personalization"]["defaultModule"],
                      },
                    }))
                  }
                />
                <Switch
                  label="紧凑导航"
                  description="减少侧边导航纵向间距，适合小屏工作环境。"
                  value={settings.personalization.compactNavigation}
                  onChange={(compactNavigation) =>
                    setSettings((current) => ({
                      ...current,
                      personalization: { ...current.personalization, compactNavigation },
                    }))
                  }
                />
              </VStack>
            )}

            <div className="settings-footer">
              <Button label="关闭" variant="secondary" onClick={() => setIsSettingsOpen(false)} />
              <Button label="保存设置" variant="primary" isLoading={isSavingSettings} onClick={handleSettingsSave} />
            </div>
          </div>
        </section>
      </Dialog>
    </AppShell>
  );
}
