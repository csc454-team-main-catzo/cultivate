/**
 * GhostTextarea — Gmail-style inline autocomplete for <textarea>.
 *
 * Rendering technique (overlay):
 *   ┌─────────────────────────────────────────────┐
 *   │  [overlay div, absolute, pointer-events:none]│
 *   │    <transparent>{value}</transparent>        │
 *   │    <gray>{ghost}</gray>                      │
 *   │  [textarea, relative, bg-transparent]        │
 *   │    user's visible text + caret               │
 *   └─────────────────────────────────────────────┘
 *
 * The overlay is rendered *before* the textarea in the DOM so it sits behind
 * it in the stacking order. The textarea has bg-transparent so the ghost text
 * bleeds through. The transparent <span> in the overlay aligns the ghost suffix
 * to start exactly where the user's text ends.
 *
 * Interaction:
 *   Tab   → accept the full suggestion (appends ghost to value)
 *   Esc   → dismiss and suppress for the current prefix
 *   type  → naturally refines/invalidates the ghost
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react"

interface GhostTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string
  onChange: (value: string) => void
  /** Return the ghost suffix to display, or null for no suggestion. */
  getSuggestion?: (text: string) => string | null
  /** Debounce delay before a new suggestion is computed (default 300 ms). */
  debounceMs?: number
  /** Extra classes forwarded to the outer wrapper (border / focus styles). */
  wrapperClassName?: string
}

/**
 * Tailwind classes applied identically to both the overlay div and the
 * textarea so their text metrics align perfectly.
 */
const SHARED_TEXT = "font-sans text-sm leading-relaxed"
const SHARED_PADDING = "px-3 py-2.5"

export default function GhostTextarea({
  value,
  onChange,
  getSuggestion,
  debounceMs = 300,
  wrapperClassName = "",
  className = "",
  rows = 3,
  onKeyDown,
  // Destructured separately so we can suppress it while ghost text is showing.
  // The ghost text and the placeholder occupy the same position; if both render
  // simultaneously the placeholder (from the textarea layer on top) hides the
  // ghost text (from the overlay layer behind it).
  placeholder,
  ...rest
}: GhostTextareaProps) {
  const [ghost, setGhost] = useState("")
  // The value at which the user pressed Esc; suppress suggestions until the
  // value diverges from this prefix.
  const [suppressedAt, setSuppressedAt] = useState<string | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /** So we only debounce on typing, not when unit/price context (getSuggestion) changes. */
  const prevValueRef = useRef<string | undefined>(undefined)
  const prevGetSuggestionRef = useRef(getSuggestion)

  // Auto-grow: keep the textarea tall enough to show all content without a
  // scrollbar, which is required for the overlay to stay in sync.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  // Compute ghost text: immediate when suggestion context changes (e.g. unit
  // toggle); debounced when only the typed value changes.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)

    if (!getSuggestion) {
      setGhost("")
      prevValueRef.current = value
      prevGetSuggestionRef.current = getSuggestion
      return
    }

    const suggestionContextChanged = prevGetSuggestionRef.current !== getSuggestion
    prevGetSuggestionRef.current = getSuggestion

    // New context (unit, price, listing fields) → show a fresh hint even if
    // the user had dismissed the previous one with Esc.
    if (suggestionContextChanged) {
      setSuppressedAt(null)
    }

    // Still at the suppressed prefix → keep ghost hidden (unless context changed above).
    if (suppressedAt !== null && value === suppressedAt && !suggestionContextChanged) {
      setGhost("")
      prevValueRef.current = value
      return
    }
    // User moved away from the suppressed prefix → lift suppression.
    if (suppressedAt !== null && value !== suppressedAt) {
      setSuppressedAt(null)
    }

    const valueChanged = prevValueRef.current !== value
    prevValueRef.current = value

    if (suggestionContextChanged) {
      const suggestion = getSuggestion(value)
      setGhost(suggestion ?? "")
    }

    if (valueChanged && !suggestionContextChanged) {
      const delay = value.length === 0 ? 80 : debounceMs
      debounceTimer.current = setTimeout(() => {
        const suggestion = getSuggestion(value)
        setGhost(suggestion ?? "")
      }, delay)
    }

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [value, getSuggestion, suppressedAt, debounceMs])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (ghost) {
        if (e.key === "Tab") {
          e.preventDefault()
          onChange(value + ghost)
          setGhost("")
          setSuppressedAt(null)
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setGhost("")
          setSuppressedAt(value)
          return
        }
      }
      onKeyDown?.(e)
    },
    [ghost, value, onChange, onKeyDown]
  )

  return (
    <div className="flex flex-col gap-1">
      {/*
       * Outer wrapper: provides the visible border, background and focus ring.
       * overflow-hidden clips the overlay to the same bounds as the textarea.
       */}
      <div
        className={[
          "relative rounded-lg border border-zinc-200 bg-white",
          "focus-within:ring-2 focus-within:ring-leaf-500/30 focus-within:border-leaf-500",
          "overflow-hidden",
          wrapperClassName,
        ].join(" ")}
      >
        {/* ── Ghost text overlay ──────────────────────────────────────── */}
        {ghost && (
          <div
            aria-hidden
            className={[
              "absolute inset-0 pointer-events-none select-none overflow-hidden",
              SHARED_TEXT,
              SHARED_PADDING,
            ].join(" ")}
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {/* Transparent mirror of the user's text positions the ghost correctly. */}
            <span style={{ color: "transparent" }}>{value}</span>
            {/* The actual ghost suggestion in muted gray. */}
            <span className="text-zinc-400">{ghost}</span>
          </div>
        )}

        {/* ── Actual textarea ─────────────────────────────────────────── */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={rows}
          className={[
            "relative w-full bg-transparent text-zinc-900",
            "placeholder:text-zinc-400",
            "focus:outline-none resize-none min-h-[80px]",
            SHARED_TEXT,
            SHARED_PADDING,
            className,
          ].join(" ")}
          // Hide the placeholder whenever ghost text is active so the ghost
          // isn't obscured by the textarea's own placeholder layer.
          placeholder={ghost ? "" : placeholder}
          style={{ whiteSpace: "pre-wrap" }}
          {...rest}
        />
      </div>

      {/* ── Keyboard hint ───────────────────────────────────────────────── */}
      {ghost && (
        <p className="text-xs text-zinc-400 select-none">
          <kbd className="inline-block px-1 py-px rounded bg-zinc-100 text-zinc-500 font-mono text-[10px] leading-tight">
            Tab
          </kbd>
          {" to accept · "}
          <kbd className="inline-block px-1 py-px rounded bg-zinc-100 text-zinc-500 font-mono text-[10px] leading-tight">
            Esc
          </kbd>
          {" to dismiss"}
        </p>
      )}
    </div>
  )
}
