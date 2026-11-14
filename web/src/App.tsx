import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { Head, Img, Op, StreamEvent, Timing, Turn } from "./types";
import { forHistory, MOCK, runTurn } from "./stream";
import { backdropGradient, midStop, stageTheme, validHex } from "./theme";
import { Scene, stageOf } from "./scene";
import { COVERS } from "./covers";
import { api, EMPTY, IdentifySheet, photoURL, ProfilePanel, Toasts, toJpeg, type Profile, type Sheet, type Toast } from "./profile";

// Shown on the cover as headlines; each leads to a different kind of page.
const SUGGESTIONS = ["周五面试，想休闲一点", "黑西装还是藏青西装，第一套买哪个", "秋天的大地色怎么配", "十二月去冰岛一周带什么", "风衣怎么选版型", "想要松弛感的风格"];

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
      for (const [id, img] of Object.entries(images)) if (img.pending) images[id] = { ...img, pending: false, failed: true };
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
    if (op.pending) images[op.id] = op.edit && prev?.url ? { ...prev, failed: false, pending: true } : { pending: true };
    else if (!op.keep || !prev) images[op.id] = prev && !op.prompt ? prev : { pending: false, failed: true };
  }
  return { ...s, turnOps, asking: "", stale, blocks: [...fresh, op, ...old], images };
}

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
  const [panel, setPanel] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const state = useRef(s);
  state.current = s;

  const stage = useMemo(() => (s.head ? stageOf(s.head, s.blocks) : null), [s.head, s.blocks]);

  // The field is the scene colour until the main picture arrives; then it
  // becomes that picture's own backdrop, so the figure stands on the page.
  const heroStops = !s.head ? cover.stops : stage?.hero ? s.images[stage.hero.id]?.stops : undefined;
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
  }, []);

  function toast(text: string, undo?: () => void) {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, text, undo }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 7000);
  }

  const saved = (r: { photo: { id: string }; profile: Profile }, text: string) => {
    setProfile(r.profile);
    toast(text, () => api.deletePhoto(r.photo.id).then(setProfile, () => {}));
  };

  // A picture only enters the profile once it is settled which person in it
  // is the user: recognised with high confidence, or pointed at by the user.
  async function upload(file: File) {
    setSheet({ stage: "looking" });
    try {
      const image = await toJpeg(file);
      setSheet({ stage: "looking", image });
      const result = await api.inspect(image);
      if (!result.people.length || !result.token) return setSheet({ stage: "nobody", image });
      if (result.auto) {
        saved(await api.confirm(result.token, 0), "认出是你，已存进档案");
        return setSheet(null);
      }
      setSheet({ stage: "choose", image, result });
    } catch (e: any) {
      setSheet({ stage: "error", message: String(e?.message ?? "请换一张图片再试。") });
    }
  }

  async function pick(index: number) {
    if (sheet?.stage !== "choose" || !sheet.result.token) return;
    setSheet({ ...sheet, saving: true });
    try {
      saved(await api.confirm(sheet.result.token, index), "已存进档案，之后的穿搭会穿在你身上");
      setSheet(null);
    } catch (e: any) {
      setSheet({ stage: "error", message: String(e?.message ?? "没存上，请再试一次。") });
    }
  }

  async function say(raw: string) {
    const input = raw.trim();
    if (!input || state.current.busy) return;
    setDraft("");
    window.scrollTo({ top: 0, behavior: "smooth" });
    const cur = state.current;
    const images: Record<string, string> = {};
    for (const [id, img] of Object.entries(cur.images)) if (img.url && /^https:/.test(img.url)) images[id] = img.url;
    dispatch({ type: "start", input });
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
      } else dispatch({ type: "event", e });
    };
    try {
      await runTurn({ input, history: cur.history, images }, onEvent, ctl.signal);
      await Promise.all(loading);
    } catch (err) {
      failed = true;
      if (!ctl.signal.aborted) dispatch({ type: "event", e: { event: "error", data: { message: "连接断了，请再试一次。" } } });
    }
    if (!ctl.signal.aborted) dispatch({ type: "finish", input, failed });
  }

  function reset() {
    abort.current?.abort();
    dispatch({ type: "reset" });
  }

  const waitingFirst = s.busy && !!s.asking;
  const mainPhoto = profile.photos.find((p) => p.main);
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
          <button type="button" className="profile-btn" onClick={() => setPanel(true)}>
            {mainPhoto && <img src={photoURL(mainPhoto.id)} alt="" />}
            档案
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
                  <h1 className="masthead">Atelier</h1>
                  <p className="cover-note">今天穿成什么样，说一句，给你排一页。</p>
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
          <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label="上传你的照片" title="上传你的照片">
            {s.busy ? <span className="orb" aria-hidden /> : "＋"}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }}
          />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={s.busy ? (s.asking ? "正在排这一页…" : "正在出图…") : s.head ? "接着说，比如“换成更正式的”" : "要去哪、做什么，直接说"}
            maxLength={400}
            aria-label="输入你的问题"
          />
          <button type="submit" className="send" disabled={!draft.trim() || s.busy} aria-label="发送">
            ↑
          </button>
        </form>
      </div>

      <AnimatePresence>
        {panel && <ProfilePanel key="panel" profile={profile} onChange={setProfile} onClose={() => setPanel(false)} onUpload={() => picker.current?.click()} />}
        {sheet && <IdentifySheet key="sheet" sheet={sheet} onPick={pick} onClose={() => setSheet(null)} />}
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
