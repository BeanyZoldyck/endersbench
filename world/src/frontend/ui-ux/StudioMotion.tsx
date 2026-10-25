import { useEffect, useLayoutEffect, useRef } from 'react';
import type { StudioScreen } from '../model';
import '../studio-motion.css';

/** Pointer position stays outside React so tracking never rerenders the studio.
 *  The smoke trail follows it only where smoke is on (the landing page); the
 *  cursor itself shows everywhere. */
export function FrostedCursor({ smoke = true }: { smoke?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const smokeOn = useRef(smoke);
  useEffect(() => { smokeOn.current = smoke; }, [smoke]);
  useEffect(() => {
    const cursor = ref.current;
    const studio = cursor?.closest<HTMLElement>('.studio');
    if (!cursor || !studio) return;
    const media = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    // Reuse soft pigment strokes; interpolate movement so fast sweeps stay connected.
    const trail = Array.from({ length: 64 }, () => {
      const wisp = document.createElement('span');
      wisp.className = 'cursor-trail-wisp';
      wisp.setAttribute('aria-hidden', 'true');
      document.body.append(wisp);
      return wisp;
    });
    let trailIndex = 0;
    let trailColor = '255, 255, 255';
    let lastSurface: Element | null = null;
    const updateTrailColor = (target: Element | null) => {
      if (target === lastSurface) return;
      lastSurface = target;
      trailColor = '255, 255, 255';
      // Follow transparent children to the painted surface beneath them.
      for (let surface: Element | null = target; surface !== null; surface = surface?.parentElement ?? null) {
        const channels = getComputedStyle(surface).backgroundColor.match(/[\d.]+/g)?.map(Number);
        if (!channels || channels.length < 3 || (channels[3] ?? 1) < 0.5) continue;
        const [red, green, blue] = channels;
        const isGreen = green > red * 1.08 && green > blue * 1.08;
        const brightness = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        trailColor = !isGreen && brightness > 150 ? '18, 18, 18' : '255, 255, 255';
        break;
      }
    };
    let lastTrailTime = 0;
    let lastTrailX = 0;
    let lastTrailY = 0;
    const clearTrail = () => {
      trail.forEach(wisp => wisp.getAnimations().forEach(animation => animation.cancel()));
      lastTrailTime = 0;
    };
    const drawTrail = (time: number) => {
      if (!smokeOn.current) return;
      if (!lastTrailTime || time - lastTrailTime > 120) {
        lastTrailTime = time;
        lastTrailX = x;
        lastTrailY = y;
        return;
      }
      if (time - lastTrailTime < 24) return;
      const dx = x - lastTrailX;
      const dy = y - lastTrailY;
      const distance = Math.hypot(dx, dy);
      if (distance < 2) return;
      const steps = Math.min(2, Math.ceil(distance / 10));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      for (let step = 1; step <= steps; step++) {
        const wisp = trail[trailIndex];
        trailIndex = (trailIndex + 1) % trail.length;
        wisp.getAnimations().forEach(animation => animation.cancel());
        wisp.style.setProperty('--smoke-color', trailColor);
        const px = lastTrailX + dx * step / steps;
        const py = lastTrailY + dy * step / steps;
        const phase = time / 360;
        const stretch = Math.min(2, Math.max(1, distance / steps / 24));
        // Curved advection: each wash unfurls sideways, curls back, and rises.
        const pose = (progress: number) => {
          const curl = (Math.sin(phase + progress * 4.8) - Math.sin(phase)) * 12 * progress;
          const driftX = -dy / distance * curl - dx / distance * progress * 10;
          const driftY = dx / distance * curl - progress * 14;
          const swell = 0.7 + progress * 0.65;
          return `translate3d(${px - 30 + driftX}px, ${py - 14 + driftY}px, 0) rotate(${angle + Math.sin(phase + progress * 3) * 18}deg) scale(${swell * stretch}, ${swell})`;
        };
        wisp.animate([
          { transform: pose(0), opacity: 0, offset: 0 },
          { transform: pose(0.15), opacity: 0.12, offset: 0.15 },
          { transform: pose(0.4), opacity: 0.085, offset: 0.4 },
          { transform: pose(0.7), opacity: 0.03, offset: 0.7 },
          { transform: pose(1), opacity: 0, offset: 1 },
        ], { duration: 720, easing: 'linear' });
      }
      lastTrailTime = time;
      lastTrailX = x;
      lastTrailY = y;
    };
    let frame = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    let previousFrameTime = 0;
    const renderCursor = (time: number) => {
      const elapsed = previousFrameTime ? Math.min(time - previousFrameTime, 50) : 16;
      previousFrameTime = time;
      // Time-based easing feels the same on 60 Hz and high-refresh displays.
      // Keep a little softness, but never let the visible pointer fall far behind.
      const distance = Math.hypot(targetX - x, targetY - y);
      if (distance > 18) {
        x = targetX - (targetX - x) / distance * 18;
        y = targetY - (targetY - y) / distance * 18;
      }
      const blend = 1 - Math.exp(-elapsed / 24);
      x += (targetX - x) * blend;
      y += (targetY - y) * blend;
      const settled = Math.hypot(targetX - x, targetY - y) < 0.15;
      if (settled) { x = targetX; y = targetY; }
      drawTrail(time);
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      cursor.dataset.visible = 'true';
      studio.classList.add('has-frosted-cursor');
      frame = settled ? 0 : requestAnimationFrame(renderCursor);
      if (settled) previousFrameTime = 0;
    };
    const hide = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previousFrameTime = 0;
      clearTrail();
      cursor.dataset.visible = 'false';
      cursor.dataset.pressed = 'false';
      studio.classList.remove('has-frosted-cursor');
    };
    const move = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Preserve text selection, native select menus, and disabled feedback.
      if (!media.matches || event.pointerType !== 'mouse' || target?.closest('input, textarea, select, [contenteditable], :disabled, [aria-disabled="true"]')) {
        hide();
        return;
      }
      updateTrailColor(target);
      targetX = event.clientX;
      targetY = event.clientY;
      if (cursor.dataset.visible !== 'true') { x = targetX; y = targetY; }
      cursor.dataset.interactive = String(!!target?.closest('button, a, summary, [role="button"]'));
      if (!frame) frame = requestAnimationFrame(renderCursor);
    };
    const press = () => { cursor.dataset.pressed = 'true'; };
    const release = () => { cursor.dataset.pressed = 'false'; };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Tab') hide(); };
    studio.addEventListener('pointermove', move, { passive: true });
    studio.addEventListener('pointerover', move, { passive: true });
    studio.addEventListener('pointerleave', hide);
    studio.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', keyboard);
    document.addEventListener('visibilitychange', hide);
    media.addEventListener('change', hide);
    return () => {
      hide();
      trail.forEach(element => element.remove());
      studio.removeEventListener('pointermove', move);
      studio.removeEventListener('pointerover', move);
      studio.removeEventListener('pointerleave', hide);
      studio.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', keyboard);
      document.removeEventListener('visibilitychange', hide);
      media.removeEventListener('change', hide);
    };
  }, []);
  return <div ref={ref} className="frosted-cursor" aria-hidden="true"><span className="frosted-cursor-orb" /></div>;
}

export function useLandingMotion(screen: StudioScreen, scenario: string) {
  useLayoutEffect(() => {
    if (screen !== 'landing') return;
    const landing = document.querySelector<HTMLElement>('.landing-content');
    if (!landing) return;
    // The wrapping navigation has a different height on phones and at text zoom.
    const studio = landing.closest<HTMLElement>('.studio');
    const header = studio?.querySelector<HTMLElement>('.studio-header');
    const measureHeader = () => {
      if (header) studio?.style.setProperty('--landing-header-height', `${header.getBoundingClientRect().height}px`);
    };
    measureHeader();
    const headerObserver = new ResizeObserver(measureHeader);
    if (header) headerObserver.observe(header);
    let disposed = false;
    const cleanups: Array<() => void> = [];
    landing.querySelectorAll<HTMLImageElement>('figure img').forEach(img => {
      if (img.dataset.imageReady === 'true') return;
      img.dataset.imageReady = 'false';
      const reveal = async () => {
        try { await img.decode(); } catch { /* Failed images still expose their alt text. */ }
        if (!disposed) img.dataset.imageReady = 'true';
      };
      img.addEventListener('load', reveal);
      img.addEventListener('error', reveal);
      if (img.complete) void reveal();
      cleanups.push(() => {
        img.removeEventListener('load', reveal);
        img.removeEventListener('error', reveal);
      });
    });
    const hero = landing.querySelector<HTMLElement>('.landing-hero');
    const illustration = landing.querySelector<HTMLElement>('.hero-illustration');
    const motion = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    studio?.querySelectorAll<HTMLButtonElement>('.hero-actions > button, .header-cta').forEach(button => {
      const rippleLayer = document.createElement('span');
      rippleLayer.className = 'button-ripple-layer';
      rippleLayer.setAttribute('aria-hidden', 'true');
      button.append(rippleLayer);
      const waves = Array.from({ length: 2 }, () => {
        const wave = document.createElement('span');
        wave.className = 'button-touch-ripple';
        wave.setAttribute('aria-hidden', 'true');
        rippleLayer.append(wave);
        return wave;
      });
      const clear = () => waves.forEach(wave => wave.getAnimations().forEach(animation => animation.cancel()));
      const enter = (event: PointerEvent) => {
        if (!motion.matches || event.pointerType !== 'mouse' || button.disabled) return;
        const scaleX = 1 + 12 / Math.max(1, button.offsetWidth);
        const scaleY = 1 + 12 / Math.max(1, button.offsetHeight);
        waves.forEach((wave, index) => {
          wave.getAnimations().forEach(animation => animation.cancel());
          wave.animate([
            { transform: 'scale(1)', opacity: 0 },
            { opacity: .55, offset: .15 },
            { opacity: .2, offset: .6 },
            { transform: `scale(${scaleX}, ${scaleY})`, opacity: 0 },
          ], { duration: 700, delay: index * 100, easing: 'cubic-bezier(.2,.55,.35,1)' });
        });
      };
      button.addEventListener('pointerenter', enter);
      motion.addEventListener('change', clear);
      cleanups.push(() => {
        clear();
        rippleLayer.remove();
        button.removeEventListener('pointerenter', enter);
        motion.removeEventListener('change', clear);
      });
    });
    if (hero && illustration) {
      const cornerRipples = Array.from({ length: 3 }, () => {
        const ripple = document.createElement('span');
        ripple.className = 'hero-corner-ripple';
        ripple.setAttribute('aria-hidden', 'true');
        illustration.append(ripple);
        return ripple;
      });
      let activeCorner = -1;
      const cornerReadyAt = [0, 0, 0, 0];
      const cornerCooldownMs = 2000;
      const rippleCorners = (event: PointerEvent) => {
        if (!motion.matches || event.pointerType !== 'mouse' || !(event.target instanceof HTMLImageElement)) return;
        const image = event.target;
        const bounds = image.getBoundingClientRect();
        const right = event.clientX > bounds.left + bounds.width / 2;
        const bottom = event.clientY > bounds.top + bounds.height / 2;
        const distance = Math.hypot(event.clientX - (right ? bounds.right : bounds.left), event.clientY - (bottom ? bounds.bottom : bounds.top));
        // Entering a corner is a single dip; moving through the center emits nothing.
        if (distance > 85) { activeCorner = -1; return; }
        const corner = Number(right) + Number(bottom) * 2;
        if (corner === activeCorner) return;
        activeCorner = corner;
        const now = performance.now();
        if (now < cornerReadyAt[corner]) return;
        // Keep the cooldown across pointer leave/re-entry; the staggered wave lasts 1860ms.
        cornerReadyAt[corner] = now + cornerCooldownMs;
        cornerRipples.forEach((ripple, index) => {
          ripple.getAnimations().forEach(animation => animation.cancel());
          ripple.dataset.corner = String(corner);
          ripple.style.left = `${image.offsetLeft + (right ? image.offsetWidth : 0)}px`;
          ripple.style.top = `${image.offsetTop + (bottom ? image.offsetHeight : 0)}px`;
          ripple.animate([
            { transform: 'translate(-50%, -50%) scale(.12)', opacity: 0 },
            { opacity: .24, offset: .16 },
            { opacity: .1, offset: .55 },
            { transform: 'translate(-50%, -50%) scale(2.8)', opacity: 0 },
          ], { duration: 1500, easing: 'cubic-bezier(.2,.55,.35,1)', delay: index * 180 });
        });
      };
      const leaveCorners = () => { activeCorner = -1; };
      illustration.addEventListener('pointerleave', leaveCorners);
      illustration.addEventListener('pointermove', rippleCorners, { passive: true });
      let frame = 0;
      let tiltX = 0;
      let tiltY = 0;
      const reset = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        illustration.style.removeProperty('transform');
        cornerRipples.forEach(ripple => ripple.getAnimations().forEach(animation => animation.cancel()));
      };
      const move = (event: PointerEvent) => {
        if (!motion.matches || event.pointerType !== 'mouse') return;
        // Measure the stationary section, never the moving artwork, to avoid feedback jitter.
        const bounds = hero.getBoundingClientRect();
        tiltX = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
        tiltY = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
        if (!frame) frame = requestAnimationFrame(() => {
          illustration.style.transform = `perspective(1100px) rotateX(${-tiltX * 1.4}deg) rotateY(${tiltY * 1.8}deg) translate3d(${tiltY * 4}px, ${tiltX * 3}px, 0)`;
          frame = 0;
        });
      };
      const keyboard = (event: KeyboardEvent) => { if (event.key === 'Tab') reset(); };
      hero.addEventListener('pointermove', move, { passive: true });
      hero.addEventListener('pointerleave', reset);
      window.addEventListener('blur', reset);
      window.addEventListener('keydown', keyboard);
      document.addEventListener('visibilitychange', reset);
      motion.addEventListener('change', reset);
      cleanups.push(() => {
        reset();
        illustration.removeEventListener('pointerleave', leaveCorners);
        illustration.removeEventListener('pointermove', rippleCorners);
        cornerRipples.forEach(ripple => ripple.remove());
        hero.removeEventListener('pointermove', move);
        hero.removeEventListener('pointerleave', reset);
        window.removeEventListener('blur', reset);
        window.removeEventListener('keydown', keyboard);
        document.removeEventListener('visibilitychange', reset);
        motion.removeEventListener('change', reset);
      });
    }
    const blocks = landing.querySelectorAll<HTMLElement>('.section-grid > *, .agent-intros > *, .landing-case-facts > *, .landing-end > *, .scenario-illustration');
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).dataset.revealed = 'true';
          observer?.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    blocks.forEach(block => {
      // Only stage offscreen blocks; returning to an anchor never hides its content.
      if (observer && block.dataset.revealed !== 'true' && block.getBoundingClientRect().top > window.innerHeight) {
        block.dataset.revealed = 'false';
        observer.observe(block);
      }
    });
    return () => {
      disposed = true;
      headerObserver.disconnect();
      studio?.style.removeProperty('--landing-header-height');
      cleanups.forEach(cleanup => cleanup());
      observer?.disconnect();

    };
  }, [screen, scenario]);
}
