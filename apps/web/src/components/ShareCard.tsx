import { forwardRef } from "react";
import { Num } from "./Num.tsx";
import { TorusArt } from "./TorusArt.tsx";
import { IconCheck, IconWalk } from "./Icons.tsx";

export interface ShareCardData {
  clock: string; // "11:42"
  got: number;
  total: number;
  lane: string | null;
  walkedM: number;
  aislesNever: number;
  savedPct: number; // positive = shorter
  savedMinutes: number;
  storeTag: string; // "STORY RD · THU"
  /** "3 min faster than your last trip · 40 m less", when there is a last trip */
  vsLast?: string;
}

export const ShareCard = forwardRef<HTMLDivElement, { data: ShareCardData; className?: string }>(function ShareCard({ data, className }, ref) {
  const pct = `${data.savedPct > 0 ? "−" : data.savedPct < 0 ? "+" : ""}${Math.abs(data.savedPct)}`;
  return (
    <article ref={ref} className={["share-card glass-deep", className].filter(Boolean).join(" ")} aria-label="Trip card">
      <div className="card-eyebrows">
        <span className="eyebrow">In and out</span>
        <span className="eyebrow">{data.storeTag}</span>
      </div>
      <div className="card-hero">
        <Num value={data.clock} className="hero" />
      </div>
      <p className="card-sub">
        {data.got} of {data.total} items{data.lane ? ` · lane ${data.lane}` : ""}
      </p>
      {data.vsLast && (
        <p className="card-sub card-vslast" data-testid="vs-last">
          {data.vsLast}
        </p>
      )}
      <TorusArt />
      <div className="tiles">
        <div className="stat-tile glass-deep tile">
          <div className="label-row">
            <span className="icon-circle">
              <IconWalk />
            </span>
            Walked
          </div>
          <div>
            <Num value={Math.round(data.walkedM)} unit="m" />
          </div>
          <div className="caption">
            {data.aislesNever} {data.aislesNever === 1 ? "aisle" : "aisles"} never entered
          </div>
        </div>
        <div className="stat-tile glass-deep tile">
          <div className="label-row">
            <span className="icon-circle">
              <IconCheck />
            </span>
            Vs list in order
          </div>
          <div>
            <Num value={pct} unit="%" className={data.savedPct > 0 ? "now" : undefined} />
          </div>
          <div className="caption">
            {data.savedMinutes >= 1 ? `about ${data.savedMinutes} ${data.savedMinutes === 1 ? "minute" : "minutes"} saved` : "about the same time"}
          </div>
        </div>
      </div>
      <footer className="card-foot">
        <span className="wordmark">
          <i className="dot" />
          grosher
        </span>
        <span className="tagline">Get in. Get it. Get out.</span>
      </footer>
    </article>
  );
});
