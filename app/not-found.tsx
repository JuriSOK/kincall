import { ButtonLink } from "@/frontend/design-system/button";
import { Card, PageHeader, PageShell } from "@/frontend/design-system/surfaces";

/**
 * Shown for an unmatched URL and for any `notFound()` call — which the person
 * and event pages already use for an unknown id, so this is the screen a stale
 * bookmark or an archived-then-removed link lands on.
 */
export default function NotFound() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="This page does not exist"
        lead="The link may be out of date, or the profile it pointed to may have been removed from view."
      />

      <Card>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted">
            Removed profiles and trusted contacts keep their history, so an older check-in can
            still be opened from the profile it belongs to.
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/" variant="primary">
              Back to profiles
            </ButtonLink>
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
