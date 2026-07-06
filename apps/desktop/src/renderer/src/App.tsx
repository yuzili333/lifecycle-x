import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@astryxdesign/core/Spinner";
import { LoginPage } from "./LoginPage";
import { WorkbenchShell } from "./WorkbenchShell";
import { useAuthStore } from "./useAuthStore";
import "./styles.css";

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  node: string;
};

function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const auth = useAuthStore();

  useEffect(() => {
    if (!window.lifecycleX) {
      setAppInfo(null);
      return;
    }

    window.lifecycleX
      .getAppInfo()
      .then((info) => setAppInfo(info as AppInfo))
      .catch(() => setAppInfo(null));
  }, []);

  const runtimeLabel = useMemo(() => {
    if (!appInfo) {
      return "Electron runtime initializing";
    }

    return `Electron ${appInfo.electron} · Node ${appInfo.node}`;
  }, [appInfo]);

  if (auth.status === "checking") {
    return (
      <main className="loading-screen">
        <Spinner size="lg" />
        <span>正在校验登录态...</span>
      </main>
    );
  }

  if (auth.status !== "authenticated") {
    return (
      <LoginPage
        onPasswordLogin={auth.loginWithPassword}
        onSsoComplete={auth.completeSso}
        lastError={auth.lastError}
        onError={auth.setLastError}
      />
    );
  }

  return <WorkbenchShell auth={auth} runtimeLabel={runtimeLabel} />;
}

export default App;
