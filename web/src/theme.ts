type RGB = [number, number, number];

function parse(hex: string | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;

function luminance(c: RGB) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [20, 19, 18];

/**
 * The model picks the palette, so it cannot be trusted to be readable.
 * Pictures are blended with "multiply", which only works on a light page,
 * so the background is pulled towards white and the other two colours are
 * pushed until they contrast with it.
 */
export function safeTheme(h: { bg?: string; ink?: string; accent?: string }) {
  let bg = parse(h.bg, [244, 241, 236]);
  for (let i = 0; i < 12 && luminance(bg) < 0.8; i++) bg = mix(bg, WHITE, 0.25);
  let ink = parse(h.ink, BLACK);
  for (let i = 0; i < 12 && contrast(ink, bg) < 9; i++) ink = mix(ink, BLACK, 0.3);
  let accent = parse(h.accent, [47, 74, 138]);
  for (let i = 0; i < 12 && contrast(accent, bg) < 3.2; i++) accent = mix(accent, BLACK, 0.15);
  const onAccent = contrast(accent, WHITE) >= 3 ? "#ffffff" : toHex(BLACK);
  return { bg: toHex(bg), ink: toHex(ink), accent: toHex(accent), onAccent };
}

/** Text colour that stays readable on an arbitrary swatch. */
export function inkOn(hex: string) {
  return luminance(parse(hex, WHITE)) > 0.45 ? "#1a1918" : "#ffffff";
}

export function validHex(hex: unknown): hex is string {
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex.trim());
}
