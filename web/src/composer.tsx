import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { toJpeg } from "./profile";
import { T } from "./i18n";
import { hasImageFile, imageFile } from "./composer-files";

const SEND_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵";
const CONTENT_SIZING = typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");
const HOVER = typeof matchMedia !== "function" || matchMedia("(hover: hover)").matches;

export type ComposerHandle = { submit: (text: string) => void; focus: () => void };
type Props = {
  ref: Ref<ComposerHandle>;
  busy: boolean;
  asking: boolean;
  hasHead: boolean;
  /** On the cover the input sits in the page, larger; elsewhere it is a bar at the foot. */
  cover: boolean;
  error: string;
  onSend: (text: string, image?: string) => boolean;
  /** Stops the page being made and returns its question. */
  onStop: () => string;
  onToast: (text: string) => void;
};

const icon = { width: 18, height: 18, viewBox: "0 0 18 18", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const Composer = memo(function Composer({ ref, busy, asking, hasHead, cover, error, onSend, onStop, onToast }: Props) {
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState("");
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const resize = useRef<() => void>(() => {});
  const picking = useRef(0);

  useEffect(() => {
    if (CONTENT_SIZING) return;
    const el = box.current!;
    const context = document.createElement("canvas").getContext("2d");
    let width = 0;
    resize.current = () => {
      if (!el.value) {
        el.style.height = "";
        return;
      }
      // Most input fits on one line. Check its width without a DOM layout;
      // measure scrollHeight only for wrapped/multiline text or when shrinking.
      if (!el.style.height && !el.value.includes("\n") && context && context.measureText(el.value).width < width) return;
      const style = getComputedStyle(el);
      el.style.height = "auto";
      const height = Math.min(el.scrollHeight, parseFloat(style.maxHeight) || 120);
      el.style.height = height <= parseFloat(style.lineHeight) + 1 ? "" : height + "px";
    };
    const observer = new ResizeObserver(([entry]) => {
      if (width === entry.contentRect.width) return;
      width = entry.contentRect.width;
      if (context) context.font = getComputedStyle(el).font;
      resize.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!CONTENT_SIZING) resize.current();
  }, [draft, cover]);

  // The cover is for asking: with a keyboard at hand the question can be typed straight away.
  useEffect(() => {
    if (cover && HOVER) box.current?.focus({ preventScroll: true });
  }, [cover]);

  function submit(text: string) {
    if (onSend(text, attach || undefined)) {
      setDraft("");
      setAttach("");
      picking.current++; // a photo still decoding must not reappear after sending
      // Keep desktop keyboard flow after clicking ↑ without reopening soft keyboards on touch devices.
      if (HOVER) box.current?.focus();
    }
  }
  useImperativeHandle(ref, () => ({ submit, focus: () => box.current?.focus() }));

  async function pickFile(file: File) {
    const version = ++picking.current;
    try {
      const image = await toJpeg(file);
      if (version === picking.current) setAttach(image);
    } catch {
      if (version === picking.current) onToast(T.badPic);
    }
  }
  const pick = useRef(pickFile);
  pick.current = pickFile;

  // A picture pasted or dropped anywhere on the page is attached, wherever the focus happens to be.
  useEffect(() => {
    const editable = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("textarea, input, [contenteditable]");
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const file = imageFile(e.clipboardData);
      if (file) {
        e.preventDefault();
        return void pick.current(file);
      }
      const text = editable(e.target) ? "" : e.clipboardData.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      setDraft((d) => (d + text).slice(0, 400));
      box.current?.focus();
    };
    let leave = 0;
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !hasImageFile(e.dataTransfer)) return;
      e.preventDefault();
      setDropping(true);
      // dragleave fires between every element crossed; a pause in dragover means the picture left.
      clearTimeout(leave);
      leave = window.setTimeout(() => setDropping(false), 150);
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer && imageFile(e.dataTransfer);
      if (!file) return;
      e.preventDefault();
      setDropping(false);
      void pick.current(file);
    };
    document.addEventListener("paste", onPaste);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      clearTimeout(leave);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, []);

  const empty = !draft.trim() && !attach;
  return (
    <div className="dock">
      <form className={`composer ${dropping ? "is-dropping" : ""}`} onSubmit={(e) => { e.preventDefault(); submit(draft); }}
        onClick={(e) => { if (e.target === e.currentTarget) box.current?.focus(); }}>
        {attach ? (
          <button type="button" className="attach has-image" onClick={() => { picking.current++; setAttach(""); }} aria-label={T.removePic} title={T.removePic}>
            <img src={attach} alt="" />
          </button>
        ) : (
          <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label={T.addPic} title={T.addPicTitle}>
            <svg {...icon}><path d="M9 3.5v11M3.5 9h11" /></svg>
          </button>
        )}
        <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void pickFile(file);
        }} />
        {/* Return inserts a line; IME confirmation must never send a question. */}
        <textarea ref={box} rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!busy) submit(draft);
          }
        }} placeholder={busy ? (asking ? T.phMaking : T.phPictures) : attach ? T.phWithPic : hasHead ? T.phFollow : T.phFirst}
          maxLength={400} aria-label={T.inputLabel} enterKeyHint="enter" />
        {!empty && !busy && <kbd className="send-key" aria-hidden>{SEND_KEY}</kbd>}
        {busy ? (
          <button type="button" className="send is-stop" onClick={() => { const asked = onStop(); if (asked && !draft) setDraft(asked); }} aria-label={T.stop} title={T.stop}>
            <svg {...icon}><rect x="5" y="5" width="8" height="8" rx="1" fill="currentColor" stroke="none" /></svg>
          </button>
        ) : (
          <button type="submit" className="send" disabled={empty} aria-label={T.send} title={`${T.send} (${SEND_KEY})`}>
            <svg {...icon}><path d="M9 14.5v-11M4.5 8 9 3.5 13.5 8" /></svg>
          </button>
        )}
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
});
