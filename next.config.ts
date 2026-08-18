import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DECISION: Node runtime, never Edge. Edge functions on Vercel must begin
  // responding within 25s; a multi-turn traversal agent can exceed that while
  // it is still deciding which nodes to read. See DECISIONS.md #7.
  serverExternalPackages: ["gpt-tokenizer"],
};

export default nextConfig;
