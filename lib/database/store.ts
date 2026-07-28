import { InMemoryRepository } from "./in-memory-repository";
import { seedRepository } from "./seed";

declare global {
  var __kincallRepository: InMemoryRepository | undefined;
}

function createSeededRepository(): InMemoryRepository {
  const repository = new InMemoryRepository();
  seedRepository(repository);
  return repository;
}

// Cached on globalThis so Next.js dev-server hot-module-reload doesn't
// silently reset in-memory demo state mid-session.
export function getRepository(): InMemoryRepository {
  if (!globalThis.__kincallRepository) {
    globalThis.__kincallRepository = createSeededRepository();
  }
  return globalThis.__kincallRepository;
}
