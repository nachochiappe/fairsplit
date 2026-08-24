import Image from 'next/image';

interface TitleMarkProps {
  className?: string;
}

export function TitleMark({ className }: TitleMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-block h-10 w-10 rotate-12 drop-shadow-[0_4px_6px_rgba(15,23,42,0.16)] ${className ?? ''}`}
    >
      <Image
        alt=""
        className="object-contain"
        fill
        sizes="56px"
        src="/branding/logo-prism-v3-symbol.svg"
        unoptimized
      />
    </span>
  );
}
