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
  // Checked first (DEC-003): with no conversation there is nothing to read
  // signals from, so a reported signal here would not be trustworthy. §9.2
  // requires a retry on an unanswered call, never a close.
  if (result.personReached === "no") {
    return {
      decision: "RETRY_CHECK_IN",
      priority: "low",
      reason: "The check-in call did not reach the person.",
    };
  }

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

  // Below the escalation rules on purpose: uncertainty about who was on the
  // line must never weaken an escalation that concerning signals justify.
  if (result.personReached === "unknown") {
    return {
      decision: "REQUEST_HUMAN_REVIEW",
      priority: "medium",
      reason: "Unable to confirm the check-in reached the person.",
    };
  }

  return {
    decision: "LOG_AND_CLOSE",
    priority: "low",
    reason: "No unusual signal detected.",
  };
}
