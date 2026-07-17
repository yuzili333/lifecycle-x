import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import type { AgentGuidance, AgentGuidanceAction, MissingInputCandidate } from "../../../../main/agentGuidance";

export type AgentGuidanceCardProps = {
  guidance: AgentGuidance;
  onAction?: (action: AgentGuidanceAction) => void;
  onCandidateSelect?: (candidate: MissingInputCandidate) => void;
};

export function AgentGuidanceCard({ guidance, onAction, onCandidateSelect }: AgentGuidanceCardProps) {
  const showActions = guidance.type !== "parameter_request" && guidance.actions.length > 0;
  return (
    <article className={`assistant-guidance-card ${guidance.type} ${guidance.blocking ? "blocking" : ""}`} aria-label={guidance.title}>
      <div className="assistant-guidance-card-heading">
        <div>
          <Text type="label" color="primary">{guidance.title}</Text>
          <Text type="body" color="secondary">{guidance.blocking ? "等待用户补充" : "可继续操作"}</Text>
        </div>
        {guidance.resumeToken && <Badge label="可恢复" variant="neutral" />}
      </div>
      <div className="assistant-guidance-card-message">{guidance.message}</div>
      {guidance.requiredInputs?.length ? (
        <div className="assistant-guidance-section">
          <Text type="label" color="primary">需要补充</Text>
          <div className="assistant-guidance-list">
            {guidance.requiredInputs.map((input) => (
              <div key={input.key} className="assistant-guidance-input">
                <span>{input.label}</span>
                <small>{input.description}</small>
                {input.candidates?.length ? (
                  <div className="assistant-guidance-candidates">
                    {input.candidates.map((candidate) => (
                      <button
                        type="button"
                        key={`${input.key}-${candidate.value}`}
                        className="assistant-guidance-candidate"
                        onClick={() => onCandidateSelect?.(candidate)}
                      >
                        {candidate.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {showActions ? (
        <div className="assistant-guidance-actions">
          {guidance.actions.map((action) => (
            <Button
              key={action.actionId}
              label={action.label}
              size="sm"
              variant={action.destructive ? "ghost" : action.primary ? "primary" : "secondary"}
              onClick={() => onAction?.(action)}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

export const MissingParameterCard = AgentGuidanceCard;
export const WorkflowRecoveryCard = AgentGuidanceCard;
export const NextActionCard = AgentGuidanceCard;
