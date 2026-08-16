// Dark is the default (the whole design is built around deep indigo), light
// is an opt-in the visitor can reach for. Toggling is rare and deliberate, so
// it gets the delight budget: a circular reveal centered on the button via
// the View Transitions API, with a plain instant swap for browsers without it
// (the CSS color transitions already in place carry that fallback smoothly).

import { useRef, useState } from 'react'

const STORAGE_KEY = 'nimsum.theme'
type Theme = 'light' | 'dark'

export function getStoredTheme(): Theme {
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  if (theme === 'light') document.documentElement.dataset.theme = 'light'
  else delete document.documentElement.dataset.theme
  localStorage.setItem(STORAGE_KEY, theme)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const supportsViewTransition = typeof document.startViewTransition === 'function'

    if (!supportsViewTransition || reduceMotion) {
      applyTheme(next)
      setTheme(next)
      return
    }

    const rect = btnRef.current?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : 0
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )

    const transition = document.startViewTransition(() => {
      applyTheme(next)
      setTheme(next)
    })

    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 500, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', pseudoElement: '::view-transition-new(root)' },
      )
    })
  }

  return (
    <button
      ref={btnRef}
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span className={`theme-icon ${theme}`} aria-hidden="true" />
    </button>
  )
}
