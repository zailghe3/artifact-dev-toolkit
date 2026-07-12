import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const moduleUrl = pathToFileURL(new URL("../lib/deployment-metadata.ts", import.meta.url).pathname).href;
const { createDeploymentMetadata, getDeploymentDisplayModel } = await import(moduleUrl);

test("creates validated production deployment metadata", () => {
  const metadata = createDeploymentMetadata({
    deployedAt: "2026-07-12T10:24:00.000Z",
    commitSha: "3B30700D8C912345678901234567890123456789",
    pullRequestNumber: "54",
    repository: "zailghe3/artifact-dev-toolkit",
  });

  assert.deepEqual(metadata, {
    deployedAt: "2026-07-12T10:24:00.000Z",
    commitSha: "3b30700d8c912345678901234567890123456789",
    pullRequestNumber: 54,
    repository: "zailghe3/artifact-dev-toolkit",
  });
});

test("omits unavailable optional pull request metadata", () => {
  const metadata = createDeploymentMetadata({
    deployedAt: "2026-07-12T10:24:00.000Z",
    commitSha: "3b30700d8c912345678901234567890123456789",
    pullRequestNumber: "",
  });

  assert.equal(metadata?.pullRequestNumber, undefined);
});

test("returns development fallback when required metadata is unavailable", () => {
  assert.equal(createDeploymentMetadata({}), null);
});


test("creates footer display links for production metadata", () => {
  const metadata = createDeploymentMetadata({
    deployedAt: "2026-07-12T10:24:00.000Z",
    commitSha: "3b30700d8c912345678901234567890123456789",
    pullRequestNumber: "54",
    repository: "zailghe3/artifact-dev-toolkit",
  });

  assert.deepEqual(getDeploymentDisplayModel(metadata), {
    deployedAt: "2026-07-12T10:24:00.000Z",
    commitSha: "3b30700d8c912345678901234567890123456789",
    shortCommitSha: "3b30700",
    commitUrl: "https://github.com/zailghe3/artifact-dev-toolkit/commit/3b30700d8c912345678901234567890123456789",
    pullRequestNumber: 54,
    pullRequestUrl: "https://github.com/zailghe3/artifact-dev-toolkit/pull/54",
  });
});

test("omits footer pull request links when optional metadata is unavailable", () => {
  const metadata = createDeploymentMetadata({
    deployedAt: "2026-07-12T10:24:00.000Z",
    commitSha: "3b30700d8c912345678901234567890123456789",
  });

  assert.equal(getDeploymentDisplayModel(metadata).pullRequestUrl, undefined);
});
