import { Theme } from "@astryxdesign/core";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { toPng } from "html-to-image";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { reportVisualizationArtifactIds } from "../../../shared/visualization";
import type {
  ReportExportVisualizationImage,
} from "../../../shared/reportExport";
import { VisualizationRenderer } from "../components/VisualizationRenderer";

export async function prepareReportVisualizationImages(input: {
  userId: string;
  conversationId: string;
  reportArtifactId: string;
  reportVersion: number;
  markdown: string;
}): Promise<ReportExportVisualizationImage[]> {
  const api = window.lifecycleX?.assistant;
  if (!api) {
    throw new Error("报告导出服务不可用。");
  }
  const artifactIds = reportVisualizationArtifactIds(input.markdown);
  const images: ReportExportVisualizationImage[] = [];
  for (const artifactId of artifactIds) {
    let artifact;
    try {
      artifact = await api.resolveReportVisualization(
        input.userId,
        input.conversationId,
        input.reportArtifactId,
        input.reportVersion,
        artifactId,
      );
    } catch (error) {
      throw new Error(`图表“${friendlyChartName(error)}”已失效或无法加载，导出已取消。`);
    }
    images.push(await renderVisualizationImage(artifactId, artifact));
  }
  return images;
}

async function renderVisualizationImage(
  artifactId: string,
  artifact: Awaited<ReturnType<NonNullable<typeof window.lifecycleX>["assistant"]["resolveReportVisualization"]>>,
) {
  const host = document.createElement("div");
  host.className = "assistant-report-export-snapshot";
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "760px",
    padding: "24px",
    background: "#ffffff",
    color: "#111111",
    zIndex: "-1",
    pointerEvents: "none",
  });
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(
        <Theme theme={neutralTheme} mode="light">
          <VisualizationRenderer
            spec={artifact.visualizationSpec}
            data={artifact.data}
            embedded
            appearance="light"
          />
        </Theme>,
      );
    });
    await waitForSnapshotLayout();
    const node = host.querySelector<HTMLElement>(".assistant-visualization");
    if (!node || node.classList.contains("error")) {
      throw new Error(`图表“${artifact.title ?? artifact.visualizationSpec.title}”渲染失败，导出已取消。`);
    }
    const rect = node.getBoundingClientRect();
    const width = Math.ceil(Math.max(node.scrollWidth, rect.width));
    const height = Math.ceil(Math.max(node.scrollHeight, rect.height));
    if (!width || !height) {
      throw new Error(`图表“${artifact.title ?? artifact.visualizationSpec.title}”没有可导出的画面。`);
    }
    const dataUrl = await toPng(node, {
      backgroundColor: "#ffffff",
      cacheBust: true,
      pixelRatio: 2,
      width,
      height,
      style: {
        margin: "0",
        maxWidth: "none",
      },
    });
    return { artifactId, dataUrl, width: width * 2, height: height * 2 };
  } finally {
    root.unmount();
    host.remove();
  }
}

async function waitForSnapshotLayout() {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function friendlyChartName(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.match(/“([^”]+)”/)?.[1] ?? "报告图表";
}
