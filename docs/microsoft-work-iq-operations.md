# Microsoft Work IQ operator setup

Microsoft Work IQ is a delegated REST provider executed through ADT Runtime. The Worker owns the browser-facing OAuth redirect and repository-authorised callback; Runtime owns the OAuth state/exchange, encrypted client/refresh-token material, delegated identity context, and provider execution. Complete Microsoft tenant setup before creating the ADT connection.

## Tenant and application prerequisites

- Follow Microsoft's current tenant enablement guidance and provision Work IQ for the intended tenant.
- Have the required Microsoft administrator complete tenant provisioning and grant administrator consent.
- Create a confidential web application registration in Microsoft Entra ID.
- Record its Directory (tenant) ID and Application (client) ID.
- Register the exact ADT callback URI: `https://<adt-host>/api/workflow-connections/work-iq/callback`.
- Grant only the delegated Work IQ permission required by the integration; do not add broad Microsoft Graph permissions unless a future ADT capability explicitly requires them.
- Create a client secret and treat it as write-only private material.
- Configure the Worker callback URI setting to exactly match the Entra registration.

Microsoft Work IQ uses delegated authentication for a work or school account. Application-only identity and personal-account support are outside the current ADT integration.

## Connect ADT

1. Create a **Microsoft Work IQ** connection in ADT.
2. Enter the tenant ID, client ID, and client secret.
3. Save the connection.
4. Choose **Connect Microsoft 365 account** and complete the browser sign-in.
5. Run **Test connection** when a live provider check is appropriate.
6. Commission [ADT Runtime](../adt-runtime/README.md#diagnostics-and-commissioning) separately before running Work IQ Agents.

The browser callback is only the public hand-off point. The Worker validates the current application/repository session and forwards the authorised OAuth continuation to Runtime. Runtime stores the delegated private state in its encrypted vault, refreshes the delegated authorization when needed, and obtains short-lived provider access for execution.

All Agents sharing one Work IQ connection act with the connected account's Microsoft 365 permissions. Reconnecting can replace that delegated identity for future runs; an already-snapshotted run remains pinned to its frozen authorization context and fails rather than silently switching accounts.

Disconnecting removes ADT's local delegated authorization. It does not revoke tenant-wide Microsoft administrator consent or claim to revoke unrelated Microsoft sessions or tokens.

Provider-specific request framing, token refresh mechanics, timeout values, and exact Microsoft API details remain authoritative in source/tests and Microsoft's current documentation.
