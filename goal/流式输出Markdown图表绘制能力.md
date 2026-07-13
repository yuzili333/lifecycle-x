# 存续期数据探针智能体｜大模型流式输出内容的图表渲染功能开发

你现在是一个资深 TypeScript / React / Electron / 流式 Markdown / 数据可视化 / AI Agent 工程师。围绕项目 **“存续期数据探针智能体 / Cycle Data Intelligence Agent”** 开发一个可落地、可测试、可扩展的 **“大模型流式输出内容的图表渲染”** 功能。

本功能用于在大模型流式输出过程中，同时处理普通文本、Markdown 内容和自定义可视化节点。系统需要定义统一的业务语义图表协议，通过动态图表路由器，根据业务语义、图表类型、数据规模和交互需求选择合适的渲染引擎。

不要让大模型直接生成某个图表库的完整配置，例如完整 ECharts `option` 或 vis-network 配置。大模型只能输出受控的业务语义 `VisualizationSpec`，由系统完成 JSON Schema 校验、Artifact 数据解析、图表路由和最终渲染。

请优先遵守当前仓库目录结构，不要大规模重构无关模块。

---

## 1. 项目背景

项目名称：

> **存续期数据探针智能体 / Cycle Data Intelligence Agent**

项目面向银行贷款后续尽职调查、存续期管理、风险监测、数据查询、Python 分析、图表生成和数据分析报告生成等业务场景。

当前需要开发的功能为：

> **大模型流式输出内容的图表渲染 / Streaming Visualization Rendering**

该功能需要支持：

1. 大模型流式文本输出；
2. 流式 Markdown 解析与渲染；
3. Markdown 中的自定义可视化节点；
4. 图表与 Markdown 分离流式传输；
5. 统一业务语义图表协议；
6. `VisualizationSpec` JSON Schema 校验；
7. Artifact 数据引用；
8. 动态图表路由；
9. 多图表引擎适配；
10. 图表主题统一；
11. 流式图表增量更新；
12. 图表错误降级；
13. 与 Streaming Model Adapter、Python Runner、Workflow、Artifact Manager 对接。

---

## 2. 核心目标

请实现一个清晰的流式内容渲染链路：

```text
模型流式事件
→ 流式内容解析
→ 区分 Markdown 与 Visualization 事件
→ VisualizationSpec 增量聚合
→ JSON Schema 校验
→ Artifact 引用解析
→ 动态图表路由
→ 选择渲染器
→ 应用主题
→ 渲染或增量更新图表
```

功能目标包括：

* 普通文本和 Markdown 可以持续流式渲染；
* 可视化节点不会破坏 Markdown 流式输出；
* 图表数据不由模型臆造或直接修改；
* 图表数据优先引用 SQL/Python 结果 Artifact；
* 图表渲染不与单一图表库强绑定；
* 根据业务语义动态选择图表类型和渲染引擎；
* 图表引擎可以注册、替换和扩展；
* 图表渲染失败时不影响整条消息继续展示。

---

## 3. 技术与业务约束

请在实现中严格遵守以下原则。

### 3.1 Markdown 与图表分离传输

不要要求模型把图表 specification 混在普通 Markdown 代码块中。

推荐将流式事件分为：

```text
text_delta
markdown_delta
visualization_start
visualization_delta
visualization_complete
artifact_reference
stream_complete
stream_error
```

Markdown 渲染器只处理文本内容；可视化渲染器只处理结构化 `VisualizationSpec`。

### 3.2 不默认绑定 EChart

系统不再默认指定 `EChart`、`vis-timeline`、`vis-timeline` 作为统一图表库。

应采用：

> **统一业务语义协议 + 动态图表路由器 + 多渲染引擎适配器**

可支持的引擎包括但不限于：

* Apache ECharts；
* vis-network；
* vis-timeline；
* 自定义 KPI Card；
* 自定义表格；
* 后续可扩展 Vega-Lite；
* 后续可扩展其他图表引擎。

### 3.3 模型不直接输出图表库原始配置

禁止模型直接输出：

* 完整 ECharts `option`；
* 完整 vis-network nodes/edges 配置；
* 完整 vis-timeline 配置；
* 任意 JavaScript 渲染函数；
* React 组件代码；
* HTML/SVG 可执行代码；
* 事件回调函数；
* formatter JavaScript 函数。

模型只输出受控的 `VisualizationSpec`。

### 3.4 图表数据来源受控

业务图表数据必须优先来自：

* SQL 查询结果 Artifact；
* Python 分析结果 Artifact；
* Workflow 临时数据集；
* 经授权的数据集引用；
* 受控的内联小数据。

模型不能：

* 编造图表数据；
* 修改 Artifact 中的原始数值；
* 根据少量 preview rows 推断完整图表数据；
* 把完整源表数据直接写入图表协议。

### 3.5 不大规模重构

优先复用当前项目已有的：

* Streaming Model Adapter；
* Markdown Renderer；
* Chat Message Renderer；
* Artifact Manager；
* Python Runner；
* Workflow；
* Theme；
* Error Boundary；
* Electron IPC。

---

## 4. 图表范围

当前版本至少支持以下可视化类型：

* KPI 卡片；
* 折线图；
* 面积图；
* 柱状图；
* 横向柱状图；
* 堆叠柱状图；
* 柱线组合图；
* 散点图；
* 气泡图；
* 热力图；
* 迁徙矩阵；
* 直方图；
* 帕累托组合图；
* 漏斗图；
* 瀑布图；
* 时间轴；
* 网络关系图；
* 数据表格；
* 空状态；
* 错误状态。

定义：

```ts
export type VisualizationType =
  | 'kpi'
  | 'line'
  | 'area'
  | 'bar'
  | 'horizontal_bar'
  | 'stacked_bar'
  | 'bar_line_combo'
  | 'scatter'
  | 'bubble'
  | 'heatmap'
  | 'migration_matrix'
  | 'histogram'
  | 'pareto'
  | 'funnel'
  | 'waterfall'
  | 'timeline'
  | 'network'
  | 'table';
```

---

## 5. 推荐目录结构

请优先复用现有结构。

---

## 6. 统一业务语义图表协议

请设计并实现 `VisualizationSpec`。

### 6.1 顶层协议

```ts
export type VisualizationSpec = {
  specVersion: '1.0';
  visualizationId: string;
  type: VisualizationType;
  title: string;
  subtitle?: string;
  description?: string;

  businessSemantic?: BusinessVisualizationSemantic;
  data: VisualizationDataSource;
  dimensions?: VisualizationDimension[];
  measures?: VisualizationMeasure[];
  series?: VisualizationSeries[];

  encoding?: VisualizationEncoding;
  interaction?: VisualizationInteraction;
  display?: VisualizationDisplay;
  theme?: VisualizationThemeRef;

  provenance: VisualizationProvenance;
  metadata?: Record<string, unknown>;
};
```

### 6.2 业务语义

```ts
export type BusinessVisualizationSemantic =
  | 'asset_scale_trend'
  | 'overdue_trend'
  | 'institution_risk_comparison'
  | 'product_risk_structure'
  | 'risk_grade_migration'
  | 'vintage_analysis'
  | 'concentration_analysis'
  | 'maturity_structure'
  | 'warning_model_analysis'
  | 'risk_score_distribution'
  | 'collection_conversion'
  | 'balance_change_attribution'
  | 'lifecycle_event_chain'
  | 'guarantee_relationship'
  | 'related_enterprise_risk'
  | 'general_analysis';
```

### 6.3 数据来源

```ts
export type VisualizationDataSource =
  | ArtifactVisualizationDataSource
  | InlineVisualizationDataSource;
```

#### Artifact 引用

```ts
export type ArtifactVisualizationDataSource = {
  mode: 'artifact';
  artifactId: string;
  datasetId?: string;
  executionId?: string;
  dataPath?: string;
  expectedSchema?: Record<string, string>;
  rowCount?: number;
  checksum?: string;
};
```

#### 受控内联数据

```ts
export type InlineVisualizationDataSource = {
  mode: 'inline';
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  trusted: boolean;
};
```

内联数据需要设置最大行数和最大字节数，只适合小型结果集。

### 6.4 维度定义

```ts
export type VisualizationDimension = {
  field: string;
  label?: string;
  dataType:
    | 'category'
    | 'time'
    | 'number'
    | 'boolean'
    | 'identifier';
  role?: 'x' | 'category' | 'series' | 'source' | 'target' | 'time';
  sort?: 'asc' | 'desc' | 'none';
};
```

### 6.5 指标定义

```ts
export type VisualizationMeasure = {
  field: string;
  label?: string;
  dataType: 'number' | 'percentage' | 'currency' | 'count';
  role?: 'y' | 'value' | 'size' | 'rate' | 'cumulative';
  aggregation?: 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count';
  axis?: 'left' | 'right';
  format?: VisualizationValueFormat;
};
```

### 6.6 值格式

```ts
export type VisualizationValueFormat = {
  type:
    | 'number'
    | 'integer'
    | 'percentage'
    | 'currency'
    | 'compact'
    | 'date'
    | 'datetime';
  decimals?: number;
  prefix?: string;
  suffix?: string;
  currency?: string;
};
```

### 6.7 编码定义

```ts
export type VisualizationEncoding = {
  x?: string;
  y?: string[];
  category?: string;
  series?: string;
  colorBy?: string;
  sizeBy?: string;
  source?: string;
  target?: string;
  startTime?: string;
  endTime?: string;
  value?: string;
};
```

### 6.8 交互定义

```ts
export type VisualizationInteraction = {
  tooltip?: boolean;
  legend?: boolean;
  zoom?: boolean;
  brush?: boolean;
  selectable?: boolean;
  draggable?: boolean;
  expandable?: boolean;
  exportable?: boolean;
};
```

### 6.9 展示定义

```ts
export type VisualizationDisplay = {
  height?: number;
  minHeight?: number;
  aspectRatio?: number;
  responsive?: boolean;
  showDataSource?: boolean;
  showWarnings?: boolean;
  emptyText?: string;
  loadingText?: string;
};
```

### 6.10 数据溯源

```ts
export type VisualizationProvenance = {
  sourceType:
    | 'sql'
    | 'python'
    | 'workflow_dataset'
    | 'approved_inline';
  sourceRequestId?: string;
  sourceExecutionId?: string;
  sourceDatasetId?: string;
  generatedAt: string;
  masked?: boolean;
  truncated?: boolean;
  warnings?: string[];
};
```

---

## 7. JSON Schema 校验

请实现与 `VisualizationSpec` 对应的 JSON Schema。

至少校验：

* `specVersion` 必填且版本受支持；
* `visualizationId` 必填；
* `type` 必须是支持的类型；
* `title` 必填；
* `data` 必填；
* Artifact 模式必须存在 `artifactId`；
* inline 模式必须存在 `rows` 和 `rowCount`；
* inline 数据不得超过配置上限；
* dimensions、measures 和 encoding 中引用的字段必须存在；
* 网络图必须包含 source 和 target；
* 时间轴必须包含时间字段；
* KPI 必须至少包含一个 measure；
* 图表不允许包含 JavaScript 函数；
* 图表不允许包含原始 HTML；
* 图表不允许包含未经授权的本地文件路径；
* 不允许模型指定任意 renderer 类名；
* 不允许模型指定任意动态 import 路径。

建议使用项目现有 schema 库；如果项目未使用，可选用 Zod、Ajv 或其他已有依赖，不要为单一功能重复引入多个校验库。

---

## 8. 流式事件协议

请与现有 Streaming Model Adapter 对齐，扩展可视化事件。

```ts
export type VisualizationStreamEvent =
  | VisualizationStartEvent
  | VisualizationDeltaEvent
  | VisualizationCompleteEvent
  | VisualizationErrorEvent;
```

### 8.1 Start Event

```ts
export type VisualizationStartEvent = {
  type: 'visualization_start';
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId: string;
  createdAt: string;
  payload: {
    specVersion?: string;
    type?: VisualizationType;
    title?: string;
  };
};
```

### 8.2 Delta Event

```ts
export type VisualizationDeltaEvent = {
  type: 'visualization_delta';
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId: string;
  createdAt: string;
  payload: {
    path?: string;
    value?: unknown;
    rawDelta?: string;
    sequence: number;
  };
};
```

### 8.3 Complete Event

```ts
export type VisualizationCompleteEvent = {
  type: 'visualization_complete';
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId: string;
  createdAt: string;
  payload: {
    spec: VisualizationSpec;
  };
};
```

### 8.4 Error Event

```ts
export type VisualizationErrorEvent = {
  type: 'visualization_error';
  eventId: string;
  messageId: string;
  conversationId: string;
  visualizationId?: string;
  createdAt: string;
  payload: {
    code: string;
    message: string;
    recoverable: boolean;
  };
};
```

---

## 9. StreamVisualizationAssembler

请实现 `StreamVisualizationAssembler`。

职责：

* 按 `visualizationId` 聚合流式增量；
* 按 `sequence` 处理顺序；
* 处理重复 delta；
* 处理乱序 delta，当前可缓存后重排；
* 在 complete 后生成完整 `VisualizationSpec`；
* 进行 JSON Schema 校验；
* 解析 Artifact 引用；
* 输出可渲染状态；
* 流结束时处理未完成节点；
* 单个图表失败不影响其他 Markdown 和图表节点。

建议状态：

```ts
export type StreamingVisualizationState = {
  visualizationId: string;
  status:
    | 'receiving'
    | 'validating'
    | 'resolving_data'
    | 'ready'
    | 'rendering'
    | 'completed'
    | 'failed';
  partialSpec?: Partial<VisualizationSpec>;
  spec?: VisualizationSpec;
  error?: VisualizationRenderError;
  updatedAt: string;
};
```

---

## 10. 自定义 Markdown 可视化节点

当前项目使用或计划使用 Astryx Markdown 流式渲染能力。请根据当前仓库实际实现进行接入，不要假设固定 API 名称。

自定义节点建议表示为内部节点，而不是要求模型直接输出 Markdown fenced code：

```ts
export type VisualizationMarkdownNode = {
  nodeType: 'visualization';
  visualizationId: string;
  status:
    | 'streaming'
    | 'ready'
    | 'error';
  spec?: VisualizationSpec;
};
```

要求：

* 文本流继续渲染时，可视化节点显示 Skeleton；
* VisualizationSpec 完整后原地更新；
* 图表后续数据更新时保持节点位置不变；
* 图表错误时显示错误卡片，不显示原始 JSON；
* 可提供“查看数据来源”“查看警告”“重试渲染”等操作；
* 不将图表协议作为普通代码块展示给最终用户。

---

## 11. 动态图表路由器

请实现 `VisualizationRouter`。

### 11.1 路由目标

路由器根据以下信息选择渲染引擎：

* VisualizationType；
* BusinessVisualizationSemantic；
* 数据结构；
* 数据规模；
* 是否需要网络布局；
* 是否需要时间轴交互；
* 是否需要渐进式渲染；
* 当前已注册的渲染器；
* 渲染器能力；
* 用户或系统策略；
* 当前运行环境。

### 11.2 Renderer Engine

```ts
export type VisualizationEngine =
  | 'kpi'
  | 'echarts'
  | 'vis_network'
  | 'vis_timeline'
  | 'table'
  | 'fallback';
```

### 11.3 Route Result

```ts
export type VisualizationRouteResult = {
  engine: VisualizationEngine;
  rendererId: string;
  reason: string;
  fallbackRendererId?: string;
  warnings: string[];
};
```

### 11.4 基础路由规则

请实现以下默认规则。

#### KPI

```text
type = kpi
→ KPI Card Renderer
```

#### 常规分析图表

以下类型优先路由到 ECharts：

```text
line
area
bar
horizontal_bar
stacked_bar
bar_line_combo
scatter
bubble
heatmap
migration_matrix
histogram
pareto
funnel
waterfall
```

#### 时间轴

```text
type = timeline
或 businessSemantic = lifecycle_event_chain
→ vis-timeline
```

#### 网络关系

```text
type = network
或 businessSemantic = guarantee_relationship
或 businessSemantic = related_enterprise_risk
→ vis-network
```

#### 表格

```text
type = table
→ Table Renderer
```

#### 不支持类型

```text
无匹配 renderer
→ Fallback Renderer
```

### 11.5 动态能力匹配

不要只使用硬编码 `switch`。

请设计 Renderer Registry：

```ts
export type VisualizationRendererCapability = {
  rendererId: string;
  engine: VisualizationEngine;
  supportedTypes: VisualizationType[];
  supportedSemantics?: BusinessVisualizationSemantic[];
  supportsStreamingUpdate: boolean;
  supportsLargeDataset: boolean;
  supportsSvg: boolean;
  supportsCanvas: boolean;
  priority: number;
};
```

路由器应从已注册 renderer 中选择能力最匹配的实现。

---

## 12. 业务图表规则

请实现 `business-chart-rules.ts`，将常用存续期业务语义映射到推荐图表。

| 业务语义       | 推荐图表      | 默认引擎         |
| ---------- | --------- | ------------ |
| 资产规模趋势     | 折线图、面积图   | ECharts      |
| 逾期趋势       | 折线图、柱线组合图 | ECharts      |
| 机构风险比较     | 横向柱状图     | ECharts      |
| 产品风险结构     | 堆叠柱状图     | ECharts      |
| 风险等级迁徙     | 迁徙矩阵热力图   | ECharts      |
| Vintage 分析 | 多折线图、热力图  | ECharts      |
| 集中度分析      | 帕累托组合图    | ECharts      |
| 到期结构分析     | 堆叠柱状图     | ECharts      |
| 预警模型分析     | 散点图、气泡图   | ECharts      |
| 风险评分分布     | 直方图       | ECharts      |
| 清收转化过程     | 漏斗图       | ECharts      |
| 余额变动归因     | 瀑布图       | ECharts      |
| 存续期事件链     | 时间轴       | vis-timeline |
| 担保关系分析     | 网络图       | vis-network  |
| 关联企业风险     | 网络图       | vis-network  |

### 12.1 图表选择规则

实现以下规则：

```text
单一指标随时间变化
→ 折线图

余额与比率同时变化
→ 双轴柱线组合图

多个机构需要精确比较
→ 横向柱状图

多个风险等级组成结构
→ 堆叠柱状图

风险等级之间迁徙
→ 热力矩阵

事件发生顺序及持续时间
→ 时间轴

企业、担保人、合同之间关系
→ 网络图

Top N 数值与累计占比
→ 帕累托组合图

数值变化的增减归因
→ 瀑布图
```

路由规则应可配置，不要散落在 UI 组件中。

---

## 13. Renderer Adapter

请定义统一渲染器接口。

```ts
export type VisualizationRendererAdapter = {
  capability: VisualizationRendererCapability;

  canRender(input: {
    spec: VisualizationSpec;
    dataSummary?: VisualizationDataSummary;
  }): boolean;

  validate(input: {
    spec: VisualizationSpec;
    data: ResolvedVisualizationData;
  }): VisualizationRendererValidationResult;

  transform(input: {
    spec: VisualizationSpec;
    data: ResolvedVisualizationData;
    theme: ResolvedVisualizationTheme;
  }): Promise<VisualizationRendererPayload>;

  update?(input: {
    previousPayload: VisualizationRendererPayload;
    spec: VisualizationSpec;
    data: ResolvedVisualizationData;
  }): Promise<VisualizationRendererPayload>;

  dispose?(visualizationId: string): Promise<void> | void;
};
```

需要实现或适配：

* KPI Renderer Adapter；
* ECharts Renderer Adapter；
* vis-network Renderer Adapter；
* vis-timeline Renderer Adapter；
* Table Renderer Adapter；
* Fallback Renderer Adapter。

---

## 14. ECharts 转换器

请实现 `EChartsSpecTransformer`。

职责：

* 将业务语义 `VisualizationSpec` 转换为受控 ECharts option；
* option 必须由系统生成，而不是由模型直接提供；
* 应用 Astryx `neutral` 主题；
* 设置 tooltip、legend、axis、series；
* 根据图表类型创建不同 series；
* 支持双轴柱线组合图；
* 支持堆叠柱；
* 支持迁徙矩阵热力图；
* 支持帕累托图；
* 支持漏斗图；
* 支持瀑布图；
* 支持动态数据更新；
* 支持渐进式渲染参数预留；
* 禁止执行来自协议的 JavaScript formatter。

不要允许 `VisualizationSpec` 直接透传任意 ECharts option 字段。

---

## 15. 网络图转换器

请实现 `NetworkSpecTransformer`。

职责：

* 将 Artifact 数据中的节点和边转换为 vis-network 数据；
* 支持借款人、担保人、关联企业、合同等节点类型；
* 支持股权、控制、担保、资金往来等关系类型；
* 支持节点聚类预留；
* 支持节点点击事件；
* 支持关系 tooltip；
* 对大规模节点设置布局和性能策略；
* 数据异常时降级为表格或提示。

推荐协议字段：

```ts
export type NetworkVisualizationFields = {
  nodeId: string;
  nodeLabel: string;
  nodeGroup?: string;
  nodeValue?: string;
  edgeSource: string;
  edgeTarget: string;
  edgeLabel?: string;
  edgeValue?: string;
};
```

---

## 16. 时间轴转换器

请实现 `TimelineSpecTransformer`。

职责：

* 将事件 Artifact 转换为 vis-timeline 数据；
* 支持时间点；
* 支持时间区间；
* 支持事件分组；
* 支持检查、预警、整改、复查等事件类型；
* 支持缩放；
* 支持 tooltip；
* 支持选中事件；
* 无结束时间时作为时间点展示。

推荐协议字段：

```ts
export type TimelineVisualizationFields = {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  group?: string;
  eventType?: string;
  description?: string;
};
```

---

## 17. Artifact 数据解析

请实现 `ArtifactDataResolver`。

### 17.1 职责

* 根据 artifactId 获取数据；
* 校验当前用户是否有权限访问 Artifact；
* 校验 Artifact 状态；
* 校验 expectedSchema；
* 获取小数据；
* 对大数据提供分页、采样、聚合或数据引用；
* 返回数据摘要；
* 不向模型返回完整数据；
* 不允许组件访问任意本地路径。

### 17.2 接口

```ts
export type ArtifactDataResolver = {
  resolve(input: {
    artifactId: string;
    userId?: string;
    expectedSchema?: Record<string, string>;
    maxRowsForInline?: number;
  }): Promise<ResolvedVisualizationData>;
};
```

```ts
export type ResolvedVisualizationData = {
  artifactId?: string;
  columns: Array<{
    name: string;
    type: string;
  }>;
  rows?: Record<string, unknown>[];
  dataRef?: string;
  rowCount: number;
  truncated: boolean;
  masked: boolean;
  warnings: string[];
};
```

---

## 18. 主题系统

图表主题参考项目 Astryx `neutral` 主题。

请不要在各图表组件中散落硬编码颜色。

定义：

```ts
export type ResolvedVisualizationTheme = {
  name: string;
  mode: 'light' | 'dark';
  colors: {
    primary: string[];
    positive: string;
    warning: string;
    danger: string;
    neutral: string[];
    textPrimary: string;
    textSecondary: string;
    border: string;
    background: string;
  };
  typography: {
    fontFamily: string;
    titleSize: number;
    labelSize: number;
    valueSize: number;
    lineHeight: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
  };
};
```

要求：

* 从当前应用主题中解析颜色；
* 支持明暗主题；
* 图表颜色、字体、间距与应用保持一致；
* 不能让模型指定任意颜色；
* 可允许模型表达语义颜色，例如 positive、warning、danger，由主题映射实际颜色。

---

## 19. React 渲染组件

### 19.1 StreamingVisualizationNode

职责：

* 接收 `visualizationId`；
* 订阅流式可视化状态；
* receiving 时显示 Skeleton；
* ready 后调用 VisualizationRenderer；
* failed 后显示错误状态；
* 节点位置保持稳定；
* 避免每个 delta 都完全重建图表。

### 19.2 VisualizationRenderer

职责：

* 调用 VisualizationRouter；
* 根据 rendererId 选择渲染器；
* 处理 Artifact 加载；
* 处理 loading；
* 处理 error；
* 应用主题；
* 支持 resize；
* 组件卸载时 dispose renderer。

### 19.3 VisualizationContainer

建议提供：

* 标题；
* 副标题；
* 图表内容；
* 数据来源；
* warning；
* loading；
* error；
* 图表工具栏；
* 展开查看；
* 导出入口预留；
* 无障碍描述。

---

## 20. 流式更新策略

请实现合理的更新节流。

要求：

* 普通文本按现有流式策略更新；
* VisualizationSpec delta 不应每个字符都触发重渲染；
* 对图表 delta 使用节流或批处理；
* 完整 specification 校验通过前显示 Skeleton；
* Artifact 到达后再绘制数据；
* 对支持动态更新的 renderer 使用增量更新；
* 对不支持动态更新的 renderer 使用受控重建；
* 同一 message 支持多个 visualizationId；
* 单个图表失败不影响其他图表。

可配置：

```ts
export type VisualizationStreamingPolicy = {
  specUpdateThrottleMs: number;
  renderUpdateThrottleMs: number;
  maxPendingDeltas: number;
  allowPartialPreview: boolean;
  validateOnEveryDelta: boolean;
  validateOnComplete: boolean;
};
```

默认建议：

* delta 聚合时只做轻量结构检查；
* complete 后执行完整 JSON Schema 校验；
* 不完整 spec 不执行实际图表转换。

---

## 21. 错误处理与降级

请定义：

```ts
export type VisualizationErrorCode =
  | 'VISUALIZATION_SPEC_INVALID'
  | 'VISUALIZATION_TYPE_UNSUPPORTED'
  | 'VISUALIZATION_RENDERER_NOT_FOUND'
  | 'VISUALIZATION_DATA_NOT_FOUND'
  | 'VISUALIZATION_DATA_PERMISSION_DENIED'
  | 'VISUALIZATION_SCHEMA_MISMATCH'
  | 'VISUALIZATION_ARTIFACT_FAILED'
  | 'VISUALIZATION_ROUTE_FAILED'
  | 'VISUALIZATION_TRANSFORM_FAILED'
  | 'VISUALIZATION_RENDER_FAILED'
  | 'VISUALIZATION_STREAM_INCOMPLETE'
  | 'VISUALIZATION_DATA_TOO_LARGE'
  | 'UNKNOWN_ERROR';
```

降级规则：

1. 图表渲染失败，不影响 Markdown；
2. 网络图失败，可降级为节点/边表格；
3. 时间轴失败，可降级为事件列表；
4. 常规图表失败，可降级为数据表格；
5. 数据未到达时显示等待状态；
6. spec 不合法时显示“可视化配置无法解析”；
7. 不向普通用户展示完整异常堆栈和原始协议；
8. 开发环境可以提供调试详情；
9. 错误状态保留 visualizationId、artifactId 和 traceId。

---

## 22. 模型输出约束提示词

请提供一段可注入大模型的系统提示词或工具描述，用于约束模型生成 `VisualizationSpec`。

中文示例：

```text
当用户需要数据可视化时，请生成受控的 VisualizationSpec，而不是生成 ECharts option、vis-network 配置、JavaScript、React 组件、HTML 或 SVG。

VisualizationSpec 只描述业务语义、图表类型、字段映射、指标格式、交互需求和 Artifact 数据引用。

图表数据必须来自系统提供的 Artifact、SQL 查询结果、Python 分析结果或已授权数据集。不要编造、补齐、修改或推断 Artifact 中不存在的数据。

优先通过 artifactId 引用数据。只有结果集较小且系统明确允许时，才可以使用 inline rows。

请根据业务含义选择图表类型：
- 单一指标随时间变化：折线图；
- 余额与比率同时变化：双轴柱线组合图；
- 多机构精确比较：横向柱状图；
- 风险等级结构：堆叠柱状图；
- 风险等级迁徙：热力矩阵；
- 存续期事件顺序和持续时间：时间轴；
- 企业、担保人、合同之间的关系：网络图。

不要指定具体图表渲染引擎。系统会根据 VisualizationSpec 动态选择合适的渲染器。
```

---

## 23. 对外 API

请实现并从 `index.ts` 导出：

```ts
createVisualizationModule(config)

visualization.registerRenderer(renderer)
visualization.unregisterRenderer(rendererId)
visualization.getRendererCapabilities()

visualization.validateSpec(spec)
visualization.route(spec, dataSummary)
visualization.resolveData(spec)
visualization.transform(spec, rendererId)
visualization.handleStreamEvent(event)
visualization.getStreamingState(visualizationId)
visualization.dispose(visualizationId)
```

模块配置：

```ts
export type VisualizationModuleConfig = {
  artifactResolver: ArtifactDataResolver;
  rendererRegistry?: VisualizationRendererRegistry;
  themeResolver: VisualizationThemeResolver;
  streamingPolicy?: Partial<VisualizationStreamingPolicy>;
  inlineDataMaxRows?: number;
  inlineDataMaxBytes?: number;
  allowInlineData?: boolean;
  enableDebugInfo?: boolean;
};
```

---

## 24. 测试要求

优先使用项目现有测试框架；TypeScript 项目可使用 Vitest。

### 24.1 Visualization Schema 测试

覆盖：

* 合法折线图；
* 合法 KPI；
* 合法网络图；
* 合法时间轴；
* 缺少 artifactId；
* 非法 type；
* 字段映射不存在；
* 网络图缺少 source/target；
* 时间轴缺少时间字段；
* inline 数据超限；
* 包含 JavaScript 函数；
* 包含非法路径。

### 24.2 Stream Assembler 测试

覆盖：

* start → delta → complete；
* 多个 delta 聚合；
* 多个 visualizationId 并行；
* 重复 sequence；
* 乱序 sequence；
* 未完成流；
* complete 后校验；
* 图表失败不影响文本事件。

### 24.3 Visualization Router 测试

覆盖：

* KPI 路由；
* 折线图路由到 ECharts；
* 热力图路由到 ECharts；
* timeline 路由到 vis-timeline；
* network 路由到 vis-network；
* renderer 不可用时 fallback；
* capability priority；
* 动态注册 renderer；
* 动态注销 renderer。

### 24.4 Business Chart Rules 测试

覆盖：

* 资产规模趋势；
* 逾期趋势；
* 机构风险比较；
* 风险等级迁徙；
* Vintage；
* 集中度；
* 到期结构；
* 担保关系；
* 关联企业风险；
* 事件链。

### 24.5 Artifact Resolver 测试

覆盖：

* 正常解析；
* Artifact 不存在；
* 权限不足；
* schema 不匹配；
* 数据脱敏；
* 数据截断；
* 大数据返回 dataRef；
* 不暴露本地绝对路径。

### 24.6 Renderer Adapter 测试

覆盖：

* ECharts spec 转换；
* 双轴柱线；
* 堆叠柱；
* 热力图；
* vis-network 转换；
* vis-timeline 转换；
* KPI 转换；
* fallback table；
* 主题应用；
* dispose。

### 24.7 React 组件测试

覆盖：

* 流式 Skeleton；
* complete 后渲染；
* Artifact loading；
* 图表错误状态；
* Markdown 和图表共存；
* 同一消息多个图表；
* 组件卸载清理；
* resize。

---

## 25. 实现约束

请遵守以下约束：

1. 优先使用 TypeScript；
2. React 组件保持轻量；
3. 优先遵守当前项目结构；
4. 不要大规模重构无关模块；
5. 不再使用vis.js图表库，同时不要默认把 EChart、vis-timeline、vis-timeline中的某一个库作为统一主图表库；
6. 不要让模型输出完整 ECharts option；
7. 不要让模型输出可执行 JavaScript；
8. 不要允许模型指定任意 renderer 路径；
9. 图表数据优先通过 Artifact 引用；
10. 不要把完整源表数据放进模型上下文；
11. 不要把完整图表数据协议作为普通 Markdown 展示；
12. 单个图表错误不能中断消息流；
13. 所有 renderer 必须通过统一 Adapter 接口注册；
14. 所有 VisualizationSpec 必须通过 schema 校验；
15. 主题配置必须复用 Astryx `neutral` 或当前应用主题；
16. 所有公开 API 应从 `index.ts` 导出；
17. 如果已有 Markdown Renderer、Streaming Model Adapter、Artifact Manager、Theme、Error Boundary，请复用；
18. 完成后运行类型检查和测试，如环境允许。

---

## 26. 验收标准

完成后应满足以下标准：

1. 支持普通文本流式渲染；
2. 支持 Markdown 流式渲染；
3. 支持自定义可视化节点；
4. 支持 Markdown 与图表分离流式传输；
5. 支持 `VisualizationSpec`；
6. 支持 JSON Schema 校验；
7. 支持 Artifact 数据引用；
8. 支持内联小数据并设置安全上限；
9. 支持动态图表路由；
10. 不默认绑定 EChart、vis-timeline、vis-timeline中任一个图表库；
11. 常规分析图表可路由到 ECharts；
12. 网络关系图可路由到 vis-network；
13. 事件链可路由到 vis-timeline；
14. KPI 可路由到自定义 KPI Renderer；
15. 支持流式图表 Skeleton 和状态更新；
16. 支持图表错误降级；
17. 支持 Astryx `neutral` 主题；
18. 图表数据具有来源追踪信息；
19. 模型不能直接控制图表库原始配置；
20. 有基础测试覆盖；
21. 模块可与 Streaming Model Adapter、Python Runner、Workflow、Artifact Manager 和 Chat Renderer 对接。

---

## 27. 开发优先级

### P0：必须完成

* VisualizationSpec 类型；
* JSON Schema 或 Zod Schema；
* VisualizationValidator；
* VisualizationRouter；
* Renderer Registry；
* StreamVisualizationAssembler；
* Visualization Event 类型；
* ArtifactDataResolver 接口；
* KPI Renderer；
* ECharts Renderer Adapter 基础实现；
* Table Fallback Renderer；
* StreamingVisualizationNode；
* VisualizationRenderer；
* Astryx `neutral` 主题适配；
* vis-network Adapter；
* vis-timeline Adapter；
* 柱线组合图；
* 堆叠柱；
* 热力矩阵；
* 帕累托图；
* 漏斗图；
* 瀑布图；
* 流式增量更新；
* 基础测试；
* 与现有 Markdown Renderer 对接；
* Renderer dispose；
* warning 展示；
* `index.ts` 导出。

### P1：预留接口

* Vega-Lite；
* 分析师探索模式；
* 图表联动；
* 下钻；
* 图表版本管理；
* 大数据渐进式加载；
* WebGL Renderer；
* 图表无障碍增强；

---

## 28. 请最终输出

执行完成后，请输出：

1. 新增或修改的文件列表；
2. 核心架构说明；
3. `VisualizationSpec` 示例；
4. 流式事件示例；
5. Artifact 数据引用示例；
6. 图表路由示例；
7. ECharts 转换示例；
8. vis-network 转换示例；
9. vis-timeline 转换示例；
10. Markdown 与图表共存示例；
11. 测试运行结果；
12. 尚未完成或需要后续补充的事项。

请直接推进实现，不要停留在设计文档。请优先遵守当前仓库目录结构，不要大规模重构无关模块；如发现已有 `streaming-model-adapter`、`markdown-renderer`、`chat-message`、`artifact-manager`、`python-runner`、`workflow`、`theme` 模块，请复用其类型、事件协议和接口。
