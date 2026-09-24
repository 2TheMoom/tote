/**
 * The Tote mark - two overlapping circles (a vesica), the lens where they
 * meet filled solid. Reads as "two positions converging into one settled
 * pool." Deliberately single-toned rather than baking functional YES/NO
 * color-coding into the permanent brand identity.
 */

export function VesicaGlyph({ size = 40, tone = "#1fa37a", ringTone = "#f0ede6", ringOpacity = 0.55 }: {
  size?: number;
  tone?: string;
  ringTone?: string;
  ringOpacity?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="16" cy="20" r="11" fill="none" stroke={ringTone} strokeWidth="1.4" opacity={ringOpacity} />
      <circle cx="24" cy="20" r="11" fill="none" stroke={ringTone} strokeWidth="1.4" opacity={ringOpacity} />
      <path
        d="M20 10.3 C23.2 13.2 25 16.4 25 20 C25 23.6 23.2 26.8 20 29.7 C16.8 26.8 15 23.6 15 20 C15 16.4 16.8 13.2 20 10.3 Z"
        fill={tone}
      />
    </svg>
  );
}
