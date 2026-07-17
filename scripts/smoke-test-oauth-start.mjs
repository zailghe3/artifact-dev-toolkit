export const productionOAuthStartUrl = "https://fpo-adt.florian-pouchet.workers.dev/auth/github/start";

export async function smokeTestOAuthStart(fetchImpl = fetch, endpoint = productionOAuthStartUrl) {
  const response = await fetchImpl(endpoint, { redirect: "manual", headers: { accept: "text/html" } });
  if (response.status < 300 || response.status >= 400) throw new Error(`OAuth start returned non-redirect status ${response.status}.`);
  const location = response.headers.get("location");
  if (!location) throw new Error("OAuth start redirect is missing Location.");
  let target;
  try { target = new URL(location); } catch { throw new Error("OAuth start redirect Location is invalid."); }
  if (target.origin !== "https://github.com" || target.pathname !== "/login/oauth/authorize") throw new Error("OAuth start did not redirect to GitHub authorization.");
  for (const parameter of ["client_id", "state", "code_challenge"]) {
    if (!target.searchParams.get(parameter)) throw new Error(`OAuth start redirect is missing ${parameter}.`);
  }
  if (target.searchParams.get("code_challenge_method") !== "S256") throw new Error("OAuth start redirect does not use S256 PKCE.");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  smokeTestOAuthStart().then(() => console.log("OAuth initiation smoke test passed.")).catch((error) => {
    // Errors are intentionally categorical and never include Location, cookies, state, or response bodies.
    console.error(error.message);
    process.exitCode = 1;
  });
}
