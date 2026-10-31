export type PriceBreakdown = {
  currency: 'usd';
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxRatePercent: number;
};

/**
 * Program price plus sales tax, in integer cents (never floats on the money path).
 * Tax is rounded half-up to the nearest cent: $99.00 at 8.75% = $8.66, $199.00 at 8.75% = $17.41.
 */
export function priceBreakdown(displayPriceUsd: number, taxRatePercent: number): PriceBreakdown {
  const subtotalCents = Math.round(displayPriceUsd * 100);
  const rateBps = Math.round(taxRatePercent * 100); // 8.75% -> 875 basis points
  const taxCents = Math.floor((subtotalCents * rateBps + 5000) / 10000);
  return { currency: 'usd', subtotalCents, taxCents, totalCents: subtotalCents + taxCents, taxRatePercent };
}
