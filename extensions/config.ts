export const SLOGAN = "Let's build something great";
export const LOGO_INTERVAL_MS = 50;
/** Terminal columns of space to the left of the π mark. */
export const LOGO_LEFT_PAD = 1;
/** Terminal columns between the π mark and the header copy. */
export const LOGO_TEXT_GAP = 3;
/** Blank rows above and below the header block. */
export const HEADER_PAD_Y = 1;
export const CONTEXT_WARN_PERCENT = 70;
export const CONTEXT_DANGER_PERCENT = 90;
/** Cache hit rate at or above this is painted syntaxKeyword (reuse/hit). Below it is warning. */
export const CACHE_HIT_WARN_PERCENT = 70;
/** Cache hit rate below this is painted error. */
export const CACHE_HIT_DANGER_PERCENT = 30;
export const UNKNOWN = "—";
export const PROMPT_CHAR = "❯";
/** Shared left inset for the prompt glyph and the footer metrics. */
export const CHROME_LEFT_PAD = 1;
export const PROMPT_LEFT_PAD = CHROME_LEFT_PAD;
export const PROMPT_GUTTER_COLS = 2;
export const FOOTER_SEPARATOR = " · ";
export const STATUS_SEPARATOR = " · ";
/** Generation time below this is clock/batching noise, not a measurable rate. */
export const TPS_MIN_ACTIVE_MS = 200;
/** Above this, the ratio is a buffer flush, not generation. Cerebras-class is ~2–3k. */
export const TPS_MAX_PLAUSIBLE = 10_000;
/** Live footer waits until the wall clock has run this long and usage.output is known. */
export const TPS_DISPLAY_MIN_MS = 1000;
/** Live footer publishes at most this often; finish still publishes immediately. */
export const TPS_DISPLAY_INTERVAL_MS = 1000;
/** Live footer ignores integer moves smaller than this; finish still publishes. */
export const TPS_DISPLAY_HYSTERESIS = 2;
