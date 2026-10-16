// A deliberately small Markdown renderer for release notes. It builds React
// elements (never raw HTML), so anything in the notes is shown as text, and
// only http(s) links are made clickable.

import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d{1,9}[.)]\s+(.*)$/;
const RULE_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      flush();
      const fence = FENCE_RE.exec(line)![1];
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: h[1].length, text: h[2] });
      continue;
    }
    if (RULE_RE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const ul = UL_RE.exec(line);
    const ol = ul ? null : OL_RE.exec(line);
    if (ul || ol) {
      flush();
      const ordered = !!ol;
      const last = blocks[blocks.length - 1];
      const text = (ul ?? ol)![1];
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(text);
      else blocks.push({ kind: "list", ordered, items: [text] });
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      flush();
      const text = line.trimStart().replace(/^>\s?/, "");
      const last = blocks[blocks.length - 1];
      if (last?.kind === "quote") last.text += ` ${text}`;
      else blocks.push({ kind: "quote", text });
      continue;
    }
    // A continuation line of the previous list item.
    const last = blocks[blocks.length - 1];
    if (!para.length && last?.kind === "list" && /^\s{2,}\S/.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

// Link targets may contain one level of brackets, e.g. a Wikipedia URL.
const LINK_TARGET = String.raw`(?:[^()\s]|\([^()\s]*\))+`;
const INLINE_RE = new RegExp(
  String.raw`(\x60[^\x60]+\x60)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\(${LINK_TARGET}\))`,
);
const LINK_RE = new RegExp(String.raw`^\[([^\]]+)\]\((${LINK_TARGET})\)$`);

export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) {
      out.push(<code key={key} className="px-1 py-0.5 rounded bg-gray-100 text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (m[2]) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else {
      const link = LINK_RE.exec(tok)!;
      const href = link[2];
      if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">
            {renderInline(link[1], key)}
          </a>,
        );
      } else {
        out.push(<Fragment key={key}>{renderInline(link[1], key)}</Fragment>);
      }
    }
    rest = rest.slice(m.index + tok.length);
  }
  return out;
}

export default function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className="space-y-3 text-sm text-gray-700 leading-relaxed">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "heading": {
            // Release notes sit under the page's own headings, so start at h3.
            const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[b.level - 1];
            return (
              <Tag key={key} className="font-semibold text-gray-900 mt-4 first:mt-0">
                {renderInline(b.text, key)}
              </Tag>
            );
          }
          case "list": {
            const List = b.ordered ? "ol" : "ul";
            return (
              <List key={key} className={`${b.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={key} className="bg-gray-50 border rounded-lg p-3 overflow-x-auto text-xs">
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-4 border-gray-200 pl-3 text-gray-600">
                {renderInline(b.text, key)}
              </blockquote>
            );
          case "rule":
            return <hr key={key} />;
          default:
            return <p key={key}>{renderInline(b.text, key)}</p>;
        }
      })}
    </div>
  );
}
