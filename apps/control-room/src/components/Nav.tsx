import { LogoMark } from "./icons";

interface Props {
  onHome: () => void;
  /** Drop the wordmark on phones when the bar is crowded. */
  compact?: boolean;
  /** Frosted over the hero; graphite over scrolling content, where text would bleed through. */
  frosted?: boolean;
  /** Links or tabs, between the logo and the action. */
  children?: React.ReactNode;
  /** The one white pill. */
  action: React.ReactNode;
}

/** A detached, frosted bar that floats 16px off the top of the viewport. */
export function Nav({ onHome, compact = false, frosted = false, children, action }: Props) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav
        aria-label="Main"
        className={`pointer-events-auto flex max-w-full items-center gap-1 rounded-nav border p-1.5 shadow-nav backdrop-blur-[4px] transition-[background-color,border-color] duration-300 ease-out ${
          frosted ? "border-white/20 bg-frost/10" : "border-hairline/15 bg-graphite/90"
        }`}
      >
        <button type="button" onClick={onHome} className={`flex h-8.5 shrink-0 items-center gap-2.5 rounded-full pl-1 ${compact ? "pr-1 sm:pr-3" : "pr-3"}`} title="All runs">
          <LogoMark size={26} />
          <span className={`text-[15px] text-white ${compact ? "max-sm:sr-only" : ""}`}>Friction</span>
        </button>
        {children && <div className="flex min-w-0 items-center gap-1">{children}</div>}
        <div className="ml-1 shrink-0">{action}</div>
      </nav>
    </header>
  );
}
