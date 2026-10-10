import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/validate-content.mjs");
const catalogPath = join(root, "public/data/catalog.json");

describe("content validator CLI filesystem paths", () => {
  it.skipIf(!existsSync(catalogPath))("validates the assembled public corpus from catalog dataFile paths", () => {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", script], {
      encoding: "utf8",
      cwd: root,
    });
    expect(output).toMatch(/CONTENT_VALID: 2 works, 48 books, 2140 translation units/);
  }, 30_000);

  it("fails when a catalog-referenced book file is missing", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "homer-content-cli-"));
    try {
      await mkdir(join(temporaryRoot, "scripts"), { recursive: true });
      await mkdir(join(temporaryRoot, "src"), { recursive: true });
      await mkdir(join(temporaryRoot, "public/data"), { recursive: true });
      await writeFile(join(temporaryRoot, "package.json"), JSON.stringify({ type: "module" }));
      await cp(script, join(temporaryRoot, "scripts/validate-content.mjs"));
      await cp(join(root, "src/content-validation.ts"), join(temporaryRoot, "src/content-validation.ts"));
      await cp(join(root, "src/data-contract.ts"), join(temporaryRoot, "src/data-contract.ts"));
      await writeFile(join(temporaryRoot, "public/data/catalog.json"), await readFile(catalogPath));

      try {
        execFileSync(process.execPath, ["--experimental-strip-types", join(temporaryRoot, "scripts/validate-content.mjs")], {
          encoding: "utf8",
          cwd: temporaryRoot,
          stdio: "pipe",
        });
        throw new Error("validator unexpectedly accepted a missing book file");
      } catch (error) {
        expect(error.status).toBe(1);
        expect(error.stderr).toContain("data/iliad/01.json");
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
