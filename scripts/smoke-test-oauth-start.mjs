export const productionOAuthStartUrl = "https://fpo-adt.florian-pouchet.workers.dev/auth/github/start";

function inspectResponse(response, endpoint) {
  if (response.status >= 500) return { retry: true, error: `OAuth start returned server status ${response.status}.` };
  if (response.status < 300 || response.status >= 400) throw new Error(`OAuth start returned non-redirect status ${response.status}.`);
  const location = response.headers.get("location");
  if (!location) throw new Error("OAuth start redirect is missing Location.");
  let target;
  try { target = new URL(location, endpoint); } catch { throw new Error("OAuth start redirect Location is invalid."); }
  if (target.origin === new URL(endpoint).origin && target.pathname === "/sign-in" && target.searchParams.get("error") === "configuration") {
    return { retry: true, error: "OAuth start reported a configuration failure." };
  }
  if (target.origin !== "https://github.com" || target.pathname !== "/login/oauth/authorize") throw new Error("OAuth start did not redirect to GitHub authorization.");
  for (const parameter of ["client_id", "state", "code_challenge"]) if (!target.searchParams.get(parameter)) throw new Error(`OAuth start redirect is missing ${parameter}.`);
  if (target.searchParams.get("code_challenge_method") !== "S256") throw new Error("OAuth start redirect does not use S256 PKCE.");
  return { retry: false };
}

export async function smokeTestOAuthStart(fetchImpl = fetch, endpoint = productionOAuthStartUrl, options = {}) {
  const attempts = options.attempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const delayMs = options.delayMs ?? 1_000;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError = "OAuth start smoke test failed.";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = inspectResponse(await fetchImpl(endpoint, { redirect: "manual", headers: { accept: "text/html" }, signal: controller.signal }), endpoint);
      if (!result.retry) return;
      lastError = result.error;
    } catch (error) {
      if (error?.name !== "AbortError" && !(error instanceof TypeError)) throw error;
      lastError = error?.name === "AbortError" ? "OAuth start request timed out." : "OAuth start network request failed.";
    } finally { clearTimeout(timeout); }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`${lastError} Retry limit reached.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  smokeTestOAuthStart().then(() => console.log("OAuth initiation smoke test passed.")).catch((error) => {
    console.error(error.message); // Categorical only: never Location, cookies, state, or PKCE values.
    process.exitCode = 1;
  });
}
