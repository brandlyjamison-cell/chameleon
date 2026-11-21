import { describe, expect, it } from "vitest";
import {
  NOT_FOUND_ALLOWED_HEADERS,
  NOT_FOUND_BODY,
  NOT_FOUND_HEADERS,
  notFoundResponse,
} from "../src/not-found";

describe("the unbranded 404 (INV-EDGE-04, INV-EDGE-05)", () => {
  it("is byte-exact and 65 bytes", () => {
    expect(NOT_FOUND_BODY).toBe(
      "<!doctype html><title>Not Found</title>404 This link has expired.",
    );
    expect(new TextEncoder().encode(NOT_FOUND_BODY)).toHaveLength(65);
    expect(NOT_FOUND_HEADERS["content-length"]).toBe("65");
  });

  it("carries no branding marker a scanner could fingerprint", () => {
    for (const marker of [
      "chameleon",
      "logo",
      "footer",
      "contact",
      "Powered",
      "cloudflare",
    ]) {
      expect(NOT_FOUND_BODY.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  });

  it("returns status 404", () => {
    expect(notFoundResponse().status).toBe(404);
  });

  it("emits only allowed headers and no cookie", () => {
    const res = notFoundResponse();
    const names = [...res.headers.keys()].sort();
    for (const name of names) {
      expect(NOT_FOUND_ALLOWED_HEADERS).toContain(name);
    }
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(names).toEqual([
      "cache-control",
      "content-length",
      "content-type",
      "x-robots-tag",
    ]);
  });

  it("allows retry-after only when explicitly passed", () => {
    expect(notFoundResponse().headers.has("retry-after")).toBe(false);
    expect(notFoundResponse(30).headers.get("retry-after")).toBe("30");
  });
});
