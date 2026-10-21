import type { ReactNode } from "react";
import type { Citation } from "../api/types";

/** Renders `[f12]` markers as hoverable citation chips. Text is rendered as React text nodes, never as HTML. */
export function CitedText({ text, citations, onCite }: { text: string; citations?: Citation[]; onCite?: (c: Citation) => void }) {
  return <>{renderInline(text, citations ?? [], onCite, "c")}</>;
}

function citeChip(id: string, citations: Citation[], onCite: ((c: Citation) => void) | undefined, key: string): ReactNode {
  const c = citations.find((x) => x.fact_id === id);
  const label = c ? `${c.label}: ${c.value}` : "Unverified reference";
  return (
    <button
      type="button"
      className="cite"
      key={key}
      aria-label={`Source ${id}: ${label}`}
      onClick={() => c && onCite?.(c)}
      style={c ? undefined : { background: "var(--danger-soft)", color: "var(--danger)" }}
    >
      {id}
      <span className="tip" role="tooltip">
        {label}
      </span>
    </button>
  );
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[f\d+\])/g;

function renderInline(text: string, citations: Citation[], onCite: ((c: Citation) => void) | undefined, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("[f")) out.push(citeChip(tok.slice(1, -1), citations, onCite, key));
    else if (tok.startsWith("**")) out.push(<strong key={key}>{renderInline(tok.slice(2, -2), citations, onCite, key)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{renderInline(tok.slice(1, -1), citations, onCite, key)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "p"; text: string };

function parse(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of md.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export function Markdown({ source, citations, onCite }: { source: string; citations?: Citation[]; onCite?: (c: Citation) => void }) {
  const blocks = parse(source ?? "");
  const cites = citations ?? [];
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.kind === "h") {
          const content = renderInline(b.text, cites, onCite, key);
          return b.level <= 2 ? <h3 key={key}>{content}</h3> : <h4 key={key}>{content}</h4>;
        }
        if (b.kind === "p") return <p key={key}>{renderInline(b.text, cites, onCite, key)}</p>;
        const items = b.items.map((it, j) => <li key={`${key}-${j}`}>{renderInline(it, cites, onCite, `${key}-${j}`)}</li>);
        return b.kind === "ul" ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>;
      })}
    </div>
  );
}
