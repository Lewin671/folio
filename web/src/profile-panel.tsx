import { useState } from "react";
import { m } from "motion/react";
import { api, type Profile } from "./profile";
import { T } from "./i18n";

type PanelProps = { profile: Profile; onChange: (p: Profile) => void; onClose: () => void };

export function ProfilePanel({ profile, onChange, onClose }: PanelProps) {
  const [armed, setArmed] = useState(false); // "clear everything" needs a second tap
  const [error, setError] = useState("");
  const run = (p: Promise<Profile>) => p.then(onChange, (e) => setError(String(e.message ?? e)));

  return (
    <m.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <m.aside className="panel" role="dialog" aria-modal aria-label={T.memory} initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{T.memory}</h2>
          <button type="button" onClick={onClose}>
            {T.close}
          </button>
        </header>

        <section>
          {profile.prefs.length === 0 ? (
            <p className="panel-note">{T.memoryEmpty}</p>
          ) : (
            <ul className="prefs">
              {profile.prefs.map((p) => (
                <li key={p.id}>
                  <span>{p.text}</span>
                  <button type="button" onClick={() => run(api.deletePref(p.id))} aria-label={T.forgetThis(p.text)}>
                    {T.forget}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <footer>
          <p className="panel-note">{T.memoryNote}</p>
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
              {armed ? T.forgetAllArmed : T.forgetAll}
            </button>
          )}
        </footer>
      </m.aside>
    </m.div>
  );
}

