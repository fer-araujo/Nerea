// Small hand-rolled validator — no schema-validation library dependency for
// three fields. Every check runs on the TRIMMED value; the returned object
// carries the normalized (trimmed) strings, so lib/contact/submit.ts never
// stores untrimmed input. Returns `null` on any failure — the caller (
// submitContact) maps that to a single generic "validation" error, so this
// module never needs to describe *which* field failed: no per-field detail
// is returned that could help an attacker fuzz the form, and no raw input is
// ever echoed back.
export interface ContactInput {
  name: string;
  email: string;
  message: string;
}

export interface RawContactInput {
  name: unknown;
  email: unknown;
  message: unknown;
}

const NAME_MAX_LENGTH = 80;
const EMAIL_MAX_LENGTH = 160;
const MESSAGE_MAX_LENGTH = 2000;

// Pragmatic "shaped like an email" check (one @, a dot somewhere after it,
// no whitespace) — intentionally not a full RFC 5322 implementation, which
// is unnecessary here and notoriously easy to get subtly wrong.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateContactInput(
  input: RawContactInput,
): ContactInput | null {
  if (
    typeof input.name !== "string" ||
    typeof input.email !== "string" ||
    typeof input.message !== "string"
  ) {
    return null;
  }

  const name = input.name.trim();
  const email = input.email.trim();
  const message = input.message.trim();

  if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
    return null;
  }
  if (
    email.length < 1 ||
    email.length > EMAIL_MAX_LENGTH ||
    !EMAIL_PATTERN.test(email)
  ) {
    return null;
  }
  if (message.length < 1 || message.length > MESSAGE_MAX_LENGTH) {
    return null;
  }

  return { name, email, message };
}
