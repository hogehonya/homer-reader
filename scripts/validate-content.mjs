import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContent } from "../src/content-validation.ts";

const dataDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../public/data");

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
