"use client";

import { useState } from "react";

type PreviewProps = {
  markdown?: string | null;
  json?: string | null;
};

export default function PreviewTabs({ markdown, json }: PreviewProps) {
  const [active, setActive] = useState<"markdown" | "json">(
    markdown ? "markdown" : "json"
  );

  if (!markdown && !json) {
    return <div className="note">No exports available for preview.</div>;
  }

  return (
    <div className="grid">
      <div className="tabs">
        {markdown ? (
          <button
            className={`tab-button ${active === "markdown" ? "active" : ""}`}
            onClick={() => setActive("markdown")}
            type="button"
          >
            Markdown
          </button>
        ) : null}
        {json ? (
          <button
            className={`tab-button ${active === "json" ? "active" : ""}`}
            onClick={() => setActive("json")}
            type="button"
          >
            JSON
          </button>
        ) : null}
      </div>
      {active === "markdown" && markdown ? <pre>{markdown}</pre> : null}
      {active === "json" && json ? <pre>{json}</pre> : null}
    </div>
  );
}
