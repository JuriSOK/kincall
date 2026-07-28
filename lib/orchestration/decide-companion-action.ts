import type { NormalizedCompanionResult } from "../calle/schemas";
import type { OrchestrationDecision, Priority } from "./states";

export interface CompanionDecisionResult {
  decision: OrchestrationDecision;
  priority: Priority;
  reason: string;
}

// Implements PRODUCT_SPECIFICATION.md §9.2's simplified rule verbatim.
// Assumes an already-normalized, well-formed result — malformed-result
// handling happens before this function is called.
export function decideCompanionAction(
  result: NormalizedCompanionResult
): CompanionDecisionResult {
  if (result.fallMentioned === "yes" && result.mobilityDifficulty === "yes") {
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      priority: "high",
      reason: "Fall mentioned with mobility difficulty.",
    };
  }

  if (result.fallMentioned === "yes") {
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      priority: "medium",
      reason: "Fall mentioned without current mobility difficulty.",
    };
  }

  return {
    decision: "LOG_AND_CLOSE",
    priority: "low",
    reason: "No unusual signal detected.",
  };
}
