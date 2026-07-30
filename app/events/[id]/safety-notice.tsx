// DEC-010: a static, unconditional notice, present regardless of any detected
// signal or severity — it must never read as a signal of how serious this
// particular event is. Real text in the document flow, not title-only and not
// colour-only, matching the existing amber-notice pattern used elsewhere.
export function SafetyNotice() {
  return (
    <p className="rounded-md border border-amber-600/40 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      KinCall is not an emergency service and does not contact emergency services. If someone may
      be in immediate danger, contact your local emergency number directly.
    </p>
  );
}
