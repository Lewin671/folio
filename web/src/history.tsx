// Earlier conversations, kept on the server so they can be reopened later.
import { useEffect, useState } from "react";
import { m } from "motion/react";
import { api, type ThreadMeta } from "./profile";
import { T } from "./i18n";

const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString(T.locale, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString(T.locale, { month: "long", day: "numeric" });
};

type Props = { onDelete: typeof api.deleteThread; current: string; onOpen: (id: string) => void; onDeleted: (id: string) => void; onClose: () => void };

export function HistoryPanel({ current, onOpen, onDeleted, onClose, onDelete }: Props) {
  const [threads, setThreads] = useState<ThreadMeta[] | null>(null);
  const [armed, setArmed] = useState(""); // deleting needs a second tap
  const [error, setError] = useState("");
  const fail = (e: any) => setError(String(e?.message ?? e));

  useEffect(() => {
    api.threads().then((r) => setThreads(r.threads), fail);
  }, []);

  return (
    <m.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.aside className="panel" role="dialog" aria-modal aria-label={T.history} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{T.history}</h2>
          <button type="button" onClick={onClose}>
            {T.close}
          </button>
        </header>

        <section>
          {threads === null ? (
            !error && <p className="panel-note">{T.loading}</p>
          ) : threads.length === 0 ? (
            <p className="panel-note">{T.historyEmpty}</p>
          ) : (
            <ul className="threads">
              {threads.map((t) => (
                <li key={t.id} className={t.id === current ? "is-current" : ""}>
                  <button type="button" className="thread" onClick={() => onOpen(t.id)}>
                    <span className="thread-pic" style={{ background: t.bg }}>
                      {t.img && <img src={t.img} alt="" loading="lazy" />}
                    </span>
                    <span className="thread-text">
                      <strong>{t.title || T.untitled}</strong>
                      <small>
                        {day(t.updated)} · {T.pages(t.count)}{t.id === current ? " · " + T.openNow : ""}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="thread-del"
                    onClick={() => {
                      if (armed !== t.id) return setArmed(t.id);
                      setArmed("");
                      onDelete(t.id).then((r) => (setThreads(r.threads), onDeleted(t.id)), fail);
                    }}
                  >
                    {armed === t.id ? T.delArmed : T.del}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <footer>
          <p className="panel-note">{T.historyNote}</p>
        </footer>
      </m.aside>
    </m.div>
  );
}
