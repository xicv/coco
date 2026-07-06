/**
 * Parse a review verdict from Oracle's free-form output. The skill instructs
 * Oracle to END its reply with a line exactly `VERDICT: clean` or `VERDICT: blocking`.
 *
 * Strict + fails closed (returns null → caller must treat as "no review recorded,
 * pause for the human"):
 *  - the verdict must be the LAST non-empty line (Oracle's actual conclusion), not an
 *    example or a format hint echoed earlier;
 *  - exactly one line may match the verdict pattern;
 *  - exact format only — `VERDICT: clean|blocking` (uppercase key, single space, lowercase
 *    verdict). Lowercase/no-space/leading-space variants are rejected on purpose.
 */
const VERDICT_LINE = /^VERDICT: (clean|blocking)$/;

export function parseOracleVerdict(text: string): 'clean' | 'blocking' | null {
  const nonEmpty = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, '')) // drop trailing whitespace only
    .filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return null;

  const matches = nonEmpty.filter((l) => VERDICT_LINE.test(l));
  if (matches.length !== 1) return null; // none, or ambiguous (multiple) → fail closed

  const last = nonEmpty[nonEmpty.length - 1].match(VERDICT_LINE);
  if (!last) return null; // a verdict line exists but isn't Oracle's final word → fail closed
  return last[1] as 'clean' | 'blocking';
}
