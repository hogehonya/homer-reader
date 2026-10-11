import { describe, expect, it } from "vitest";
import { dataRootFromBaseUrl } from "./data-root";

describe("data root from Vite base URL", () => {
  it("keeps root-hosted data paths at the origin root", () => {
    expect(dataRootFromBaseUrl("/")).toBe("");
  });

  it("keeps the repository prefix for GitHub Pages assets", () => {
    expect(dataRootFromBaseUrl("/homer-reader/")).toBe("/homer-reader");
  });
});
