import type { SVGProps } from "react";

export function StateGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true" {...props}>
      <g stroke="var(--glyph-frame, #c9a227)" strokeWidth="4.5" strokeLinecap="square">
        <path d="M31 12H8V35" />
        <path d="M70 12H92V35" />
        <path d="M92 72V94H70" />
        <path d="M8 72V94H31" />
      </g>
      <path d="M50 15V97M7 53H87" stroke="var(--glyph-route, #8fa876)" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M29 32L71 74M71 32L29 74" stroke="var(--glyph-frame, #c9a227)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M57 11C77 15 90 30 92 47" stroke="var(--glyph-node, #c36a4b)" strokeWidth="2.5" strokeDasharray="3.4 2.6" />
      <circle cx="50" cy="9" r="5.1" fill="var(--glyph-node, #c36a4b)" />
      <circle cx="93" cy="53" r="5.1" fill="var(--glyph-node, #c36a4b)" />
      <circle cx="50" cy="53" r="5.2" fill="var(--glyph-branch, #ede6d5)" />
    </svg>
  );
}
