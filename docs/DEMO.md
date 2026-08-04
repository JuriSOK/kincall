# KinCall — Demo walkthrough

## Objective

Show that KinCall turns one phone conversation into a coordinated, confirmed human
response — and that the decision to escalate is made by explicit rules, not by the
voice agent's judgement.

---

## The story

Claire lives alone. During a routine check-in she mentions, in passing, that she would
like help completing an administrative document. She has not fallen, she is not in pain,
and she does not ask anyone to be alarmed.

That single sentence is enough for KinCall to act — and specific enough that her family
knows exactly what she needs before they pick up.

---

## Expected call order

| # | Call | Who plays it | What happens |
|---|---|---|---|
| 1 | **Companion Agent** → Claire | The monitored person | Claire mentions she needs help with an administrative document |
| 2 | **Family Agent** → Julie | First trusted contact | Julie understands, but cannot help today |
| 3 | **Family Agent** → Marc | Second trusted contact | Marc confirms he will visit this afternoon |
| 4 | **Notification Agent** → Claire | The monitored person | Claire is told Marc is coming, and when |

The event then reaches `CASE_CLOSED`.

If nobody confirms, the cascade continues to the end of the circle, call 4 still happens
with the unresolved message, and the event reaches `ATTENTION_UNRESOLVED` instead.

---

## What to notice

1. **The escalation is not the agent's decision.** Claire said nothing alarming and the
   agent flagged no attention. She *asked for help*, and that single fact overrides the
   model's own assessment — a rule in
   [`backend/orchestration/decision-tree.ts`](../backend/orchestration/decision-tree.ts).

2. **The context survives the handoff.** Julie and Marc are not told "Claire needs help."
   They are told she would like help completing an administrative document — her own
   reported words, carried through unchanged to every contact in the circle.

3. **It generalizes.** Nothing about administrative documents is hardcoded. A broken
   boiler or a lost set of keys propagates through the identical path.

4. **The cascade stops on commitment, not on contact.** Julie answering is not enough;
   only an explicit "yes, I can help" ends it.

5. **The loop is closed.** Claire is called back and told who is coming. She is never
   told she is safe, and never told the visit already happened — only what was promised.

6. **Nothing is asserted that was not established.** A commitment is recorded as a
   commitment; KinCall never claims to have verified that it took place.

---

## Success criteria

- The check-in call completes and returns a structured result.
- The decision engine reaches "contact the trusted circle" from the explicit help request.
- Julie is called before Marc, in configured priority order.
- The specific context reaches both Julie and Marc, identically.
- Marc's confirmation stops the cascade — no further contact is called.
- Claire receives exactly one callback naming Marc and the visit.
- The event reaches a terminal status and the dashboard shows the full timeline.

---

## Known limitations

- **Not an emergency service.** KinCall never contacts emergency services, and says so if
  asked.
- **No diagnosis.** The decision is operational and binary: close the check-in, or contact
  the circle.
- **A commitment is not a verified action.** KinCall cannot know whether the visit
  happened.
- **No automatic scheduler yet.** Check-ins are started from a profile page.
- **Voicemail cannot be reliably detected**, so KinCall never claims a message was left.
- **Call latency is external.** The delay before the phone rings belongs to the provider
  and carrier.

---

## Before running a live demo

Live calls reach real phones. Only ever dial a consenting participant on a number
configured for the demo, and keep the trusted circle pointed at the same controlled
number. No phone number, key or participant detail belongs in this repository.
