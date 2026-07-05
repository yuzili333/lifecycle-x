# @lifecycle-x/desktop

存续期数据探针智能体的 Electron 桌面客户端。

## Scripts

```bash
pnpm --filter @lifecycle-x/desktop dev
pnpm --filter @lifecycle-x/desktop build
pnpm --filter @lifecycle-x/desktop typecheck
```

## Structure

- `src/main`: Electron 主进程，负责创建窗口和注册 IPC。
- `src/preload`: 安全暴露给渲染进程的桥接 API。
- `src/renderer`: React 渲染进程，承载业务工作台界面。

