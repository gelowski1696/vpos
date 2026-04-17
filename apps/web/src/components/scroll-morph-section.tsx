'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

const FRAME_COUNT = 240;
const FRAME_DIR = '/illustrations/scroll-morph';
const HEADLINE_FADE_IN_FRAME = 180;
const MOBILE_BREAKPOINT = 768;
const DESKTOP_FOCAL_X = 0.5;
const MOBILE_FOCAL_X = 0.58;
const FOCAL_Y = 0.5;

function framePath(index: number): string {
  return `${FRAME_DIR}/frame-${String(index).padStart(3, '0')}.jpg`;
}

export function ScrollMorphSection(): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headlineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const headline = headlineRef.current;
    if (!wrapper || !section || !canvas || !headline) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const images: HTMLImageElement[] = [];
    const state = { frame: 0 };

    const sizeCanvasToSection = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = section.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const render = (): void => {
      const img = images[state.frame];
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;
      ctx.clearRect(0, 0, cw, ch);
      if (!img || !img.complete || img.naturalWidth === 0) return;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const targetAspect = cw / ch;
      const sourceAspect = iw / ih;
      const focalX = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
        ? MOBILE_FOCAL_X
        : DESKTOP_FOCAL_X;

      let sx = 0;
      let sy = 0;
      let sw = iw;
      let sh = ih;

      if (sourceAspect > targetAspect) {
        sw = ih * targetAspect;
        sx = (iw - sw) * focalX;
      } else if (sourceAspect < targetAspect) {
        sh = iw / targetAspect;
        sy = (ih - sh) * FOCAL_Y;
      }

      sx = Math.max(0, Math.min(sx, iw - sw));
      sy = Math.max(0, Math.min(sy, ih - sh));

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    };

    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.src = framePath(i + 1);
      images.push(img);
    }

    sizeCanvasToSection();

    const firstImage = images[0];
    if (firstImage.complete && firstImage.naturalWidth > 0) {
      render();
    } else {
      firstImage.addEventListener('load', render, { once: true });
    }

    const getScrollEnd = (): string =>
      window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? '+=180%' : '+=300%';

    const tween = gsap.to(state, {
      frame: FRAME_COUNT - 1,
      snap: 'frame',
      ease: 'none',
      scrollTrigger: {
        trigger: wrapper,
        start: 'top top',
        end: getScrollEnd,
        scrub: 0.5,
        pin: true,
        pinType: window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? 'transform' : 'fixed',
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onRefresh: render,
        onUpdate: (self) => {
          const absoluteFrame = self.progress * (FRAME_COUNT - 1);
          const fadeStart = HEADLINE_FADE_IN_FRAME;
          const fadeEnd = FRAME_COUNT - 1;
          const fadeProgress =
            absoluteFrame <= fadeStart
              ? 0
              : Math.min(1, (absoluteFrame - fadeStart) / Math.max(1, fadeEnd - fadeStart));
          headline.style.opacity = String(fadeProgress);
          headline.style.transform = `translate3d(0, ${16 - fadeProgress * 16}px, 0)`;
        },
      },
      onUpdate: render,
    });

    const handleResize = (): void => {
      sizeCanvasToSection();
      render();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="mx-auto mt-7 w-full max-w-[1400px]">
      <section
        ref={sectionRef}
        className="relative h-screen w-full overflow-hidden rounded-2xl border border-amber-300/25 bg-black/50 sm:rounded-3xl"
        style={{ height: '100dvh' }}
        aria-label="VPOS product morph"
      >
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_50%,rgba(240,200,111,0.12),transparent_60%)]" />
        <canvas ref={canvasRef} className="absolute inset-0 z-10 block" aria-hidden="true" />
        <div
          ref={headlineRef}
          className="pointer-events-none absolute inset-x-0 bottom-[10%] z-20 flex flex-col items-center px-4 text-center opacity-0 sm:bottom-[12%] sm:px-6"
          style={{ transform: 'translate3d(0, 16px, 0)' }}
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-amber-200/90 sm:mb-3 sm:text-[11px] sm:tracking-[0.3em]">
            VMJAMTECH VPOS
          </p>
          <h2 className="max-w-3xl text-2xl font-black leading-tight text-white sm:text-3xl md:text-5xl">
            From cylinder to command center
          </h2>
          <p className="mt-2 max-w-xl text-xs text-slate-200 sm:mt-3 sm:text-sm md:text-base">
            One scroll away from the full LPG operations picture.
          </p>
        </div>
      </section>
    </div>
  );
}
