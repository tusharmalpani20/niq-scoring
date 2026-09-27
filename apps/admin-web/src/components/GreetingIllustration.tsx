type Period = "morning" | "afternoon" | "evening";

/** The teal shapes inherit the organization's primary colour. */
export function GreetingIllustration({ period }: { period: Period }) {
  return <svg viewBox="0 0 64 64" fill="none" className="size-16 shrink-0 text-primary" aria-hidden="true">
    <circle cx="32" cy="32" r="31" fill="currentColor" opacity=".09" />
    {period === "morning" && <>
      <path d="M12 46h40" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M19 45a13 13 0 0 1 26 0" fill="#FFD47B" stroke="#F4A947" strokeWidth="2" />
      <path d="M32 12v6M13 27l4 3M51 27l-4 3M18 18l4 4M46 18l-4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M15 52c5-3 10-3 15 0s10 3 15 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".5" />
    </>}
    {period === "afternoon" && <>
      <circle cx="32" cy="32" r="13" fill="#FFD47B" stroke="#F4A947" strokeWidth="2" />
      <path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="32" r="19" stroke="currentColor" strokeWidth="1.5" opacity=".25" />
    </>}
    {period === "evening" && <>
      <path d="M45 39.5A19 19 0 0 1 24.5 17 19 19 0 1 0 45 39.5Z" fill="currentColor" />
      <path d="M43 14v7M39.5 17.5h7M51 27v5M48.5 29.5h5" stroke="#E5B96A" strokeWidth="2" strokeLinecap="round" />
      <circle cx="19" cy="42" r="1.5" fill="#E5B96A" />
      <path d="M18 51c8 3 20 3 28-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".4" />
    </>}
  </svg>;
}
