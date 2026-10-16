# Homelab site

A static, dependency-free homelab site in a dark terminal style (plain HTML, CSS and vanilla JS, no build step).

The content is the **real, sanitized** content of the Brittain Homelab (a multi-node Proxmox cluster), taken from the lab docs. Storage is ZFS throughout: four single-disk HDD pools (14, 10, 10 and 6 TB, ≈36 TiB total; the 14 TB pool holds Nextcloud data) plus two SSD pools for guest root disks.

> **This site is meant to be PUBLIC.** Do not add internal IP addresses, subnets, internal URLs or hostnames, ping endpoints, or anything credential-related (passwords, tokens, key locations) to the data files. Show service names and states only.

## Layout

```
index.html          page skeleton (rarely needs editing)
css/style.css       theme (colors are CSS variables at the top)
js/app.js           renders the data files, boot intro, live status feed polling
data/content.json   site text: boot lines, bio, hardware, network, projects, footer
data/services.json  service metadata (id, name, node, desc)
data/status.json    live state feed written by the collector (see Status board)
tools/              collect_status.py, publish_status.sh, mapping.example.json
.nojekyll           tells GitHub Pages to serve files as-is
```

## Run it

The page loads its data with `fetch()`, so serve it over HTTP (opening `index.html` from disk won't work):

```sh
cd homelab-site
python3 -m http.server 8000
# open http://localhost:8000
```

Any static host (nginx, Caddy, GitHub Pages, a container) works the same way: just copy the folder. All paths are relative, so it also works under a subpath such as `https://user.github.io/homelab-site/`.

## Editing content (`data/content.json`)

| Key | What it controls |
| --- | --- |
| `site` | tab title, prompt `user@host` shown in the top bar |
| `boot` | lines typed in the boot intro. Lines starting with `[ OK ]`, `[INFO]` or `[WARN]` are color-coded (INFO is cyan) |
| `home` | `heading` (the typed command), `bio` paragraphs, `facts` tiles |
| `hardware.items` | one card per machine or device: `name`, `role`, `icon` (`server`, `storage`, `chip`, `shield`, `network`, `power`), `specs` as `[label, value]` pairs, `tags` |
| `network.diagram` | `nodes` (`id`, `label`, `sub`, `kind`, `x/y/w/h`), `links` as `{from,to,speed}` (`wan`/`1g`/`2.5g`/`lab`/`remote`/`iot`), optional `groups` (dashed labeled regions, used for the nested lab), and `caption`. Renderer builds an orthogonal SVG with neon strokes and packet animations (honors `prefers-reduced-motion`) |
| `network.vlans` | VLAN table rows: `id`, `name`, `note`. A `subnet` column appears only if some row has a `subnet` value (left out on the public site on purpose) |
| `network.dns`, `network.vpn` | the two bullet lists (`title`, `points`) |
| `projects.items` | `title`, `summary` (a string, or an array of paragraphs), `tags`, and optional `date` and `url` |
| `status` | `intro`, `refreshSeconds` (browser poll interval, default 1800 = 30 min), `staleMinutes` (default 480 = 8 h); defaults live in `STATUS_DEFAULTS` at the top of the status section in `js/app.js` |
| `footer` | footer text |

Add or remove list entries freely. Keep the JSON valid (double quotes, no trailing commas). Check with `python3 -m json.tool data/content.json`.

### Projects

- Projects are shown in **file order** (no sorting).
- `date` is **optional** and a **free-form string** (e.g. `"October 2026"`, `"2026-10-11"`). It is shown as written; if it looks like a year, year-month or full ISO date, or `Month YYYY`, a machine-readable `datetime` attribute is added too. If a project has no date, nothing is shown and the card uses the full width. Currently every project is dated `October 2026` except the older network build-out projects ("Network upgrades", "IP addressing and port-forward hygiene"), which are left undated on purpose. Don't invent dates; add one only when confirmed.
- `url` is optional. Without it the title is plain text instead of a link.
- Tag filter chips are generated automatically from tags used by **two or more** projects (if fewer than three tags qualify, every tag gets a chip). Every tag is still shown on its project card.

## Status board (live feed)

The board is driven by **two files**, merged in the browser by `id`:

| File | Holds | Changes |
| --- | --- | --- |
| `data/services.json` | static metadata: `id`, `name`, `node` (generic node label), `desc` | when you add or rename a service |
| `data/status.json` | live state only: `{"updated": "<ISO timestamp>", "services": [{"id", "name", "state"}]}` where `state` is `up`, `down`, `stopped` or `degraded` | every 6 hours, written by the collector (the only file that changes after deploy) |

```json
{ "updated": "2026-10-11T20:30:00Z", "services": [ { "id": "nextcloud", "name": "Nextcloud", "state": "up" } ] }
```

Browser behaviour (`js/app.js`):

- Polls `data/status.json?t=<timestamp>` every `status.refreshSeconds` (default 1800) with `cache: no-store`, so CDNs and browsers don't serve an old copy.
- Shows `last updated: <local time> (7 h 20 min ago)` and a summary line counting each state (`up`, `degraded`, `down`; `stopped` and `unknown` appear only when present).
- **Stale fallback:** if the feed is missing, unreadable, has no valid `updated`, or is older than `status.staleMinutes` (default 480, i.e. 8 hours: one missed 6-hour run plus slack), every tile shows a neutral **UNKNOWN** badge and a "Feed stale" notice appears. When the feed is **fresh**, a service whose id is not in it is still shown, with an **UNKNOWN** badge, and counted as unknown in the summary, so all tiles always appear. A wrong "up" is never shown.
- `stopped` is a neutral dashed badge, `unknown` a dotted one.
- The old visitor-side "live ping" feature was removed: it could only work on the LAN and would have meant shipping internal URLs.

The checked-in `status.json` is a **seed** (everything `up`, timestamp from build day). It is placeholder data that the collector overwrites on its first run; until then it shows as stale after 8 hours.

### Collector (`tools/collect_status.py`)

A stdlib-only Python 3 script that runs **on your LAN**, reads internal monitoring, and writes a sanitized `status.json` (public ids, names and states only; never IPs, hostnames, URLs or internal job names). Full docs are in the script header. Summary:

| Source | Env | Notes |
| --- | --- | --- |
| Prometheus | `PROM_URL` (e.g. `http://prometheus.example:9090`), optional `PROM_QUERY` (default `up`) | value 1 = up, 0 = down. Several series on one public id: all up = up, some = degraded, none = down. A mapped job with no series at all is reported `down` |
| Proxmox | `PVE_URL` (e.g. `https://pve.example:8006`), `PVE_TOKEN` (`user@realm!tokenid=SECRET`, read-only `PVEAuditor` role), optional `PVE_VERIFY_TLS=0` | `running` = up, `stopped` = stopped, other = degraded. This is how VMs that are switched off show as **stopped** instead of **down** |

If both sources know an id, Proxmox `stopped` wins; otherwise Prometheus wins (Proxmox running + Prometheus down = degraded).

**Mapping file.** Copy `tools/mapping.example.json` to `tools/mapping.json` (git-ignored) and map internal Prometheus job names and Proxmox vmids to the public ids in `services.json`. Only mapped items are published (allowlist). Ids that are not in the mapping simply don't appear in the feed, and the site shows their tiles as UNKNOWN.

**Mapping Proxmox guests from Prometheus (no Proxmox token).** If Prometheus already scrapes [prometheus-pve-exporter](https://github.com/prometheus-pve/prometheus-pve-exporter), its `pve_up{id="qemu/100"}` / `pve_up{id="lxc/101"}` series (1 = guest running, 0 = not running) can drive guest tiles. Add `prometheus.rules` to the mapping, where each rule lists label matchers that must all match exactly (`__name__` matches the metric name) plus the public id, and fetch both metrics in one query:

```json
"prometheus": {
  "label": "job",
  "map":   { "pihole-job": "pi-hole", "pbs-job": "proxmox-backup-server" },
  "rules": [
    { "match": { "__name__": "pve_up", "id": "lxc/101" },  "id": "nextcloud" },
    { "match": { "__name__": "pve_up", "name": "guest-name" }, "id": "caddy" }
  ]
}
```

```sh
export PROM_URL=http://prometheus.example:9090
export PROM_QUERY='pve_up or up'
```

Rules win over `map` for the same series; `map` still works unchanged for `up{job=...}`. A rule may add `"off_state": "stopped"` to report a 0 value as `stopped` instead of `down`. An empty Prometheus answer is treated as a failed source (the feed is left alone and goes stale).

```sh
export PROM_URL=http://prometheus.example:9090
export PVE_URL=https://pve.example:8006        # optional
export PVE_TOKEN='monitor@pve!site=xxxxxxxx'   # optional, keep out of the repo
python3 tools/collect_status.py --mapping tools/mapping.json \
        --services data/services.json --out data/status.json --print
```

If every source fails, the script exits 1 and leaves the old file alone, so the site goes stale (UNKNOWN) rather than lying. Exit codes: 0 ok, 1 all sources failed, 2 configuration error.

### Publishing to GitHub Pages every 6 hours

The feed updates **4 times a day** (every 6 hours). A cron job (or systemd timer) on a LAN machine runs `tools/publish_status.sh`, which collects the status, copies `data/status.json` into a local clone of your Pages repo, commits and pushes. GitHub Pages then redeploys (takes a minute or two). **`data/status.json` is the only file that changes** after the first deploy.

**`tools/publish_status.sh`** (bash, documented in its header):

1. runs `collect_status.py` and validates its output;
2. `git pull --ff-only` in the clone at `$PAGES_REPO_DIR`, copies `data/status.json` there;
3. commits **only if the file changed**, then pushes.

Fail safe: if the collector fails or the output is invalid, nothing is copied or pushed; the published file just ages and the site shows UNKNOWN after 8 hours. No secrets are in the script; it relies on git credentials already configured on the machine. Environment: `PAGES_REPO_DIR` (required), `PAGES_BRANCH` (default `main`), `PAGES_REMOTE` (default `origin`), `SITE_DIR`, `MAPPING_FILE`, `PYTHON`, plus the collector's `PROM_URL`, `PVE_URL`, `PVE_TOKEN`. Exit codes: 0 ok, 1 collector/validation failure, 2 config error, 3 git failure.

#### Deploy steps (GitHub Pages)

1. **Create the repo** on GitHub, e.g. `homelab-site` (public; free Pages needs a public repo). Don't add a README or license so the first push is clean.
2. **Push the site** from this folder:
   ```sh
   cd homelab-site
   git init -b main && git add -A && git commit -m "Initial site"
   git remote add origin git@github.com:YOUR_USER/homelab-site.git
   git push -u origin main
   ```
   `.gitignore` already keeps `tools/mapping.json` and `*.env` out of the repo. `.nojekyll` is included so Pages serves files as-is.
3. **Enable Pages:** repo **Settings > Pages > Build and deployment > Source: Deploy from a branch**, branch `main`, folder `/ (root)`. The site appears at `https://YOUR_USER.github.io/homelab-site/`. All asset and fetch paths are relative (no leading slash), so the project subpath works. A custom domain also works (Settings > Pages).
4. **Give the LAN machine push access** (pick one):
   - *Deploy key (recommended):* on the LAN machine, `ssh-keygen -t ed25519 -f ~/.ssh/homelab_pages -N ''`. In the repo, **Settings > Deploy keys > Add deploy key**, paste `homelab_pages.pub` and tick **Allow write access**. The key only works for that one repo. Add to `~/.ssh/config`:
     ```
     Host github-homelab
       HostName github.com
       User git
       IdentityFile ~/.ssh/homelab_pages
       IdentitiesOnly yes
     ```
     and clone with `git clone git@github-homelab:YOUR_USER/homelab-site.git`.
   - *Fine-grained token:* GitHub **Settings > Developer settings > Fine-grained tokens**, repository access limited to this repo, **Contents: Read and write**, and an expiry you will remember. Store it with a git credential helper (`git config credential.helper store`, file mode 600), never in the repo or in `publish_status.sh`.
5. **Prepare the LAN machine:** clone the Pages repo (`PAGES_REPO_DIR`), put the site tools somewhere (can be the same clone), create `tools/mapping.json` from `tools/mapping.example.json`, and put secrets in `/etc/homelab-status.env` (`chmod 600`):
   ```sh
   export PAGES_REPO_DIR=/opt/homelab-pages
   export PROM_URL=http://prometheus.example:9090
   export PVE_URL=https://pve.example:8006        # optional
   export PVE_TOKEN='monitor@pve!site=xxxxxxxx'   # optional, read-only PVEAuditor token
   ```
   Test once by hand: `. /etc/homelab-status.env && /opt/homelab-pages/tools/publish_status.sh`, then check the commit on GitHub.

Simplest layout: one clone at `/opt/homelab-pages` used as both the site folder and the Pages clone (`SITE_DIR=/opt/homelab-pages`, `PAGES_REPO_DIR=/opt/homelab-pages`; the script detects the same file and skips the copy). By default `SITE_DIR` is the folder containing `tools/`, so if you run the script from a separate site checkout, `PAGES_REPO_DIR` can point to a different clone.

#### Scheduling

**cron** (`crontab -e` as the user that has the git key; cron has no env file, so source it):

```cron
0 */6 * * * . /etc/homelab-status.env && /opt/homelab-pages/tools/publish_status.sh >> $HOME/homelab-publish.log 2>&1
```

That runs at 00:00, 06:00, 12:00 and 18:00 (machine local time).

**systemd timer** (`/etc/systemd/system/homelab-status.service` and `.timer`):

```ini
# homelab-status.service
[Unit]
Description=Collect and publish homelab status
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=homelab
EnvironmentFile=/etc/homelab-status.env
ExecStart=/opt/homelab-pages/tools/publish_status.sh

# homelab-status.timer
[Unit]
Description=Publish homelab status every 6 hours

[Timer]
OnCalendar=*-*-* 00/6:00:00
Persistent=true
RandomizedDelaySec=60

[Install]
WantedBy=timers.target
```

With systemd, the env file uses plain `KEY=value` lines (no `export`). Enable with `systemctl enable --now homelab-status.timer`; check with `systemctl list-timers homelab-status.timer` and `journalctl -u homelab-status.service`.

#### Timing

Collector runs every 6 hours; the browser re-reads the feed every 30 minutes (`refreshSeconds: 1800`); the board shows UNKNOWN when the feed is older than 8 hours (`staleMinutes: 480`), which tolerates one missed run plus slack. Keep `staleMinutes` above the cron interval. That is about 4 commits a day.

*Other hosts:* any static host works. For your own nginx/Caddy, replace the git steps with `rsync -a --chmod=F644 data/status.json deploy@web.example:/var/www/homelab/data/status.json` and serve it with `Cache-Control: no-cache`.

**Privacy checklist:** the collector only writes allow-listed public ids; never put internal IPs, hostnames or job names in `services.json`, `status.json` or `mapping.example.json`; keep `tools/mapping.json` and the env file out of the repo (both are in `.gitignore`).

## Customizing the look

Edit the CSS variables at the top of `css/style.css` (`--green`, `--amber`, `--bg`, ...). The blinking cursor and animations are disabled automatically for visitors who prefer reduced motion, and the boot intro has a "skip" button. The network diagram scrolls horizontally on narrow screens.
