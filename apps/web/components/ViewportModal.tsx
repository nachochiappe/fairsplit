'use client';

import { KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type ViewportBounds = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function readViewportBounds(): ViewportBounds {
  if (typeof window === 'undefined') {
    return { top: 0, left: 0, width: 0, height: 0 };
  }

  const viewport = window.visualViewport;
  if (viewport) {
    return {
      top: viewport.offsetTop,
      left: viewport.offsetLeft,
      width: viewport.width,
      height: viewport.height,
    };
  }

  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true',
  );
}

export function ViewportModal({
  children,
  onDismiss,
  presentation = 'dialog',
}: {
  children: ReactNode;
  onDismiss?: () => void;
  presentation?: 'dialog' | 'page';
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [bounds, setBounds] = useState<ViewportBounds>(() => readViewportBounds());
  const portalNodeRef = useRef<HTMLDivElement | null>(null);
  const dialogRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsMounted(true);

    const syncViewportBounds = () => {
      setBounds(readViewportBounds());
    };

    syncViewportBounds();

    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', syncViewportBounds);
    viewport?.addEventListener('scroll', syncViewportBounds);
    window.addEventListener('resize', syncViewportBounds);
    window.addEventListener('scroll', syncViewportBounds, { passive: true });

    return () => {
      viewport?.removeEventListener('resize', syncViewportBounds);
      viewport?.removeEventListener('scroll', syncViewportBounds);
      window.removeEventListener('resize', syncViewportBounds);
      window.removeEventListener('scroll', syncViewportBounds);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const portalNode = document.createElement('div');
    portalNode.dataset.viewportModal = 'true';
    document.body.appendChild(portalNode);
    portalNodeRef.current = portalNode;

    return () => {
      portalNode.remove();
      portalNodeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isMounted || typeof document === 'undefined') {
      return;
    }

    const dialogRoot = dialogRootRef.current;
    if (!dialogRoot) {
      return;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = getFocusableElements(dialogRoot);
    const initialFocusTarget = focusable[0] ?? dialogRoot;
    initialFocusTarget.focus();

    const bodyChildren = Array.from(document.body.children);
    const portalNode = portalNodeRef.current;
    const previousOverflow = document.body.style.overflow;
    const hiddenSiblings: HTMLElement[] = [];

    for (const child of bodyChildren) {
      if (!(child instanceof HTMLElement) || child === portalNode) {
        continue;
      }

      if (!child.hasAttribute('aria-hidden')) {
        child.setAttribute('aria-hidden', 'true');
        hiddenSiblings.push(child);
      }

      child.inert = true;
    }

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;

      for (const child of bodyChildren) {
        if (child instanceof HTMLElement && child !== portalNode) {
          child.inert = false;
        }
      }

      for (const child of hiddenSiblings) {
        child.removeAttribute('aria-hidden');
      }

      previouslyFocused?.focus();
    };
  }, [isMounted]);

  if (!isMounted || !portalNodeRef.current) {
    return null;
  }

  const isPagePresentation = presentation === 'page';

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const dialogRoot = dialogRootRef.current;
    if (!dialogRoot) {
      return;
    }

    if (event.key === 'Escape') {
      if (onDismiss) {
        event.preventDefault();
        onDismiss();
      }
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const focusable = getFocusableElements(dialogRoot);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRoot.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (event.shiftKey) {
      if (!activeElement || activeElement === first || !dialogRoot.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }

    if (!activeElement || activeElement === last || !dialogRoot.contains(activeElement)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={`fixed z-50 flex ${
        isPagePresentation ? 'items-stretch justify-stretch bg-transparent p-0' : 'items-center justify-center bg-slate-900/40 p-4'
      }`}
      onClick={onDismiss}
      onKeyDown={handleKeyDown}
      style={{
        top: `${bounds.top}px`,
        left: `${bounds.left}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
    >
      <div
        className={isPagePresentation ? 'h-full w-full' : undefined}
        ref={dialogRootRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    portalNodeRef.current,
  );
}
