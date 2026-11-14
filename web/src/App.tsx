import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Head, Img, Op, StreamEvent, Timing, Turn } from "./types";
import { forHistory, MOCK, runTurn } from "./stream";
import { safeTheme } from "./theme";
import { Scene } from "./scene";

const SUGGESTIONS = [
  { hint: "一整套", say: "周五面试，想休闲一点" },
  { hint: "二选一", say: "黑西装还是藏青西装，第一套买哪个" },
  { hint: "配色", say: "秋天的大地色怎么配" },
  { hint: "清单", say: "十二月去冰岛一周带什么" },
  { hint: "方法", say: "风衣怎么选版型" },
  { hint: "灵感", say: "想要松弛感的风格" },
];

type State = {
  head: Head | null;
  blocks: Op[]; // current page, in stream order; blocks of the previous page follow until replaced
  stale: Set<string>; // ids still showing the previous page's content
  images: Record<string, Img>;
  busy: boolean;
  asking: string; // the question being answered, shown until the first block arrives
  turnOps: Op[]; // everything the model wrote this turn, for history
  history: Turn[];
  timing: Timing;
  error: string;
};

const initial: State = { head: null, blocks: [], stale: new Set(), images: {}, busy: false, asking: "", turnOps: [], history: [], timing: {}, error: "" };

type Action = { type: "start"; input: string } | { type: "event"; e: StreamEvent } | { type: "finish"; input: string; failed?: boolean } | { type: "reset" };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "reset":
      return initial;

    case "start":
      return { ...s, busy: true, asking: a.input, error: "", timing: {}, turnOps: [], stale: new Set(s.blocks.map((b) => b.id)) };

    case "finish": {
      // Whatever is still pending when the stream ends will never arrive.
      const images = { ...s.images };
      for (const [id, img] of Object.entries(images)) if (img.pending) images[id] = { url: img.url, pending: false, failed: true };
      const ok = !a.failed && s.turnOps.length > 0;
      const history = ok ? [...s.history, { user: a.input, ops: forHistory(s.turnOps) }].slice(-3) : s.history;
      return { ...s, busy: false, asking: "", images, history, stale: new Set(), blocks: s.blocks.filter((b) => !s.stale.has(b.id)) };
    }

    case "event": {
      const { event, data } = a.e;
      switch (event) {
        case "first":
          return { ...s, timing: { ...s.timing, first: data.ms } };
        case "scene_done":
          return { ...s, timing: { ...s.timing, scene: data.ms }, stale: new Set(), blocks: s.blocks.filter((b) => !s.stale.has(b.id)) };
        case "end":
          return { ...s, timing: { ...s.timing, end: data.ms } };
        case "error":
          return { ...s, error: String(data.message ?? "出错了，请再试一次。") };
        case "image":
          return { ...s, images: { ...s.images, [data.id]: { url: data.url, pending: false } }, timing: { ...s.timing, image: data.ms } };
        case "image_error":
          return { ...s, images: { ...s.images, [data.id]: { url: s.images[data.id]?.url, pending: false, failed: true } } };
        case "op":
          return applyOp(s, data as Op);
        default:
          return s;
      }
    }
  }
}

function applyOp(s: State, op: Op): State {
  const turnOps = [...s.turnOps, op];
  if (op.t === "scene") {
    // A different layout means a different topic: the old page leaves at once
    // instead of lingering inside a composition it was not written for.
    const sameLayout = s.head?.layout === op.layout;
    return {
      ...s,
      turnOps,
      asking: "",
      head: op as unknown as Head,
      blocks: sameLayout ? s.blocks : [],
      stale: sameLayout ? s.stale : new Set(),
      images: sameLayout ? s.images : {},
    };
  }
  if (!s.head) return s; // blocks before a scene line cannot be placed

  const stale = new Set(s.stale);
  stale.delete(op.id);
  const fresh = s.blocks.filter((b) => !s.stale.has(b.id) && b.id !== op.id);
  const old = s.blocks.filter((b) => stale.has(b.id));
  const images = { ...s.images };
  if (op.t === "image" || op.t === "option") {
    const prev = images[op.id];
    if (op.pending) images[op.id] = { url: op.edit ? prev?.url : undefined, pending: true };
    else if (!op.keep || !prev) images[op.id] = prev && !op.prompt ? prev : { pending: false, failed: true };
  }
  return { ...s, turnOps, asking: "", stale, blocks: [...fresh, op, ...old], images };
}

export function App() {
  const [s, dispatch] = useReducer(reducer, initial);
  const [draft, setDraft] = useState("");
  const [showTiming, setShowTiming] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const state = useRef(s);
  state.current = s;

  const theme = useMemo(() => safeTheme(s.head ?? {}), [s.head]);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--bg", theme.bg);
    root.setProperty("--ink", theme.ink);
    root.setProperty("--accent", theme.accent);
    root.setProperty("--on-accent", theme.onAccent);
  }, [theme]);

  async function say(raw: string) {
    const input = raw.trim();
    if (!input || state.current.busy) return;
    setDraft("");
    const cur = state.current;
    const images: Record<string, string> = {};
    for (const [id, img] of Object.entries(cur.images)) if (img.url && /^https:/.test(img.url)) images[id] = img.url;
    dispatch({ type: "start", input });
    const ctl = new AbortController();
    abort.current = ctl;
    let failed = false;
    try {
      await runTurn({ input, history: cur.history, images }, (e) => dispatch({ type: "event", e }), ctl.signal);
    } catch (err) {
      failed = true;
      if (!ctl.signal.aborted) dispatch({ type: "event", e: { event: "error", data: { message: "连接断了，请再试一次。" } } });
    }
    dispatch({ type: "finish", input, failed });
  }

  function reset() {
    abort.current?.abort();
    dispatch({ type: "reset" });
  }

  const actions = s.blocks.find((b) => b.t === "actions" && !s.stale.has(b.id));
  const chips: { label: string; say: string }[] = (Array.isArray(actions?.items) ? actions!.items : [])
    .filter((x: any) => x && typeof x.label === "string" && x.label.trim())
    .slice(0, 3);
  const waitingFirst = s.busy && !!s.asking;

  return (
    <div className={`app ${s.busy ? "is-busy" : ""}`}>
      <nav className="top">
        <button type="button" className="brand" onClick={reset} title="回到开始">
          Atelier
        </button>
        <span className="top-right">
          {(s.timing.first || s.busy) && (
            <button type="button" className="timing" onClick={() => setShowTiming((v) => !v)} title="各阶段耗时，点击收起或展开">
              {showTiming ? <TimingLine t={s.timing} busy={s.busy} /> : "耗时"}
            </button>
          )}
          {MOCK && <span className="mock-flag">假数据</span>}
        </span>
      </nav>

      <LayoutGroup>
        <AnimatePresence mode="wait">
          {waitingFirst && !s.head ? (
            <motion.div key="asking" className="asking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p>{s.asking}</p>
            </motion.div>
          ) : s.head ? (
            <motion.div key="scene" className={waitingFirst ? "scene-wrap is-waiting" : "scene-wrap"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Scene head={s.head} blocks={s.blocks} images={s.images} stale={s.stale} onSay={say} />
            </motion.div>
          ) : (
            <motion.div key="home" className="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <h1>今天穿什么</h1>
              <ul>
                {SUGGESTIONS.map((x) => (
                  <li key={x.say}>
                    <button type="button" onClick={() => say(x.say)}>
                      <span className="hint">{x.hint}</span>
                      {x.say}
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>

      <div className="dock">
        {s.error && (
          <p className="error" role="alert">
            {s.error}
          </p>
        )}
        {!s.busy && chips.length > 0 && (
          <div className="chips">
            {chips.map((c) => (
              <button type="button" key={c.label} onClick={() => say(c.say || c.label)}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            say(draft);
          }}
        >
          <span className="orb" aria-hidden />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={s.busy ? (s.asking ? "正在排版…" : "正在出图…") : s.head ? "接着说，比如“换成更正式的”" : "要去哪、做什么，直接说"}
            maxLength={400}
            aria-label="输入你的问题"
            autoFocus
          />
          <button type="submit" disabled={!draft.trim() || s.busy} aria-label="发送">
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}

function TimingLine({ t, busy }: { t: Timing; busy: boolean }) {
  const f = (ms?: number) => (ms == null ? "…" : (ms / 1000).toFixed(1) + " 秒");
  const parts = [`首块 ${f(t.first)}`, `版面 ${f(t.scene)}`];
  if (t.image != null || (busy && t.scene != null)) parts.push(`图片 ${f(t.image)}`);
  return <>{parts.join(" · ")}</>;
}
