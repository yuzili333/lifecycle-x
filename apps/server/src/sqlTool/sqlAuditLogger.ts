import { randomUUID } from "node:crypto";
import type { SqlAuditEvent, SqlAuditLogger } from "./types.js";

export class InMemorySqlAuditLogger implements SqlAuditLogger {
  readonly events: SqlAuditEvent[] = [];

  log(event: Omit<SqlAuditEvent, "auditId" | "createdAt">) {
    this.events.push({
      ...event,
      auditId: `sql_audit_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    });
  }
}
