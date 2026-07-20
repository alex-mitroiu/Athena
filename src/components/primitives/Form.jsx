import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { T, CONTRACT_PRESETS } from "../../tokens";
import { api } from "../../api";
import { toast } from "../../toast";
import Btn from "./Btn";

// BtnToggle — unified selected/unselected toggle button (contract type, container size, etc.)
const BtnToggle = ({ children, selected, onClick, wide, sub }) => {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: wide ? 1 : undefined,
        padding: sub ? "9px 14px" : "6px 14px",
        borderRadius: 6,
        fontFamily: T.body, fontSize: 13, fontWeight: 600,
        cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        border: `1px solid ${selected ? T.accent : hov ? T.borderMid : T.border}`,
        background: selected ? T.accentBg : hov ? T.btnSecondaryHoverBg : "transparent",
        color: selected ? T.accent : hov ? T.text : T.textMuted,
        transition: "background 0.14s, border-color 0.14s, color 0.14s",
      }}
    >
      <span style={{ fontFamily: sub ? T.mono : T.body, fontWeight: 700 }}>{children}</span>
      {sub && <span style={{ fontSize: 10, opacity: 0.65 }}>{sub}</span>}
    </button>
  );
};

const Field = ({ label, required, hint, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    {label && (
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <label style={{ fontFamily: T.body, fontSize: 10.5, color: T.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em" }}>
          {label}{required && <span style={{ color: T.danger }}> *</span>}
        </label>
        {hint && <span style={{ fontFamily: T.body, fontSize: 10.5, color: T.border }}>{hint}</span>}
      </div>
    )}
    {children}
  </div>
);

// Getters re-evaluate T on every spread — theme-safe across light/dark switches.
export const inputBase = {
  get background() { return T.bg; },
  get border()     { return `1px solid ${T.border}`; },
  get color()      { return T.text; },
  borderRadius: 6, padding: "8px 12px",
  outline: "none", width: "100%", boxSizing: "border-box",
};

const Inp = ({ label, value, onChange, placeholder, mono, maxLength, required, hint, type = "text", inputMode }) => (
  <Field label={label} required={required} hint={hint}>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      maxLength={maxLength} type={type} inputMode={inputMode}
      style={{ ...inputBase, fontFamily: mono ? T.mono : T.body, fontSize: mono ? 13 : 14 }} />
  </Field>
);

const Sel = ({ label, value, onChange, options, required, error }) => (
  <Field label={label} required={required}>
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ ...inputBase, fontFamily: T.body, fontSize: 14, cursor: "pointer",
        ...(error ? { borderColor: T.danger, boxShadow: `0 0 0 2px ${T.danger}44` } : {}) }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>
);

// ─── Markdown formatting toolbar (TKT-H2FCMK) ──────────────────────────────────
// Every text box in Athena (ticket description, comments, test notes) shares
// this one Textarea, so this is the single place a lightweight Markdown editor
// needed to be added — no schema change, just Markdown syntax inside the same
// TEXT columns. Read-only displays of this text render it via MarkdownView
// (src/markdown.jsx). Formatting half of the Confluence/Jira toolbar (bold,
// italic, lists, checkboxes, link, code, table) — not a full block-editor.

// Wraps the selection in before/after (e.g. **bold**); if nothing is selected,
// inserts before+after with the cursor left in between.
const wrapSelection = (text, start, end, before, after = before) => {
  const selected = text.slice(start, end);
  const newText = text.slice(0, start) + before + selected + after + text.slice(end);
  return { newText, selStart: start + before.length, selEnd: start + before.length + selected.length };
};

// Prefixes every line touching the selection (expanded to whole lines) with a
// fixed prefix, or with 1./2./3.… when numbered is true.
const prefixLines = (text, start, end, prefix, numbered = false) => {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = text.length;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const newBlock = lines.map((l, i) => (numbered ? `${i + 1}. ${l}` : `${prefix}${l}`)).join("\n");
  const newText = text.slice(0, lineStart) + newBlock + text.slice(lineEnd);
  return { newText, selStart: lineStart, selEnd: lineStart + newBlock.length };
};

const MD_ACTIONS = {
  bold:      (text, s, e) => wrapSelection(text, s, e, "**"),
  italic:    (text, s, e) => wrapSelection(text, s, e, "*"),
  strike:    (text, s, e) => wrapSelection(text, s, e, "~~"),
  code:      (text, s, e) => wrapSelection(text, s, e, "`"),
  codeblock: (text, s, e) => wrapSelection(text, s, e, "```\n", "\n```"),
  heading:   (text, s, e) => prefixLines(text, s, e, "## "),
  quote:     (text, s, e) => prefixLines(text, s, e, "> "),
  bullet:    (text, s, e) => prefixLines(text, s, e, "- "),
  checkbox:  (text, s, e) => prefixLines(text, s, e, "- [ ] "),
  numbered:  (text, s, e) => prefixLines(text, s, e, "", true),
  link: (text, s, e) => {
    const label = text.slice(s, e) || "link text";
    const insertion = `[${label}](https://)`;
    const newText = text.slice(0, s) + insertion + text.slice(e);
    const urlStart = s + label.length + 3; // "[" + label + "]("
    return { newText, selStart: urlStart, selEnd: urlStart + "https://".length };
  },
  table: (text, s) => {
    const template = "| Header | Header |\n| --- | --- |\n| Cell | Cell |";
    const needsLeadingBreak = s > 0 && text[s - 1] !== "\n";
    const insertion = (needsLeadingBreak ? "\n" : "") + template;
    const newText = text.slice(0, s) + insertion + text.slice(s);
    const tableStart = s + (needsLeadingBreak ? 1 : 0);
    return { newText, selStart: tableStart, selEnd: tableStart + "| Header | Header |".length };
  },
};

const MD_BUTTONS = [
  { action: "bold",      icon: "B",   title: "Bold", style: { fontWeight: 700 } },
  { action: "italic",    icon: "I",   title: "Italic", style: { fontStyle: "italic" } },
  { action: "strike",    icon: "S",   title: "Strikethrough", style: { textDecoration: "line-through" } },
  { action: "heading",   icon: "H",   title: "Heading" },
  { action: "bullet",    icon: "•",   title: "Bullet list" },
  { action: "numbered",  icon: "1.",  title: "Numbered list" },
  { action: "checkbox",  icon: "☑",   title: "Checklist" },
  { action: "link",      icon: "🔗",  title: "Link" },
  { action: "code",      icon: "</>", title: "Inline code" },
  { action: "codeblock", icon: "{ }", title: "Code block" },
  { action: "quote",     icon: "❝",   title: "Quote" },
  { action: "table",     icon: "▦",   title: "Table" },
];

const MarkdownToolbar = ({ onAction }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 1, padding: "3px 5px",
    borderBottom: `1px solid ${T.border}`, background: T.bg }}>
    {MD_BUTTONS.map(b => (
      <button key={b.action} type="button" title={b.title}
        onMouseDown={e => e.preventDefault()} // keep the textarea's selection alive through the click
        onClick={() => onAction(b.action)}
        style={{ background: "none", border: "none", cursor: "pointer", borderRadius: 4,
          padding: "4px 7px", fontSize: 12, fontFamily: T.mono, color: T.textMuted, lineHeight: 1, ...b.style }}
        onMouseEnter={e => { e.currentTarget.style.background = T.surfaceHover; e.currentTarget.style.color = T.text; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = T.textMuted; }}>
        {b.icon}
      </button>
    ))}
  </div>
);

// ─── @Mention typeahead (TKT-LQCH4B) ───────────────────────────────────────────
// notifyMentions (routes/kanban.js) already regex-matches @Full Name in comment
// bodies to fire notifications — this only adds the UI affordance for it, so
// every insertion below reproduces that exact "@First Last" text, nothing new
// server-side beyond a name lookup any logged-in user (not just admins) can call.

let mentionableUsersPromise = null;
const getMentionableUsers = () => {
  if (!mentionableUsersPromise) mentionableUsersPromise = api.users.mentionable().catch(() => []);
  return mentionableUsersPromise;
};

// Finds an in-progress "@word" or "@First Last" run ending exactly at the
// cursor. Must start at the beginning of the text or right after whitespace,
// so it doesn't fire mid-word (e.g. "someone@example.com").
const getActiveMention = (text, cursor) => {
  const before = text.slice(0, cursor);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  const prevChar = atIndex > 0 ? before[atIndex - 1] : "";
  if (prevChar && !/\s/.test(prevChar)) return null;
  const fragment = before.slice(atIndex + 1);
  if (fragment.length > 40 || /^\s/.test(fragment)) return null;
  if (!/^([A-Za-z][\w.'-]*)?( ([A-Za-z][\w.'-]*)?)?$/.test(fragment)) return null;
  return { start: atIndex, query: fragment };
};

const userMatchesQuery = (name, query) => {
  const qWords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (qWords.length === 0) return true;
  const nameWords = name.toLowerCase().split(/\s+/);
  return qWords.every((qw, i) => nameWords[i] && nameWords[i].startsWith(qw));
};

// Mirrors the textarea's text up to the caret in a hidden same-styled div to
// read off the caret's pixel position — the only reliable way to place a
// popup at the caret in a plain <textarea> (no DOM API exposes this directly).
const getCaretPixelPosition = (ta, index) => {
  const style = window.getComputedStyle(ta);
  const div = document.createElement("div");
  ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
   "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
   "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight",
   "textTransform", "wordSpacing", "textIndent"].forEach(p => { div.style[p] = style[p]; });
  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";
  div.textContent = ta.value.slice(0, index);
  const marker = document.createElement("span");
  marker.textContent = ta.value.slice(index) || ".";
  div.appendChild(marker);
  document.body.appendChild(div);
  const rect = ta.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || 18;
  const top  = rect.top  - ta.scrollTop  + marker.offsetTop + lineHeight;
  const left = rect.left - ta.scrollLeft + marker.offsetLeft;
  document.body.removeChild(div);
  return { top, left };
};

const MentionDropdown = ({ top, left, users, activeIndex, onPick, onHover }) => createPortal(
  <div style={{
    position: "fixed", top, left, zIndex: 10000, minWidth: 180, maxHeight: 220, overflowY: "auto",
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,.35)", padding: 4,
  }}>
    {users.length === 0 ? (
      <div style={{ padding: "8px 10px", fontFamily: T.body, fontSize: 12.5, color: T.textMuted }}>No matches</div>
    ) : users.map((u, i) => (
      <div key={u.id} onMouseDown={e => { e.preventDefault(); onPick(u); }} onMouseEnter={() => onHover(i)}
        style={{ padding: "6px 10px", borderRadius: 5, cursor: "pointer", fontFamily: T.body, fontSize: 13,
          color: T.text, background: i === activeIndex ? T.accentBg : "transparent" }}>
        {u.name}
      </div>
    ))}
  </div>,
  document.body
);

const Textarea = ({ label, value, onChange, placeholder, rows = 3, ticketId }) => {
  const taRef = useRef(null);
  const [mention, setMention] = useState(null); // { start, query, top, left, activeIndex }
  const [mentionUsers, setMentionUsers] = useState([]);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => { getMentionableUsers().then(setMentionUsers); }, []);

  // ─── Inline image paste/drop (TKT-8LE2SZ) ───────────────────────────────────
  // Reuses the existing ticket_attachments upload pipeline — only available
  // once a ticket exists to attach to (same constraint the separate Attachments
  // panel already has for a not-yet-created ticket). A unique placeholder is
  // inserted immediately so the user sees something happened, then swapped for
  // the real "![name](url)" once the upload resolves — reading value from a
  // ref rather than the closed-over prop so a slow upload doesn't clobber
  // whatever the user has typed in the meantime.
  const handleImageFile = async file => {
    if (!ticketId) return;
    const ta = taRef.current;
    if (!ta) return;
    const token = Math.random().toString(36).slice(2, 8);
    const placeholder = `![Uploading ${file.name}…](pending:${token})`;
    const insertAt = ta.selectionStart, insertEnd = ta.selectionEnd;
    const withPlaceholder = value.slice(0, insertAt) + placeholder + value.slice(insertEnd);
    onChange(withPlaceholder);
    const caret = insertAt + placeholder.length;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(caret, caret); });

    const swap = replacement => {
      const current = valueRef.current;
      onChange(current.includes(placeholder)
        ? current.replace(placeholder, replacement)
        : current + (current && !current.endsWith("\n") ? "\n" : "") + replacement);
    };

    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const attachment = await api.tickets.addAttachment(ticketId, { filename: file.name, mimeType: file.type, data: base64 });
      swap(`![${attachment.filename}](/api/attachments/${attachment.id}/download)`);
    } catch (e) {
      swap("");
      toast.error(`Failed to upload ${file.name}: ${e.message}`);
    }
  };

  const handlePaste = e => {
    const item = Array.from(e.clipboardData?.items || []).find(it => it.kind === "file" && it.type.startsWith("image/"));
    if (!item || !ticketId) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    handleImageFile(file);
  };

  const handleDrop = e => {
    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith("image/"));
    if (!file || !ticketId) return;
    e.preventDefault();
    handleImageFile(file);
  };

  const applyAction = action => {
    const ta = taRef.current;
    if (!ta) return;
    const { newText, selStart, selEnd } = MD_ACTIONS[action](value || "", ta.selectionStart, ta.selectionEnd);
    onChange(newText);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  };

  const updateMentionState = text => {
    const ta = taRef.current;
    if (!ta) return;
    const active = getActiveMention(text, ta.selectionStart);
    if (!active) { setMention(null); return; }
    const { top, left } = getCaretPixelPosition(ta, active.start + 1);
    setMention({ ...active, top, left, activeIndex: 0 });
  };

  const handleChange = e => {
    onChange(e.target.value);
    updateMentionState(e.target.value);
  };

  const filteredUsers = mention
    ? mentionUsers.filter(u => userMatchesQuery(u.name, mention.query)).slice(0, 8)
    : [];

  const pickMention = user => {
    const ta = taRef.current;
    if (!ta || !mention) return;
    const insertion = `@${user.name} `;
    const newText = value.slice(0, mention.start) + insertion + value.slice(ta.selectionStart);
    const caret = mention.start + insertion.length;
    onChange(newText);
    setMention(null);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = e => {
    if (!mention) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setMention(null);
      return;
    }
    if (filteredUsers.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMention(m => ({ ...m, activeIndex: (m.activeIndex + 1) % filteredUsers.length }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMention(m => ({ ...m, activeIndex: (m.activeIndex - 1 + filteredUsers.length) % filteredUsers.length }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pickMention(filteredUsers[mention.activeIndex]);
    }
  };

  return (
    <Field label={label}>
      <div style={{ border: `1px solid ${T.border}`, borderRadius: 7, overflow: "hidden" }}>
        <MarkdownToolbar onAction={applyAction} />
        <textarea ref={taRef} value={value} onChange={handleChange} onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onPaste={handlePaste} onDrop={handleDrop} onDragOver={e => ticketId && e.preventDefault()}
          placeholder={placeholder} rows={rows}
          style={{ ...inputBase, border: "none", borderRadius: 0, fontFamily: T.body, fontSize: 14, resize: "vertical", display: "block" }} />
      </div>
      {mention && (
        <MentionDropdown top={mention.top} left={mention.left} users={filteredUsers}
          activeIndex={mention.activeIndex} onPick={pickMention}
          onHover={i => setMention(m => ({ ...m, activeIndex: i }))} />
      )}
    </Field>
  );
};


// ─── Shared: Contract Type Picker ─────────────────────────────────────────────

const ContractTypeInput = ({ value, onChange }) => (
  <div>
    <div style={{ fontFamily: T.body, fontSize: 10.5, color: T.textMuted, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>
      Contract Type <span style={{ color: T.danger }}>*</span>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {CONTRACT_PRESETS.map(t => (
        <BtnToggle key={t} selected={value === t} onClick={() => onChange(t)}>{t}</BtnToggle>
      ))}
    </div>
  </div>
);

// ─── Forms ────────────────────────────────────────────────────────────────────

export { BtnToggle, Field, Inp, Sel, Textarea, ContractTypeInput };