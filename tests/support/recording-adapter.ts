import { vi } from "vitest";
import type {
  CalleAdapter,
  CallReference,
  CallResult,
  CompanionCallInput,
  FamilyCallInput,
} from "@/lib/calle/adapter";
import { FakeCalleAdapter, type FakeScenarioId } from "@/lib/calle/fake-adapter";

// FakeCalleAdapter mints a fresh random call id on every start, so it does not
// model CALL-E's Idempotency-Key contract: repeating a request under a key
// that was already used returns the ORIGINAL call rather than placing a second
// one. Recovery after a crash depends entirely on that behaviour, so the tests
// need an adapter that actually has it.
//
// `distinctCallIds` is what proves no duplicate call was placed: the spy can
// legitimately be invoked twice by a replay, but the number of real calls
// CALL-E ended up with must still be one per contact.
export class RecordingCalleAdapter implements CalleAdapter {
  readonly startCompanionCallSpy = vi.fn();
  readonly startFamilyCallSpy = vi.fn();
  readonly distinctCallIds = new Set<string>();

  private readonly inner: FakeCalleAdapter;
  private readonly byIdempotencyKey = new Map<string, string>();

  constructor(options: { scenario?: FakeScenarioId } = {}) {
    this.inner = new FakeCalleAdapter(options);
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  private async remember(key: string, place: () => Promise<CallReference>): Promise<CallReference> {
    const existing = this.byIdempotencyKey.get(key);
    if (existing) return { callId: existing, idempotencyKey: key };

    const reference = await place();
    this.byIdempotencyKey.set(key, reference.callId);
    this.distinctCallIds.add(reference.callId);
    return reference;
  }

  async startCompanionCall(input: CompanionCallInput): Promise<CallReference> {
    this.startCompanionCallSpy(input);
    return this.remember(input.idempotencyKey, () => this.inner.startCompanionCall(input));
  }

  async startFamilyCall(input: FamilyCallInput): Promise<CallReference> {
    this.startFamilyCallSpy(input);
    return this.remember(input.idempotencyKey, () => this.inner.startFamilyCall(input));
  }

  async getCallResult(callId: string): Promise<CallResult> {
    return this.inner.getCallResult(callId);
  }

  // Which contacts a family call was actually placed to, in order.
  contactsCalled(): string[] {
    return this.startFamilyCallSpy.mock.calls.map(
      (call) => (call[0] as FamilyCallInput).contact.id
    );
  }
}
