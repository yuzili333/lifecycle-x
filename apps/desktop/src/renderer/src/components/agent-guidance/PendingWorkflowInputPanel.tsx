import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import type { AgentGuidanceAction, MissingWorkflowInput } from "../../../../main/agentGuidance";

export type PendingWorkflowInputContext = {
  workflowId: string;
  resumeToken?: string;
  title: string;
  expectedInputs: MissingWorkflowInput[];
  suggestedActions: AgentGuidanceAction[];
};

export type PendingWorkflowInputPanelProps = {
  context: PendingWorkflowInputContext;
  onAction?: (action: AgentGuidanceAction) => void;
};

export function PendingWorkflowInputPanel({ context, onAction }: PendingWorkflowInputPanelProps) {
  const inputLabels = context.expectedInputs.map((input) => input.label).join("、");
  const visibleActions = context.suggestedActions.slice(0, 3);
  return (
    <section className="assistant-pending-workflow-panel" aria-label="待补充工作流上下文">
      <div className="assistant-pending-workflow-heading">
        <Badge label="待补充" variant="neutral" />
        <span>{context.title}</span>
      </div>
      {inputLabels ? (
        <div className="assistant-pending-workflow-inputs">
          当前需要补充：{inputLabels}
        </div>
      ) : null}
      {visibleActions.length ? (
        <div className="assistant-pending-workflow-actions">
          {visibleActions.map((action) => (
            <Button
              key={action.actionId}
              label={action.label}
              size="sm"
              variant={action.primary ? "primary" : "secondary"}
              onClick={() => onAction?.(action)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
