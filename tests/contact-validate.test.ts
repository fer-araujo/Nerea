import { describe, expect, it } from "vitest";
import { validateContactInput } from "@/lib/contact/validate";

describe("validateContactInput — happy path", () => {
  it("accepts a well-formed submission and trims every field", () => {
    const result = validateContactInput({
      name: "  Ana  ",
      email: "  ana@example.com  ",
      message: "  Hola, me interesa una pieza.  ",
    });

    expect(result).toEqual({
      name: "Ana",
      email: "ana@example.com",
      message: "Hola, me interesa una pieza.",
    });
  });
});

describe("validateContactInput — type checks", () => {
  it("rejects non-string fields (e.g. a Server Action invoked directly with the wrong shape)", () => {
    expect(
      validateContactInput({ name: 123, email: "a@b.com", message: "hi" }),
    ).toBeNull();
    expect(
      validateContactInput({ name: "Ana", email: { toString: () => "a@b.com" }, message: "hi" }),
    ).toBeNull();
  });
});

describe("validateContactInput — name", () => {
  it("rejects an empty name after trimming", () => {
    expect(
      validateContactInput({ name: "   ", email: "a@b.com", message: "hi" }),
    ).toBeNull();
  });

  it("rejects a name longer than 80 characters", () => {
    expect(
      validateContactInput({ name: "a".repeat(81), email: "a@b.com", message: "hi" }),
    ).toBeNull();
  });

  it("accepts a name at exactly the 80 character boundary", () => {
    expect(
      validateContactInput({ name: "a".repeat(80), email: "a@b.com", message: "hi" }),
    ).not.toBeNull();
  });
});

describe("validateContactInput — email", () => {
  it("rejects a malformed email", () => {
    expect(
      validateContactInput({ name: "Ana", email: "not-an-email", message: "hi" }),
    ).toBeNull();
    expect(
      validateContactInput({ name: "Ana", email: "missing-domain@", message: "hi" }),
    ).toBeNull();
  });

  it("rejects an email longer than 160 characters", () => {
    const tooLongEmail = `${"a".repeat(155)}@b.com`; // 161 chars, still email-shaped
    expect(tooLongEmail).toHaveLength(161);
    expect(
      validateContactInput({ name: "Ana", email: tooLongEmail, message: "hi" }),
    ).toBeNull();
  });
});

describe("validateContactInput — message", () => {
  it("rejects an empty message after trimming", () => {
    expect(
      validateContactInput({ name: "Ana", email: "a@b.com", message: "   " }),
    ).toBeNull();
  });

  it("rejects a message longer than 2000 characters", () => {
    expect(
      validateContactInput({ name: "Ana", email: "a@b.com", message: "a".repeat(2001) }),
    ).toBeNull();
  });

  it("accepts a message at exactly the 2000 character boundary", () => {
    expect(
      validateContactInput({ name: "Ana", email: "a@b.com", message: "a".repeat(2000) }),
    ).not.toBeNull();
  });
});
