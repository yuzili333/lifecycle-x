import { request, type AuthFailure, type AuthUser } from "./auth";

export type UserProfile = AuthUser & {
  department: string;
  title: string;
  phone: string;
};

export type WorkbenchSettings = {
  general: {
    language: "zh-CN" | "en-US";
    timezone: string;
    notificationsEnabled: boolean;
  };
  appearance: {
    themeMode: "light" | "dark";
    accentColor: string;
    backgroundColor: string;
    foregroundColor: string;
    fontFamily: string;
    codeFontFamily: string;
    uiFontSize: number;
    codeFontSize: number;
    translucentSidebar: boolean;
    contrast: "standard" | "high";
    dockIcon: "default" | "light" | "deep";
  };
  configuration: {
    modelProvider: string;
    apiKeyStatus: "not_configured" | "configured";
    skillEnabled: boolean;
    mcpEnabled: boolean;
  };
  personalization: {
    defaultModule: "data-assistant" | "data-management";
    compactNavigation: boolean;
  };
};

export type ApiResult<T extends { success: true }> = T | AuthFailure;

function authHeaders(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

export const workbenchApi = {
  profile(accessToken: string) {
    return request<{ success: true; profile: UserProfile }>("/users/me/profile", {
      headers: authHeaders(accessToken),
    });
  },

  updateAvatar(accessToken: string, avatarUrl: string) {
    return request<{ success: true; profile: UserProfile }>("/users/me/avatar", {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ avatarUrl }),
    });
  },

  settings(accessToken: string) {
    return request<{ success: true; settings: WorkbenchSettings }>("/users/me/settings", {
      headers: authHeaders(accessToken),
    });
  },

  updateSettings(accessToken: string, settings: Partial<WorkbenchSettings>) {
    return request<{ success: true; settings: WorkbenchSettings }>("/users/me/settings", {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify(settings),
    });
  },
};
