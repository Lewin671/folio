import { memo, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { toJpeg } from "./profile";
import { T } from "./i18n";
import { hasImageFile, imageFile } from "./composer-files";

const SEND_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵";
const CONTENT_SIZING = typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

export type ComposerHandle = { submit: (text: string) => void };
type Props = {
  ref: Ref<ComposerHandle>;
  busy: boolean;
  asking: boolean;
  hasHead: boolean;
  error: string;
  onSend: (text: string, image?: string) => boolean;
  onToast: (text: string) => void;
};

export const Composer = memo(function Composer({ ref, busy, asking, hasHead, error, onSend, onToast }: Props) {
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState("");
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
      el.style.height = "auto";
      const height = Math.min(el.scrollHeight, 120);
      el.style.height = height <= 24 ? "" : height + "px";
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
  }, [draft]);

  function submit(text: string) {
    if (onSend(text, attach || undefined)) {
      setDraft("");
      setAttach("");
      picking.current++; // a photo still decoding must not reappear after sending
      // Keep desktop keyboard flow after clicking ↑ without reopening soft keyboards on touch devices.
      if (typeof matchMedia !== "function" || matchMedia("(hover: hover)").matches) box.current?.focus();
    }
  }
  useImperativeHandle(ref, () => ({ submit }));

  async function pickFile(file: File) {
    const version = ++picking.current;
    try {
      const image = await toJpeg(file);
      if (version === picking.current) setAttach(image);
    } catch {
      if (version === picking.current) onToast(T.badPic);
    }
  }

  return (
    <div className="dock">
      {error && <p className="error" role="alert">{error}</p>}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(draft); }}
        onClick={(e) => { if (e.target === e.currentTarget) box.current?.focus(); }}
        onPaste={(e) => {
          const file = imageFile(e.clipboardData);
          if (file) { e.preventDefault(); void pickFile(file); }
        }}
        onDragOver={(e) => { if (hasImageFile(e.dataTransfer)) e.preventDefault(); }}
        onDrop={(e) => {
          const file = imageFile(e.dataTransfer);
          if (file) { e.preventDefault(); void pickFile(file); }
        }}>
        {attach ? (
          <button type="button" className="attach has-image" onClick={() => { picking.current++; setAttach(""); }} aria-label={T.removePic} title={T.removePic}>
            <img src={attach} alt="" />
          </button>
        ) : (
          <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label={T.addPic} title={T.addPicTitle}>
            {busy ? <span className="orb" aria-hidden /> : "＋"}
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
            submit(draft);
          }
        }} placeholder={busy ? (asking ? T.phMaking : T.phPictures) : attach ? T.phWithPic : hasHead ? T.phFollow : T.phFirst}
          maxLength={400} aria-label={T.inputLabel} enterKeyHint="enter" />
        {draft.trim() && !busy && <kbd className="send-key" aria-hidden>{SEND_KEY}</kbd>}
        <button type="submit" className="send" disabled={(!draft.trim() && !attach) || busy} aria-label={T.send} title={`${T.send} (${SEND_KEY})`}>↑</button>
      </form>
    </div>
  );
});
