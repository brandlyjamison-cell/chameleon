import { describe, expect, it } from "vitest";
import {
  buildCapture,
  CaptureRowSchema,
  EngineCaptureSchema,
  parseCredentialFields,
} from "../src/capture.js";

describe("capture shape (INV-CAP-03)", () => {
  it("keeps the engine's kind when the client posts another", () => {
    const cap = buildCapture({
      engineKind: "credential",
      fields: { username: "jane@netflix.com", password: "hunter2" },
      clientKind: "session",
    });
    expect(cap.kind).toBe("credential");
  });

  it("accepts aitm kinds through the same builder unchanged", () => {
    const cap = buildCapture({
      engineKind: "session",
      fields: { jar: "r2://x" },
      clientKind: "credential",
    });
    expect(cap.kind).toBe("session");
  });

  it("rejects an empty field set", () => {
    expect(() => EngineCaptureSchema.parse({ kind: "credential", fields: {} })).toThrow();
  });
});

describe("credential fields", () => {
  it("trims the username", () => {
    expect(
      parseCredentialFields({ username: "  a@b.co  ", password: "x" }).username,
    ).toBe("a@b.co");
  });

  it("rejects an empty password", () => {
    expect(() => parseCredentialFields({ username: "a@b.co", password: "" })).toThrow();
  });

  it("caps the password at 1024 and the username at 320", () => {
    expect(() =>
      parseCredentialFields({ username: "a", password: "x".repeat(1025) }),
    ).toThrow();
    expect(() =>
      parseCredentialFields({ username: "a".repeat(321), password: "x" }),
    ).toThrow();
  });
});

describe("stored row", () => {
  it("has no dedicated password column and requires source", () => {
    const base = {
      id: "0192f0a0-0000-7000-8000-000000000000",
      orgId: "0192f0a0-0000-7000-8000-000000000001",
      serviceId: "0192f0a0-0000-7000-8000-000000000002",
      linkId: "0192f0a0-0000-7000-8000-000000000003",
      kind: "credential",
      status: "new",
      payloadRef: null,
      receivedAt: "2026-11-20T12:00:00.000Z",
    };
    expect(CaptureRowSchema.parse({ ...base, source: "human" }).source).toBe("human");
    expect(() => CaptureRowSchema.parse(base)).toThrow();
  });
});
