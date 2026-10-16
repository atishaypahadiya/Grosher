// The gradient ground with its three blooms. Behind every phone screen.
export function Ground({ className }: { className?: string }) {
  return (
    <div className={["ground", className].filter(Boolean).join(" ")} aria-hidden>
      <div className="bloom bloom-cream" />
      <div className="bloom bloom-lime" />
      <div className="bloom bloom-deep" />
    </div>
  );
}
