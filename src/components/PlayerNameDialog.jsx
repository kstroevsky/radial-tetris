import { useEffect, useRef, useState } from "react";

function cleanedName(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
}

export function PlayerNameDialog({ open, initialName = "", required = false, onSave, onCancel, onPlayOffline }) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setError("");
    setSaving(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [initialName, open]);

  useEffect(() => {
    if (!open || required) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onCancel?.();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, open, required]);

  if (!open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const nextName = cleanedName(name);
    if ([...nextName].length < 1 || [...nextName].length > 24) {
      setError("Use between 1 and 24 visible characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(nextName);
    } catch (submitError) {
      setError(submitError?.message ?? "Could not save your callsign.");
      setSaving(false);
    }
  };

  return (
    <div className="leaderboard-backdrop player-dialog" data-game-input-blocking="true" role="presentation">
      <section className="player-dialog-card" role="dialog" aria-modal="true" aria-labelledby="player-dialog-title">
        <span className="eyebrow">Anonymous pilot profile</span>
        <h2 id="player-dialog-title">Choose your callsign</h2>
        <p>Your name and game totals live in the leaderboard. This browser remembers only an anonymous player ID.</p>
        <form onSubmit={submit}>
          <label htmlFor="player-name">Player name</label>
          <input
            ref={inputRef}
            id="player-name"
            name="player-name"
            value={name}
            maxLength="24"
            autoComplete="nickname"
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
            aria-describedby={error ? "player-name-error" : undefined}
          />
          {error && <span id="player-name-error" className="dialog-error" role="alert">{error}</span>}
          <div className="dialog-actions">
            {!required && <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Cancel</button>}
            <button className="primary-button" type="submit" disabled={saving}>{saving ? "Saving…" : "Lock callsign"}</button>
          </div>
          {required && error && <button className="offline-button" type="button" onClick={onPlayOffline}>Continue offline</button>}
        </form>
      </section>
    </div>
  );
}
