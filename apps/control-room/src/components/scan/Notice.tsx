import { Dot, type Tone } from "../badges";

/** What is on screen, and why: a 3% box with its status light, like a finished persona's summary. */
export function Notice({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-ui border border-hairline/10 bg-white/3 px-3 py-2 text-ui leading-snug text-bone">
      <span className="mt-1.5 flex">
        <Dot tone={tone} size={7} />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
