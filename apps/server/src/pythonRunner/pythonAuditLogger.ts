import { randomUUID } from "node:crypto";
import type { PythonAuditEvent, PythonAuditLogger } from "./types.js";

export class InMemoryPythonAuditLogger implements PythonAuditLogger {
  readonly events: PythonAuditEvent[] = [];

  log(event: Omit<PythonAuditEvent, "auditId" | "createdAt">) {
    this.events.push({
      ...event,
      auditId: `py_audit_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    });
  }
}
