// Pictures shipped with the app, each with the backdrop colours measured along
// its edges (top to bottom). The home screen uses one as its cover and the
// offline fixtures reuse them.
export type Pic = { url: string; stops: string[] };

export const pic = {
  magenta: { url: "/mock/magenta.jpg", stops: ["#b13979", "#be488a", "#c14c8e", "#bf488a", "#bb4286", "#c95797"] },
  cobalt: { url: "/mock/cobalt.jpg", stops: ["#0d2986", "#193298", "#18349c", "#173098", "#102b8f", "#0f3499"] },
  olive: { url: "/mock/olive.jpg", stops: ["#666540", "#716e49", "#716d4a", "#6e6a47", "#5c5d35", "#848159"] },
  flat: { url: "/mock/flat.jpg", stops: ["#9fbfd8", "#a3c1da", "#a1bfd9", "#98b8d1", "#86adc9", "#80a4c1"] },
} satisfies Record<string, Pic>;

export const COVERS: Pic[] = [pic.magenta, pic.cobalt, pic.olive];
