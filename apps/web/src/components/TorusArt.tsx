// Hairline torus: nested ellipses at white 55%, .8px, one lime dot at the center.
const RINGS = 14;

export function TorusArt({ className }: { className?: string }) {
  const rings = Array.from({ length: RINGS }, (_, i) => {
    const t = i / (RINGS - 1);
    return { rx: 36 + t * 134, ry: 10 + t * 56, rot: (i % 2 ? 1 : -1) * t * 9, cy: 76 + Math.sin(t * Math.PI) * 4 };
  });
  return (
    <svg className={["torus", className].filter(Boolean).join(" ")} viewBox="0 0 340 152" aria-hidden>
      <g fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="0.8">
        {rings.map((r, i) => (
          <ellipse key={i} cx={170} cy={r.cy} rx={r.rx} ry={r.ry} transform={`rotate(${r.rot} 170 ${r.cy})`} />
        ))}
      </g>
      <circle cx={170} cy={76} r={10} fill="rgba(212,255,74,0.25)" />
      <circle cx={170} cy={76} r={5} fill="#D4FF4A" />
    </svg>
  );
}
