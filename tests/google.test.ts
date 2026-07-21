import { describe, expect, it } from "vitest";
import { parseGoogleSessionHeader } from "../src/google.js";

describe("Google session header", () => {
  it("parses DD.MM.RRRR GG:MM", () => {
    const value = parseGoogleSessionHeader("05.10.2026 08:00");
    expect(value).not.toBeNull();
  });

  it("rejects invalid labels", () => {
    expect(parseGoogleSessionHeader("2026-10-05")).toBeNull();
    expect(parseGoogleSessionHeader("32.10.2026 08:00")).toBeNull();
  });
});
