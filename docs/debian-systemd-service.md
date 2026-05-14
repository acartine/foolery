# Running Foolery as a Debian systemd Service

This guide covers running Foolery as a long-lived, user-level systemd service on
Debian Linux (Debian 12+ and derivatives such as Ubuntu and Raspberry Pi OS).
It walks through writing a `systemd` unit, starting and stopping the service
with `systemctl`, and binding the listener to a specific network interface so
the app is reachable from other devices on your network without exposing it to
every interface on the host.

> **TL;DR — bind address recommendation**
>
> 1. Best (most private): a **[Tailscale](https://tailscale.com) IP** —
>    reachable only from devices in your tailnet.
> 2. Acceptable: a **local-network (LAN) IP** such as `192.168.x.x` or
>    `10.x.x.x` — reachable from any device on the same subnet.
> 3. **Not recommended**: `0.0.0.0` — binds every interface on the host,
>    including the public one. Foolery has no built-in auth, so do not expose
>    it to the open internet.

---

## Prerequisites

- A Debian-family Linux host where the user that will own the service can log
  in (the service runs under that user, not `root`).
- `systemd` (default on Debian / Ubuntu).
- Foolery installed for that user. From the user's shell:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/acartine/foolery/main/scripts/install.sh | bash
  ```

  The installer places the launcher at `~/.local/bin/foolery` and the runtime
  at `~/.local/share/foolery/runtime/`. See the
  [README install steps](../README.md#install) for the full bootstrap
  (`foolery setup`, agent CLIs, etc.).
- At least one supported memory-manager CLI (`kno` or `bd`) on the user's
  `PATH`.

Verify the launcher works interactively before turning it into a service:

```bash
foolery start
foolery status
foolery stop
```

If `foolery start` fails, fix that first — systemd will not make a broken
runtime work.

---

## Step 1 — Choose the bind address

Foolery's listener is controlled by two environment variables that the
launcher reads:

| Variable        | Default     | What it does                              |
| --------------- | ----------- | ----------------------------------------- |
| `FOOLERY_HOST`  | `127.0.0.1` | Hostname or IP the server binds to        |
| `FOOLERY_PORT`  | `3210`      | TCP port the server listens on            |

The default (`127.0.0.1`) is loopback-only — fine for a single-user workstation
but unreachable from other machines.

To make Foolery reachable from another device, pick one of:

### Option A — Tailscale IP (recommended)

If the host is on a [tailnet](https://tailscale.com), find its tailnet IP:

```bash
tailscale ip -4
# → e.g. 100.64.12.34
```

Bind to that address. Only devices authenticated to the same tailnet (your
laptop, phone, etc.) will be able to reach Foolery. This is the most private
option because Tailscale handles authentication and encryption at the network
layer, and the IP is not routable from the public internet.

### Option B — LAN IP

Find the host's address on your home or office network:

```bash
ip -4 addr show scope global | awk '/inet/ {print $2}' | cut -d/ -f1
# → e.g. 192.168.1.42
```

Bind to that LAN IP. Any device on the same subnet (and anyone who gets onto
that subnet) can reach Foolery on this port. Use this if you do not have a
mesh VPN but trust your local network.

### Option C — `0.0.0.0` (not recommended)

`FOOLERY_HOST=0.0.0.0` binds every interface on the host, including any
public IP the machine has. Foolery has no built-in authentication, so anyone
who can reach the host on that port can drive your agents and read your
beats. **Do not use `0.0.0.0` on a machine with a public IP, and do not use it
on an untrusted network.** If you genuinely need to listen on multiple
interfaces, put Foolery behind a reverse proxy that adds authentication and
TLS — that is out of scope for this guide.

For the rest of this guide, replace `<BIND_IP>` with the address you chose.

---

## Step 2 — Write the systemd unit

Create a system-level unit file at `/etc/systemd/system/foolery.service`. The
service runs as your user account (replace `<YOUR_USER>` and `<YOUR_HOME>`
with the matching values — for example, `cartine` and `/home/cartine`):

```ini
[Unit]
Description=Foolery — keyboard-first agent orchestration
Documentation=https://github.com/acartine/foolery
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<YOUR_USER>
Group=<YOUR_USER>
WorkingDirectory=<YOUR_HOME>/.local/share/foolery/runtime

# Bind address and port (see "Choose the bind address" above).
# Replace <BIND_IP> with your Tailscale or LAN IP. Do not use 0.0.0.0.
Environment=FOOLERY_HOST=<BIND_IP>
Environment=FOOLERY_PORT=3210
Environment=NODE_ENV=production
Environment=HOME=<YOUR_HOME>
Environment=PATH=<YOUR_HOME>/.local/bin:/usr/local/bin:/usr/bin:/bin

# Run Next directly in the foreground so systemd owns the process.
# The foolery launcher's `start` subcommand backgrounds via nohup, which
# does not play well with Type=simple.
ExecStart=/usr/bin/node <YOUR_HOME>/.local/share/foolery/runtime/node_modules/next/dist/bin/next start --hostname ${FOOLERY_HOST} --port ${FOOLERY_PORT}

Restart=on-failure
RestartSec=5

# Light hardening. Loosen only if a feature you need is broken by it.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=<YOUR_HOME>/.local/state/foolery <YOUR_HOME>/.config/foolery
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
```

Notes:

- `Type=simple` + running `next start` directly is the cleanest fit. The
  `foolery start` launcher daemonizes itself, which is not what systemd wants.
- `ProtectHome=read-only` plus an explicit `ReadWritePaths=` for
  `~/.local/state/foolery` and `~/.config/foolery` lets the service write
  logs, PID, and config without giving it full home access. Add other paths
  here if you need to mount additional repositories.
- Make sure `node` resolves to a Node.js 20+ binary. If your `node` is
  somewhere other than `/usr/bin/node`, update `ExecStart` accordingly
  (`command -v node` will tell you).

---

## Step 3 — Install and start the service

Reload systemd so it picks up the new unit, enable it on boot, and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable foolery.service
sudo systemctl start foolery.service
```

Check status:

```bash
systemctl status foolery.service
```

A healthy service shows `Active: active (running)` and the most recent log
lines.

---

## Step 4 — Verify the bind address

Confirm Foolery is listening on the IP you chose and **not** on `0.0.0.0`:

```bash
ss -ltnp | grep 3210
```

You should see something like:

```
LISTEN 0  511  100.64.12.34:3210  0.0.0.0:*  users:(("node",pid=12345,fd=20))
```

The address on the left of `:3210` should match your `FOOLERY_HOST`. If you
see `0.0.0.0:3210` or `*:3210`, the service is bound to every interface —
stop it, fix `FOOLERY_HOST` in the unit file, `daemon-reload`, and restart.

From another device, hit it:

```bash
curl -sS http://<BIND_IP>:3210/api/version
```

A JSON body with the installed version means you are good.

---

## Day-to-day systemctl commands

| Task                                | Command                                          |
| ----------------------------------- | ------------------------------------------------ |
| Start                               | `sudo systemctl start foolery.service`           |
| Stop                                | `sudo systemctl stop foolery.service`            |
| Restart                             | `sudo systemctl restart foolery.service`         |
| Reload after editing the unit file  | `sudo systemctl daemon-reload && sudo systemctl restart foolery.service` |
| Enable on boot                      | `sudo systemctl enable foolery.service`          |
| Disable autostart                   | `sudo systemctl disable foolery.service`         |
| Show status + recent logs           | `systemctl status foolery.service`               |
| Follow logs live                    | `journalctl -u foolery.service -f`               |
| Last 200 log lines                  | `journalctl -u foolery.service -n 200`           |
| Logs since boot                     | `journalctl -u foolery.service -b`               |

When `foolery update` lands a new runtime version, run
`sudo systemctl restart foolery.service` so the service picks it up.

---

## Troubleshooting

**`Active: failed (Result: exit-code)`** — Inspect the logs:

```bash
journalctl -u foolery.service -n 200 --no-pager
```

Common causes:

- `node: command not found` → `node` is not at `/usr/bin/node`. Use
  `command -v node` to find it and update `ExecStart`.
- `EADDRINUSE: address already in use` → Another process owns
  `FOOLERY_PORT`. Stop the other process or pick a different port.
- Permission errors writing to `~/.local/state/foolery` → confirm
  `ReadWritePaths=` covers the directory and that `User=` matches the owner
  of `~/.local/share/foolery/runtime`.

**Foolery starts but other devices can't reach it** — Almost always one of:

- `FOOLERY_HOST` is still `127.0.0.1`. Verify with `ss -ltnp | grep 3210`.
- A host firewall is blocking the port. On Debian with UFW:
  `sudo ufw allow from <client-subnet> to any port 3210 proto tcp`.
- Your router blocks LAN-to-LAN traffic, or the client is on a different
  subnet. Tailscale sidesteps both problems.

**You really do need to listen on multiple interfaces** — Don't set
`FOOLERY_HOST=0.0.0.0` directly. Instead, run Foolery on `127.0.0.1` and put
[nginx](https://nginx.org/) or [Caddy](https://caddyserver.com/) in front of
it with HTTPS and basic auth (or an OAuth proxy). That belongs in a separate
reverse-proxy guide.
