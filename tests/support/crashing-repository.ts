import type { Repository } from "@/lib/database/repository";

export class InjectedCrash extends Error {
  constructor(method: string) {
    super(`Injected crash at ${method}`);
    this.name = "InjectedCrash";
  }
}

export type RepositoryMethod = keyof Repository;

// Wraps any Repository and throws at a named method, simulating a Vercel
// function being killed mid-branch. The write that was in flight is NOT
// applied, exactly as a real kill would leave it.
//
// `after` skips N successful calls first, so a crash can be aimed at (say) the
// second commitTransition of a cascade rather than the first.
export function crashingRepository(
  inner: Repository,
  plan: { method: RepositoryMethod; after?: number }
): Repository {
  let seen = 0;
  const skip = plan.after ?? 0;

  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || property !== plan.method) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        if (seen >= skip) throw new InjectedCrash(String(property));
        seen += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as Repository;
}

// Crashes *after* the wrapped method succeeds, so the write IS applied and the
// process then dies — the window this design's atomicity claims are about.
export function crashingAfterRepository(
  inner: Repository,
  plan: { method: RepositoryMethod; after?: number }
): Repository {
  let seen = 0;
  const skip = plan.after ?? 0;

  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || property !== plan.method) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const result = await (value as (...a: unknown[]) => unknown).apply(target, args);
        if (seen >= skip) throw new InjectedCrash(String(property));
        seen += 1;
        return result;
      };
    },
  }) as Repository;
}
