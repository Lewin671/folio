import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import type { Head, Img, Op, StreamEvent, Timing, Turn } from "./types";
import { forHistory, MOCK, runTurn } from "./stream";
import { backdropGradient, midStop, stageTheme, validHex } from "./theme";
import { Scene, stageOf } from "./scene";
import { api, EMPTY, Toasts, type Profile, type ThreadMeta, type Toast } from "./profile";
import { ThreadRow } from "./thread-row";
import { Composer, type ComposerHandle } from "./composer";
import { createThreadSaver } from "./thread-saver";
import { parseRoute, routeURL, type Route } from "./route";
import { switchLang, T } from "./i18n";

const ProfilePanel = lazy(() => import("./profile-panel").then((m) => ({ default: m.ProfilePanel })));
const HistoryPanel = lazy(() => import("./history").then((m) => ({ default: m.HistoryPanel })));

// Shown on the cover as headlines; each leads to a different kind of page.
const SUGGESTIONS = T.suggestions;

// The cover is plain type on one flat colour, a different one each day.
const PAPERS = ["#E0452B", "#1D3C8F", "#EFB52C", "#14513E", "#E9E2D0", "#5C1E3B", "#D8D3F0"];
const paperOfTheDay = () => PAPERS[Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000) % PAPERS.length];
// With sample data there is no server to ask, so the cover lists a few made-up conversations (not with ?fresh).
const MOCK_RECENTS: ThreadMeta[] = !MOCK || new URLSearchParams(location.search).has("fresh") ? [] : [
  { id: "m1", title: T.suggestions[0], updated: new Date(Date.now() - 3600e3).toISOString(), count: 3, bg: "#0E2A5C", img: "/pics/jelly.jpg" },
  { id: "m2", title: T.suggestions[1], updated: new Date(Date.now() - 86400e3).toISOString(), count: 1, bg: "#E69F2C", img: "/pics/moka.jpg" },
  { id: "m3", title: T.suggestions[2], updated: new Date(Date.now() - 4 * 86400e3).toISOString(), count: 5, bg: "#27306B" },
];
const RECENT = 3; // how many earlier conversations the cover lists

type State = {
  head: Head | null;
  blocks: Op[]; // current page, in stream order; blocks of the previous page follow until replaced
  stale: Set<string>; // ids still showing the previous page's content
  images: Record<string, Img>;
  busy: boolean;
  asking: string; // the question being answered, shown until the first block arrives
  question: string; // the same question, kept for the whole turn
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

const initial: State = { head: null, blocks: [], stale: new Set(), images: {}, busy: false, asking: "", question: "", attached: "", seen: "", turnOps: [], history: [], timing: {}, error: "", thread: "", pages: [], at: -1, rev: 0 };

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
      // A page saved while its pictures were still being made will not get them now.
      const pages = a.pages.map((p) => {
        const images = { ...p.images };
        for (const [id, img] of Object.entries(images)) if (img.pending) images[id] = { ...img, pending: false, failed: true };
        return { ...p, images };
      });
      const kept = { ...initial, thread: a.thread, pages, rev: s.rev };
      const page = pages[a.to];
      if (!page) return kept;
      return { ...kept, at: a.to, head: page.head, blocks: page.blocks, images: page.images, history: page.history };
    }

    case "start":
      // Asking from the cover begins a new conversation.
      if (a.thread !== s.thread) s = { ...s, thread: a.thread, pages: [], at: -1 };
      return { ...s, busy: true, asking: a.input, question: a.input, attached: a.image ?? "", seen: "", error: "", timing: {}, turnOps: [], stale: new Set(s.blocks.map((b) => b.id)) };

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
          return { ...s, timing: { ...s.timing, scene: data.ms, input: data.input_tokens, cached: data.cached_tokens }, stale: new Set(), blocks: s.blocks.filter((b) => !s.stale.has(b.id)) };
        case "end":
          return { ...s, timing: { ...s.timing, end: data.ms } };
        case "error":
          return { ...s, error: String(data.message ?? T.failed) };
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

// Timings are for whoever is tuning the models; add ?timing to the address to see them.
const SHOW_TIMING = new URLSearchParams(location.search).has("timing");
const newThread = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n) + "…" : text);

function record(entry: Route, replace = false) {
  const url = routeURL(entry, location.search);
  if (replace || url === location.pathname + location.search) history.replaceState(entry, "", url);
  else history.pushState(entry, "", url);
}

/** Resolves once the browser has the picture, so it can appear together with its colour field. */
const preload = (url: string) =>
  new Promise<void>((resolve) => {
    const im = new Image();
    im.onerror = () => resolve();
    im.onload = async () => {
      await im.decode?.().catch(() => {});
      resolve();
    };
    im.src = url;
  });

export function App() {
  const [s, dispatch] = useReducer(reducer, initial);
  const [showTiming, setShowTiming] = useState(false);
  const [paper] = useState(paperOfTheDay);
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [problems, setProblems] = useState<string[]>([]); // what is missing in the setup, if anything
  const [panel, setPanel] = useState<"" | "memory" | "history">("");
  const [recents, setRecents] = useState<ThreadMeta[]>([]); // the latest conversations, listed on the cover
  const [toasts, setToasts] = useState<Toast[]>([]);
  const composer = useRef<ComposerHandle>(null);
  const say = useCallback((text: string) => composer.current?.submit(text), []);
  const abort = useRef<AbortController | null>(null);
  const state = useRef(s);
  state.current = s;

  useEffect(() => {
    document.title = s.head?.title ? `${s.head.title} · Folio` : "Folio";
  }, [s.head?.title]);

  const stage = useMemo(() => (s.head ? stageOf(s.head, s.blocks) : null), [s.head, s.blocks]);

  // The field is the scene colour until the main picture arrives; then it
  // becomes that picture's own backdrop, so the figure stands on the page.
  const heroStops = stage?.hero && !stage.framed ? s.images[stage.hero.id]?.stops : undefined;
  const flat = midStop(heroStops) ?? (!s.head ? paper : validHex(s.head.bg) ? s.head.bg.trim() : "#8c857b");
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
    if (!MOCK) latest();
  }, []);

  // Every move is a browser history entry naming the conversation and the
  // page, so the back button and the swipe gesture leaf through pages, and a
  // reload or a later visit to the same entry opens that page again.
  const pending = useRef(false); // the current entry stands for a page still being made
  const skipPop = useRef(false);
  const navigation = useRef(0); // a late server reply must not undo a newer move
  function enter(entry: Route) {
    navigation.current++;
    record(entry, pending.current);
    pending.current = false;
  }
  function show(to: number) {
    cancel();
    enter({ th: state.current.thread, i: to });
    dispatch({ type: "go", to });
    window.scrollTo({ top: 0 });
  }
  function restore(entry: Route | null) {
    const visit = ++navigation.current;
    const cur = state.current;
    const cover = (failed = false) => {
      record({ i: -1 }, true);
      dispatch({ type: "go", to: -1 });
      if (failed) toast(T.cantOpen);
    };
    if (!entry) return cover(true);
    const { th, i } = entry;
    if (!th || i < 0) return cover();
    if (th === cur.thread && cur.pages.length) {
      const to = Math.min(i, cur.pages.length - 1);
      record({ th, i: to }, true);
      return dispatch({ type: "go", to });
    }
    if (MOCK) return cover();
    api.thread(th).then((t) => {
      if (visit !== navigation.current) return;
      if (!t.pages.length) return cover(true);
      const to = Math.min(i, t.pages.length - 1);
      record({ th: t.id, i: to }, true);
      dispatch({ type: "open", thread: t.id, pages: t.pages, to });
    }, () => {
      if (visit === navigation.current) cover(true);
    });
  }
  useEffect(() => {
    if (!MOCK) restore(parseRoute(location.pathname));
    const onPop = () => {
      if (skipPop.current) return void (skipPop.current = false);
      cancel();
      pending.current = false;
      restore(parseRoute(location.pathname));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const toast = useCallback((text: string, undo?: () => void) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, undo }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 7000);
  }, []);

  // The conversation is saved on the server as soon as a page has a title,
  // again when its text is complete and as each picture arrives, so it is in
  // the history even if the reader leaves before the page is finished.
  const [saving] = useState(() => createThreadSaver(
    async (id: string, pages: Page[]) => {
      const first = pages[0];
      const title = first.head.title || clip(first.history[first.history.length - 1]?.user ?? "", 40);
      const img = Object.values(first.images).find((im) => im.url?.startsWith("/api/img/"))?.url;
      await api.saveThread(id, { title, bg: first.head.bg, img }, pages);
      const meta = { id, title, updated: new Date().toISOString(), count: pages.length, bg: first.head.bg, img };
      setRecents((rs) => [meta, ...rs.filter((r) => r.id !== id)].slice(0, RECENT));
    },
    api.deleteThread,
    () => toast(T.notSaved),
  ));
  const unfinished = useRef(""); // the conversation whose saved copy includes an unfinished page
  const save = saving.save;
  const settled = Object.values(s.images).filter((im) => !im.pending).length;
  useEffect(() => {
    if (MOCK || abort.current?.signal.aborted || !s.busy || !s.thread || !s.head || !s.turnOps.length) return;
    unfinished.current = s.thread;
    const page: Page = { head: s.head, blocks: s.blocks.filter((b) => !s.stale.has(b.id)), images: s.images, history: [...s.history, { user: s.seen || s.question, ops: forHistory(s.turnOps) }].slice(-3) };
    save(s.thread, [...s.pages.slice(0, s.at + 1), page]);
  }, [s.busy, s.turnOps.length > 0, s.timing.scene, settled]);
  useEffect(() => {
    if (MOCK || !s.rev || !s.thread || !s.pages.length) return;
    unfinished.current = "";
    save(s.thread, s.pages);
  }, [s.rev]);
  /** Stops the page being made. Its saved draft gives way to the pages that were finished. */
  function cancel() {
    navigation.current++;
    abort.current?.abort();
    const cur = state.current;
    if (cur.busy && unfinished.current === cur.thread) {
      if (cur.pages.length) save(cur.thread, cur.pages);
      else void saving.remove(cur.thread).then(latest, () => {});
    }
    unfinished.current = "";
  }

  const sendTurn = useCallback((raw: string, image?: string) => {
    const input = raw.trim() || (image ? T.defaultAsk : "");
    if (!input || state.current.busy || (abort.current && !abort.current.signal.aborted)) return false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    const cur = state.current;
    const images: Record<string, string> = {};
    for (const [id, img] of Object.entries(cur.images)) if (img.url && !img.url.startsWith("data:")) images[id] = img.url;
    // The page being made gets its browser entry now, so going back while it
    // is still being made returns to the page it was asked from.
    const thread = cur.at < 0 || !cur.thread ? newThread() : cur.thread;
    const entry = { th: thread, i: cur.at < 0 ? 0 : cur.at + 1 };
    navigation.current++;
    record(entry);
    pending.current = true;
    let made = false;
    let placed = cur.at >= 0; // blocks can only be placed once there is a scene
    dispatch({ type: "start", input, image, thread });
    const ctl = new AbortController();
    abort.current = ctl;
    let failed = false;
    const loading: Promise<void>[] = [];
    const onEvent = (e: StreamEvent) => {
      if (ctl.signal.aborted) return;
      if (e.event === "memory") {
        // The model noted a lasting preference; show it so it can be taken back.
        const added: { id: string; text: string }[] = Array.isArray(e.data?.added) ? e.data.added : [];
        if (e.data?.profile) setProfile(e.data.profile);
        if (added.length) toast(T.remembered(added.map((p) => p.text)), () => Promise.all(added.map((p) => api.deletePref(p.id))).then((ps) => ps.length && setProfile(ps[ps.length - 1]), () => {}));
      } else if (e.event === "image" && typeof e.data?.url === "string") {
        loading.push(preload(e.data.url).then(() => void (ctl.signal.aborted || dispatch({ type: "event", e }))));
      } else {
        if (e.event === "op") made = (placed ||= e.data?.t === "scene");
        dispatch({ type: "event", e });
      }
    };
    void (async () => {
      try {
        await runTurn({ input, history: cur.history, images, image }, onEvent, ctl.signal);
        await Promise.all(loading);
      } catch (err) {
        failed = true;
        if (!ctl.signal.aborted) dispatch({ type: "event", e: { event: "error", data: { message: T.dropped } } });
      }
      if (ctl.signal.aborted) return;
      abort.current = null;
      dispatch({ type: "finish", input, failed });
      pending.current = false;
      record(made ? entry : { th: cur.thread, i: cur.at }, true);
      if (!made) {
        // Nothing came of the question: step off the entry that was added for it.
        skipPop.current = true;
        history.back();
      }
    })();
    return true;
  }, [toast]);

  const latest = () => api.threads(RECENT).then((r) => setRecents(r.threads), () => {});
  const reopen = (id: string) => (id === s.thread && s.pages.length ? show(s.pages.length - 1) : void openThread(id));
  /** Stops the page being made and hands the question back so it can be reworded. */
  const stop = useCallback(() => {
    const asked = state.current.busy ? state.current.question : "";
    if (asked) history.back(); // the entry added for this page is stepped off, which cancels it
    return asked;
  }, []);

  // Keys for a reader whose hands are off the input: leaf through pages, close a panel, start typing.
  const keys = useRef((_: KeyboardEvent) => {});
  keys.current = (e) => {
    if (e.key === "Escape" && panel) return setPanel("");
    const el = e.target as HTMLElement | null;
    if (panel || e.metaKey || e.ctrlKey || e.altKey || el?.closest("textarea, input, [contenteditable]")) return;
    if (e.key === "/") return void (e.preventDefault(), composer.current?.focus());
    if (s.at < 0 || s.busy) return;
    if (e.key === "ArrowLeft" && s.at > 0) show(s.at - 1);
    if (e.key === "ArrowRight" && s.at < s.pages.length - 1) show(s.at + 1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function openThread(id: string) {
    const visit = ++navigation.current;
    try {
      const t = await api.thread(id);
      if (visit !== navigation.current) return;
      const to = t.pages.length - 1;
      if (to < 0) throw new Error(T.cantOpen);
      cancel();
      enter({ th: t.id, i: to });
      dispatch({ type: "open", thread: t.id, pages: t.pages, to });
      window.scrollTo({ top: 0 });
      setPanel("");
    } catch (e: any) {
      // The page that was showing stays; only the failure is reported.
      if (visit === navigation.current) toast(String(e?.message ?? T.cantOpen));
    }
  }

  const waitingFirst = s.busy && !!s.asking;
  const home = !s.head && !s.busy;
  const shown = MOCK ? MOCK_RECENTS : recents;
  const heroClass = stage?.hero ? (stage.square ? "hero-square" : "hero-figure") : "";

  return (
    <div className={`app ${s.busy ? "is-busy" : ""} ${waitingFirst ? "is-thinking" : ""} ${home ? "is-home" : ""} ${theme.dark ? "on-dark" : "on-light"} ${heroClass} ${stage ? "tpl-" + stage.tpl : ""}`}>
      <div className="field" aria-hidden>
        <AnimatePresence>
          <m.div key={field} className="field-layer" style={{ background: field }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0.999 }} transition={{ duration: 1.1, ease: "easeInOut" }} />
        </AnimatePresence>
      </div>
      <div className="progress" aria-hidden />

      <nav className="top">
        <span className="top-left">
          <button type="button" className="brand" onClick={() => show(-1)} title={T.toCover}>
            Folio
          </button>
          {s.at >= 0 && s.pages.length > 1 && (
            <span className="pager">
              <button type="button" onClick={() => show(s.busy ? s.at : s.at - 1)} disabled={s.at === 0 && !s.busy} aria-label={T.prev} title={T.prev}>
                <span className="chev is-back" aria-hidden />
              </button>
              <span className="pager-n">
                {s.at + 1} / {s.pages.length}
              </span>
              <button type="button" onClick={() => show(s.at + 1)} disabled={s.busy || s.at >= s.pages.length - 1} aria-label={T.next} title={T.next}>
                <span className="chev" aria-hidden />
              </button>
            </span>
          )}
        </span>
        <span className="top-right">
          {SHOW_TIMING && (s.timing.first || s.busy) && (
            <button type="button" className="timing" onClick={() => setShowTiming((v) => !v)} title={T.timingTitle}>
              {showTiming ? <TimingLine t={s.timing} busy={s.busy} /> : T.timing}
            </button>
          )}
          {MOCK && <span className="mock-flag">{T.mock}</span>}
          {!home && (
            <button type="button" className="nav-link" onClick={() => show(-1)}>
              {T.newPage}
            </button>
          )}
          {!MOCK && (
            <button type="button" className="nav-link" onClick={() => setPanel("history")}>
              {T.history}
            </button>
          )}
          <button type="button" className="nav-link" onClick={() => setPanel("memory")}>
            {T.memory}
          </button>
          {home && (
            <button type="button" className="nav-link" onClick={switchLang} lang={T.locale === "en-US" ? "zh-CN" : "en"}>
              {T.otherLang}
            </button>
          )}
        </span>
      </nav>

      <LayoutGroup>
        <AnimatePresence mode="wait">
          {waitingFirst && !s.head ? (
            <m.div key="asking" className="asking" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.6 }}>
              <p>{s.asking}</p>
            </m.div>
          ) : s.head && stage ? (
            <m.div key={"scene-" + stage.tpl} className={waitingFirst ? "scene-wrap is-waiting" : "scene-wrap"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.5 }}>
              <Scene head={s.head} stage={stage} images={s.images} stale={s.stale} busy={s.busy} onSay={say} />
            </m.div>
          ) : (
            <m.div key="home" className={`home ${shown.length ? "has-recent" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }} transition={{ duration: 0.6 }}>
              <header>
                <h1 className="masthead">Folio</h1>
                <p className="cover-note">{T.tagline}</p>
              </header>
              {problems.length > 0 && (
                <div className="setup" role="alert">
                  <h2>{T.setupTitle}</h2>
                  <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
                  <p>{T.setupNote}</p>
                </div>
              )}
              <div className="cover-lists">
                <section>
                  <h2 className="cover-label">{T.tryLabel}</h2>
                  <ul className="cover-lines">
                    {SUGGESTIONS.slice(0, shown.length ? 3 : 4).map((q) => (
                      <li key={q}>
                        <button type="button" onClick={() => say(q)}>
                          {q}
                          <span className="chev" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                {shown.length > 0 && (
                  <section>
                    <h2 className="cover-label">
                      {T.recentLabel}
                      {!MOCK && (
                        <button type="button" onClick={() => setPanel("history")}>
                          {T.allHistory}
                          <span className="chev" aria-hidden />
                        </button>
                      )}
                    </h2>
                    <ul className="threads">
                      {shown.map((t) => (
                        <li key={t.id}>
                          <ThreadRow thread={t} onOpen={() => (MOCK ? say(t.title) : reopen(t.id))} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </LayoutGroup>

      <Composer ref={composer} busy={s.busy} asking={!!s.asking} hasHead={!!s.head} cover={home} error={s.error} onSend={sendTurn} onStop={stop} onToast={toast} />

      <AnimatePresence>
        {panel === "memory" && (
          <Suspense key="memory" fallback={null}>
            <ProfilePanel profile={profile} onChange={setProfile} onClose={() => setPanel("")} />
          </Suspense>
        )}
        {panel === "history" && (
          <Suspense key="history" fallback={null}>
            <HistoryPanel
              current={s.thread}
              onDelete={(id) => {
                const cur = state.current;
                if (cur.thread === id && cur.busy) {
                  unfinished.current = "";
                  abort.current?.abort();
                  dispatch({ type: "go", to: cur.at });
                }
                return saving.remove(id);
              }}
              onOpen={openThread}
              onClose={() => setPanel("")}
              onDeleted={(id) => {
                latest();
                if (id !== state.current.thread) return;
                unfinished.current = "";
                abort.current?.abort();
                enter({ i: -1 });
                dispatch({ type: "open", thread: "", pages: [], to: -1 });
              }}
            />
          </Suspense>
        )}
      </AnimatePresence>
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </div>
  );
}

function TimingLine({ t, busy }: { t: Timing; busy: boolean }) {
  const f = (ms?: number) => (ms == null ? "…" : T.seconds((ms / 1000).toFixed(1)));
  const parts = [`${T.tFirst} ${f(t.first)}`, `${T.tLayout} ${f(t.scene)}`];
  if (t.image != null || (busy && t.scene != null)) parts.push(`${T.tPictures} ${f(t.image)}`);
  if (t.input) parts.push(T.tCached(Math.round(((t.cached ?? 0) * 100) / t.input)));
  return <>{parts.join(" · ")}</>;
}
