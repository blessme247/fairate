type Props = { size?: number };

/**
 * The Fairate mark: two chains, and the region they agree on.
 *
 * Two overlapping circles are the source and payout chains. The filled lens is their
 * intersection — the part of each chain's state the other has verified, which is exactly what an
 * attestation establishes. The corridor lives in that overlap, so the logo is the architecture.
 *
 * Geometry is exact rather than eyeballed: circles of r=6 centred at (9,12) and (15,12) meet at
 * (12, 12 ± √27), so the lens is two 120° arcs. Strokes use `currentColor` and the lens uses the
 * accent, so the mark inherits the theme instead of carrying its own palette.
 */
export function Logo({ size = 22 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="logo">
      <circle cx="9" cy="12" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <circle cx="15" cy="12" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <path d="M12 6.804A6 6 0 0 1 12 17.196A6 6 0 0 1 12 6.804Z" fill="var(--accent)" />
    </svg>
  );
}
