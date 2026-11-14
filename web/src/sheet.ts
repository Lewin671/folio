// Panels slide in from the side on a wide screen and rise from the bottom on a phone.
const phone = typeof matchMedia === "function" && matchMedia("(max-width: 900px)").matches;
const away = phone ? { y: "100%" } : { x: "calc(100% + 24px)" };

export const sheetMotion = {
  initial: away,
  animate: { x: 0, y: 0 },
  exit: away,
  transition: { type: "spring", bounce: 0, duration: 0.5 },
} as const;
