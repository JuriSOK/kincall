import Link from "next/link";
import { ButtonLink } from "@/app/ui/button";
import { KinCallMark } from "@/app/ui/kincall-mark";

// The public landing page (Stage B). Deliberately separate from the
// application shell under app/(app)/ — this page has no Nav, no profile
// data, and makes no repository call; it exists purely to explain the
// product and hand off to /dashboard. Splitting "/" from the operational
// home page this way (rather than the single combined page §14.1 of the
// frozen spec originally described) is recorded as a scope note in
// docs/DECISION_LOG.md: every element §14.1 requires is still present, just
// on /dashboard instead of "/".
//
// UI/UX cleanup pass (see docs/DECISION_LOG.md's latest entry): the icon is
// a redrawn vector mark (app/ui/kincall-mark.tsx), replacing the earlier
// raster logo — crisp at any size, themes correctly in dark mode via
// --kc-brand-blue/--kc-brand-cyan, and never needs cropping. No separate
// top-left/top-right text or CTA sits alongside it — the mark and wordmark
// alone identify the page, and the one call to action lives in the centred
// hero below.
export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-5 py-16 text-center sm:px-8 sm:py-24">
        {/* The floating animation is decorative and is neutralised entirely
            by app/ui/tokens.css's blanket prefers-reduced-motion rule — no
            separate override needed here. */}
        <div className="kc-animate-float flex flex-col items-center gap-3">
          <KinCallMark className="h-20 w-20 sm:h-24 sm:w-24" />
          <span className="text-2xl font-semibold tracking-tight text-brand-blue sm:text-3xl">
            KinCall
          </span>
        </div>

        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          A familiar phone call, watching over the people you love.
        </h1>
        <p className="max-w-xl text-balance text-base text-muted sm:text-lg">
          KinCall is a multi-agent phone care coordinator that checks in on vulnerable people and
          automatically coordinates their trusted contacts when something seems wrong.
        </p>
        <ButtonLink href="/dashboard" variant="primary" size="md" className="mt-2 px-6 py-3 text-base">
          Get started
        </ButtonLink>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-5 pb-16 sm:grid-cols-3 sm:px-8">
        <InfoCard title="Regular, natural check-ins">
          KinCall calls on a familiar schedule and has an ordinary conversation — never a rigid
          questionnaire — so someone who lives alone always has a reason to talk to someone.
        </InfoCard>
        <InfoCard title="A clear, binary decision">
          After every check-in, KinCall does exactly one of two things: close it as normal, or
          contact the trusted circle. There is no in-between severity rating — it is not a
          diagnosis, only an operational choice.
        </InfoCard>
        <InfoCard title="Nobody is left unreached">
          If the person doesn't answer, or a trusted contact doesn't pick up, KinCall retries once
          and then moves on to the next person in the circle — automatically, in order, until
          someone can help.
        </InfoCard>
      </section>

      <section className="border-t border-line bg-sunken">
        <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 py-16 sm:px-8">
          <h2 className="text-center text-xl font-semibold tracking-tight sm:text-2xl">
            How it works
          </h2>
          <ol className="grid gap-6 sm:grid-cols-4">
            <Step number={1} title="KinCall calls">
              A companion agent calls at the scheduled time and has a natural conversation.
            </Step>
            <Step number={2} title="It listens for what matters">
              A fall, a request for help, distress, or anything else unusual — not a checklist of
              symptoms.
            </Step>
            <Step number={3} title="It decides, once">
              Nothing unusual: the check-in simply closes. Something worth a second look: the
              trusted circle is contacted.
            </Step>
            <Step number={4} title="Someone takes over">
              The circle is called in order until someone confirms they'll help — and everything is
              recorded on the dashboard.
            </Step>
          </ol>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-8 text-center text-xs text-subtle sm:px-8">
        <p>
          A demo mode is available for evaluation, with no real calls placed — see{" "}
          <Link href="/dashboard" className="text-accent hover:underline">
            the dashboard
          </Link>{" "}
          for details on any profile.
        </p>
      </footer>
    </main>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-kc border border-line bg-surface p-5 shadow-kc-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-kc-full bg-accent-soft text-xs font-semibold text-accent">
        {number}
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-sm text-muted">{children}</p>
    </li>
  );
}
