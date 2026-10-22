/**
 * Record-form open/close animations (company theme `motion`, docs/THEMING.md), run with the Web Animations API on
 * a workspace tab panel. DOCUMENT: the form is lifted out of a drawer when opened, and filed away into its tab
 * when closed. SLIDE: a short slide/fade. NONE (or the OS "reduce motion" setting): nothing.
 */

type Motion = 'document' | 'slide' | 'none'

function currentMotion(): Motion {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'none'
  const m = document.documentElement.dataset.motion
  return m === 'slide' || m === 'none' ? m : 'document'
}

export function motionEnabled() {
  return currentMotion() !== 'none'
}

/** Resolves when the animation ends — also if it's cancelled or the element goes away mid-way. */
function settled(animation: Animation, maxMs: number): Promise<void> {
  return Promise.race([
    animation.finished.then(() => undefined, () => undefined),
    new Promise<void>(resolve => window.setTimeout(resolve, maxMs)),
  ])
}

/** A freshly opened record: pulled up out of the drawer, tilting flat as it lands. */
export function playOpen(el: HTMLElement) {
  const motion = currentMotion()
  if (motion === 'none') return
  if (motion === 'slide') {
    el.animate(
      [{ transform: 'translateX(18px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
    return
  }
  el.animate(
    [
      { transform: 'perspective(1400px) translateY(36px) rotateX(9deg) scale(.96)', opacity: 0, transformOrigin: '50% 0%' },
      { transform: 'perspective(1400px) translateY(-4px) rotateX(-.6deg) scale(1.004)', opacity: 1, offset: 0.62, transformOrigin: '50% 0%' },
      { transform: 'none', opacity: 1, transformOrigin: '50% 0%' },
    ],
    { duration: 440, easing: 'cubic-bezier(.22,.9,.3,1)' },
  )
}

/**
 * A record being closed: lifted slightly, then folded down into its tab in the strip — the tab is the cabinet
 * drawer it's filed into — and the tab gives a small "drawer shut" bump. Resolves when it's done; the caller
 * removes the tab then. Returns null when there's nothing to animate (remove right away).
 */
export function playClose(panel: HTMLElement, tabChip: HTMLElement | null): Promise<void> | null {
  const motion = currentMotion()
  if (motion === 'none') return null
  if (motion === 'slide') {
    const a = panel.animate(
      [{ transform: 'none', opacity: 1 }, { transform: 'translateX(28px)', opacity: 0 }],
      { duration: 180, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
    )
    return settled(a, 400)
  }

  // Fold toward the tab: scaling around a transform-origin placed on the tab's centre (above the panel)
  // carries the sheet up into it.
  const box = panel.getBoundingClientRect()
  const chip = tabChip?.getBoundingClientRect()
  const ox = chip ? chip.left + chip.width / 2 - box.left : box.width / 2
  const oy = chip ? chip.top + chip.height / 2 - box.top : -24
  const origin = `${ox}px ${oy}px`
  const a = panel.animate(
    [
      { transform: 'none', opacity: 1, transformOrigin: origin, easing: 'cubic-bezier(.2,.7,.3,1)' },
      { transform: 'translateY(-10px) rotate(-.6deg) scale(.985)', opacity: 1, offset: 0.22, transformOrigin: origin, easing: 'cubic-bezier(.55,0,.8,.2)' },
      { transform: 'translateY(0) rotate(-2.5deg) scale(.18, .1)', opacity: 0.85, offset: 0.86, transformOrigin: origin },
      { transform: 'translateY(0) rotate(-3deg) scale(.04, .02)', opacity: 0, transformOrigin: origin },
    ],
    { duration: 480, fill: 'forwards' },
  )
  tabChip?.animate(
    [
      { transform: 'none' },
      { transform: 'translateY(3px) scaleY(.88)', offset: 0.45 },
      { transform: 'none' },
    ],
    { duration: 200, delay: 360, easing: 'ease-out' },
  )
  return settled(a, 900)
}
