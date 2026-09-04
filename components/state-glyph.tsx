import type { SVGProps } from "react";

export function StateGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 320 320" fill="none" className={className} aria-hidden="true" {...props}>
      <g stroke="var(--glyph-frame, currentColor)" strokeWidth="8" strokeLinecap="square" strokeLinejoin="round">
        <path d="M72 126V72H126" />
        <path d="M194 72H248V126" />
        <path d="M248 194V248H194" />
        <path d="M126 248H72V194" />
      </g>
      <path d="M96 112C121 91 146 96 146 126C146 157 113 161 113 188C113 214 139 230 164 214L225 158C240 144 257 148 278 158" stroke="var(--glyph-route, currentColor)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M146 126C166 126 185 112 200 121C213 129 218 143 225 158" stroke="var(--glyph-branch, var(--glyph-route, currentColor))" strokeWidth="5" strokeLinecap="round" />
      <circle cx="96" cy="112" r="11" fill="var(--glyph-cutout, var(--background))" stroke="var(--glyph-route, currentColor)" strokeWidth="7" />
      <circle cx="146" cy="126" r="7" fill="var(--glyph-node, currentColor)" />
      <circle cx="113" cy="188" r="7" fill="var(--glyph-node, currentColor)" />
      <rect x="270" y="150" width="16" height="16" rx="2" transform="rotate(45 278 158)" fill="var(--glyph-route, currentColor)" />
    </svg>
  );
}
