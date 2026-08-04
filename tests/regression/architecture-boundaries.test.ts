import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Structural guards for the frontend / backend / shared split.
//
// These are deliberately a plain source scan rather than an architecture
// framework: the rules are few and stable, and a dependency added purely to
// assert them would cost more than it protects.
//
// RUNTIME COUPLING ONLY. `import type` is erased by the compiler and creates no
// runtime edge, so a type-only import across a boundary is not a violation —
// `shared/domain/types.ts` naming an `AgentType` declared next to the CALL-E
// adapter is a vocabulary reference, not a dependency. Every rule below
// therefore ignores `import type` and `export type` lines.

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  const absolute = path.join(ROOT, dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  try {
    walk(absolute);
  } catch {
    return [];
  }
  return out;
}

function read(file: string): string {
  return readFileSync(file, "utf-8");
}

// Import specifiers that carry a real runtime edge: `import type` and
// `export type` are stripped out before matching.
function runtimeImports(source: string): string[] {
  const withoutTypeOnly = source
    .split("\n")
    .filter((line) => !/^\s*(import|export)\s+type\s/.test(line))
    .join("\n");
  return [...withoutTypeOnly.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
}

function relative(file: string): string {
  return path.relative(ROOT, file);
}

describe("shared/ is runtime-neutral", () => {
  it("never imports from app/, frontend/ or backend/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("shared")) {
      for (const spec of runtimeImports(read(file))) {
        if (/^@\/(app|frontend|backend)\//.test(spec)) {
          offenders.push(`${relative(file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("backend/ does not depend on the user interface", () => {
  it("never imports from frontend/ or app/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("backend")) {
      for (const spec of runtimeImports(read(file))) {
        if (/^@\/(frontend|app)\//.test(spec)) {
          offenders.push(`${relative(file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("client components never reach server-only code", () => {
  it("no \"use client\" file imports from backend/", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("frontend")]) {
      const source = read(file);
      if (!/^\s*["']use client["']/m.test(source)) continue;
      for (const spec of runtimeImports(source)) {
        if (spec.startsWith("@/backend/")) {
          offenders.push(`${relative(file)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no \"use client\" file imports the Supabase or CALL-E clients", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("frontend")]) {
      const source = read(file);
      if (!/^\s*["']use client["']/m.test(source)) continue;
      if (/@supabase\/supabase-js|server-only/.test(source)) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("API routes stay thin", () => {
  // A route handler may CALL a backend use case; it must not construct the
  // Supabase or CALL-E client itself, which is what would let orchestration or
  // persistence logic drift into the routing layer.
  it("never instantiate a Supabase or CALL-E client directly", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("app/api")) {
      const source = read(file);
      if (/createClient\s*\(/.test(source) || /new\s+LiveCalleAdapter\s*\(/.test(source)) {
        offenders.push(relative(file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("no import survives from the pre-reorganization layout", () => {
  it("nothing references @/lib, @/prompts or @/app/ui", () => {
    const offenders: string[] = [];
    const roots = ["app", "frontend", "backend", "shared", "tests", "scripts"];
    // This file necessarily contains the very strings it forbids, so it is the
    // one file excluded from its own scan.
    const self = path.join(ROOT, "tests/regression/architecture-boundaries.test.ts");
    for (const file of roots.flatMap(sourceFiles)) {
      if (file === self) continue;
      const source = read(file);
      for (const stale of ["@/lib/", "@/prompts/", "@/app/ui/"]) {
        if (source.includes(stale)) offenders.push(`${relative(file)} -> ${stale}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("README stays consistent with the repository", () => {
  it("every local link and image path resolves", () => {
    const readme = readFileSync(path.join(ROOT, "README.md"), "utf-8");
    const targets = [
      ...[...readme.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map((m) => m[1]),
      ...[...readme.matchAll(/src="\.\/([^"]+)"/g)].map((m) => m[1]),
    ];
    const missing = targets
      .map((t) => t.split("#")[0])
      .filter((t) => t.length > 0)
      .filter((t) => {
        try {
          statSync(path.join(ROOT, t.replace(/^\.\//, "")));
          return false;
        } catch {
          return true;
        }
      });
    expect(missing).toEqual([]);
  });
});
