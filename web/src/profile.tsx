// What the app remembers about the user, and small helpers around it.
import { useState } from "react";
import { motion } from "motion/react";

export type Pref = { id: string; text: string; added: string };
export type Profile = { prefs: Pref[] };

export const EMPTY: Profile = { prefs: [] };

export type ThreadMeta = { id: string; title: string; updated: string; count: number; bg?: string; img?: string };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "出错了，请再试一次。");
  return data as T;
}

export const api = {
  setup: () => call<{ problems: string[] }>("/api/setup"),
  profile: () => call<Profile>("/api/profile"),
  clear: () => call<Profile>("/api/profile", "DELETE"),
  deletePref: (id: string) => call<Profile>(`/api/pref/${id}`, "DELETE"),
  threads: () => call<{ threads: ThreadMeta[] }>("/api/threads"),
  thread: (id: string) => call<ThreadMeta & { pages: any[] }>(`/api/threads/${id}`),
  saveThread: (id: string, cover: { title: string; bg?: string; img?: string }, pages: unknown[]) => call<{ ok: boolean }>(`/api/threads/${id}`, "PUT", { ...cover, pages }),
  deleteThread: (id: string) => call<{ threads: ThreadMeta[] }>(`/api/threads/${id}`, "DELETE"),
};

/**
 * Phone photos are large and carry their rotation in metadata. Drawing to a
 * canvas applies the rotation and shrinks the picture before it is sent.
 */
export async function toJpeg(file: Blob, maxSide = 1600): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}

type PanelProps = { profile: Profile; onChange: (p: Profile) => void; onClose: () => void };

export function ProfilePanel({ profile, onChange, onClose }: PanelProps) {
  const [armed, setArmed] = useState(false); // "clear everything" needs a second tap
  const [error, setError] = useState("");
  const run = (p: Promise<Profile>) => p.then(onChange, (e) => setError(String(e.message ?? e)));

  return (
    <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="panel" role="dialog" aria-modal aria-label="记忆" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>记忆</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </header>

        <section>
          {profile.prefs.length === 0 ? (
            <p className="panel-note">还没有。你提到的背景和偏好会记在这里，比如“我是初中生”“多用比喻讲”，之后的讲解会照着来。</p>
          ) : (
            <ul className="prefs">
              {profile.prefs.map((p) => (
                <li key={p.id}>
                  <span>{p.text}</span>
                  <button type="button" onClick={() => run(api.deletePref(p.id))} aria-label={`忘掉：${p.text}`}>
                    忘掉
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <footer>
          <p className="panel-note">这些只存在运行这个应用的电脑上，每次提问时会一起发给模型。</p>
          {profile.prefs.length > 0 && (
            <button
              type="button"
              className={armed ? "danger is-armed" : "danger"}
              onClick={() => {
                if (!armed) return setArmed(true);
                setArmed(false);
                run(api.clear());
              }}
            >
              {armed ? "再点一次，全部忘掉" : "全部忘掉"}
            </button>
          )}
        </footer>
      </motion.aside>
    </motion.div>
  );
}

export type Toast = { id: number; text: string; undo?: () => void };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <motion.div key={t.id} className="toast" layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <span>{t.text}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                t.undo!();
                onDismiss(t.id);
              }}
            >
              撤销
            </button>
          )}
        </motion.div>
      ))}
    </div>
  );
}
