import { type ButtonHTMLAttributes } from 'react';

type ActionKind = 'archive' | 'clone' | 'delete' | 'edit' | 'remove' | 'rename';
type ActionButtonSize = 'icon' | 'label';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  action: ActionKind;
  size?: ActionButtonSize;
}

const actionToneClass: Record<ActionKind, string> = {
  archive: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  clone: 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100',
  delete: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  edit: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
  remove: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
  rename: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
};

export function ActionButton({ action, className, size = 'label', type = 'button', ...props }: ActionButtonProps) {
  const sizeClass =
    size === 'icon'
      ? 'inline-flex h-8 w-8 items-center justify-center rounded-lg'
      : 'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium';

  const classes = [
    sizeClass,
    'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
    actionToneClass[action],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button {...props} className={classes} type={type} />;
}
