import { InMemoryRepository } from "@/backend/persistence/in-memory-repository";
import { seedRepository } from "@/backend/persistence/seed";
import type { Repository } from "@/backend/persistence/repository";
import { repositoryContract } from "./repository-contract";

const LEASE_SECONDS = 90;

// A controllable clock, so lease expiry is testable without waiting 90 real
// seconds and without vi.useFakeTimers() leaking into unrelated assertions.
let clockOffsetMs = 0;
const now = () => Date.now() + clockOffsetMs;

// The two instances share one backing store, which is what makes `reopen()`
// mean "a second process over the same data" rather than "a blank slate".
let sharedStore: ReturnType<InMemoryRepository["getStore"]>;

repositoryContract("InMemoryRepository", {
  leaseSeconds: LEASE_SECONDS,
  async make() {
    clockOffsetMs = 0;
    const repository = new InMemoryRepository({ now });
    seedRepository(repository);
    sharedStore = repository.getStore();
    return repository;
  },
  async reopen(): Promise<Repository> {
    return new InMemoryRepository({ store: sharedStore, now });
  },
  async advance(seconds: number) {
    clockOffsetMs += seconds * 1000;
  },
});
