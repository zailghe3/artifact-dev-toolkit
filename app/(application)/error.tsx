"use client";

import { buttonStyles, PageHeader, Panel } from "@/components/Ui";

export default function ApplicationPageError({ reset }: { reset: () => void }) {
  return (
    <Panel className="max-w-2xl">
      <PageHeader title="This page could not be loaded." description="Try again or open another page from the sidebar." />
      <button type="button" onClick={reset} className={buttonStyles.secondary}>Try again</button>
    </Panel>
  );
}
