import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Head, Img, Op, StreamEvent, Timing, Turn } from "./types";
import { forHistory, MOCK, runTurn } from "./stream";
import { backdropGradient, midStop, stageTheme, validHex } from "./theme";
import { Scene, stageOf } from "./scene";
import { COVERS } from "./covers";
import { api, EMPTY, ProfilePanel, Toasts, toJpeg, type Profile, type Toast } from "./profile";
import { HistoryPanel } from "./history";

// Shown on the cover as headlines; each leads to a different kind of page.
const SUGGESTIONS = ["水母没有大脑，怎么游泳", "拿铁和卡布奇诺有什么不同", "大气层分哪几层", "罗马帝国是怎么衰落的", "复利是怎么回事", "考考我太阳系"];

type State = {
  head: Head | null;
  blocks: Op[]; // current page, in stream order; blocks of the previous page follow until replaced
  stale: Set<string>; // ids still showing the previous page's content
  images: Record<string, Img>;
  busy: boolean;
  asking: string; // the question being answered, shown until the first block arrives
  attached: string; // the picture sent with this question, shown where the model places it
  seen: string; // the question as the model received it, including what it saw in the picture
  turnOps: Op[]; // everything the model wrote this turn, for history
  history: Turn[];
  timing: Timing;
  error: string;
  thread: string; // the conversation these pages belong to, as saved on the server
  pages: Page[]; // every page of this conversation, oldest first
  at: number; // which of them is showing; -1 is the cover
  rev: number; // goes up whenever the pages change and need saving
};

/** A finished page, kept so the reader can leaf back to it. */
type Page = { head: Head; blocks: Op[]; images: Record<string, Img>; history: Turn[] };

const initial: State = { head: null, blocks: [], stale: new Set(), images: {}, busy: false, asking: "", attached: "", seen: "", turnOps: [], history: [], timing: {}, error: "", thread: "", pages: [], at: -1, rev: 0 };

type Action = { type: "start"; input: string; image?: string; thread: string } | { type: "open"; thread: string; pages: Page[]; to: number } | { type: "event"; e: StreamEvent } | { type: "finish"; input: string; failed?: boolean } | { type: "go"; to: number };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "go": {
      // Leafing to another page drops whatever was in progress; the pages themselves stay.
      const page = s.pages[a.to];
      const kept = { ...initial, thread: s.thread, pages: s.pages, rev: s.rev };
      if (!page) return kept;
      return { ...kept, at: a.to, head: page.head, blocks: page.blocks, images: page.images, history: page.history };
    }

    case "open": {
      // A conversation from the history replaces the one that was showing.
      const kept = { ...initial, thread: a.thread, pages: a.pages, rev: s.rev };
      const page = a.pages[a.to];
      if (!page) return kept;
      return { ...kept, at: a.to, head: page.head, blocks: page.blocks, images: page.images, history: page.history };
    }

    case "start":
      // Asking from the cover begins a new conversation.
      if (a.thread !== s.thread) s = { ...s, thread: a.thread, pages: [], at: -1 };
      return { ...s, busy: true, asking: a.input, attached: a.image ?? "", seen: "", error: "", timing: {}, turnOps: [], stale: new Set(s.blocks.map((b) => b.id)) };

    case "finish": {
      // Whatever is still pending when the stream ends will never arrive.
      const images = { ...s.images };
      for (const [id, img] of Object.entries(images)) if (img.pending) images[id] = { ...img, pending: false, failed: true };
      const ok = !a.failed && s.turnOps.length > 0;
      const history = ok ? [...s.history, { user: s.seen || a.input, ops: forHistory(s.turnOps) }].slice(-3) : s.history;
      const blocks = s.blocks.filter((b) => !s.stale.has(b.id));
      // A new page goes after the one it was asked from; pages that came after that one are dropped.
      const made = s.head && s.turnOps.length > 0;
      const pages = made ? [...s.pages.slice(0, s.at + 1), { head: s.head!, blocks, images, history }] : s.pages;
      return { ...s, busy: false, asking: "", images, history, stale: new Set(), blocks, pages, at: made ? pages.length - 1 : s.at, rev: made ? s.rev + 1 : s.rev };
    }

    case "event": {
      const { event, data } = a.e;
      switch (event) {
        case "seen":
          // The server keeps the attached picture; its address replaces the local copy.
          return { ...s, seen: String(data.text ?? ""), attached: typeof data.url === "string" && data.url ? data.url : s.attached };
        case "first":
          return { ...s, timing: { ...s.timing, first: data.ms } };
        case "scene_done":
          return { ...s, timing: { ...s.timing, scene: data.ms }, stale: new Set(), blocks: s.blocks.filter((b) => !s.stale.has(b.id)) };
        case "end":
          return { ...s, timing: { ...s.timing, end: data.ms } };
        case "error":
          return { ...s, error: String(data.message ?? "出错了，请再试一次。") };
        case "image":
          return { ...s, images: { ...s.images, [data.id]: { url: data.url, stops: Array.isArray(data.stops) ? data.stops.filter(validHex) : undefined, pending: false } }, timing: { ...s.timing, image: data.ms } };
        case "image_error":
          return { ...s, images: { ...s.images, [data.id]: { ...s.images[data.id], pending: false, failed: true } } };
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
    if (op.kind === "upload" && s.attached) images[op.id] = { url: s.attached, pending: false };
    else if (op.pending) images[op.id] = op.edit && prev?.url ? { ...prev, failed: false, pending: true } : { pending: true };
    else if (!op.keep || !prev) images[op.id] = prev && !op.prompt ? prev : { pending: false, failed: true };
  }
  return { ...s, turnOps, asking: "", stale, blocks: [...fresh, op, ...old], images };
}

const newThread = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n) + "…" : text);

/** Resolves once the browser has the picture, so it can appear together with its colour field. */
const preload = (url: string) =>
  new Promise<void>((resolve) => {
    const im = new Image();
    im.onload = im.onerror = () => resolve();
    im.src = url;
  });

export function App() {
  const [s, dispatch] = useReducer(reducer, initial);
  const [draft, setDraft] = useState("");
  const [showTiming, setShowTiming] = useState(false);
  // The home screen is a magazine cover: one of the shipped pictures on its own backdrop.
  const [cover] = useState(() => COVERS[Math.floor(Math.random() * COVERS.length)]);
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [problems, setProblems] = useState<string[]>([]); // what is missing in the setup, if anything
  const [panel, setPanel] = useState<"" | "memory" | "history">("");
  const [attach, setAttach] = useState(""); // a picture waiting to be sent with the next question
  const [toasts, setToasts] = useState<Toast[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const state = useRef(s);
  state.current = s;

  const stage = useMemo(() => (s.head ? stageOf(s.head, s.blocks) : null), [s.head, s.blocks]);

  // The field is the scene colour until the main picture arrives; then it
  // becomes that picture's own backdrop, so the figure stands on the page.
  const heroStops = !s.head ? cover.stops : stage?.hero && !stage.framed ? s.images[stage.hero.id]?.stops : undefined;
  const flat = midStop(heroStops) ?? (s.head && validHex(s.head.bg) ? s.head.bg.trim() : "#8c857b");
  const field = heroStops?.length ? backdropGradient(heroStops, "var(--hero-top)", "var(--hero-h)") : flat;
  const theme = useMemo(() => stageTheme(flat, s.head?.accent), [flat, s.head?.accent]);
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--flat", theme.bg);
    root.setProperty("--ink", theme.ink);
    root.setProperty("--accent", theme.accent);
    root.setProperty("--on-accent", theme.onAccent);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
  }, [theme]);

  useEffect(() => {
    api.profile().then(setProfile, () => {}); // without a server (offline fixtures) the profile just stays empty
    if (!MOCK) api.setup().then((r) => setProblems(r.problems ?? []), () => {});
  }, []);

  // Every move is a browser history entry naming the conversation and the
  // page, so the back button and the swipe gesture leaf through pages, and a
  // reload or a later visit to the same entry opens that page again.
  const pending = useRef(false); // the current entry stands for a page still being made
  const skipPop = useRef(false);
  function enter(entry: { th?: string; i: number }) {
    if (pending.current) history.replaceState(entry, "");
    else history.pushState(entry, "");
    pending.current = false;
  }
  function show(to: number) {
    abort.current?.abort();
    enter({ th: state.current.thread, i: to });
    dispatch({ type: "go", to });
    window.scrollTo({ top: 0 });
  }
  function restore(entry: any) {
    const cur = state.current;
    const i = typeof entry?.i === "number" ? entry.i : -1;
    if (i < 0 || typeof entry?.th !== "string") return dispatch({ type: "go", to: -1 });
    if (entry.th === cur.thread && cur.pages.length) return dispatch({ type: "go", to: Math.min(i, cur.pages.length - 1) });
    api.thread(entry.th).then(
      (t) => dispatch({ type: "open", thread: t.id, pages: t.pages, to: Math.min(i, t.pages.length - 1) }),
      () => dispatch({ type: "go", to: -1 }),
    );
  }
  useEffect(() => {
    if (!MOCK) restore(history.state);
    const onPop = (e: PopStateEvent) => {
      if (skipPop.current) return void (skipPop.current = false);
      abort.current?.abort();
      pending.current = false;
      restore(e.state);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Pages are saved on the server after each one is made.
  useEffect(() => {
    if (MOCK || !s.rev || !s.thread || !s.pages.length) return;
    const first = s.pages[0];
    const title = first.head.title || clip(first.history[first.history.length - 1]?.user ?? "", 40);
    api.saveThread(s.thread, title, s.pages).catch(() => toast("这一页没能存进历史"));
  }, [s.rev]);

  function toast(text: string, undo?: () => void) {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, undo }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 7000);
  }

  async function pickFile(file: File) {
    try {
      setAttach(await toJpeg(file));
    } catch {
      toast("这张图读不出来，换一张试试");
    }
  }

  async function say(raw: string) {
    const image = attach || undefined;
    const input = raw.trim() || (image ? "这是什么？讲讲它。" : "");
    if (!input || state.current.busy) return;
    setDraft("");
    setAttach("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    const cur = state.current;
    const images: Record<string, string> = {};
    for (const [id, img] of Object.entries(cur.images)) if (img.url && !img.url.startsWith("data:")) images[id] = img.url;
    // The page being made gets its browser entry now, so going back while it
    // is still being made returns to the page it was asked from.
    const thread = cur.at < 0 || !cur.thread ? newThread() : cur.thread;
    history.pushState({ th: thread, i: cur.at < 0 ? 0 : cur.at + 1 }, "");
    pending.current = true;
    let made = false;
    let placed = cur.at >= 0; // blocks can only be placed once there is a scene
    dispatch({ type: "start", input, image, thread });
    const ctl = new AbortController();
    abort.current = ctl;
    let failed = false;
    const loading: Promise<void>[] = [];
    const onEvent = (e: StreamEvent) => {
      if (e.event === "memory") {
        // The model noted a lasting preference; show it so it can be taken back.
        const added: { id: string; text: string }[] = Array.isArray(e.data?.added) ? e.data.added : [];
        if (e.data?.profile) setProfile(e.data.profile);
        if (added.length) toast("记住了：" + added.map((p) => p.text).join("、"), () => Promise.all(added.map((p) => api.deletePref(p.id))).then((ps) => ps.length && setProfile(ps[ps.length - 1]), () => {}));
      } else if (e.event === "image" && typeof e.data?.url === "string") {
        loading.push(preload(e.data.url).then(() => void (ctl.signal.aborted || dispatch({ type: "event", e }))));
      } else {
        if (e.event === "op") made = (placed ||= e.data?.t === "scene");
        dispatch({ type: "event", e });
      }
    };
    try {
      await runTurn({ input, history: cur.history, images, image }, onEvent, ctl.signal);
      await Promise.all(loading);
    } catch (err) {
      failed = true;
      if (!ctl.signal.aborted) dispatch({ type: "event", e: { event: "error", data: { message: "连接断了，请再试一次。" } } });
    }
    if (ctl.signal.aborted) return;
    dispatch({ type: "finish", input, failed });
    pending.current = false;
    if (!made) {
      // Nothing came of the question: step off the entry that was added for it.
      skipPop.current = true;
      history.back();
    }
  }

  async function openThread(id: string) {
    try {
      const t = await api.thread(id);
      const to = t.pages.length - 1;
      abort.current?.abort();
      enter({ th: t.id, i: to });
      dispatch({ type: "open", thread: t.id, pages: t.pages, to });
      window.scrollTo({ top: 0 });
      setPanel("");
    } catch (e: any) {
      toast(String(e?.message ?? "打不开这段记录"));
    }
  }

  const waitingFirst = s.busy && !!s.asking;
  const heroClass = !s.head ? "hero-figure" : stage?.hero ? (stage.square ? "hero-square" : "hero-figure") : "";

  return (
    <div className={`app ${s.busy ? "is-busy" : ""} ${waitingFirst ? "is-thinking" : ""} ${s.head ? "" : "is-home"} ${theme.dark ? "on-dark" : "on-light"} ${heroClass} ${stage ? "tpl-" + stage.tpl : ""}`}>
      <div className="field" aria-hidden>
        <AnimatePresence>
          <motion.div key={field} className="field-layer" style={{ background: field }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0.999 }} transition={{ duration: 1.1, ease: "easeInOut" }} />
        </AnimatePresence>
      </div>
      <div className="glow" aria-hidden />

      <nav className="top">
        <span className="top-left">
          <button type="button" className="brand" onClick={() => show(-1)} title="回到封面">
            Folio
          </button>
          {s.at >= 0 && s.pages.length > 1 && (
            <span className="pager">
              <button type="button" onClick={() => show(s.busy ? s.at : s.at - 1)} disabled={s.at === 0 && !s.busy} aria-label="上一页" title="上一页">
                ←
              </button>
              <span className="pager-n">
                {s.at + 1} / {s.pages.length}
              </span>
              <button type="button" onClick={() => show(s.at + 1)} disabled={s.busy || s.at >= s.pages.length - 1} aria-label="下一页" title="下一页">
                →
              </button>
            </span>
          )}
        </span>
        <span className="top-right">
          {(s.timing.first || s.busy) && (
            <button type="button" className="timing" onClick={() => setShowTiming((v) => !v)} title="各阶段耗时，点击收起或展开">
              {showTiming ? <TimingLine t={s.timing} busy={s.busy} /> : "耗时"}
            </button>
          )}
          {MOCK && <span className="mock-flag">假数据</span>}
          {s.at < 0 && !s.busy && s.pages.length > 0 && (
            <button type="button" className="profile-btn" onClick={() => show(s.pages.length - 1)} aria-label="下一页">
              回到刚才那页 →
            </button>
          )}
          {!MOCK && (
            <button type="button" className="profile-btn" onClick={() => setPanel("history")}>
              历史
            </button>
          )}
          <button type="button" className="profile-btn" onClick={() => setPanel("memory")}>
            记忆
          </button>
        </span>
      </nav>

      <LayoutGroup>
        <AnimatePresence mode="wait">
          {waitingFirst && !s.head ? (
            <motion.div key="asking" className="asking" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.6 }}>
              <p>{s.asking}</p>
            </motion.div>
          ) : s.head && stage ? (
            <motion.div key={"scene-" + stage.tpl} className={waitingFirst ? "scene-wrap is-waiting" : "scene-wrap"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.5 }}>
              <Scene head={s.head} stage={stage} images={s.images} stale={s.stale} busy={s.busy} onSay={say} />
            </motion.div>
          ) : (
            <motion.div key="home" className="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.8 }}>
              <div className="hero">
                <figure className="figure">
                  <div className="figure-imgs">
                    <img src={cover.url} alt="" draggable={false} />
                  </div>
                </figure>
              </div>
              <div className="cover-left">
                <header>
                  <h1 className="masthead">Folio</h1>
                  <p className="cover-note">问什么，都给你排一页。</p>
                </header>
                <ul className="cover-lines ">
                  {SUGGESTIONS.slice(0, 3).map((q, i) => (
                    <li key={q}>
                      <button type="button" onClick={() => say(q)}>
                        <span className="n">{String(i + 1 + 0).padStart(2, "0")}</span>
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="cover-right">
                {problems.length > 0 && (
                  <div className="setup" role="alert">
                    <h2>还差一步才能用</h2>
                    <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                    <p>改好后重启服务，再刷新这个页面。</p>
                  </div>
                )}
                <ul className="cover-lines ">
                  {SUGGESTIONS.slice(3, 6).map((q, i) => (
                    <li key={q}>
                      <button type="button" onClick={() => say(q)}>
                        <span className="n">{String(i + 1 + 3).padStart(2, "0")}</span>
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            say(draft);
          }}
        >
          {attach ? (
            <button type="button" className="attach has-image" onClick={() => setAttach("")} aria-label="去掉这张图片" title="去掉这张图片">
              <img src={attach} alt="" />
            </button>
          ) : (
            <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label="附一张图片" title="附一张图片，问问这是什么">
              {s.busy ? <span className="orb" aria-hidden /> : "＋"}
            </button>
          )}
          <input
            ref={picker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) pickFile(file);
            }}
          />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={s.busy ? (s.asking ? "正在排这一页…" : "正在出图…") : attach ? "想问这张图什么？不写就直接讲" : s.head ? "接着问，比如“举个例子”" : "问点什么，或者附一张图"}
            maxLength={400}
            aria-label="输入你的问题"
          />
          <button type="submit" className="send" disabled={(!draft.trim() && !attach) || s.busy} aria-label="发送">
            ↑
          </button>
        </form>
      </div>

      <AnimatePresence>
        {panel === "memory" && <ProfilePanel key="memory" profile={profile} onChange={setProfile} onClose={() => setPanel("")} />}
        {panel === "history" && (
          <HistoryPanel
            key="history"
            current={s.thread}
            onOpen={openThread}
            onClose={() => setPanel("")}
            onDeleted={(id) => {
              if (id !== state.current.thread) return;
              abort.current?.abort();
              enter({ i: -1 });
              dispatch({ type: "open", thread: "", pages: [], to: -1 });
            }}
          />
        )}
      </AnimatePresence>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </div>
  );
}

function TimingLine({ t, busy }: { t: Timing; busy: boolean }) {
  const f = (ms?: number) => (ms == null ? "…" : (ms / 1000).toFixed(1) + " 秒");
  const parts = [`首块 ${f(t.first)}`, `版面 ${f(t.scene)}`];
  if (t.image != null || (busy && t.scene != null)) parts.push(`图片 ${f(t.image)}`);
  return <>{parts.join(" · ")}</>;
}
