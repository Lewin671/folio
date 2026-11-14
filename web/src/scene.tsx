import { memo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { Head, Img, Op } from "./types";
import { inkOn, midStop, validHex } from "./theme";
import { T } from "./i18n";

const ease = [0.22, 1, 0.36, 1] as const;
const enter = { initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, transition: { duration: 0.2 } } };
const spring = { layout: { duration: 0.7, ease }, duration: 0.7, ease };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const kindOf = (b: Op | undefined) => str(b?.kind);
/** Square pictures: a set of objects, a detail, a place, or whatever the user attached. */
const isSquare = (b: Op | undefined) => ["set", "detail", "scene", "upload"].includes(kindOf(b));
/** Pictures with no studio backdrop to continue, shown in a frame instead of merged into the page. */
const isFramed = (b: Op | undefined) => ["scene", "upload"].includes(kindOf(b));
const bandsOf = (b: Op) => list(b.items).filter((it) => validHex(it?.hex) && str(it?.name)).slice(0, 6);

export type Stage = {
  /** How the screen is composed; decided by what the model actually sent, not only by the layout it named. */
  tpl: "center" | "side" | "gallery" | "bands" | "plain" | "note";
  hero?: Op; // the one picture the whole page is built around
  square: boolean;
  framed: boolean;
  bands?: Op; // layers shown as full-height bands
  tiles: Op[];
  options: Op[];
  body: Op[];
};

/**
 * The model may put any block in any layout, so the composition is chosen
 * from the blocks that arrived: every combination has a place to go.
 */
export function stageOf(head: Head, blocks: Op[]): Stage {
  const images = blocks.filter((b) => b.t === "image");
  const options = blocks.filter((b) => b.t === "option");
  const isGallery = head.layout === "compare" || head.layout === "gallery";
  const bands = blocks.find((b) => b.t === "bands" && bandsOf(b).length >= 2);
  const hero = !isGallery && !bands ? images[0] : undefined;
  const tiles = bands ? [] : images.filter((b) => b !== hero);
  const body = blocks.filter((b) => b !== bands && renderers[b.t] && !isEmpty(b));
  const square = isSquare(hero);
  const hasContent = body.some((b) => b.t !== "actions");
  const tpl = hero
    ? head.layout === "subject" && !square ? "center" : "side"
    : bands ? "bands"
    : tiles.length || options.length ? "gallery"
    : head.layout === "note" || !hasContent ? "note" : "plain";
  return { tpl, hero, square, framed: isFramed(hero), bands, tiles, options, body };
}

type Props = {
  head: Head;
  stage: Stage;
  images: Record<string, Img>;
  stale: Set<string>;
  busy: boolean;
  onSay: (text: string) => void;
};

export const Scene = memo(function Scene({ head, stage, images, stale, busy, onSay }: Props) {
  const { tpl, hero, bands, tiles, options, body } = stage;
  const done = body.some((b) => b.t === "actions");
  const cls = ["scene", `is-${tpl}`, `layout-${head.layout}`, `tone-${head.tone}`].join(" ");
  const tileStyle = (b: Op) => {
    const c = midStop(images[b.id]?.stops) ?? (validHex(b.bg) ? b.bg.trim() : undefined);
    return c ? { ["--tile" as any]: c, ["--tile-ink" as any]: inkOn(c) } : undefined;
  };

  // An option the model gave no picture is set in type alone, not shown as a picture that failed.
  const bare = (b: Op) => !images[b.id]?.url && !images[b.id]?.pending;

  return (
    <main className={cls}>
      <AnimatePresence>
        {hero && (
          <m.div key={hero.id} className={`hero ${stage.framed ? "is-framed" : ""} ${kindOf(hero) === "upload" ? "is-upload" : ""} ${stale.has(hero.id) ? "is-stale" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <Figure img={images[hero.id]} />
          </m.div>
        )}
      </AnimatePresence>

      {bands && <Bands op={bands} />}

      <header className="head">
        {str(head.kicker) && (
          <m.p className="kicker" key={head.kicker} {...enter} transition={spring}>
            {head.kicker}
          </m.p>
        )}
        <m.h1 className="title" style={{ ["--per" as any]: titlePer(head.title) }} key={head.title} {...enter} transition={{ ...spring, delay: 0.06 }}>
          {head.title}
        </m.h1>
        {str(head.lede) && (
          <m.p className="lede" key={head.lede} {...enter} transition={{ ...spring, delay: 0.14 }}>
            {head.lede}
          </m.p>
        )}
      </header>

      {(options.length > 0 || tiles.length > 0) && (
        <div className="gallery">
          <AnimatePresence mode="popLayout">
            {options.map((b, i) => (
              <m.article key={b.id} layoutId={b.id} layout="position" style={tileStyle(b)} className={`tile option ${b.pick ? "is-pick" : ""} ${bare(b) ? "is-bare" : ""} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={{ ...spring, delay: 0.08 * i }}>
                {!bare(b) && (
                  <div className="tile-figure">
                    <Figure img={images[b.id]} />
                  </div>
                )}
                <div className="tile-text">
                  <p className="option-tag">
                    {b.pick && <span className="pick">{T.pick}</span>}
                    {str(b.tag)}
                  </p>
                  <h2>{str(b.title)}</h2>
                  <ul className="points">
                    {list(b.points).slice(0, 3).map((p, i) => (
                      <li key={i}>{str(p)}</li>
                    ))}
                  </ul>
                </div>
              </m.article>
            ))}
            {tiles.map((b, i) => (
              <m.div key={b.id} layoutId={b.id} layout="position" style={tileStyle(b)} className={`tile picture ${isSquare(b) ? "is-square" : ""} ${isFramed(b) ? "is-framed" : ""} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={{ ...spring, delay: 0.08 * i }}>
                <Figure img={images[b.id]} />
                {/* Says what the picture shows, so it can be matched to the text beside it. */}
                {str(b.caption) && (
                  <p className="tile-caption">
                    <span className="n">{String(i + 1).padStart(2, "0")}</span>
                    <b>{str(b.caption)}</b>
                    {str(b.note) && <small>{str(b.note)}</small>}
                  </p>
                )}
              </m.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="body">
        <AnimatePresence mode="popLayout">
          {body.map((b) => {
            const Block = renderers[b.t];
            return (
              <m.section key={b.id} layoutId={b.id} layout="position" className={`block block-${b.t} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={spring}>
                <Block op={b} onSay={onSay} busy={busy} />
              </m.section>
            );
          })}
        </AnimatePresence>
        {done && <p className="fineprint">{T.fineprint}</p>}
      </div>
    </main>
  );
});

/**
 * How many characters a line of the title should hold: a short title stays on
 * one line, longer ones are split over two or three lines of even length.
 */
function titlePer(title: unknown) {
  // Latin letters are about half as wide as Chinese characters.
  let n = 0;
  for (const ch of str(title)) n += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
  const lines = n <= 9 ? 1 : n <= 20 ? 2 : 3;
  return Math.max(4, Math.ceil(n / lines) + (lines > 1 ? 1 : 0));
}

function Figure({ img }: { img?: Img }) {
  const url = img?.url;
  return (
    <figure className={`figure ${img?.pending ? "is-waiting" : ""}`}>
      <div className="figure-imgs">
        <AnimatePresence>
          {url && (
            <m.img key={url} src={url} alt="" draggable={false} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1, ease }} />
          )}
        </AnimatePresence>
      </div>
      {!url && !img?.failed && <div className="figure-ghost" aria-hidden />}
      {img?.pending && <figcaption>{url ? T.picEditing : T.picMaking}</figcaption>}
      {img?.failed && <figcaption>{url ? T.picEditFailed : T.picFailed}</figcaption>}
    </figure>
  );
}

/** Layers of something, each a band of its own colour sized by its weight. */
function Bands({ op }: { op: Op }) {
  const items = bandsOf(op);
  const rows = op.dir !== "cols";
  const weights = items.map((it) => (typeof it.weight === "number" && it.weight > 0 ? it.weight : 1));
  const top = Math.max(...weights);
  return (
    <div className={`bands ${rows ? "is-rows" : "is-cols"} ${items.length > 4 ? "is-many" : ""}`}>
      {items.map((it, i) => (
        <m.div
          key={i}
          className="band"
          style={{ background: it.hex, color: inkOn(it.hex) }}
          initial={{ flexGrow: 0.001 }}
          // Square root keeps a thin layer tall enough to carry its label.
          animate={{ flexGrow: 0.7 + 2.3 * Math.sqrt(weights[i] / top) }}
          transition={{ duration: 1.1, ease, delay: 0.12 * i }}
        >
          <div className="band-label">
            <span className="band-value">{str(it.value)}</span>
            <span className="band-name">{str(it.name)}</span>
            {str(it.note) && <span className="band-note">{str(it.note)}</span>}
          </div>
        </m.div>
      ))}
    </div>
  );
}

type BlockProps = { op: Op; onSay: (text: string) => void; busy: boolean };

function isEmpty(b: Op) {
  switch (b.t) {
    case "text":
    case "quote":
      return !str(b.body);
    case "rules":
      return !list(b.do).length && !list(b.dont).length;
    case "checklist":
      return !list(b.groups).length;
    case "quiz":
      return !str(b.question) || list(b.options).length < 2;
    default:
      return !list(b.items).length;
  }
}

const Parts = ({ op, onSay, busy }: BlockProps) => (
  <ul className="parts">
    {list(op.items).slice(0, 6).map((it, i) => (
      <li key={str(it.id) || i}>
        <button type="button" disabled={busy} onClick={() => onSay(T.more(str(it.name)))}>
          {validHex(it.hex) && <span className="dot" style={{ background: it.hex }} />}
          <span className="part-text">
            <span className="part-name">{str(it.name)}</span>
            {str(it.note) && <span className="part-note">{str(it.note)}</span>}
          </span>
          <span className="chev" aria-label={T.moreLabel} />
        </button>
      </li>
    ))}
  </ul>
);

const renderers: Record<string, (p: BlockProps) => React.ReactNode> = {
  text: ({ op }) => <p className="text">{str(op.body)}</p>,

  quote: ({ op }) => <blockquote>{str(op.body)}</blockquote>,

  parts: Parts,
  pieces: Parts, // earlier name, still accepted

  timeline: ({ op }) => (
    <ol className="timeline">
      {list(op.items).slice(0, 6).map((it, i) => (
        <li key={i}>
          <span className={`when ${[...str(it.when)].length > 7 ? "is-long" : ""}`}>{str(it.when)}</span>
          <div>
            <h3>{str(it.title)}</h3>
            {str(it.body) && <p>{str(it.body)}</p>}
          </div>
        </li>
      ))}
    </ol>
  ),

  steps: ({ op }) => (
    <ol className="steps">
      {list(op.items).slice(0, 5).map((it, i) => (
        <li key={i}>
          <span className="step-n">{i + 1}</span>
          <div>
            <h3>{str(it.title)}</h3>
            {str(it.body) && <p>{str(it.body)}</p>}
          </div>
        </li>
      ))}
    </ol>
  ),

  cards: ({ op }) => <Cards items={list(op.items).filter((it) => str(it?.front)).slice(0, 6)} />,

  quiz: ({ op }) => <Quiz op={op} />,

  bars: ({ op }) => {
    const items = list(op.items).filter((it) => typeof it?.value === "number" && it.value >= 0 && str(it.label)).slice(0, 7);
    const top = Math.max(...items.map((it) => it.value), 1e-9);
    return (
      <div className="bars">
        {items.map((it, i) => (
          <div className="bar" key={i}>
            <span className="bar-label">{str(it.label)}</span>
            <span className="bar-track">
              <m.span className="bar-fill" initial={{ width: 0 }} animate={{ width: `${Math.max((it.value / top) * 100, 1.5)}%` }} transition={{ duration: 1, ease, delay: 0.08 * i }} />
            </span>
            <span className="bar-value">
              {it.value.toLocaleString("zh-CN")}
              {str(op.unit) && <small> {str(op.unit)}</small>}
            </span>
          </div>
        ))}
      </div>
    );
  },

  rules: ({ op }) => (
    <div className="rules">
      {list(op.do).length > 0 && (
        <div className="rule-card">
          <h3>{str(op.doLabel) || T.doLabel}</h3>
          <ul>{list(op.do).slice(0, 4).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
        </div>
      )}
      {list(op.dont).length > 0 && (
        <div className="rule-card is-dont">
          <h3>{str(op.dontLabel) || T.dontLabel}</h3>
          <ul>{list(op.dont).slice(0, 4).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
        </div>
      )}
    </div>
  ),

  checklist: ({ op }) => <Checklist groups={list(op.groups)} />,

  facts: ({ op }) => (
    <dl className="facts">
      {list(op.items).slice(0, 4).map((it, i) => (
        <div key={i}>
          <dd>{str(it.value)}</dd>
          <dt>{str(it.label)}</dt>
        </div>
      ))}
    </dl>
  ),

  // The next steps are part of the page the model composed, not chrome around it.
  actions: ({ op, onSay, busy }) => (
    <div className="actions">
      {list(op.items)
        .filter((x) => str(x?.label))
        .slice(0, 3)
        .map((x) => (
          <button type="button" key={str(x.label)} disabled={busy} onClick={() => onSay(str(x.say) || str(x.label))}>
            {str(x.label)}
          </button>
        ))}
    </div>
  ),
};

/** Cards that turn over on a tap: the question in front, the answer behind. */
function Cards({ items }: { items: any[] }) {
  const [turned, setTurned] = useState<Set<number>>(new Set());
  const flip = (i: number) =>
    setTurned((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  return (
    <div className="cards">
      {items.map((it, i) => (
        <button type="button" key={i} className={`card ${turned.has(i) ? "is-turned" : ""}`} onClick={() => flip(i)} aria-label={turned.has(i) ? T.flipBack : T.flip}>
          <span className="card-inner">
            <span className="card-face card-front">
              <small>{String(i + 1).padStart(2, "0")}</small>
              {str(it.front)}
            </span>
            <span className="card-face card-back">{str(it.back)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** One question; the answer and the reason appear once an option is chosen. */
function Quiz({ op }: { op: Op }) {
  const [picked, setPicked] = useState<number | null>(null);
  const options = list(op.options).slice(0, 4);
  const answer = typeof op.answer === "number" ? op.answer : -1;
  return (
    <div className={`quiz ${picked !== null ? "is-answered" : ""}`}>
      <h3>{str(op.question)}</h3>
      <div className="quiz-options">
        {options.map((o, i) => (
          <button type="button" key={i} disabled={picked !== null} className={picked === null ? "" : i === answer ? "is-right" : i === picked ? "is-wrong" : "is-rest"} onClick={() => setPicked(i)}>
            <span className="quiz-key">{"ABCD"[i]}</span>
            <span className="quiz-text">{str(o)}</span>
            <span className="quiz-mark" aria-hidden />
          </button>
        ))}
      </div>
      {picked !== null && (
        <m.p className="quiz-why" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          {picked === answer ? T.right : T.wrong}
          {str(op.why)}
        </m.p>
      )}
    </div>
  );
}

function Checklist({ groups }: { groups: any[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const total = groups.reduce((n, g) => n + list(g.items).length, 0);
  return (
    <div className="checklist">
      <p className="checklist-count">
        <b>{done.size}</b> / {total} {T.done}
      </p>
      <div className="checklist-groups">
        {groups.map((g, gi) => (
          <div className="checklist-group" key={gi}>
            <h3>{str(g.title)}</h3>
            <ul>
              {list(g.items).map((it, i) => {
                const k = `${gi}-${i}`;
                return (
                  <li key={k}>
                    <label className={done.has(k) ? "is-done" : ""}>
                      <input type="checkbox" checked={done.has(k)} onChange={() => toggle(k)} />
                      <span>{str(it)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
