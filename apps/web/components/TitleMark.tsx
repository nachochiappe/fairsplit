interface TitleMarkProps {
  className?: string;
}

export function TitleMark({ className }: TitleMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-10 w-10 rotate-12 overflow-hidden rounded-[0.6rem] bg-slate-200 shadow-[0_4px_12px_rgba(15,23,42,0.16)] ${className ?? ''}`}
    >
      <span className="absolute inset-0 bg-gradient-to-br from-white/30 to-transparent" />
      <span className="absolute left-[-45%] top-1/2 h-2.5 w-[190%] -translate-y-1/2 rotate-45 bg-gradient-to-r from-teal-400 to-purple-500" />
    </span>
  );
}
