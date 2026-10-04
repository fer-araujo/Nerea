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

// The admin's tab rows (the section tabs in AdminNav, the period tabs in
// PeriodNav). A row scrolls sideways on a phone instead of wrapping, so it
// needs `overflow-x: auto`, and that is where the trap is: with `overflow-x`
// set and `overflow-y` left at its default, the browser computes `overflow-y:
// auto` as well, so ANY vertical overflow, even one pixel, grows a vertical
// scrollbar (the tiny up/dot/down one on desktop Windows). So the row pins
// `overflow-y: hidden` and hides its own scrollbar (it still scrolls by touch,
// trackpad and keyboard focus). When the tabs fit nothing overflows at all.
export const TAB_ROW_CLASS =
  "flex gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

// One tab. Its 2px underline sits INSIDE the link's own box (no negative margin
// pulling it out of the row, which is what used to overflow), and its focus
// ring is drawn inside the box too (`-outline-offset-2`): a scrolling row clips
// whatever sticks out of it, so the global outset ring (globals.css) would be
// cut off at the top and bottom. The trailing `!` is needed because that global
// `:focus-visible` rule is unlayered CSS, which beats any Tailwind utility.
export const TAB_LINK_CLASS =
  "inline-flex min-h-11 shrink-0 items-center border-b-2 font-sans text-sm transition-colors focus-visible:-outline-offset-2!";

export const TAB_LINK_ACTIVE_CLASS = "border-brass text-ink";

export const TAB_LINK_IDLE_CLASS =
  "border-transparent text-graphite hover:text-ink";

export const NOTICE_ERROR_CLASS =
  "border border-ink/25 bg-bone-sunk px-4 py-3 font-mono text-xs leading-relaxed text-ink";

export const NOTICE_INFO_CLASS =
  "border border-line bg-bone-raised px-4 py-3 font-mono text-xs leading-relaxed text-ink";

/** Figures: mono, with digits that line up in a column. */
export const NUMBER_CLASS = "font-mono tabular-nums";

// A small label on a row ("Manual", "Costo pendiente"): a hairline box, the
// same mono caps as the field labels. Meaning never rides on color alone — the
// words carry it — so the attention variant only darkens the border.
export const BADGE_CLASS =
  "inline-flex items-center border border-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite";

export const BADGE_ATTENTION_CLASS =
  "inline-flex items-center border border-brass-deep px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink";
