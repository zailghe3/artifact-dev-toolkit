"use client";

import { useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { MAX_DECISION_OPTIONS, approvalOutcomeLabels } from "../adt-runtime/src/workflow-interaction-contract";
import { workflowBlockRegistry } from "@/lib/workflow-block-registry";
import { buttonStyles } from "@/components/Ui";
import { workflowGraphNodeClass, type WorkflowGraphNodeKind } from "@/components/WorkflowGraphNodeStyles";

type Option = { id: string; title: string; description?: string; value?: string };
const optional = (value: string) => value === "" ? undefined : value;

export function WorkflowInteractiveGraphNode({ id, type, data }: NodeProps) {
  const version = Number(data.blockVersion ?? 1);
  const block = workflowBlockRegistry.resolve(type, version);
  const updateNodeInternals = useUpdateNodeInternals();
  let outputs: readonly { id: string }[] = block.interface.outputs;
  try { outputs = workflowBlockRegistry.ports(type, version, "outputs", data.config); }
  catch { /* Invalid draft configuration is surfaced alongside block settings. */ }
  const handles = outputs.map(port => port.id).join(",");
  useEffect(() => { updateNodeInternals(id); }, [id, handles, updateNodeInternals]);
  return <div className={workflowGraphNodeClass(type as WorkflowGraphNodeKind)}>
    <Handle id="in" type="target" position={Position.Left} />
    <strong>{block.ui.label}</strong>
    {outputs.map((port, index) => outputs.length === 1
      ? <Handle key={port.id} id={port.id} type="source" position={Position.Right} />
      : <div className="relative pr-2 text-right text-xs" key={port.id}>
        {type === "approval" ? approvalOutcomeLabels[port.id as keyof typeof approvalOutcomeLabels] : port.id}
        <Handle id={port.id} type="source" position={Position.Right} style={{ right: -17 }} />
        <span className="sr-only">Output {index + 1}</span>
      </div>)}
  </div>;
}

export function WorkflowInteractiveBlockEditor({
  type, config, onChange,
}: { type: string; config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void }) {
  const set = (name: string, value: unknown) => onChange({ ...config, [name]: value });
  const text = (name: string, label: string, limit: number, required = false) => <label>
    {label}<input className="adt-field" required={required} maxLength={limit} value={String(config[name] ?? "")}
      onChange={event => set(name, required ? event.target.value : optional(event.target.value))} />
  </label>;
  const check = (name: string, label: string, defaultValue = false) => <label className="flex items-start gap-2">
    <input type="checkbox" checked={Boolean(config[name] ?? defaultValue)} onChange={event => set(name, event.target.checked)} />
    {label}
  </label>;

  if (type === "display-output") return text("label", "Section title (optional)", 160);
  if (type === "human-edit") return text("message", "Review instruction", 2_000, true);
  if (type === "human-input") return <>
    <label>Question source<select className="adt-field" value={String(config.questionSource)}
      onChange={event => onChange({ ...config, questionSource: event.target.value, question: undefined })}>
      <option value="configured">Configured question</option>
      <option value="incoming">Incoming text from the Workflow</option>
    </select></label>
    {config.questionSource === "configured" && text("question", "Question", 2_000, true)}
    {text("message", "Explanation (optional)", 2_000)}
    {text("placeholder", "Answer placeholder (optional)", 240)}
    {check("required", "Require an answer", true)}
    {check("showContext", "Show incoming text alongside the question")}
    {check("includeContext", "Pass incoming text alongside the answer")}
  </>;
  if (type === "approval") return <>
    {text("message", "Approval message", 2_000, true)}
    {check("allowRevision", "Offer Request revision")}
    {config.allowRevision === true && check("requireRevisionFeedback", "Require feedback when requesting revision", true)}
    {check("allowReject", "Offer Reject")}
    <p className="text-sm text-muted-foreground">Connect Approve and any Request revision route.
      An unconnected Reject route ends the Run with a rejected outcome.</p>
  </>;

  const options = (config.options ?? []) as Option[];
  const update = (index: number, fields: Partial<Option>) =>
    set("options", options.map((option, i) => i === index ? { ...option, ...fields } : option));
  return <>
    <label>Options source<select className="adt-field" value={String(config.source)} onChange={event => {
      const { message, allowGuidance } = config;
      const source = event.target.value;
      onChange(source === "dynamic" ? { source, message, allowGuidance } :
        { ...workflowBlockRegistry.resolve("human-decision", 1).authoring.configTemplate as object, message, allowGuidance });
    }}>
      <option value="static">Configured options</option><option value="dynamic">Options supplied by an Agent</option>
    </select></label>
    {text("message", config.source === "dynamic" ? "Default question" : "Question", 2_000, true)}
    {check("allowGuidance", "Allow additional guidance")}
    {config.source === "dynamic" ? <p className="text-sm text-muted-foreground">
      The Agent returns JSON with an optional message and two to eight options. Each option has an ID, title, and value.
      The selected option continues through the out port.
    </p> : <>
      <label>Continuation<select className="adt-field" value={String(config.routing)} onChange={event => set("routing", event.target.value)}>
        <option value="data">One output with the selected value</option><option value="branches">A branch for each option</option>
      </select></label>
      {config.routing === "branches" && <p className="text-sm text-muted-foreground">Connect one route for each option ID.</p>}
      {options.map((option, index) => <fieldset key={index} className="grid gap-2 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-medium">Option {index + 1}</legend>
        <label>Stable ID<input className="adt-field" required maxLength={64} value={option.id}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={event => update(index, { id: event.target.value })} /></label>
        <label>Title<input className="adt-field" required maxLength={160} value={option.title}
          onChange={event => update(index, { title: event.target.value })} /></label>
        <label>Description (optional)<textarea className="adt-field" rows={2} maxLength={2_000} value={option.description ?? ""}
          onChange={event => update(index, { description: optional(event.target.value) })} /></label>
        <label>Downstream value (optional)<textarea className="adt-field" rows={2} maxLength={16_384} value={option.value ?? ""}
          onChange={event => update(index, { value: optional(event.target.value) })} /></label>
        <button type="button" className={buttonStyles.subtle} disabled={options.length <= 2}
          onClick={() => set("options", options.filter((_, i) => i !== index))}>Remove option</button>
      </fieldset>)}
      <div><button type="button" className={buttonStyles.secondary} disabled={options.length >= MAX_DECISION_OPTIONS}
        onClick={() => set("options", [...options, { id: `option-${crypto.randomUUID().slice(0, 8)}`, title: "" }])}>Add option</button></div>
    </>}
  </>;
}
