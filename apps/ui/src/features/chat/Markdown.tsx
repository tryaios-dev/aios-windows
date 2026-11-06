import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Highlight, type PrismTheme } from "prism-react-renderer";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCopy } from "@/components/ui/layout";
import { ConfirmDialog } from "@/components/ui/overlays";

/**
 * Model output is rendered as data (SR-06, M-20). react-markdown never emits raw
 * HTML; remote images are refused; external links open only after confirmation.
 * In the Electron build this sits under a strict CSP as well.
 */

const prismTheme: PrismTheme = {
  plain: { color: "var(--color-ink)", backgroundColor: "transparent" },
  styles: [
    { types: ["comment", "prolog", "doctype", "cdata"], style: { color: "var(--color-ink-50)", fontStyle: "italic" } },
    { types: ["punctuation"], style: { color: "var(--color-ink-soft)" } },
    {
      types: ["property", "tag", "boolean", "number", "constant", "symbol"],
      style: { color: "var(--color-brass-text)" },
    },
    { types: ["string", "char", "inserted", "attr-value"], style: { color: "var(--color-green)" } },
    { types: ["operator", "entity", "url"], style: { color: "var(--color-ink-soft)" } },
    { types: ["keyword", "atrule", "selector"], style: { color: "var(--color-deny)" } },
    { types: ["function", "class-name", "builtin"], style: { color: "var(--color-slate)" } },
    { types: ["deleted"], style: { color: "var(--color-deny)" } },
    { types: ["variable", "regex", "important"], style: { color: "var(--color-slate)" } },
  ],
};

function CodeBlock({ code, language }: { code: string; language: string }) {
  const { copied, copy } = useCopy();
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-line bg-paper-raised text-xs">
      <div className="flex h-8 items-center justify-between border-b border-line-soft bg-paper px-3">
        <span className="label-mono">{language || "code"}</span>
        <button
          onClick={() => copy(code)}
          className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-ink-50 transition-colors hover:bg-ink-6 hover:text-ink"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3 text-green" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <Highlight theme={prismTheme} code={code.replace(/\n$/, "")} language={language || "text"}>
        {({ className, tokens, getLineProps, getTokenProps }) => (
          <pre className={cn(className, "overflow-x-auto px-3 py-3 font-mono leading-5")}>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} className="table-row">
                <span className="table-cell select-none pr-3 text-right text-ink-50" aria-hidden>
                  {i + 1}
                </span>
                <span className="table-cell">
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </span>
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  );
}

function ConfirmedLink({ href, children }: { href?: string | undefined; children?: ReactNode | undefined }) {
  const [open, setOpen] = useState(false);
  if (!href) return <>{children}</>;
  let host = href;
  try {
    host = new URL(href).host;
  } catch {
    /* keep the raw value */
  }
  return (
    <>
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="inline-flex items-baseline gap-0.5 text-green underline decoration-green/30 underline-offset-2 hover:decoration-green"
      >
        {children}
        <ExternalLink className="size-3 self-center opacity-70" aria-hidden />
      </a>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        eyebrow="External link"
        title={`Open ${host} in your browser?`}
        description="This link came from a model answer. AIOS opens it in your default browser and sends nothing from this conversation."
        confirmLabel="Open link"
        onConfirm={() => {
          setOpen(false);
          window.open(href, "_blank", "noopener,noreferrer");
        }}
      >
        <div className="truncate rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink-soft">
          {href}
        </div>
      </ConfirmDialog>
    </>
  );
}

export function Markdown({ content, className }: { content: string; className?: string | undefined }) {
  return (
    <div className={cn("prose-aios", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url) => (/^https?:\/\//i.test(url) || url.startsWith("#") ? url : "")}
        components={{
          a: ({ href, children }) => <ConfirmedLink href={href}>{children}</ConfirmedLink>,
          img: () => (
            <span className="inline-flex items-center rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-2xs text-ink-50">
              [remote image blocked]
            </span>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const text = String(children ?? "");
            if (match || text.includes("\n")) return <CodeBlock code={text} language={match?.[1] ?? ""} />;
            return (
              <code
                className="rounded-xs border border-line-soft bg-paper px-1 py-px font-mono text-xs text-ink"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-line bg-paper px-3 py-1.5 text-left text-xs font-semibold text-ink-soft">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-line-soft px-3 py-1.5 align-top last:border-b-0">{children}</td>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-green/50 pl-3.5 text-ink-soft [&>p]:my-1.5">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-line-soft" />,
          input: ({ checked }) => (
            <span
              className={cn(
                "mr-1.5 inline-flex size-3.5 translate-y-0.5 items-center justify-center rounded-xs border",
                checked ? "border-green bg-green text-white" : "border-line-strong bg-white",
              )}
            >
              {checked && <Check className="size-2.5" strokeWidth={3} />}
            </span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
