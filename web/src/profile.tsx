// The user's profile: confirmed photos of themselves, an appearance note and
// remembered preferences, plus the sheet that asks "which one is you".
import { useState } from "react";
import { motion } from "motion/react";

export type Photo = { id: string; added: string; main: boolean };
export type Pref = { id: string; text: string; added: string };
export type Profile = { photos: Photo[]; appearance: string; prefs: Pref[] };
export type Person = { box: [number, number, number, number]; desc: string };
export type Inspection = { people: Person[]; guess: number; confidence: number; known: boolean; auto: boolean; token?: string };

export const EMPTY: Profile = { photos: [], appearance: "", prefs: [] };
export const photoURL = (id: string) => `/api/photo/${id}`;

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "出错了，请再试一次。");
  return data as T;
}

export const api = {
  setup: () => call<{ problems: string[] }>("/api/setup"),
  profile: () => call<Profile>("/api/profile"),
  clear: () => call<Profile>("/api/profile", "DELETE"),
  inspect: (image: string) => call<Inspection>("/api/photo/inspect", "POST", { image }),
  confirm: (token: string, index: number) => call<{ photo: Photo; profile: Profile }>("/api/photo/confirm", "POST", { token, index }),
  deletePhoto: (id: string) => call<Profile>(`/api/photo/${id}`, "DELETE"),
  setMain: (id: string) => call<Profile>(`/api/photo/${id}/main`, "POST"),
  deletePref: (id: string) => call<Profile>(`/api/pref/${id}`, "DELETE"),
};

/**
 * Phone photos are large and carry their rotation in metadata. Drawing to a
 * canvas applies the rotation and shrinks the picture, so the server and the
 * boxes drawn over it agree on what the picture looks like.
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

export type Sheet =
  | { stage: "looking"; image?: string }
  | { stage: "choose"; image: string; result: Inspection; saving?: boolean }
  | { stage: "nobody"; image: string }
  | { stage: "error"; message: string };

/** Below this the model's guess is not shown: a wrong hint is worse than none. */
const HINT_CONFIDENCE = 0.85;

export function IdentifySheet({ sheet, onPick, onClose }: { sheet: Sheet; onPick: (index: number) => void; onClose: () => void }) {
  const people = sheet.stage === "choose" ? sheet.result.people : [];
  const many = people.length > 1;
  const hint = sheet.stage === "choose" && sheet.result.confidence >= HINT_CONFIDENCE ? sheet.result.guess : -1;
  const saving = sheet.stage === "choose" && !!sheet.saving;

  let title = "正在看这张照片";
  let note = "";
  if (sheet.stage === "error") [title, note] = ["没能处理这张图", sheet.message];
  if (sheet.stage === "nobody") [title, note] = ["这张图里没看到人", "档案只保存你本人的照片，用来生成试穿图。"];
  if (sheet.stage === "choose") {
    if (many) [title, note] = ["点一下哪个是你", "只会裁出并保存你本人，其他人不会留下。"];
    else if (!sheet.result.known) [title, note] = ["这是你本人吗", "确认后存进档案，之后的穿搭会穿在你身上。"];
    else if (sheet.result.guess === 0) [title, note] = ["看起来是你，确认一下", "和档案里的照片比对过，但把握不够，所以问一句。"];
    else [title, note] = ["这和档案里的你不太像", "如果确实是你本人，点确认就会存进档案。"];
  }

  return (
    <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={saving ? undefined : onClose}>
      <motion.div className="sheet" role="dialog" aria-modal aria-label={title} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {note && <p className="sheet-note">{note}</p>}
        {"image" in sheet && sheet.image && (
          <div className={`sheet-photo ${sheet.stage === "looking" ? "is-looking" : ""}`}>
            <img src={sheet.image} alt="你上传的照片" />
            {people.map((p, i) => (
              <button
                key={i}
                type="button"
                className={`who ${i === hint ? "is-hint" : ""}`}
                style={{ left: `${p.box[0] * 100}%`, top: `${p.box[1] * 100}%`, width: `${(p.box[2] - p.box[0]) * 100}%`, height: `${(p.box[3] - p.box[1]) * 100}%` }}
                disabled={saving}
                onClick={() => onPick(i)}
                aria-label={`这个是我：${p.desc}`}
              >
                {many && <span>{i === hint ? "像是你" : "是我"}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          {sheet.stage === "choose" && !many && (
            <button type="button" className="primary" disabled={saving} onClick={() => onPick(0)}>
              {saving ? "正在保存…" : "是我，存进档案"}
            </button>
          )}
          {sheet.stage !== "looking" && (
            <button type="button" disabled={saving} onClick={onClose}>
              {sheet.stage === "choose" ? (many ? "都不是我" : "不是我") : "好"}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

type PanelProps = { profile: Profile; onChange: (p: Profile) => void; onClose: () => void; onUpload: () => void };

export function ProfilePanel({ profile, onChange, onClose, onUpload }: PanelProps) {
  const [armed, setArmed] = useState(false); // "clear everything" needs a second tap
  const [error, setError] = useState("");
  const run = (p: Promise<Profile>) => p.then(onChange, (e) => setError(String(e.message ?? e)));
  const empty = profile.photos.length === 0 && profile.prefs.length === 0;

  return (
    <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="panel" role="dialog" aria-modal aria-label="档案" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>档案</h2>
          <button type="button" onClick={onClose} aria-label="关闭">
            关闭
          </button>
        </header>

        <section>
          <h3>你的照片</h3>
          <div className="album">
            {profile.photos.map((ph) => (
              <div key={ph.id} className={`album-item ${ph.main ? "is-main" : ""}`}>
                <button type="button" className="album-photo" onClick={() => !ph.main && run(api.setMain(ph.id))} title={ph.main ? "试穿用的是这张" : "改用这张试穿"}>
                  <img src={photoURL(ph.id)} alt="" />
                  {ph.main && <span>试穿用这张</span>}
                </button>
                <button type="button" className="album-del" onClick={() => run(api.deletePhoto(ph.id))} aria-label="删除这张照片">
                  删除
                </button>
              </div>
            ))}
            <button type="button" className="album-add" onClick={onUpload}>
              <b>＋</b>
              添加照片
            </button>
          </div>
          {profile.appearance && <p className="panel-note">{profile.appearance}</p>}
        </section>

        <section>
          <h3>记住的偏好</h3>
          {profile.prefs.length === 0 ? (
            <p className="panel-note">还没有。聊天里提到的长期偏好会记在这里，比如“不穿高跟鞋”。</p>
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
          <p className="panel-note">照片和偏好只存在运行这个应用的电脑上。生成试穿图和识别照片时，照片会发给火山引擎的模型。</p>
          {!empty && (
            <button
              type="button"
              className={armed ? "danger is-armed" : "danger"}
              onClick={() => {
                if (!armed) return setArmed(true);
                setArmed(false);
                run(api.clear());
              }}
            >
              {armed ? "再点一次，全部删除" : "清空档案"}
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
