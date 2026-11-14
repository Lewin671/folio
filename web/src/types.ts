export type Op = { t: string; id: string; [key: string]: any };

export type Head = {
  layout: string;
  tone: string;
  bg: string;
  accent: string;
  kicker?: string;
  title?: string;
  lede?: string;
};

/** `stops` are the picture's backdrop colours, top to bottom, as measured by the server. */
export type Img = { url?: string; stops?: string[]; pending: boolean; failed?: boolean };

export type Timing = { first?: number; scene?: number; image?: number; end?: number; input?: number; cached?: number };

export type Turn = { user: string; ops: Op[] };

export type StreamEvent = { event: string; data: any };
