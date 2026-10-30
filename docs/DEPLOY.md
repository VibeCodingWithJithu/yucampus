# Putting YuCampus online (rented server with Caddy)

> The pilot runs on Yubhian's own computer through a Cloudflare Tunnel instead (decided 2026-10-30): see
> [DEPLOY_HOME.md](DEPLOY_HOME.md). This guide is for a server whose DNS stays at Hostinger. In step 6, set
> `ROOT_DOMAIN=yucampus.yubhiantechnologies.in` and delete the Cloudflare Tunnel section of `.env`.

A step-by-step checklist for the Yubhian team, for the pilot setup decided on 2026-10-30 (docs/ARCHITECTURE.md):
one server in India runs everything with Docker. It takes about two hours the first time. Do the steps in order.

When you are done:

| Address | What it is |
|---|---|
| `https://<college>.yucampus.yubhiantechnologies.in` | Each college, e.g. `https://srec.yucampus.yubhiantechnologies.in` |
| `https://admin.yucampus.yubhiantechnologies.in` | The YuCampus team panel |
| `https://auth.yucampus.yubhiantechnologies.in` | Where Google and Microsoft sign-in return (no page of its own) |
| `https://files.yucampus.yubhiantechnologies.in` | Evidence files (only through signed links) |
| `https://yucampus.yubhiantechnologies.in` | Sends visitors to yubhiantechnologies.in for now |

HTTPS certificates are free (Let's Encrypt) and renew themselves. Each college's certificate is fetched the first
time someone opens its address, so the very first visit takes a few extra seconds.

---

## 1. Get a server in India (about 30 minutes)

A domain only gives names; the app itself (web app, API, database, files) has to run on a computer that is always
on. All data must stay in India (DPDP Act, docs/ARCHITECTURE.md).

### Free: Oracle Cloud Always Free (recommended for the pilot)
Oracle gives one ARM server with up to 4 CPUs and 24 GB RAM free for as long as the account is used, in Mumbai or
Hyderabad. Everything in this guide runs on it unchanged.

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Choose **India West (Mumbai)** or
   **India South (Hyderabad)** as the **home region**: it cannot be changed later, and Always Free servers only
   run in the home region. A card is asked for to check identity; Always Free resources are not charged.
2. **Compute → Instances → Create instance**:
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **Ampere → VM.Standard.A1.Flex**, **4 OCPUs, 24 GB memory** (all within Always Free)
   - Networking: create a new virtual cloud network with a **public subnet**, and **assign a public IPv4 address**
   - SSH keys: **Generate a key pair for me** and download both keys
   - Click **Create**. If it says "Out of capacity", try again later or pick another availability domain.
3. **Make the IP fixed**: instance → **Attached VNICs** → the VNIC → **IPv4 addresses** → edit → **Reserved public
   IP** (free). Note the IP, e.g. `140.238.10.20`.
4. **Open ports 80 and 443**, in two places:
   - Instance → subnet → **Default Security List** → **Add Ingress Rules**: source `0.0.0.0/0`, TCP, destination
     port `80,443`.
   - On the server itself (Oracle's Ubuntu blocks them by default), after connecting in step 4:
     ```sh
     sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -m state --state NEW -j ACCEPT
     sudo netfilter-persistent save
     ```
5. Connect from your laptop: `ssh -i <downloaded private key> ubuntu@<your IP>`.

Oracle may reclaim an Always Free server that sits almost idle for 7 days. A server running YuCampus is not idle,
but upgrading the account to **Pay As You Go** (still free within the limits) removes that risk.

### Paid alternative
For example [AWS Lightsail](https://lightsail.aws.amazon.com/) **Mumbai**, Ubuntu 24.04, **4 GB RAM** (about USD 24
a month): create the instance, attach a static IP, and add HTTPS (443) under **Networking → IPv4 Firewall**.
DigitalOcean Bangalore, Azure Pune or Google Mumbai work the same way. 2 GB RAM is too small to build the app.

## 2. Point the addresses at the server, in Hostinger (about 10 minutes, then up to an hour to spread)

1. Sign in to [Hostinger hPanel](https://hpanel.hostinger.com/) → **Domains** → `yubhiantechnologies.in` →
   **DNS / Nameservers** → **DNS records**.
2. Add two records (type the name exactly; Hostinger adds `.yubhiantechnologies.in` itself):

   | Type | Name | Points to | TTL |
   |---|---|---|---|
   | A | `yucampus` | your static IP | 3600 |
   | A | `*.yucampus` | your static IP | 3600 |

3. If a record named `yucampus` or `*.yucampus` already exists (for example a CNAME), delete it first.
4. Leave every other record alone: your website and email keep working.
5. Check from your laptop after a few minutes (both should print your IP):
   ```
   nslookup yucampus.yubhiantechnologies.in
   nslookup anything.yucampus.yubhiantechnologies.in
   ```

Do not start step 6 before both answers show your IP: Let's Encrypt refuses certificates for names that do not yet
point at the server, and too many failed tries lock you out for an hour.

## 3. Set up email sending (about 30 minutes, plus approval time)

YuCampus sends invitations, password resets and reminders. Example with
[Amazon SES](https://console.aws.amazon.com/ses/) in **Asia Pacific (Mumbai)**:

1. **Identities** → **Create identity** → **Domain** → `yubhiantechnologies.in`. Keep **Easy DKIM** on.
2. SES shows three CNAME records. Add each in Hostinger's DNS records (copy name and value exactly). SES shows
   "Verified" once it sees them (usually within an hour).
3. Also add, or update, the SPF record in Hostinger: type `TXT`, name `@`, value
   `v=spf1 include:amazonses.com ~all`. If a `v=spf1` record already exists (for example for Hostinger email),
   add `include:amazonses.com` to it instead of creating a second one.
4. **Account dashboard** → **Request production access** (new accounts can only send to verified addresses).
   Say it is for transactional mail (invitations and password resets) for colleges that use YuCampus.
5. **SMTP settings** → **Create SMTP credentials**. Save the username and password; you need them in step 6.

## 4. Connect to the server and install Docker (about 10 minutes)

Connect with `ssh -i <private key> ubuntu@<your IP>` (in Lightsail you can also click **Connect using SSH**). Then:

```sh
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```
Connect again (so the Docker permission applies) and check: `docker compose version`.

## 5. Get the code onto the server

```sh
git clone https://github.com/VibeCodingWithJithu/yucampus.git
cd yucampus/infra/production
```
If the repository is private, GitHub asks for a username and a password: use a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with read-only access
to the `yucampus` repository as the password.

## 6. Fill in the settings

```sh
cp env.example .env
openssl rand -hex 32     # run once per random value you need (six of them)
nano .env
```
Fill in every line, using a fresh `openssl rand -hex 32` value for `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `JWT_SECRET` and `TOTP_KEY`. For `SMTP_URL` use the SES credentials from step 3:
```
SMTP_URL=smtps://SMTP_USERNAME:SMTP_PASSWORD@email-smtp.ap-south-1.amazonaws.com:465
```
If the SMTP password contains `/`, `+` or `=`, write them as `%2F`, `%2B` and `%3D`.
The Google and Microsoft values are the same as in your laptop's `.env`. Save with Ctrl+O, Enter, then Ctrl+X.

Keep a copy of this `.env` in the company password manager. Without it the database and files cannot be opened.

## 7. Build and start (about 15 minutes)

```sh
docker compose build                                   # builds the app (5 to 10 minutes)
docker compose up -d postgres redis storage            # database, job queue, file storage
docker compose run --rm tools pnpm db:migrate          # creates the tables
docker compose run --rm tools pnpm db:rules            # loads the NAAC, NBA, NIRF and AISHE rules
docker compose up -d                                   # starts everything, including HTTPS
docker compose ps                                      # every service should say "Up"; api "healthy" after a minute
```
The production database gets the rules only: no sample college and no sample accounts.

Check that file storage is ready:
```sh
docker compose exec api node -e "fetch('http://localhost:4000/health').then(r => r.text()).then(console.log)"
```
It should print `"database":"up","storage":"up"`. If storage says `off`, the files address had no certificate yet
when the API started: wait a minute and run `docker compose restart api`.

## 8. Create your team account and the first college

```sh
docker compose run --rm tools pnpm platform:create-admin "Your Name" you@yubhiantechnologies.in
```
It prints a link to `https://admin.yucampus.yubhiantechnologies.in/admin/set-password?...`. Open it within 3 days,
choose a password and set up your authenticator app. Save the recovery codes.

In the panel, **Colleges** → add a college (name, type, state, subdomain such as `srec`). The college admin gets an
email invitation. Open `https://srec.yucampus.yubhiantechnologies.in` to check it loads with a padlock.

## 9. Turn on nightly backups

```sh
chmod +x backup.sh
./backup.sh                       # try it once; it prints where the backup went
crontab -e                        # choose nano if asked, then add this line at the end:
30 2 * * * /home/ubuntu/yucampus/infra/production/backup.sh >> /var/log/yucampus-backup.log 2>&1
```
`sudo mkdir -p /var/backups/yucampus && sudo chown $USER /var/backups/yucampus` first if the script cannot write
there. It keeps 14 days on the server. **Before the first real college uses it**, also copy the folder to a second
location in India every night, for example an S3 bucket in Mumbai with `aws s3 sync /var/backups/yucampus s3://<bucket>`,
and turn on the provider's scheduled backups of the server disk (Oracle: **Block Storage → Boot Volumes → backup
policy**, Bronze is free within the limits; Lightsail: **automatic snapshots**).

## 10. Google and Microsoft sign-in

Add the live redirect addresses as described in [SSO_SETUP.md](SSO_SETUP.md), part B (steps B5 and B6):
```
https://auth.yucampus.yubhiantechnologies.in/api/v1/auth/sso/google/callback
https://auth.yucampus.yubhiantechnologies.in/api/v1/auth/sso/microsoft/callback
```

---

## Updating to a new version

```sh
cd ~/yucampus && git pull
cd infra/production
docker compose build
docker compose run --rm tools pnpm db:migrate
docker compose run --rm tools pnpm db:rules
docker compose up -d
```
People may see an error for a few seconds while the API restarts. Do updates outside college hours.

## Useful commands (run in `infra/production`)

| To | Run |
|---|---|
| See what is running | `docker compose ps` |
| Read the API's log | `docker compose logs api --tail 100` |
| Read certificate messages | `docker compose logs caddy --tail 100` |
| Restart everything | `docker compose restart` |
| Stop everything (data is kept) | `docker compose down` |

Never run `docker compose down -v`: `-v` deletes the database and all evidence files.

## If something goes wrong

| You see | Check |
|---|---|
| Browser says the site cannot be reached | DNS (step 2) and the firewall: ports 80 and 443 must be open. |
| Certificate warning on a college address | The college must exist in the team panel. Caddy only fetches certificates for existing colleges. Look at `docker compose logs caddy`. |
| "too many certificates" in the Caddy log | Let's Encrypt allows 50 new certificates a week for the domain; new colleges wait until the week is over. |
| Emails do not arrive | `docker compose logs api` for SMTP errors; SES must be out of the sandbox (step 3.4). |
| Uploads fail | The health check in step 7 must say `"storage":"up"`. |
| Restoring a backup | `docker compose exec -T postgres pg_restore -U yucampus -d yucampus --clean < /var/backups/yucampus/database-<date>.dump` (ask before doing this on a live server). |
