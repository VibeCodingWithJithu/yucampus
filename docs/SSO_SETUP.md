# Setting up Google and Microsoft sign-in

A step-by-step checklist for the Yubhian team. Everything here is free. Do part A first: it needs no server and no
domain, only your laptop. Parts B and C are for going live.

Addresses used below (decided 2026-10-30; colleges are <college>.yubhiantechnologies.in):

| What | Local testing | Live |
|---|---|---|
| Google redirect address | `http://localhost:3000/api/v1/auth/sso/google/callback` | `https://auth.yubhiantechnologies.in/api/v1/auth/sso/google/callback` |
| Microsoft redirect address | `http://localhost:3000/api/v1/auth/sso/microsoft/callback` | `https://auth.yubhiantechnologies.in/api/v1/auth/sso/microsoft/callback` |

Type them exactly: no trailing slash, all lowercase. Google and Microsoft rename menu items from time to time; if a
label differs, look for the nearest match.

---

## Part A: Try it on your laptop (about 1 hour)

### A1. Google (about 20 minutes)
1. Open the [Google Cloud Console](https://console.cloud.google.com/) with Yubhian's Google account. Use a company
   account, not a personal one, so access survives staff changes.
2. In the project picker at the top, choose **New project**, name it `YuCampus` and click **Create**. Make sure it is
   selected.
3. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and click **Get started**:
   - App name `YuCampus`, support email a Yubhian address
   - Audience **External**
   - Contact email a Yubhian address
   - Accept the policy and click **Create**.
4. In [Data access](https://console.cloud.google.com/auth/scopes), click **Add or remove scopes** and tick `openid`,
   `.../auth/userinfo.email` and `.../auth/userinfo.profile`. Save.
5. In [Audience](https://console.cloud.google.com/auth/audience) → **Test users**, add the Gmail or Google
   address you will test with. While the app is in "Testing", only these people can sign in.
6. In [Clients](https://console.cloud.google.com/auth/clients), click **Create client**:
   - Type **Web application**, name `YuCampus web`
   - **Authorized redirect URIs**: add the **local** Google address from the table
   - Click **Create**.
7. Copy the **Client ID** and **Client secret** now. The secret is shown only once, so also click **Download JSON**
   and keep the file in a password manager.

### A2. Microsoft (about 20 minutes)
1. You need a Microsoft organisation account.
   - If Yubhian has Microsoft 365, use its admin account.
   - If not, create a free [Azure account](https://azure.microsoft.com/free). It asks for a card and phone to check
     identity; registering an app costs nothing.
2. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) → **Identity** → **Applications** →
   [**App registrations**](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) →
   **New registration**:
   - Name `YuCampus`
   - Supported account types: **Accounts in any organizational directory (Any Microsoft Entra ID tenant –
     Multitenant)**. Not the option that includes personal accounts.
   - Redirect URI: platform **Web**, the **local** Microsoft address from the table
   - Click **Register**.
3. On **Overview**, copy the **Application (client) ID**.
4. Go to **Certificates & secrets** → **New client secret**, choose the longest expiry (24 months) and click **Add**.
   Copy the **Value** column right away (not "Secret ID"). Set a calendar reminder one month before it expires.
5. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated**, tick `openid`, `email` and
   `profile`, then **Add permissions**.
6. Go to **Token configuration** → **Add optional claim** → **ID**, tick `email` and click **Add**. Accept if asked to
   add the Graph email permission.

### A3. Put the values into YuCampus
In the `.env` file at the repo root, add:
```
GOOGLE_CLIENT_ID=<Client ID from A1>
GOOGLE_CLIENT_SECRET=<Client secret from A1>
MICROSOFT_CLIENT_ID=<Application (client) ID from A2>
MICROSOFT_CLIENT_SECRET=<secret Value from A2>
```
Leave `SSO_BASE_URL` and `NEXT_PUBLIC_SSO_URL` out locally. Restart `pnpm dev`. Never commit `.env`.

### A4. Test
1. Open http://localhost:3000, sign in as `admin@sample-college.example` (password `Sample@1234`).
2. In **Users and roles**, add yourself with the exact email you will sign in with. Give yourself any role.
3. Open **Institution setup** → **Sign-in with Google or Microsoft**:
   - Tick Google and Microsoft.
   - In **Email domains allowed**, type your email's domain (e.g. `gmail.com` for a Gmail test).
   - Click **Save**.
4. Sign out. The sign-in page now shows **Continue with Google** and **Continue with Microsoft**. Try each one; you
   should land on the dashboard as yourself.
5. Afterwards, remove test domains such as `gmail.com`. Real colleges list only their own domains.

If something goes wrong:

| You see | Fix |
|---|---|
| Google `redirect_uri_mismatch` | The redirect address differs by a character, `http`/`https`, or a trailing slash. |
| Google "Access blocked" | Add your address under Test users (A1 step 5). |
| Microsoft `AADSTS50011` | Redirect address mismatch. |
| Microsoft `AADSTS7000215` | Wrong secret: you copied the Secret ID instead of the Value. |
| Microsoft "Need admin approval" | Your organisation needs an admin to approve the app (see C2). |
| "not on your college's domain" | Add the domain in Institution setup. |
| "no YuCampus account for that email" | Add the person in Users and roles with exactly that email. |

---

## Part B: Going live

### B1 to B4. Server, DNS, HTTPS and email
Follow [DEPLOY_HOME.md](DEPLOY_HOME.md) (your own computer with a Cloudflare Tunnel), steps 1 to 8. It covers the
computer, moving the DNS to Cloudflare, HTTPS (automatic) and email sending.

### B5. Google, for going live
1. Verify `yubhiantechnologies.in` in [Google Search Console](https://search.google.com/search-console): add a
   **Domain** property, then add the TXT record at your DNS provider.
2. Put three pages on `yubhiantechnologies.in`: a home page, a privacy policy (e.g. `/privacy`) and terms (e.g.
   `/terms`).
3. In [Branding](https://console.cloud.google.com/auth/branding), fill in the home page, privacy policy and terms
   links, and set the authorized domain to `yubhiantechnologies.in`.
4. In [Clients](https://console.cloud.google.com/auth/clients) → `YuCampus web`, add the **live** Google redirect
   address. Keep the local one for testing.
5. In [Audience](https://console.cloud.google.com/auth/audience), click **Publish app** so anyone, not only test
   users, can sign in. With only `openid`, `email` and `profile`, no security review is needed. If you add a logo,
   expect a short brand check.

### B6. Microsoft, for going live
1. In the app → **Authentication**, add the **live** Microsoft redirect address. Keep the local one.
2. Recommended: join the [Microsoft AI Cloud Partner Program](https://partner.microsoft.com/) (free) and add your
   Partner ID under **Branding & properties** → **Publisher verification**
   ([guide](https://learn.microsoft.com/entra/identity-platform/publisher-verification-overview)). Colleges then see
   "verified publisher" instead of a warning.

### B7. Server settings
Put the four Google and Microsoft values in the live copy's `infra/production/.env` (DEPLOY_HOME.md, step 5), then
run `docker compose up -d` in that folder. The sign-in addresses are set from `ROOT_DOMAIN` automatically.

---

## Part C: For each college that wants SSO

1. **In YuCampus:** the college admin opens **Institution setup** → **Sign-in with Google or Microsoft**, ticks the
   provider their college uses and enters their email domain (e.g. `srec.ac.in`). People must already be added in
   **Users and roles** with their college email.
2. **College on Microsoft 365:** the college's IT admin may need to approve YuCampus once for everyone. Send them this
   link, with your Microsoft client ID filled in:
   ```
   https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=YOUR_MICROSOFT_CLIENT_ID&scope=openid%20email%20profile&redirect_uri=https://auth.yubhiantechnologies.in/api/v1/auth/sso/microsoft/callback
   ```
3. **College on Google Workspace that blocks unknown apps:** the college's admin opens
   [Google Admin](https://admin.google.com/) → **Security** → **Access and data control** → **API controls** →
   **Manage third-party app access**, adds YuCampus by its Google Client ID and marks it **Trusted**
   ([help page](https://support.google.com/a/answer/7281227)).

---

## Reminders
- The Microsoft client secret expires (24 months at most). Make a new one and update `MICROSOFT_CLIENT_SECRET` before
  it does, or Microsoft sign-in stops.
- If a secret leaks, delete it in the console, make a new one and update the server.
- Moving to another domain later means changing `ROOT_DOMAIN` on the server (then `docker compose build`), the DNS
  records and the redirect addresses.
  No code changes.
