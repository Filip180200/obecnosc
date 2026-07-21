import { describe, expect, it } from "vitest";
import {
  googleDriveListOptions,
  parseGoogleSessionHeader
} from "../src/google.js";

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
describe("Google Drive listing options", () => {
  it("uses a Shared Drive corpus when driveId is available", () => {
    expect(googleDriveListOptions("shared-drive-123")).toEqual({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "drive",
      driveId: "shared-drive-123"
    });
  });

  it("keeps My Drive support without forcing a drive corpus", () => {
    expect(googleDriveListOptions()).toEqual({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
  });
});
