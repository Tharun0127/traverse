import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Traverse — an ObjectGraph implementation and adversarial audit",
  description:
    "A working implementation of the ObjectGraph document format (arXiv 2604.27820), measured against baseline markdown injection, plus the first adversarial audit of its routing layer.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b hairline sticky top-0 z-50 backdrop-blur bg-[#07090c]/85">
          <div className="mx-auto max-w-[1400px] px-5 h-12 flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 no-underline">
              <span className="mono text-[13px] font-semibold text-[var(--text)]">
                traverse
              </span>
              <span className="mono text-[10px] text-[var(--dimmer)] hidden sm:inline">
                .og
              </span>
            </Link>
            <nav className="flex items-center gap-4 mono text-[11px]">
              <Link
                href="/"
                className="text-[var(--dim)] hover:text-[var(--text)] no-underline"
              >
                playground
              </Link>
              <Link
                href="/benchmark"
                className="text-[var(--dim)] hover:text-[var(--text)] no-underline"
              >
                benchmark
              </Link>
              <Link
                href="/audit"
                className="text-[var(--dim)] hover:text-[var(--text)] no-underline"
              >
                audit
              </Link>
              <Link
                href="/code"
                className="text-[var(--dim)] hover:text-[var(--text)] no-underline"
              >
                code
              </Link>
            </nav>
            <div className="ml-auto mono text-[10px] text-[var(--dimmer)] hidden md:block">
              implements arXiv:2604.27820
            </div>
          </div>
        </header>
        {children}
        <footer className="border-t hairline mt-16">
          <div className="mx-auto max-w-[1400px] px-5 py-6 mono text-[10px] text-[var(--dimmer)] leading-relaxed">
            <p>
              An independent implementation of the ObjectGraph format described
              in{" "}
              <a
                href="https://arxiv.org/abs/2604.27820"
                target="_blank"
                rel="noreferrer"
              >
                arXiv:2604.27820
              </a>
              . Not affiliated with or endorsed by the authors.
            </p>
            <p className="mt-1">
              Token counts use cl100k_base as a proxy for Claude&apos;s
              tokenizer, which is not public. Both lanes are measured
              identically, so the ratio holds even though absolute counts drift.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
