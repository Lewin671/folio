import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Head, Img, Op } from "./types";
import { inkOn, validHex } from "./theme";

const ease = [0.22, 1, 0.36, 1] as const;
const enter = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, transition: { duration: 0.18 } } };
const spring = { layout: { duration: 0.6, ease }, duration: 0.5, ease };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);

type Props = {
  head: Head;
  blocks: Op[];
  images: Record<string, Img>;
  stale: Set<string>;
  onSay: (text: string) => void;
};

export function Scene({ head, blocks, images, stale, onSay }: Props) {
  const media = blocks.filter((b) => b.t === "image");
  const options = blocks.filter((b) => b.t === "option");
  const body = blocks.filter((b) => renderers[b.t] && !isEmpty(b));
  const cls = ["scene", `layout-${head.layout}`, `tone-${head.tone}`, media.length ? "has-media" : "", options.length ? "has-options" : "", `media-${Math.min(media.length, 3)}`].join(" ");

  return (
    <main className={cls}>
      <header className="head">
        {str(head.kicker) && (
          <motion.p layout="position" className="kicker" key={head.kicker} {...enter} transition={spring}>
            {head.kicker}
          </motion.p>
        )}
        <motion.h1 layout="position" className="title" key={head.title} {...enter} transition={{ ...spring, delay: 0.05 }}>
          {head.title}
        </motion.h1>
        {str(head.lede) && (
          <motion.p layout="position" className="lede" key={head.lede} {...enter} transition={{ ...spring, delay: 0.12 }}>
            {head.lede}
          </motion.p>
        )}
      </header>

      {media.length > 0 && (
        <div className="media">
          <AnimatePresence mode="popLayout">
            {media.map((b) => (
              <motion.div key={b.id} layoutId={b.id} layout className={stale.has(b.id) ? "is-stale" : ""} {...enter} transition={spring}>
                <Figure img={images[b.id]} kind={str(b.kind)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {options.length > 0 && (
        <div className="options" style={{ ["--n" as any]: options.length }}>
          <AnimatePresence mode="popLayout">
            {options.map((b) => (
              <motion.article key={b.id} layoutId={b.id} layout="position" className={`option ${b.pick ? "is-pick" : ""} ${stale.has(b.id) ? "is-stale" : ""}`} {...enter} transition={spring}>
                <div className="option-figure">
                  <Figure img={images[b.id]} kind={str(b.kind)} />
                </div>
                <p className="option-tag">
                  {b.pick && <span className="pick">推荐</span>}
                  {str(b.tag)}
                </p>
                <h2>{str(b.title)}</h2>
                <ul className="points">
                  {list(b.points).map((p, i) => (
                    <li key={i}>{str(p)}</li>
                  ))}
                </ul>
              </motion.article>
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
                <Block op={b} onSay={onSay} />
              </motion.section>
            );
          })}
        </AnimatePresence>
      </div>
    </main>
  );
}

function Figure({ img, kind }: { img?: Img; kind: string }) {
  const [loaded, setLoaded] = useState<string>();
  const url = img?.url;
  const ready = !!url && loaded === url;
  const waiting = !!img?.pending || (!!url && !ready);
  return (
    <figure className={`figure kind-${kind === "flatlay" || kind === "detail" ? "square" : "figure"} ${waiting ? "is-waiting" : ""} ${ready ? "is-ready" : ""}`}>
      {url && <img key={url} src={url} alt="" onLoad={() => setLoaded(url)} draggable={false} />}
      {!ready && <div className="figure-ghost" aria-hidden />}
      {img?.pending && <figcaption>{url ? "正在换装" : "正在出图"}</figcaption>}
      {img?.failed && <figcaption>{url ? "没换成功，保留原图" : "图没出来"}</figcaption>}
    </figure>
  );
}

type BlockProps = { op: Op; onSay: (text: string) => void };

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

  pieces: ({ op, onSay }) => (
    <ul className="pieces">
      {list(op.items).map((it, i) => (
        <li key={str(it.id) || i}>
          <button type="button" onClick={() => onSay(`把「${str(it.name)}」换成另一件，你来定，其余不变`)}>
            <span className="dot" style={validHex(it.hex) ? { background: it.hex } : undefined} />
            <span className="piece-name">{str(it.name)}</span>
            <span className="piece-note">{str(it.note)}</span>
            <span className="piece-swap">换一件</span>
          </button>
        </li>
      ))}
    </ul>
  ),

  swatches: ({ op }) => {
    const items = list(op.items).filter((it) => validHex(it.hex)).slice(0, 6);
    return (
      <div className="swatches">
        {items.map((it, i) => (
          <div key={i} className="swatch" style={{ background: it.hex, color: inkOn(it.hex), flexGrow: Math.max(1, items.length - i) }}>
            <span className="swatch-role">{str(it.role)}</span>
            <span className="swatch-name">{str(it.name)}</span>
            <span className="swatch-hex">{String(it.hex).toUpperCase()}</span>
          </div>
        ))}
      </div>
    );
  },

  steps: ({ op }) => (
    <ol className="steps">
      {list(op.items).map((it, i) => (
        <li key={i}>
          <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
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
        <div>
          <h3>这样做</h3>
          <ul className="do">{list(op.do).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
        </div>
      )}
      {list(op.dont).length > 0 && (
        <div>
          <h3>别这样</h3>
          <ul className="dont">{list(op.dont).map((x, i) => <li key={i}>{str(x)}</li>)}</ul>
        </div>
      )}
    </div>
  ),

  checklist: ({ op }) => <Checklist groups={list(op.groups)} />,

  facts: ({ op }) => (
    <dl className="facts">
      {list(op.items).slice(0, 4).map((it, i) => (
        <div key={i}>
          <dt>{str(it.label)}</dt>
          <dd>{str(it.value)}</dd>
        </div>
      ))}
    </dl>
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
        已装 {done.size} / {total}
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
