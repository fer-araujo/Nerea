// Minimal className joiner — no runtime dependency. Filters falsy values so
// callers can write `cn("base", cond && "variant", className)` without pulling
// in clsx/tailwind-merge for the storefront's small, non-conflicting classes.
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
