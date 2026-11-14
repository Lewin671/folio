export type Op = { t: string; id: string; [key: string]: any };

export type Head = {
  layout: string;
  tone: string;
  bg: string;
  ink: string;
  accent: string;
  kicker?: string;
  title?: string;
  lede?: string;
};

export type Img = { url?: string; pending: boolean; failed?: boolean };

export type Timing = { first?: number; scene?: number; image?: number; end?: number };

export type Turn = { user: string; ops: Op[] };

export type StreamEvent = { event: string; data: any };
