interface TitleMarkProps {
  className?: string;
}

export function TitleMark({ className }: TitleMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-10 w-10 overflow-hidden rounded-[0.8rem] border border-brand-200 bg-brand-50 ${className ?? ''}`}
    >
      <span className="absolute inset-y-[18%] left-[24%] w-[18%] rounded-full bg-brand-700" />
      <span className="absolute inset-y-[18%] right-[24%] w-[18%] rounded-full bg-brand-700" />
      <span className="absolute left-1/2 top-1/2 h-[18%] w-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-700" />
    </span>
  );
}
