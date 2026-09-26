# Microsoft Work IQ operator setup

Microsoft Work IQ is a direct, delegated REST provider. Complete Microsoft tenant setup before creating the ADT connection.

## Tenant and application prerequisites

- Follow Microsoft's current [tenant enablement guidance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq). Provision Work IQ and configure the current usage/billing arrangement documented there.
- Have a Global Administrator complete the one-time tenant provisioning and grant administrator consent.
- Create a confidential web application registration in Microsoft Entra ID.
- Record its Directory (tenant) ID and Application (client) ID.
- Register the exact ADT callback URI: `https://<adt-host>/api/workflow-connections/work-iq/callback`.
- Add only the delegated permission `api://workiq.svc.cloud.microsoft/WorkIQAgent.Ask` and grant the required administrator consent. This v1 integration does not need broad Microsoft Graph permissions such as `User.Read`, mail, files, calendar, Teams, or Sites.
- Create a client secret. Treat it as write-only private material.
- Set the non-secret Worker configuration `WORK_IQ_OAUTH_REDIRECT_URI` to that exact HTTPS callback URI. The configured value and Entra registration must match exactly.

Microsoft documents Work IQ as delegated authentication for work or school accounts. Application-only authentication and personal Microsoft accounts are unsupported for this integration. See the current [Work IQ API overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/api-overview) and [Microsoft identity-platform authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## Connect ADT

1. Create a **Microsoft Work IQ** connection in ADT.
2. Enter the tenant ID, client ID, and client secret.
3. Save the configured connection.
4. Select **Connect Microsoft 365 account** and sign in with one work or school account.
5. Run **Test connection** explicitly when a capacity-consuming live test is appropriate.

All Agents sharing the connection act with the connected account's Microsoft 365 permissions. Reconnecting may replace that account and changes the permissions/context used by all those Agents; already-snapshotted runs remain pinned to their prior authorization context and fail rather than switching identity.

Disconnecting removes ADT's local delegated authorization. It does not revoke tenant-wide Microsoft administrator consent or claim to revoke every Microsoft session or token.
