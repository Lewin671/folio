// One earlier conversation, drawn the same way wherever it is listed.
import { T } from "./i18n";
import type { ThreadMeta } from "./profile";

const day = (iso: string) => {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(T.locale, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(T.locale, { month: "long", day: "numeric" });
};

export function ThreadRow({ thread: t, current, onOpen }: { thread: ThreadMeta; current?: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="thread" onClick={onOpen}>
      <span className="thread-pic" style={{ background: t.bg }}>
        {t.img && <img src={t.img} alt="" loading="lazy" />}
      </span>
      <span className="thread-text">
        <strong>{t.title || T.untitled}</strong>
        <small>
          {day(t.updated)} · {T.pages(t.count)}{current ? " · " + T.openNow : ""}
        </small>
      </span>
    </button>
  );
}
