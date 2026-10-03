// Class strings shared by the admin modules' forms and tables, so the panel
// keeps one visual language: hairlines instead of shadows, mono uppercase
// labels, the storefront's bone / ink / graphite / brass tokens, and a 44px
// minimum touch target on every control (down to 360px phones).

export const LABEL_CLASS =
  "font-mono text-[11px] uppercase tracking-[0.14em] text-graphite";

export const FIELD_CLASS = "flex flex-col gap-2";

export const INPUT_CLASS =
  "min-h-11 w-full rounded-none border border-line bg-bone-raised px-4 py-3 font-sans text-sm text-ink placeholder:text-graphite/60 disabled:cursor-not-allowed disabled:opacity-60";

// Native select arrow kept on purpose (no appearance-none): it is the only
// cue that the control opens a list.
export const SELECT_CLASS =
  "min-h-11 w-full rounded-none border border-line bg-bone-raised px-3 py-3 font-sans text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60";

export const PRIMARY_BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center border border-ink bg-ink px-7 py-3.5 font-sans text-sm text-bone transition-colors duration-200 hover:border-brass-deep hover:bg-brass-deep disabled:cursor-not-allowed disabled:opacity-60";

export const QUIET_BUTTON_CLASS =
  "min-h-11 font-sans text-sm text-graphite underline decoration-line underline-offset-4 transition-colors hover:text-brass-deep disabled:cursor-not-allowed disabled:opacity-60";

export const LINK_CLASS =
  "inline-flex min-h-11 items-center gap-2 font-sans text-sm text-ink underline decoration-brass underline-offset-4 transition-colors hover:text-brass-deep";

export const PANEL_CLASS = "border border-line bg-bone-raised p-5 sm:p-6";

export const NOTICE_ERROR_CLASS =
  "border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink";

export const NOTICE_INFO_CLASS =
  "border border-line bg-bone-raised px-4 py-3 font-mono text-xs leading-relaxed text-ink";

/** Figures: mono, with digits that line up in a column. */
export const NUMBER_CLASS = "font-mono tabular-nums";
