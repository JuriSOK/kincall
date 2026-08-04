import { getCalleMode } from "./adapter";
import { FAKE_SCENARIOS } from "./fake-adapter";

export interface DemoScenarioOption {
  id: string;
  label: string;
  description: string;
}

// The fake-mode demo scenario list, or `undefined` in live mode (DEC-011).
//
// `undefined` rather than an empty array on purpose: the interface renders no
// selector at all in live mode, so a real call's behaviour can never be steered
// from the UI. Its own module because it needs getCalleMode (adapter.ts), and
// adapter.ts already imports fake-adapter.ts.
export function listDemoScenarios(): DemoScenarioOption[] | undefined {
  if (getCalleMode() !== "fake") return undefined;
  return Object.entries(FAKE_SCENARIOS).map(([id, scenario]) => ({
    id,
    label: scenario.label,
    description: scenario.description,
  }));
}
