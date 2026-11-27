"use client";

import { BookOpen, FileCode2, FileText } from "lucide-react";
import type { Definition, ListItem, PhrasingContent, RootContent, TableCell, TableRow } from "mdast";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/components/CopyButton";
import { buttonStyles } from "@/components/Ui";
import { conversationRequest } from "@/lib/conversation-client";
import type { ResponseSection } from "@/lib/conversation-types";

const parser = remark().use(remarkGfm);
type RenderNode = RootContent | PhrasingContent | ListItem | TableCell | TableRow;

export function safeResponseHref(href: string) {
  if (!href || href.length > 8192 || /[\x00-\x20\x7f\\]/.test(href)) return;
  if (href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"))) return href;
  try {
    const url = new URL(href);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.href;
  } catch { /* Invalid or unsupported link. */ }
}

function Markdown({ text }: { text: string }) {
  const root = useMemo(() => parser.parse(text), [text]);
  const definitions = new Map<string, Definition>();
  for (const item of root.children) if (item.type === "definition" && !definitions.has(item.identifier)) definitions.set(item.identifier, item);
  const children = (items: RenderNode[]) => items.map((item, index) => <Fragment key={index}>{render(item)}</Fragment>);
  const link = (url: string, contents: ReactNode, title?: string | null) => {
    const href = safeResponseHref(url);
    return href ? <a href={href} title={title ?? undefined} target={href.startsWith("http") ? "_blank" : undefined}
      rel="noopener noreferrer">{contents}</a> : contents;
  };
  function render(node: RenderNode): ReactNode {
    switch (node.type) {
      case "text": return node.value;
      case "paragraph": return <p>{children(node.children)}</p>;
      case "heading": {
        const Heading = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[node.depth - 1];
        return <Heading>{children(node.children)}</Heading>;
      }
      case "blockquote": return <blockquote>{children(node.children)}</blockquote>;
      case "strong": return <strong>{children(node.children)}</strong>;
      case "emphasis": return <em>{children(node.children)}</em>;
      case "delete": return <del>{children(node.children)}</del>;
      case "break": return <br />;
      case "thematicBreak": return <hr />;
      case "inlineCode": return <code>{node.value}</code>;
      case "code": return <figure className="min-w-0 rounded-lg border border-border bg-muted">
        <figcaption className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate">{node.lang || "Code"}</span><CopyButton text={node.value} label="code block" compact />
        </figcaption>
        <pre className="overflow-x-auto p-3" tabIndex={0}><code>{node.value}</code></pre>
      </figure>;
      case "link": return link(node.url, children(node.children), node.title);
      case "linkReference": {
        const definition = definitions.get(node.identifier);
        return definition ? link(definition.url, children(node.children), definition.title) : children(node.children);
      }
      case "list": return node.ordered ? <ol start={node.start ?? undefined}>{children(node.children)}</ol> : <ul>{children(node.children)}</ul>;
      case "listItem": return <li>{node.checked != null && <span role="img" aria-label={node.checked ? "Complete" : "Incomplete"}>{node.checked ? "☑ " : "☐ "}</span>}{children(node.children)}</li>;
      case "table": {
        const [header, ...rows] = node.children;
        return <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} aria-label="Markdown table">
          <table>
            {header && <thead><tr>{header.children.map((cell, index) => <th scope="col" key={index}>{children(cell.children)}</th>)}</tr></thead>}
            <tbody>{children(rows)}</tbody>
          </table>
        </div>;
      }
      case "tableRow": return <tr>{children(node.children)}</tr>;
      case "tableCell": return <td>{children(node.children)}</td>;
      case "image":
      case "imageReference": return node.alt;
      default: return null;
    }
  }
  return <div className="adt-response-markdown min-w-0 break-words">{children(root.children)}</div>;
}

const actionUrl = (runId: string, id: string) => `/api/workflow-runs/${runId}/actions/${id}`;

function ResponseSectionView({ runId, section, raw, preview }: {
  runId: string; section: ResponseSection; raw: boolean; preview: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const markdown = section.markdown;

  async function invoke(id: string, review: boolean) {
    if (pending) return;
    setPending(review ? id : "preview");
    setError("");
    try {
      if (review) {
        const result = await conversationRequest<{ id: string }>(actionUrl(runId, id), { method: "POST" });
        router.push(`/advisor/knowledge?proposal=${encodeURIComponent(result.id)}`);
      } else {
        await preview(id);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The response action is unavailable.");
    } finally {
      setPending(undefined);
    }
  }

  return <div className={section.label ? "mt-4 min-w-0 rounded-lg border border-border p-3 sm:p-4" : "min-w-0"}>
    {section.label && <h3 className="mb-2 text-sm font-semibold">{section.label}</h3>}
    {markdown !== undefined && (raw
      ? <pre className="min-w-0 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-muted p-3 text-sm">{markdown}</pre>
      : markdown ? <Markdown text={markdown} /> : <p className="text-sm text-muted-foreground">The Workflow returned no text.</p>)}
    {section.actions?.length ? <div className="mt-3 flex flex-wrap items-center gap-2">
      {markdown === undefined && <button type="button" className={buttonStyles.secondary} disabled={Boolean(pending)}
        onClick={() => void invoke(section.actions![0].id, false)}>{pending === "preview" ? "Loading output…" : "View output"}</button>}
      {section.label && markdown !== undefined && <CopyButton text={markdown} label="section" compact />}
      {section.actions.map(action => action.kind === "knowledge-proposal" && <button key={action.id} type="button"
        className={buttonStyles.secondary} disabled={Boolean(pending)} onClick={() => void invoke(action.id, true)}>
        <BookOpen className="size-4" aria-hidden="true" />{pending === action.id ? "Opening proposal…" : "Review & save to knowledge"}
      </button>)}
    </div> : null}
    {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
  </div>;
}

export function WorkflowResponse({ runId, sections }: { runId: string; sections: ResponseSection[] }) {
  const [raw, setRaw] = useState(false);
  const [previews, setPreviews] = useState(() => new Map<string, string>());
  const visible = sections.map(section => ({ ...section, markdown: section.markdown ?? previews.get(section.id) }));
  async function load(id: string) {
    return (await conversationRequest<{ markdown: string }>(actionUrl(runId, id))).markdown;
  }
  async function preview(id: string) {
    const markdown = await load(id);
    setPreviews(previous => new Map(previous).set(id, markdown));
  }
  async function completeResponse() {
    const parts: string[] = [];
    // Keep the timeline lightweight and limit concurrent reads for an explicit complete copy.
    for (let start = 0; start < visible.length; start += 4) {
      parts.push(...await Promise.all(visible.slice(start, start + 4).map(section => section.markdown ?? load(section.id))));
    }
    return parts.filter(Boolean).join("\n\n");
  }
  if (!visible.length) return null;
  const response = visible.every(section => section.markdown !== undefined)
    ? visible.map(section => section.markdown).filter(Boolean).join("\n\n") : completeResponse;
  return <div className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {response && <CopyButton text={response} label="complete response" compact />}
      <button type="button" className={buttonStyles.subtle} aria-pressed={raw} onClick={() => setRaw(value => !value)}>
        {raw ? <FileText aria-hidden="true" className="size-4" /> : <FileCode2 aria-hidden="true" className="size-4" />}
        {raw ? "Show rendered" : "Show raw Markdown"}
      </button>
    </div>
    {visible.map(section => <ResponseSectionView key={section.id} runId={runId} section={section} raw={raw} preview={preview} />)}
  </div>;
}
