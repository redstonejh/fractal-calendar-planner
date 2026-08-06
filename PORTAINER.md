# Fractal Calendar — Portainer deployment

The browser dashboard is served by a dependency-free Node.js server. Its image
must be built before the stack is deployed because Portainer stacks should use
an image reference, not a Compose `build:` directive.

## Image build

In Portainer:

1. Open **Images** and select **Build a new image**.
2. Set **Name** to `fractal-calendar-web:latest`.
3. Choose **URL** and enter
   `https://github.com/redstonejh/fractal-calendar-planner.git#portainer-web`.
4. Set **Dockerfile path** to `Dockerfile`.
5. Select the local Docker environment and click **Build the image**.

## Stack deployment

1. Open **Stacks**, click **Add stack**, and name it `fractal-calendar-web`.
2. Select **Web editor** and paste `portainer-stack.yml`.
3. Under **Environment variables**, add:
   - `FRACTAL_ADMIN_USERNAME` = `admin`
   - `FRACTAL_ADMIN_PASSWORD` = a strong initial password (8+ characters)
4. Click **Deploy the stack**.
5. Wait for `fractal-calendar-web` to report **healthy**.

Open `http://192.168.203.118:8083`. Health is available at
`http://192.168.203.118:8083/healthz`.

The named volume `fractal-calendar-data` preserves accounts across updates.
Calendar layout preferences remain per-account in each browser's local storage.
Changing the admin environment variables does not overwrite an administrator
already stored in that volume.

## Updating

Rebuild `fractal-calendar-web:latest` from the `portainer-web` branch. Then open
the stack, choose **Editor**, enable **Re-pull image and redeploy**, and click
**Update the stack**.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `FRACTAL_WEB_PORT` | `8080` | HTTP port inside the container |
| `FRACTAL_DATA_DIR` | `/data` | Persistent account storage |
| `FRACTAL_ADMIN_USERNAME` | `admin` | Seed administrator name |
| `FRACTAL_ADMIN_PASSWORD` | none in Compose | Seed administrator password |
| `FRACTAL_SESSION_TTL_MS` | `86400000` | Login session lifetime |
| `FRACTAL_COOKIE_SECURE` | `false` | Set `true` only when served over HTTPS |
