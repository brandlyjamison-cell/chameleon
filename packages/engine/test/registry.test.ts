import { describe, expect, it } from "vitest";
import { chameleon, engineFor, registeredCodes } from "../src/index.js";

describe("engine registry (INV-ARCH-02)", () => {
  it("resolves a registered type", () => {
    expect(engineFor("chameleon")).toBe(chameleon);
  });

  it("throws for an unregistered type", () => {
    // `aitm` is a registry row with no engine until later.
    expect(() => engineFor("aitm")).toThrow(/no engine/);
  });
});

describe("chameleon capture contract (INV-CAP-03, INV-CAP-04)", () => {
  it("may only ever emit credential", () => {
    expect(chameleon.captureKinds).toEqual(["credential"]);
    expect(chameleon.defaultKind).toBe("credential");
  });

  it("parses a submitted password into a credential capture", () => {
    const cap = chameleon.parseCapture(
      { email: "jane@netflix.com", password: "hunter2" },
      null,
    );
    expect(cap.kind).toBe("credential");
    expect(cap.fields).toMatchObject({
      username: "jane@netflix.com",
      password: "hunter2",
    });
  });

  it("renders no one-time-code input on either step", async () => {
    const t = await chameleon.resolve({} as never);
    const oneStep = await chameleon.render(t);
    const stepOne = await chameleon.render({ ...t, stepCount: 2, step: 1 });
    const stepTwo = await chameleon.render({ ...t, stepCount: 2, step: 2 });
    for (const html of [oneStep, stepOne, stepTwo]) {
      expect(html).not.toContain("one-time-code");
    }
    expect(oneStep).toContain('type="password"');
    expect(stepOne).toContain('type="email"');
    expect(stepOne).not.toContain('type="password"');
  });

  it("renders a two-step password screen with no visible email field", async () => {
    const t = await chameleon.resolve({} as never);
    const html = await chameleon.render({
      ...t,
      stepCount: 2,
      step: 2,
      prefilledEmail: "a@b.co",
    });
    expect(html).toContain('name="password"');
    expect(html).toContain('type="hidden" name="email"');
    expect(html).not.toContain('type="email"');
  });
});

describe("registry surface", () => {
  it("lists chameleon only at stage 1", () => {
    expect(registeredCodes()).toEqual(["chameleon"]);
  });
});
