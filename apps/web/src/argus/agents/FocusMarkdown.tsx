import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { remarkGithubAlerts } from "../../markdown-github-alerts";
import "./markdown-signal.css";

/** List and focus-modal titles, colored with the markdown system's heading ink. */
export const SCAN_TITLE_CLASS = "argus-scan-title";

const ALERT_LABEL = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
} as const;

type AlertKind = keyof typeof ALERT_LABEL;

const REMARK_PLUGINS = [remarkGfm, remarkGithubAlerts];
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataAlert"],
    code: [["className", /^language-/]],
  },
} satisfies Parameters<typeof rehypeSanitize>[0];
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, SANITIZE_SCHEMA]] satisfies NonNullable<
  Options["rehypePlugins"]
>;

function alertKind(value: unknown): AlertKind | null {
  const kind = String(value ?? "").toLowerCase();
  return kind in ALERT_LABEL ? (kind as AlertKind) : null;
}

function languageOf(children: ReactNode): string | null {
  let language: string | null = null;
  Children.forEach(children, (child) => {
    if (!isValidElement<{ className?: string }>(child)) return;
    const match = /(?:^|\s)language-([^\s]+)/.exec(child.props.className ?? "");
    if (match?.[1]) language = match[1];
  });
  return language;
}

const COMPONENTS = {
  pre({ node: _node, children, ...props }) {
    const language = languageOf(children);
    if (!language) return <pre {...props}>{children}</pre>;
    return (
      <figure className="md-code">
        <figcaption className="md-code-head">
          <span>{language}</span>
        </figcaption>
        <pre {...props}>{children}</pre>
      </figure>
    );
  },
  table({ node: _node, children, ...props }) {
    return (
      <div className="md-table">
        <table {...props}>{children}</table>
      </div>
    );
  },
  blockquote({ node: _node, children, ...props }) {
    const record = props as Record<string, unknown>;
    const kind = alertKind(record.dataAlert ?? record["data-alert"]);
    if (!kind) return <blockquote {...props}>{children}</blockquote>;
    return (
      <div className={`markdown-alert markdown-alert-${kind}`} role="note">
        <p className="markdown-alert-title">{ALERT_LABEL[kind]}</p>
        {children}
      </div>
    );
  },
  a({ node: _node, href, children, ...props }) {
    const external = typeof href === "string" && /^(https?:|mailto:)/.test(href);
    return (
      <a
        href={href}
        {...props}
        {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      >
        {children}
      </a>
    );
  },
} satisfies Components;

/**
 * Markdown for the focus modal, in the reading system's structure: an
 * `article.md` whose headings, lists, code, links, and quotes the scoped
 * stylesheet already knows how to paint.
 */
export const FocusMarkdown = memo(function FocusMarkdown({ text }: { text: string }) {
  return (
    <article className="md w-full min-w-0" data-theme="light">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
});
