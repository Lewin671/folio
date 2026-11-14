// What the app remembers about the user, and small helpers around it.
import { m } from "motion/react";
import { LANG, T } from "./i18n";

export type Pref = { id: string; text: string; added: string };
export type Profile = { prefs: Pref[] };

export const EMPTY: Profile = { prefs: [] };

export type ThreadMeta = { id: string; title: string; updated: string; count: number; bg?: string; img?: string };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Folio-Lang": LANG };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : T.failed);
  return data as T;
}

export const api = {
  setup: () => call<{ problems: string[] }>("/api/setup"),
  profile: () => call<Profile>("/api/profile"),
  clear: () => call<Profile>("/api/profile", "DELETE"),
  deletePref: (id: string) => call<Profile>(`/api/pref/${id}`, "DELETE"),
  threads: (limit?: number) => call<{ threads: ThreadMeta[] }>(limit === undefined ? "/api/threads" : `/api/threads?limit=${limit}`),
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

export type Toast = { id: number; text: string; undo?: () => void };

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <m.div key={t.id} className="toast" layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <span>{t.text}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                t.undo!();
                onDismiss(t.id);
              }}
            >
              {T.undo}
            </button>
          )}
        </m.div>
      ))}
    </div>
  );
}
