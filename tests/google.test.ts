import { describe, expect, it } from "vitest";
import {
  googleConfigFromEnv,
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

describe("Google environment config", () => {
  it("requires a finite timeout of at least one second", () => {
    expect(() =>
      googleConfigFromEnv({
        GOOGLE_DRIVE_FOLDER_ID: "folder",
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "service@example.test",
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "private-key",
        GOOGLE_TIMEOUT_MS: "999"
      })
    ).toThrow("GOOGLE_TIMEOUT_MS");

    expect(
      googleConfigFromEnv({
        GOOGLE_DRIVE_FOLDER_ID: "folder",
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "service@example.test",
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "private-key",
        GOOGLE_TIMEOUT_MS: "12000"
      })
    ).toMatchObject({ timeoutMs: 12000 });
  });
});
