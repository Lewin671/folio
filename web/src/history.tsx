// Earlier conversations, kept on the server so they can be reopened later.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { api, type ThreadMeta } from "./profile";

const day = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
};

type Props = { current: string; onOpen: (id: string) => void; onDeleted: (id: string) => void; onClose: () => void };

export function HistoryPanel({ current, onOpen, onDeleted, onClose }: Props) {
  const [threads, setThreads] = useState<ThreadMeta[] | null>(null);
  const [armed, setArmed] = useState(""); // deleting needs a second tap
  const [error, setError] = useState("");
  const fail = (e: any) => setError(String(e?.message ?? e));

  useEffect(() => {
    api.threads().then((r) => setThreads(r.threads), fail);
  }, []);

  return (
    <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="panel" role="dialog" aria-modal aria-label="历史" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>历史</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </header>

        <section>
          {threads === null ? (
            !error && <p className="panel-note">正在读取…</p>
          ) : threads.length === 0 ? (
            <p className="panel-note">还没有。问过的每一页都会留在这里，下次进来可以接着看、接着问。</p>
          ) : (
            <ul className="threads">
              {threads.map((t) => (
                <li key={t.id} className={t.id === current ? "is-current" : ""}>
                  <button type="button" className="thread" onClick={() => onOpen(t.id)}>
                    <span className="thread-pic" style={{ background: t.bg }}>
                      {t.img && <img src={t.img} alt="" loading="lazy" />}
                    </span>
                    <span className="thread-text">
                      <strong>{t.title || "未命名的一页"}</strong>
                      <small>
                        {day(t.updated)} · {t.count} 页{t.id === current ? " · 正在看" : ""}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="thread-del"
                    onClick={() => {
                      if (armed !== t.id) return setArmed(t.id);
                      setArmed("");
                      api.deleteThread(t.id).then((r) => (setThreads(r.threads), onDeleted(t.id)), fail);
                    }}
                  >
                    {armed === t.id ? "确定删除" : "删除"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <footer>
          <p className="panel-note">这些页面和里面的图片存在运行这个应用的电脑上，能打开这个地址的人都看得到。</p>
        </footer>
      </motion.aside>
    </motion.div>
  );
}
