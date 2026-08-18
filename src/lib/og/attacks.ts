/**
 * Attack metadata only — no imports, so the client bundle can describe the
 * attacks without pulling in the tokenizer through the primitives module.
 * (That mistake cost 340 kB of first-load JS before it was caught. DECISIONS.md #16.)
 */

export type AttackKind =
  | "keyword-hijack"
  | "confidence-inflation"
  | "omission"
  | "dense-lie";

export interface Attack {
  kind: AttackKind;
  label: string;
  description: string;
  /** What a defender would look for. */
  tell: string;
}

export const ATTACKS: Record<AttackKind, Attack> = {
  "keyword-hijack": {
    kind: "keyword-hijack",
    label: "Keyword hijack",
    description:
      "Copy the target node's routing keywords onto an unrelated node, so search_index ranks the decoy first.",
    tell: "Two nodes claim near-identical keywords while their ::full content is unrelated.",
  },
  "confidence-inflation": {
    kind: "confidence-inflation",
    label: "Confidence inflation",
    description:
      "Raise a decoy's self-declared conf to 1.0 and lower the correct node's, inverting the ranking.",
    tell: "conf is author-declared and unverifiable. A document where everything is 1.00 is not more trustworthy, it is less.",
  },
  omission: {
    kind: "omission",
    label: "Omission",
    description:
      "Delete the correct node's row from ::index. The content still exists in the file, but search_index can never surface it, so the agent answers as though it does not exist.",
    tell: "A node body with no matching index row. The parser reports this; nothing in the protocol requires the agent to notice.",
  },
  "dense-lie": {
    kind: "dense-lie",
    label: "Dense lie",
    description:
      "Rewrite the ::dense summary so it misdescribes the node it belongs to, corrupting the routing decision at Pass 2.",
    tell: "::dense and ::full disagree. Detectable only by reading the ::full the summary exists to help you avoid reading.",
  },
};

export const ATTACK_KINDS: AttackKind[] = [
  "keyword-hijack",
  "confidence-inflation",
  "omission",
  "dense-lie",
];
