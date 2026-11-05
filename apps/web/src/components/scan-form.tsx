'use client';

import { useState, type FormEvent } from 'react';

/** The home page's scan box. Scanning isn't built yet, so submitting only says so. */
export function ScanForm() {
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <form className="scan-form" onSubmit={submit}>
      <label htmlFor="scan-url">Your app&apos;s link</label>
      <div className="scan-row">
        <input
          id="scan-url"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://your-app.com"
          autoComplete="url"
          required
        />
        <button type="submit">Scan</button>
      </div>
      <details>
        <summary>Also scan a GitHub repo</summary>
        <label htmlFor="scan-repo">Repo link</label>
        <input
          id="scan-repo"
          name="repo"
          type="url"
          inputMode="url"
          placeholder="https://github.com/you/your-app"
        />
      </details>
      <p className="scan-status" aria-live="polite">
        {submitted && "Scanning isn't ready yet."}
      </p>
    </form>
  );
}
