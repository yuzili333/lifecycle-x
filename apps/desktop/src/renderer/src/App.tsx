import { useEffect, useMemo, useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { LoginPage } from "./LoginPage";
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

const workflowSteps = [
  "导入数据源",
  "识别字段口径",
  "生成分析计划",
  "执行风险扫描",
  "归集证据链",
  "输出报告初稿",
];

const modules = [
  {
    name: "工作台",
    description: "自然语言任务入口、分析计划确认、风险结果查看。",
  },
  {
    name: "数据源",
    description: "CSV 导入、数据库连接配置、字段映射和质量摘要。",
  },
  {
    name: "证据库",
    description: "保存证据编号、来源、记录范围和统计口径。",
  },
  {
    name: "报告库",
    description: "归档 Markdown、PDF、JSON 报告和引用关系。",
  },
];

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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">LX</div>
          <div>
            <strong>Lifecycle X</strong>
            <span>存续期数据探针</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {["工作台", "数据源", "证据库", "报告库", "审计追踪"].map((item) => (
            <button
              className={item === "工作台" ? "nav-item active" : "nav-item"}
              key={item}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>存续期数据探针智能体</h1>
            <p>
              {auth.user?.displayName} · {auth.user?.role === "admin" ? "管理员" : "普通用户"} ·
              面向贷后管理和后续尽职调查的桌面分析工作台。
            </p>
          </div>
          <div className="topbar-actions">
            <div className="runtime">{runtimeLabel}</div>
            <Button label="退出登录" variant="secondary" size="sm" onClick={auth.logout} />
          </div>
        </header>

        {auth.permissions.includes("audit:read") ? (
          <Banner
            status="success"
            title="管理员权限已启用"
            description="当前账号可访问审计追踪、用户管理和数据源管理能力。"
          />
        ) : (
          <Banner
            status="info"
            title="普通用户权限"
            description="当前账号可执行分析任务、查看数据源和读取报告。"
          />
        )}

        <section className="task-panel" aria-labelledby="task-title">
          <div>
            <h2 id="task-title">自然语言分析任务</h2>
            <p>
              输入资金用途核查、回款变化分析、外部风险扫描或报告生成任务。
            </p>
          </div>
          <div className="task-input">
            <span>
              核查 XX 公司近三个月贷款资金是否流入关联方，并输出证据链。
            </span>
            <button type="button">生成分析计划</button>
          </div>
        </section>

        <section className="content-grid">
          <section className="panel">
            <h2>基础流程</h2>
            <ol className="workflow">
              {workflowSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="panel modules-panel">
            <h2>客户端模块</h2>
            <div className="module-list">
              {modules.map((module) => (
                <article className="module-card" key={module.name}>
                  <h3>{module.name}</h3>
                  <p>{module.description}</p>
                </article>
              ))}
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}

export default App;
