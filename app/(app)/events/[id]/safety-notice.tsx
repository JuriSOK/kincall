import { Notice } from "@/frontend/design-system/surfaces";

// DEC-010: a static, unconditional notice, present regardless of any detected
// signal or severity — it must never read as a signal of how serious this
// particular event is. Real text in the document flow, not title-only and not
// colour-only.
//
// Rendered through the shared Notice at the "attention" tone rather than the
// "unresolved" one, deliberately: this text is identical on every event, so
// giving it the tone reserved for ATTENTION_UNRESOLVED would make every event
// look like that outcome.
export function SafetyNotice() {
  return (
    <Notice tone="attention">
      KinCall is not an emergency service and does not contact emergency services. If someone may
      be in immediate danger, contact your local emergency number directly.
    </Notice>
  );
}
