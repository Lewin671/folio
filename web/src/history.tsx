// Earlier conversations, kept on the server so they can be reopened later.
import { useEffect, useState } from "react";
import { m } from "motion/react";
import { api, type ThreadMeta } from "./profile";
import { T } from "./i18n";
import { sheetMotion } from "./sheet";
import { ThreadRow } from "./thread-row";

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
      <m.aside className="panel" role="dialog" aria-modal aria-label={T.history} {...sheetMotion} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{T.history}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={T.close} title={T.close} />
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
                  <ThreadRow thread={t} current={t.id === current} onOpen={() => onOpen(t.id)} />
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
