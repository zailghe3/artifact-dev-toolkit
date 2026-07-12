"use client";

import { getDeploymentDisplayModel, type DeploymentMetadata } from "@/lib/deployment-metadata";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
};

export function formatDeploymentTime(deployedAt: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, DATE_FORMAT).format(new Date(deployedAt));
}

export function DeploymentFooter({ metadata }: { metadata: DeploymentMetadata | null }) {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-5 text-center text-xs text-slate-500 dark:text-slate-400 sm:px-6 lg:px-8">
      {metadata ? <DeploymentIdentity metadata={metadata} /> : <span>Development build</span>}
    </footer>
  );
}

function DeploymentIdentity({ metadata }: { metadata: DeploymentMetadata }) {
  const display = getDeploymentDisplayModel(metadata);

  return (
    <p aria-label={`Deployment ${display.deployedAt} from commit ${display.commitSha}`}>
      <time dateTime={display.deployedAt} title={display.deployedAt}>
        Deployed {formatDeploymentTime(display.deployedAt)}
      </time>
      {display.pullRequestNumber ? (
        <>
          <span aria-hidden="true"> · </span>
          <a className="underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-200" href={display.pullRequestUrl}>
            PR #{display.pullRequestNumber}
          </a>
        </>
      ) : null}
      <span aria-hidden="true"> · </span>
      <a className="underline-offset-2 hover:text-slate-700 hover:underline dark:hover:text-slate-200" href={display.commitUrl} title={display.commitSha}>
        <span className="sr-only">Commit </span>
        {display.shortCommitSha}
      </a>
    </p>
  );
}
