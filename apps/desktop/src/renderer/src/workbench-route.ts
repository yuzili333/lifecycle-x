export type WorkbenchRoute = "home" | "database";

export const WORKBENCH_ROUTE_HASH: Record<WorkbenchRoute, string> = {
  home: "#/home",
  database: "#/database",
};

export function canAccessWorkbenchRoute(route: WorkbenchRoute, permissions: string[]) {
  return route === "home"
    ? permissions.includes("analysis:read")
    : permissions.includes("datasource:read");
}

export function fallbackWorkbenchRoute(permissions: string[]): WorkbenchRoute {
  if (canAccessWorkbenchRoute("home", permissions)) {
    return "home";
  }
  if (canAccessWorkbenchRoute("database", permissions)) {
    return "database";
  }
  return "home";
}

export function parseWorkbenchRoute(hash: string, permissions: string[]): WorkbenchRoute {
  const requestedRoute = hash === WORKBENCH_ROUTE_HASH.database
    ? "database"
    : hash === WORKBENCH_ROUTE_HASH.home
      ? "home"
      : null;

  if (requestedRoute && canAccessWorkbenchRoute(requestedRoute, permissions)) {
    return requestedRoute;
  }
  return fallbackWorkbenchRoute(permissions);
}
