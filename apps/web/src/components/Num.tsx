// A number set in Doto with its unit in Outfit 300 at ~42% (DESIGN.md §2 Type).
export function Num({ value, unit, className, size }: { value: string | number; unit?: string; className?: string; size?: number }) {
  return (
    <span className={["num", className].filter(Boolean).join(" ")} style={size ? { fontSize: size } : undefined}>
      {value}
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}
