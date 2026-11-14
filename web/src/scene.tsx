import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Head, Img, Op } from "./types";
import { inkOn, midStop, validHex } from "./theme";

const ease = [0.22, 1, 0.36, 1] as const;
const enter = { initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, transition: { duration: 0.2 } } };
const spring = { layout: { duration: 0.7, ease }, duration: 0.7, ease };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isSquare = (b: Op | undefined) => !!b && (b.kind === "flatlay" || b.kind === "detail");
const swatchesOf = (b: Op) => list(b.items).filter((it) => validHex(it?.hex)).slice(0, 6);

export type Stage = {
  /** How the screen is composed; decided by what the model actually sent, not only by the layout it named. */
  tpl: "center" | "side" | "gallery" | "bands" | "plain" | "note";
  hero?: Op; // the one picture the whole page is built around
  square: boolean;
  bands?: Op; // palette colours shown as full-height bands
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
  const isGallery = head.layout === "compare" || head.layout === "mood";
  const bands = head.layout === "palette" ? blocks.find((b) => b.t === "swatches" && swatchesOf(b).length >= 2) : undefined;
  const hero = !isGallery && !bands ? images[0] : undefined;
  const tiles = bands ? [] : images.filter((b) => b !== hero);
  const body = blocks.filter((b) => b !== bands && renderers[b.t] && !isEmpty(b));
  const square = isSquare(hero);
  const hasContent = body.some((b) => b.t !== "actions");
  const tpl = hero
    ? head.layout === "look" && !square ? "center" : "side"
    : bands ? "bands"
    : tiles.length || options.length ? "gallery"
    : head.layout === "note" || !hasContent ? "note" : "plain";
  return { tpl, hero, square, bands, tiles, options, body };
}

type Props = {
  head: Head;
  stage: Stage;
  images: Record<string, Img>;
  stale: Set<string>;
  busy: boolean;
  onSay: (text: string) => void;
};

export function Scene({ head, stage, images, stale, busy, onSay }: Props) {
  const { tpl, hero, bands, tiles, options, body } = stage;
  const cls = ["scene", `is-${tpl}`, `layout-${head.layout}`, `tone-${head.tone}`].join(" ");
  const tileStyle = (b: Op) => {
    const c = midStop(images[b.id]?.stops) ?? (validHex(b.bg) ? b.bg.trim() : undefined);
    return c ? { ["--tile" as any]: c, ["--tile-ink" as any]: inkOn(c) } : undefined;
  };

  return (
    <main className={cls}>
      <AnimatePresence>
        {hero && (
          <motion.div key={hero.id} className={`hero ${stale.has(hero.id) ? "is-stale" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            <Figure img={images[hero.id]} />
          </motion.div>
        )}
      </AnimatePresence>

      {bands && (
        <div className={`bands ${swatchesOf(bands).length > 4 ? "is-many" : ""}`}>
          {swatchesOf(bands).map((it, i, all) => (
            <motion.div
              key={i}
              className="band"
              style={{ background: it.hex, color: inkOn(it.hex) }}
              initial={{ flexGrow: 0.001 }}
              animate={{ flexGrow: 1 + (all.length - 1 - i) * 0.45 }}
              transition={{ duration: 1.1, ease, delay: 0.12 * i }}
            >
              <div className="band-label">
                <span className="band-role">{str(it.role)}</span>
                <span className="band-name">{str(it.name)}</span>
                <span className="band-hex">{String(it.hex).toUpperCase()}</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <header className="head">
        {str(head.kicker) && (
          <motion.p className="kicker" key={head.kicker} {...enter} transition={spring}>
            {head.kicker}
          </motion.p>
        )}
        <motion.h1 className={`title len-${titleLen(head.title)}`} key={head.title} {...enter} transition={{ ...spring, delay: 0.06 }}>
          {head.title}
        </motion.h1>
        {str(head.lede) && (
          <motion.p className="lede" key={head.lede} {...enter} transition={{ ...spring, delay: 0.14 }}>
            {head.lede}
          </motion.p>
        )}
      </header>

      {(options.length > 0 || tiles.length > 0) && (
        <div className="gallery">
          <AnimatePresence mode="popLayout">
            {options.map((b, i) => (
              <motion.article key={b.id} layoutId={b.id} layout="position" style={tileStyle(b)} className={`tile option ${b.pick ? "is-pick" : ""} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={{ ...spring, delay: 0.08 * i }}>
                <div className="tile-figure">
                  <Figure img={images[b.id]} />
                </div>
                <div className="tile-text">
                  <p className="option-tag">
                    {b.pick && <span className="pick">推荐</span>}
                    {str(b.tag)}
                  </p>
                  <h2>{str(b.title)}</h2>
                  <ul className="points">
                    {list(b.points).slice(0, 3).map((p, i) => (
                      <li key={i}>{str(p)}</li>
                    ))}
                  </ul>
                </div>
              </motion.article>
            ))}
            {tiles.map((b, i) => (
              <motion.div key={b.id} layoutId={b.id} layout="position" style={tileStyle(b)} className={`tile picture ${isSquare(b) ? "is-square" : ""} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={{ ...spring, delay: 0.08 * i }}>
                <Figure img={images[b.id]} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="body">
        <AnimatePresence mode="popLayout">
          {body.map((b) => {
            const Block = renderers[b.t];
            return (
              <motion.section key={b.id} layoutId={b.id} layout="position" className={`block block-${b.t} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={spring}>
                <Block op={b} onSay={onSay} busy={busy} />
              </motion.section>
            );
          })}
        </AnimatePresence>
      </div>
    </main>
  );
}

/** Long titles get a smaller size so the display type never breaks the page. */
function titleLen(title: unknown) {
  const n = [...str(title)].length;
  return n <= 6 ? "s" : n <= 10 ? "m" : n <= 16 ? "l" : "xl";
}

function Figure({ img }: { img?: Img }) {
  const url = img?.url;
  return (
    <figure className={`figure ${img?.pending ? "is-waiting" : ""}`}>
      <div className="figure-imgs">
        <AnimatePresence>
          {url && (
            <motion.img key={url} src={url} alt="" draggable={false} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1, ease }} />
          )}
        </AnimatePresence>
      </div>
      {!url && !img?.failed && <div className="figure-ghost" aria-hidden />}
      {img?.pending && <figcaption>{url ? "正在换装" : "正在出图"}</figcaption>}
      {img?.failed && <figcaption>{url ? "没换成功，保留原图" : "图没出来"}</figcaption>}
    </figure>
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
    default:
      return !list(b.items).length;
  }
}

const renderers: Record<string, (p: BlockProps) => React.ReactNode> = {
  text: ({ op }) => <p className="text">{str(op.body)}</p>,

  quote: ({ op }) => <blockquote>{str(op.body)}</blockquote>,

  pieces: ({ op, onSay, busy }) => (
    <ul className="pieces">
      {list(op.items).slice(0, 7).map((it, i) => (
        <li key={str(it.id) || i}>
          <button type="button" disabled={busy} onClick={() => onSay(`把「${str(it.name)}」换成另一件，你来定，其余不变`)}>
            <span className="dot" style={validHex(it.hex) ? { background: it.hex } : undefined} />
            <span className="piece-text">
              <span className="piece-name">{str(it.name)}</span>
              {str(it.note) && <span className="piece-note">{str(it.note)}</span>}
            </span>
            <span className="piece-swap">换一件</span>
          </button>
        </li>
      ))}
    </ul>
  ),

  swatches: ({ op }) => (
    <div className="swatches">
      {swatchesOf(op).map((it, i) => (
        <div key={i} className="swatch" style={{ background: it.hex, color: inkOn(it.hex) }}>
          <span className="swatch-name">{str(it.name)}</span>
          <span className="swatch-role">{str(it.role)}</span>
        </div>
      ))}
    </div>
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

  rules: ({ op }) => (
    <div className="rules">
      {list(op.do).length > 0 && (
        <div className="rule-card">
          <h3>这样做</h3>
          <ul>{list(op.do).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
        </div>
      )}
      {list(op.dont).length > 0 && (
        <div className="rule-card is-dont">
          <h3>别这样</h3>
          <ul>{list(op.dont).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
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
        <b>{done.size}</b> / {total} 已装
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
