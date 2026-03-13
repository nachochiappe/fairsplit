'use client';

import { ReactNode, useEffect, useState } from 'react';
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

export function ViewportModal({ children }: { children: ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);
  const [bounds, setBounds] = useState<ViewportBounds>(() => readViewportBounds());

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

  if (!isMounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-50 flex items-center justify-center bg-slate-900/40 p-4"
      style={{
        top: `${bounds.top}px`,
        left: `${bounds.left}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
