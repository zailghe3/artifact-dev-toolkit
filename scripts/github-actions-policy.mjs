const fullShaPattern = /^[0-9a-f]{40}$/;
const actionNamePattern = /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?)*$/;
const actionLinePattern = /^\s*(?:-\s*)?uses:\s+([^\s#]+)(?:\s+#\s*(.*))?\s*$/gm;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plainObject(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => own(value, key));

export function parseApprovedActionsManifest(source) {
  let document;
  try {
    document = JSON.parse(source);
  } catch (error) {
    throw new Error(`Malformed approved Actions manifest: ${error.message}`);
  }

  if (!exactKeys(document, ['schemaVersion', 'actions'])) {
    throw new Error('Malformed approved Actions manifest: expected only schemaVersion and actions.');
  }
  if (document.schemaVersion !== 1) {
    throw new Error(`Unsupported approved Actions manifest schema version: ${String(document.schemaVersion)}.`);
  }
  if (!plainObject(document.actions)) {
    throw new Error('Malformed approved Actions manifest: actions must be an object.');
  }

  // JSON.parse otherwise silently keeps the last occurrence of a duplicate key.
  const serializedEntryNames = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*\{\s*"sha"\s*:/g)]
    .map((match) => JSON.parse(`"${match[1]}"`));
  if (new Set(serializedEntryNames).size !== serializedEntryNames.length) {
    throw new Error('Malformed approved Actions manifest: duplicate Action entries are not allowed.');
  }

  const approvals = new Map();
  for (const [name, approval] of Object.entries(document.actions)) {
    if (!actionNamePattern.test(name)) {
      throw new Error(`Malformed approved Actions manifest: invalid Action name ${JSON.stringify(name)}.`);
    }
    if (!exactKeys(approval, ['sha', 'tag'])) {
      throw new Error(`Malformed approved Actions manifest: ${name} must contain only sha and tag.`);
    }
    if (typeof approval.sha !== 'string' || !fullShaPattern.test(approval.sha)) {
      throw new Error(`Malformed approved Actions manifest: ${name} sha must be exactly 40 lowercase hexadecimal characters.`);
    }
    if (typeof approval.tag !== 'string' || approval.tag === '' || /\s/.test(approval.tag)) {
      throw new Error(`Malformed approved Actions manifest: ${name} tag must be a non-empty, whitespace-free string.`);
    }
    approvals.set(name, { sha: approval.sha, tag: approval.tag });
  }
  return approvals;
}

function promotionMessage(action, ref, comment, approval) {
  const requestedTag = comment.startsWith(`${action}@`) ? comment.slice(action.length + 1) : (comment || '<missing>');
  return [
    'Unapproved GitHub Action release:',
    '',
    action,
    `requested SHA: ${ref}`,
    `requested tag: ${requestedTag}`,
    `approved SHA:  ${approval.sha}`,
    `approved tag:  ${approval.tag}`,
    '',
    'Review the upstream Action release and update',
    '.github/approved-actions.json to promote it.',
  ].join('\n');
}

export function validateWorkflowActionPolicy(workflows, approvals) {
  const errors = [];
  const referenced = new Set();

  for (const [path, body] of Object.entries(workflows)) {
    for (const [, target, rawComment = ''] of body.matchAll(actionLinePattern)) {
      if (target.startsWith('./') || target.startsWith('docker://')) continue;
      const separator = target.lastIndexOf('@');
      const action = separator > 0 ? target.slice(0, separator) : target;
      const ref = separator > 0 ? target.slice(separator + 1) : '';
      const comment = rawComment.trim();
      const approval = approvals.get(action);

      if (!actionNamePattern.test(action)) {
        errors.push(`${path} references malformed external Action ${JSON.stringify(target)}.`);
        continue;
      }
      if (!approval) {
        errors.push(`${path} references unapproved GitHub Action ${action}. Add it to .github/approved-actions.json only after reviewing the upstream Action.`);
        continue;
      }
      referenced.add(action);
      if (!fullShaPattern.test(ref)) {
        errors.push(`${path} must pin ${action} to an exact 40-character lowercase hexadecimal commit SHA.\n\n${promotionMessage(action, ref || '<missing>', comment, approval)}`);
        continue;
      }
      const expectedComment = `${action}@${approval.tag}`;
      if (ref !== approval.sha || comment !== expectedComment) {
        errors.push(`${path}:\n${promotionMessage(action, ref, comment, approval)}`);
      }
    }
  }

  for (const action of approvals.keys()) {
    if (!referenced.has(action)) errors.push(`Obsolete approved Action entry: ${action} is not referenced by any Workflow.`);
  }
  return errors;
}
