import { LogoMark } from "./icons";

interface Props {
  onHome: () => void;
  /** Frosted over the hero; graphite over scrolling content, where text would bleed through. */
  frosted?: boolean;
  /** Links or tabs, between the logo and the action. */
  children?: React.ReactNode;
  /** The one white pill, where a view has one. */
  action?: React.ReactNode;
}

/** A detached, frosted bar that floats 16px off the top of the viewport. */
export function Nav({ onHome, frosted = false, children, action }: Props) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <nav
        aria-label="Main"
        className={`pointer-events-auto flex max-w-full items-center gap-1 rounded-nav border p-1.5 shadow-nav backdrop-blur-[4px] transition-[background-color,border-color] duration-300 ease-out ${
          frosted ? "border-white/20 bg-frost/10" : "border-hairline/15 bg-graphite/90"
        }`}
      >
        <button type="button" onClick={onHome} className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full p-1" title="All runs" aria-label="All runs">
          <LogoMark size={26} />
        </button>
        {children && <div className="flex min-w-0 items-center gap-1">{children}</div>}
        {action && <div className="ml-1 shrink-0">{action}</div>}
      </nav>
    </header>
  );
}
