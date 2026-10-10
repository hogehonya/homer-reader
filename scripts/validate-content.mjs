import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent } from "../src/content-validation.ts";

const dataDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../public/data");

if (process.argv.includes("--if-present") && !(await containsContentArtifact(dataDirectory))) {
  console.log("CONTENT_SKIPPED: public/data has no content artifacts yet");
  process.exit(0);
}

try {
  const summary = await validateContent(async (relativePath) => {
    const absolutePath = resolve(dataDirectory, relativePath);
    if (!absolutePath.startsWith(`${dataDirectory}/`)) throw new Error("data path escapes public/data");
    return JSON.parse(await readFile(absolutePath, "utf8"));
  });
  console.log(`CONTENT_VALID: ${summary.workCount} works, ${summary.bookCount} books, ${summary.unitCount} translation units`);
} catch (error) {
  console.error(`CONTENT_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function containsContentArtifact(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() || entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && await containsContentArtifact(resolve(directory, entry.name))) return true;
  }
  return false;
}
