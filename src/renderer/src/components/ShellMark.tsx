/**
 * ShellMark — Shelly's identity mark (shell-spiral / turtle motif).
 *
 * Uses `currentColor` so it adopts whatever text/accent color it's placed in,
 * and a soft gradient fill. Shared across the top bar, welcome screen, and
 * empty states so the brand reads consistently.
 */
export function ShellMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M24 4C13 4 4 13 4 24C4 35 13 44 24 44C35 44 44 35 44 24C44 13 35 4 24 4Z"
        fill="url(#shellmark-gradient)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M16 16C16 16 20 12 24 12C28 12 32 16 32 20C32 24 28 28 24 28C20 28 18 26 18 24C18 22 20 20 22 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.65"
      />
      <path
        d="M24 20V32"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M18 24H30"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M19 19L29 29"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.3"
      />
      <path
        d="M29 19L19 29"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.3"
      />
      <defs>
        <linearGradient
          id="shellmark-gradient"
          x1="4"
          y1="4"
          x2="44"
          y2="44"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
        </linearGradient>
      </defs>
    </svg>
  );
}
