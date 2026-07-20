import { Fragment, useState, useEffect } from "react";
import { T } from "./tokens";
import { TOKEN_KEY } from "./api";

// ─── Markdown renderer (TKT-H2FCMK) ─────────────────────────────────────────────
// Read-only counterpart to the toolbar in components/primitives/Form.jsx —
// renders the same lightweight Markdown subset (bold, italic, strikethrough,
// headings, bullet/numbered/checkbox lists, links, inline code, code blocks,
// quotes, tables) as real React elements, never via dangerouslySetInnerHTML —
// ticket/comment text is user-authored and must never be interpreted as raw
// HTML. Deliberately not a full CommonMark implementation (no nested lists,
// no nested inline emphasis) — this covers what the toolbar can produce.

// Inline spans within a single line: code first (so markup inside `code` is
// left alone), then images (must come before links — same [text](url) shape
// with a leading !), then links, then bold/strike/italic.
const INLINE_PATTERN = /`([^`]+)`|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*/g;

// Uploaded images live behind an auth-gated download route (/api/attachments/…)
// — a plain <img src> can't send the bearer token, so this fetches the bytes
// itself and hands the <img> a blob URL instead. External image URLs (pasted
// by hand, not through the upload pipeline) just render directly.
const AuthedImage = ({ src, alt }) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const needsAuth = src.startsWith("/api/");

  useEffect(() => {
    if (!needsAuth) return;
    let objectUrl, cancelled = false;
    fetch(src, { headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` } })
      .then(res => { if (!res.ok) throw new Error(); return res.blob(); })
      .then(blob => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setBlobUrl(objectUrl); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src, needsAuth]);

  if (src.startsWith("pending:")) return <span style={{ color: T.textMuted, fontStyle: "italic" }}>{alt}</span>;
  if (failed) return <span style={{ color: T.danger, fontStyle: "italic", fontSize: "0.9em" }}>[image unavailable]</span>;
  const finalSrc = needsAuth ? blobUrl : src;
  if (!finalSrc) return <span style={{ color: T.textMuted, fontStyle: "italic", fontSize: "0.9em" }}>Loading image…</span>;
  return <img src={finalSrc} alt={alt} style={{ maxWidth: "100%", borderRadius: 6, display: "block", margin: "4px 0" }} />;
};

const parseInline = (text, keyPrefix) => {
  const nodes = [];
  let lastIndex = 0, key = 0;
  let m;
  INLINE_PATTERN.lastIndex = 0;
  while ((m = INLINE_PATTERN.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    const k = `${keyPrefix}-${key++}`;
    if (m[1] !== undefined) {
      nodes.push(<code key={k} style={{ fontFamily: T.mono, fontSize: "0.92em", background: T.bg,
        border: `1px solid ${T.border}`, borderRadius: 4, padding: "1px 5px" }}>{m[1]}</code>);
    } else if (m[3] !== undefined) {
      nodes.push(<AuthedImage key={k} src={m[3]} alt={m[2] || ""} />);
    } else if (m[4] !== undefined) {
      nodes.push(<a key={k} href={m[5]} target="_blank" rel="noopener noreferrer"
        style={{ color: T.accent, textDecoration: "underline" }}>{m[4]}</a>);
    } else if (m[6] !== undefined) {
      nodes.push(<strong key={k}>{m[6]}</strong>);
    } else if (m[7] !== undefined) {
      nodes.push(<span key={k} style={{ textDecoration: "line-through", opacity: 0.75 }}>{m[7]}</span>);
    } else if (m[8] !== undefined) {
      nodes.push(<em key={k}>{m[8]}</em>);
    }
    lastIndex = INLINE_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
};

const HEADING_SIZE = { 1: 18, 2: 16, 3: 14.5, 4: 13.5, 5: 13, 6: 12.5 };

const splitTableRow = line => {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map(c => c.trim());
};

// Groups raw lines into typed blocks (code fence, table, quote, lists,
// headings, paragraphs) — a single forward pass, each branch consumes as many
// lines as belong to it before continuing.
const parseBlocks = text => {
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { codeLines.push(lines[i]); i++; }
      i++;
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, content: headingMatch[2] });
      i++; continue;
    }

    if (line.includes("|") && lines[i + 1] && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") { rows.push(splitTableRow(lines[i])); i++; }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ type: "quote", content: quoteLines.join("\n") });
      continue;
    }

    if (/^\s*-\s+\[[ xX]\]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*-\s+\[[ xX]\]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*-\s+\[([ xX])\]\s+(.*)$/);
        items.push({ checked: m[1].toLowerCase() === "x", content: m[2] });
        i++;
      }
      blocks.push({ type: "checklist", items });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*-\s+\[[ xX]\]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++;
      }
      blocks.push({ type: "bullet", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      blocks.push({ type: "numbered", items });
      continue;
    }

    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6})\s+/.test(lines[i]) && !/^```/.test(lines[i].trim()) &&
           !/^>\s?/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      paraLines.push(lines[i]); i++;
    }
    blocks.push({ type: "para", content: paraLines.join("\n") });
  }
  return blocks;
};

const listStyle = { margin: "0 0 10px", paddingLeft: 22, lineHeight: 1.6 };
const tableCellStyle = { padding: "5px 10px", borderBottom: `1px solid ${T.border}`, textAlign: "left" };

const renderBlock = (b, idx) => {
  const key = `md-${idx}`;
  switch (b.type) {
    case "heading":
      return <div key={key} style={{ fontFamily: T.head, fontWeight: 700, color: T.text,
        fontSize: HEADING_SIZE[b.level] || 13, margin: "10px 0 6px" }}>{parseInline(b.content, key)}</div>;
    case "code":
      return <pre key={key} style={{ margin: "0 0 10px", padding: "10px 12px", borderRadius: 7,
        background: T.bg, border: `1px solid ${T.border}`, overflowX: "auto" }}>
        <code style={{ fontFamily: T.mono, fontSize: 12.5, color: T.text, whiteSpace: "pre" }}>{b.content}</code>
      </pre>;
    case "quote":
      return <blockquote key={key} style={{ margin: "0 0 10px", padding: "2px 14px",
        borderLeft: `3px solid ${T.accent}66`, color: T.textMuted, fontStyle: "italic" }}>
        {b.content.split("\n").map((ln, li) => <div key={li}>{parseInline(ln, `${key}-${li}`)}</div>)}
      </blockquote>;
    case "checklist":
      return <div key={key} style={{ margin: "0 0 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        {b.items.map((it, i) => (
          <label key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
            <input type="checkbox" checked={it.checked} readOnly disabled style={{ marginTop: 3, cursor: "default" }} />
            <span style={it.checked ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{parseInline(it.content, `${key}-${i}`)}</span>
          </label>
        ))}
      </div>;
    case "bullet":
      return <ul key={key} style={listStyle}>{b.items.map((it, i) => <li key={i}>{parseInline(it, `${key}-${i}`)}</li>)}</ul>;
    case "numbered":
      return <ol key={key} style={listStyle}>{b.items.map((it, i) => <li key={i}>{parseInline(it, `${key}-${i}`)}</li>)}</ol>;
    case "table":
      return (
        <div key={key} style={{ overflowX: "auto", marginBottom: 10 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: "100%" }}>
            <thead><tr>{b.header.map((h, i) => <th key={i} style={{ ...tableCellStyle, fontWeight: 700, color: T.text, borderBottom: `1px solid ${T.border}` }}>{parseInline(h, `${key}h${i}`)}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci} style={tableCellStyle}>{parseInline(c, `${key}-${ri}-${ci}`)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    case "para":
    default: {
      const paraLines = b.content.split("\n");
      return (
        <p key={key} style={{ margin: "0 0 10px" }}>
          {paraLines.map((ln, li) => (
            <Fragment key={li}>
              {li > 0 && <br />}
              {parseInline(ln, `${key}-${li}`)}
            </Fragment>
          ))}
        </p>
      );
    }
  }
};

// text may be plain prose (pre-existing tickets/comments predating this
// feature) or Markdown — both render sensibly since plain text just becomes a
// single paragraph block with line breaks preserved.
export const MarkdownView = ({ text, style }) => {
  if (!text) return null;
  const blocks = parseBlocks(text);
  return (
    <div style={{ fontFamily: T.body, fontSize: 13, color: T.text, lineHeight: 1.65, ...style }}>
      {blocks.map(renderBlock)}
    </div>
  );
};
