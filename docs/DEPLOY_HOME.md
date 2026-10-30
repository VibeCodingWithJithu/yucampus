# Putting YuCampus online from your own computer (Cloudflare Tunnel)

A step-by-step checklist for the Yubhian team, for the free pilot setup decided on 2026-10-30
(docs/ARCHITECTURE.md): YuCampus runs in Docker on a Windows computer in India, and Cloudflare (free) gives it
HTTPS addresses under yubhiantechnologies.in. No port is opened on your router. About two hours the first time.

When you are done:

| Address | What it is |
|---|---|
| `https://<college>.yubhiantechnologies.in` | Each college, e.g. `https://srec.yubhiantechnologies.in` |
| `https://admin.yubhiantechnologies.in` | The YuCampus team panel |
| `https://auth.yubhiantechnologies.in` | Where Google and Microsoft sign-in return (no page of its own) |
| `https://files.yubhiantechnologies.in` | Evidence files (only through signed links) |
| `yubhiantechnologies.in`, `www`, email | Your company website and email: unchanged |

Names the company uses or may use (www, mail, blog, careers and so on) cannot be chosen for a college.

**Before you start, know the limits of this setup.** When the computer is off, asleep, restarting for Windows
Update, or offline, every college is offline too. Use it for demos and the first pilot colleges; move to a server
(the same setup, see "Moving to a server later") before colleges depend on it every day.

---

## 1. Prepare the computer (about 20 minutes)

1. **Keep it awake**: Settings → System → Power → **Screen and sleep**: "When plugged in, put my device to sleep
   after" → **Never**. On a laptop, keep it plugged in and set "When I close the lid" to **Do nothing**
   (Control Panel → Power Options → Choose what closing the lid does).
2. **Encrypt the disk**: Settings → Privacy & security → **Device encryption** (or **BitLocker** on Windows Pro)
   → On. Save the recovery key in the company password manager. College data will live on this disk.
3. **Windows Update**: Settings → Windows Update → Advanced options → **Active hours** → set them to cover college
   hours (for example 8:00 to 20:00), so restarts happen at night.
4. **Docker Desktop** is already installed. Open it → Settings → General → tick **Start Docker Desktop when you sign
   in to your computer**. After a restart, sign in to Windows so Docker (and YuCampus) starts again.

## 2. Move the DNS of yubhiantechnologies.in to Cloudflare (about 30 minutes, then up to a day to spread)

Your domain stays registered at Hostinger; only the "phone book" (DNS) moves to Cloudflare. Your website and email
keep working if every record is copied, so check the list carefully.

1. Create a free account at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. **Add a domain** → `yubhiantechnologies.in` → **Quick scan for DNS records** → plan **Free**.
3. Cloudflare shows the records it found. Open [Hostinger hPanel](https://hpanel.hostinger.com/) → **Domains** →
   `yubhiantechnologies.in` → **DNS / Nameservers** → **DNS records** in another tab and compare. Every record in
   Hostinger must also be in Cloudflare, especially:
   - **MX** records (email)
   - **TXT** records (SPF `v=spf1 ...`, DKIM, Google or Microsoft verification)
   - **A / CNAME** records for the website (`@`, `www`)

   Add any that are missing in Cloudflare (**Add record**, same type, name and value).
4. For the records copied from Hostinger, click the orange cloud so it turns **grey (DNS only)**. This keeps your
   website and email working exactly as they do today.
5. Cloudflare shows two nameservers, like `anna.ns.cloudflare.com` and `bob.ns.cloudflare.com`. In hPanel →
   **Domains** → `yubhiantechnologies.in` → **DNS / Nameservers** → **Change nameservers** → **Use custom
   nameservers**, enter the two Cloudflare names and save.
6. Wait until Cloudflare emails you that the domain is **Active** (usually within an hour, at most a day). Then
   check that your website opens and that an email sent to your company address arrives.
7. In Cloudflare → **SSL/TLS** → **Edge Certificates**: turn on **Always Use HTTPS**.

## 3. Create the tunnel (about 15 minutes)

1. Cloudflare dashboard → **Zero Trust** (left menu; choose the **Free** plan if asked; it asks for a card but the
   free plan is not charged) → **Networks** → **Tunnels** → **Create a tunnel** → **Cloudflared** → name
   `yucampus-home` → **Save tunnel**.
2. On the "Install and run connectors" page, choose **Docker**. Copy the long value after `--token` in the command
   shown. You do not run that command: the token goes into `.env` in step 5.
3. **Next** → add the routes (called **Public hostnames** or **Published application routes**). Add them in this
   order; the first match wins:

   | Subdomain | Domain | Service type | URL |
   |---|---|---|---|
   | `files` | yubhiantechnologies.in | HTTP | `storage:8333` |
   | `*` | yubhiantechnologies.in | HTTP | `web:3000` |

4. If Cloudflare says it could not create the DNS record for `*`, add it yourself: **DNS** → **Records** → **Add
   record** → type **CNAME**, name `*`, target `<tunnel id>.cfargotunnel.com` (the tunnel id is shown on the tunnel's
   page), **Proxied** (orange cloud) → Save. Your own records (`@`, `www`, `mail` ...) are more specific and keep
   working.

## 4. Email sending

YuCampus sends invitations, password resets and reminders. The simplest free option is a mailbox in your Hostinger
email: create `no-reply@yubhiantechnologies.in` in hPanel → **Emails**. Its SMTP address is
`smtp.hostinger.com`, port 465. Hostinger limits how many emails a mailbox may send per day, which is fine for a
pilot. Amazon SES (Mumbai) is the option when that is no longer enough.

## 5. Get the code and fill in the settings

Use a separate folder for the live copy, so your development work never changes what colleges use. In PowerShell:
```powershell
git clone https://github.com/VibeCodingWithJithu/yucampus.git C:\YuCampus-live
cd C:\YuCampus-live\infra\production
copy env.example .env
notepad .env
```
Fill in every value:
- `ROOT_DOMAIN=yubhiantechnologies.in` (already set) and `CLOUDFLARE_TUNNEL_TOKEN=` the token from step 3.
- `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `JWT_SECRET`, `TOTP_KEY`: a different
  random value for each. Make one with this PowerShell line (run it six times):
  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | % { $_.ToString('x2') }) -join ''
  ```
- `SMTP_URL=smtps://no-reply%40yubhiantechnologies.in:MAILBOX_PASSWORD@smtp.hostinger.com:465` (the `@` in the
  address is written `%40`; write `/`, `+`, `=`, `@` or `:` in the password as `%2F`, `%2B`, `%3D`, `%40`, `%3A`).
- Google and Microsoft: the same four values as in your development `.env`.
- Leave `ACME_EMAIL` empty (it is for the rented-server setup).

Keep a copy of this `.env` in the company password manager. Without it the database and files cannot be opened.

## 6. Build and start (about 15 minutes)

In `C:\YuCampus-live\infra\production`:
```powershell
docker compose build                                   # builds the app (5 to 10 minutes)
docker compose up -d postgres redis storage            # database, job queue, file storage
docker compose run --rm tools pnpm db:migrate          # creates the tables
docker compose run --rm tools pnpm db:rules            # loads the NAAC, NBA, NIRF and AISHE rules
docker compose up -d                                   # starts everything, including the tunnel
docker compose ps                                      # every service "Up"; api "healthy" after a minute
```
This runs next to your development setup without touching it: the live copy is called `yucampus-live` in Docker
and opens no ports on the computer. The live database gets the rules only: no sample college, no sample accounts.

In Cloudflare → Zero Trust → Networks → Tunnels, `yucampus-home` should now show **Healthy**.

Check that file storage is ready:
```powershell
docker compose exec api node -e "fetch('http://localhost:4000/health').then(r => r.text()).then(console.log)"
```
It should print `"database":"up","storage":"up"`. If storage says `off`, the tunnel was not connected yet when the
API started: wait a minute and run `docker compose restart api`.

## 7. Create your team account and the first college

```powershell
docker compose run --rm tools pnpm platform:create-admin "Your Name" you@yubhiantechnologies.in
```
It prints a link to `https://admin.yubhiantechnologies.in/admin/set-password?...`. Open it within 3 days, choose a
password and set up your authenticator app. Save the recovery codes.

In the panel, **Colleges** → add a college (name, type, state, subdomain such as `srec`). The college admin gets an
email invitation. Open `https://srec.yubhiantechnologies.in` to check it loads with a padlock.

## 8. Turn on nightly backups

Try it once:
```powershell
powershell -ExecutionPolicy Bypass -File C:\YuCampus-live\infra\production\backup.ps1 -Dir D:\YuCampus-backups
```
Then schedule it every night at 2:30 (the computer must be on):
```powershell
schtasks /Create /SC DAILY /ST 02:30 /TN "YuCampus backup" /TR "powershell -ExecutionPolicy Bypass -File C:\YuCampus-live\infra\production\backup.ps1 -Dir D:\YuCampus-backups"
```
Use a different drive than the one YuCampus runs on if you have one. It keeps 14 days. Once a week, also copy the
folder to an external disk kept somewhere else: if this computer is lost or stolen, that copy is all you have.

## 9. Google and Microsoft sign-in

The live sign-in addresses are now under yubhiantechnologies.in. Add them as described in
[SSO_SETUP.md](SSO_SETUP.md), steps B5 and B6:
```
https://auth.yubhiantechnologies.in/api/v1/auth/sso/google/callback
https://auth.yubhiantechnologies.in/api/v1/auth/sso/microsoft/callback
```
Then run `docker compose up -d` again.

---

## Updating to a new version

```powershell
cd C:\YuCampus-live
git pull
cd infra\production
docker compose build
docker compose run --rm tools pnpm db:migrate
docker compose run --rm tools pnpm db:rules
docker compose up -d
```
People may see an error for a few seconds while the API restarts. Do updates outside college hours.

## Useful commands (in `C:\YuCampus-live\infra\production`)

| To | Run |
|---|---|
| See what is running | `docker compose ps` |
| Read the API's log | `docker compose logs api --tail 100` |
| Read the tunnel's log | `docker compose logs tunnel --tail 100` |
| Restart everything | `docker compose restart` |
| Stop everything (data is kept) | `docker compose down` |

Never run `docker compose down -v`: `-v` deletes the database and all evidence files.

## If something goes wrong

| You see | Check |
|---|---|
| Cloudflare error 1033 | The tunnel is not connected: is the computer on, Docker running, `docker compose ps` showing `tunnel` Up? |
| Cloudflare error 502 | The tunnel works but the app is not ready: `docker compose ps`, then `docker compose logs web` / `api`. |
| Website or email stopped working after step 2 | A record was not copied to Cloudflare: compare with the list in Hostinger (still visible there). |
| Uploads fail | The health check in step 6 must say `"storage":"up"`. Files over 100 MB are refused by Cloudflare's free plan. |
| Emails do not arrive | `docker compose logs api` for SMTP errors; check the mailbox password in `SMTP_URL`. |
| Restoring a backup | Ask before doing this: it replaces the live database. `docker compose cp D:\YuCampus-backups\database-<date>.dump postgres:/tmp/r.dump`, then `docker compose exec postgres pg_restore -U yucampus -d yucampus --clean /tmp/r.dump` |

## Moving to a server later

Rent a server in India (or use Oracle Cloud Always Free; docs/DEPLOY.md, step 1), install Docker, copy `.env`
and the latest backup to it, and run the same commands from step 6 there, then restore the backup. The tunnel token
moves with `.env`, so the addresses stay the same and nothing changes for colleges. Then stop the copy on this
computer.
