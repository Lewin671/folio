// Pictures shipped with the app, each with the backdrop colours measured along
// its edges (top to bottom). The home screen uses one as its cover and the
// offline fixtures reuse them.
export type Pic = { url: string; stops?: string[] };

export const pic = {
  jelly: { url: "/pics/jelly.jpg", stops: ["#02173f", "#021b49", "#021e4d", "#022051", "#02235d", "#003f8b"] },
  saturn: { url: "/pics/saturn.jpg", stops: ["#bb3a25", "#d24b32", "#e2573a", "#e2583c", "#f77a50", "#e86e53"] },
  moka: { url: "/pics/moka.jpg", stops: ["#cb821d", "#d68d24", "#df9729", "#e69f2c", "#e49a2a", "#eba93b"] },
  fossils: { url: "/pics/fossils.jpg", stops: ["#9da796", "#9fa99a", "#9fa899", "#9da797", "#9aa494", "#98a291"] },
  rome: { url: "/pics/rome.jpg" }, // a place, shown framed: no backdrop to continue
} satisfies Record<string, Pic>;

export const COVERS: Required<Pic>[] = [pic.jelly, pic.moka];
