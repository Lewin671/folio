type RGB = [number, number, number];

function parse(hex: string | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

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

const DARK: RGB = [22, 20, 18];

/**
 * A scene is a full-bleed colour field, so the model's colour is used as it
 * is and only the text adapts: light on deep colours, dark on bright ones.
 * An accent that would vanish into the field falls back to the text colour.
 */
export function stageTheme(bgHex: string | undefined, accentHex: string | undefined) {
  const bg = parse(bgHex, [140, 133, 123]);
  const dark = luminance(bg) < 0.3;
  const ink = dark ? WHITE : DARK;
  let accent = parse(accentHex, ink);
  if (contrast(accent, bg) < 2.2) accent = ink;
  return { bg: toHex(bg), ink: toHex(ink), accent: toHex(accent), onAccent: inkOn(toHex(accent)), dark };
}

/**
 * Page background that continues a picture's own backdrop: the colours read
 * along its edges, placed at the heights they were read from. `top` and
 * `height` are CSS lengths describing where the picture sits.
 */
export function backdropGradient(stops: string[], top: string, height: string) {
  const n = stops.length;
  const at = stops.map((c, i) => `${c} calc(${top} + ${height} * ${((2 * i + 1) / (2 * n)).toFixed(4)})`);
  return `linear-gradient(180deg, ${at.join(", ")})`;
}

export const midStop = (stops: string[] | undefined) => (stops?.length ? stops[stops.length >> 1] : undefined);

/** Text colour that stays readable on an arbitrary swatch. */
export function inkOn(hex: string) {
  return luminance(parse(hex, WHITE)) > 0.45 ? "#1a1918" : "#ffffff";
}

export function validHex(hex: unknown): hex is string {
  return typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex.trim());
}
