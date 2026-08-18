/**
 * Token accounting.
 *
 * DECISION #8: we count with cl100k_base (via gpt-tokenizer), not Claude's
 * tokenizer, because Anthropic does not publish one. Every number in this
 * project is therefore a *proxy*. That is fine for the comparison we care
 * about — injection and traversal are measured with the identical tokenizer,
 * so the ratio holds even though the absolute counts drift a few percent from
 * what Anthropic would bill. This is stated on the benchmark page too; it is a
 * real limitation and hiding it would be worse than the error it introduces.
 */

import { encode } from "gpt-tokenizer";

export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

/**
 * Pricing for claude-sonnet-5, USD per million tokens.
 * Used only to turn token counts into a number a human can feel.
 */
export const PRICING = {
  inputPerMTok: 3.0,
  outputPerMTok: 15.0,
} as const;

export function costUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRICING.inputPerMTok +
    (outputTokens / 1_000_000) * PRICING.outputPerMTok
  );
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.0000";
  if (usd < 0.0001) return "<$0.0001";
  return `$${usd.toFixed(4)}`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}
