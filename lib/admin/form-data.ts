// Reading FormData without trusting it. `FormData.get()` can return a File as
// well as a string, and a request can omit any field, so every field is read
// as `string | undefined`: a File or a missing value is simply "not provided",
// and the zod schema decides whether that is acceptable.

export function formText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/** Every value of a repeated field (one per row), in document order. */
export function formTexts(
  formData: FormData,
  name: string,
): Array<string | undefined> {
  return formData
    .getAll(name)
    .map((value) => (typeof value === "string" ? value : undefined));
}
