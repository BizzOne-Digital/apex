export type PriceBreakdown = {
  currency: 'usd';
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxRatePercent: number;
};

/**
 * Program price plus sales tax, in integer cents (never floats on the money path).
 * Tax is rounded half-up to the nearest cent: $99.00 at 13% = $12.87, $199.00 at 13% = $25.87.
 */
export function priceBreakdown(displayPriceUsd: number, taxRatePercent: number): PriceBreakdown {
  const subtotalCents = Math.round(displayPriceUsd * 100);
  const rateBps = Math.round(taxRatePercent * 100); // 13% -> 1300 basis points
  const taxCents = Math.floor((subtotalCents * rateBps + 5000) / 10000);
  return { currency: 'usd', subtotalCents, taxCents, totalCents: subtotalCents + taxCents, taxRatePercent };
}
