# Moms Village

A community for moms: member profiles, a chronological discussion feed, likes and comments, open local groups, events with RSVPs, and a community marketplace. Warm sage-and-cream styling, responsive layout, and an administration panel for reports and account suspensions.

## Requirements

- Node.js 22 or later and npm
- An existing MySQL 8+ database (or compatible MariaDB), reachable from your container
- A dedicated database user with table creation, SELECT, INSERT, UPDATE, DELETE and index permissions

## Setup

1. Download or clone this repository.
2. Copy `config.example.js` to `config.js` and enter your external MySQL connection details. Do not commit `config.js`: it contains credentials.
3. Generate a unique secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and set `sessionSecret`. Do not reuse another project's secret.
4. Set `publicUrl` to your domain for reference, `secureCookies: true` for HTTPS, and configure `trustProxy` to match your proxy setup (for example `1` for one trusted reverse proxy). `publicUrl` does not configure DNS or a proxy automatically.
5. Set `adminEmails` to your own email and generate a separate random `adminRegistrationCode` of at least 32 characters. Register with that email and enter the code under **Administrator setup**. Allowlisted addresses are reserved and cannot register without the code. There is no default account or password. Clear the setup code after provisioning your admins. Removing an email from the allowlist immediately revokes its admin access. Existing regular accounts are not automatically promoted by changing the allowlist.
6. Run `npm install`, then `npm start`. Retain the generated `package-lock.json` for reproducible subsequent installs with `npm ci`.

The app creates tables from `schema.sql` and its session store at startup. Create the database itself first. A separate SQL import is unnecessary for this initial version. Future schema changes will require migrations; `CREATE TABLE IF NOT EXISTS` does not upgrade existing tables.

## Wisp / Pterodactyl

Use a Node.js 22+ egg. Install with `npm install --omit=dev`, set the main file to **server.js**, and run `node server.js` (or `npm start`). Set `port` to your Wisp allocation and leave `host` as **0.0.0.0**, not the public IP. Route your domain / Cloudflare Tunnel to the allocated port. The database host must be reachable from within the container; `127.0.0.1` means the container itself.

For Docker: `docker build -t momsvillage .`, then `docker run -d --name momsvillage -p 3014:3014 --mount type=bind,source=/absolute/path/config.js,target=/home/node/app/config.js,readonly momsvillage`. Ensure the configuration is readable by the container's `node` user. The configuration is excluded from the Docker image. Persistent records and sessions live in your external MySQL database. Back up that database.

`GET /health` checks database connectivity and returns `{"ok":true}`. Startup intentionally fails if configuration or the database is unavailable.

## Included

- Registration (18+ and guidelines agreement), sign-in and sign-out; bcrypt passwords and persistent MySQL sessions
- Profiles with display name, city, biography and HTTPS avatar URL; view another member by clicking their name
- Feed posts with an optional HTTPS image, likes, comments, and author deletion
- Searchable local groups, join/leave membership, group conversations and group owner deletion
- Upcoming events in local display time, stored in UTC, with attendee counts and RSVP/cancellation
- Searchable marketplace, USD prices/free items, explicit seller contact instructions, sold/relist and deletion
- Reports on posts, comments, groups, events and listings; staff content inspection/removal, report resolution, and account suspension/restoration
- Request limits, CSRF checks, session rotation, escaped member content, security headers, parameterized SQL and server-side ownership checks

## Privacy and current scope

Community content, profiles, groups and marketplace contact instructions are visible to signed-in members. All groups are open; group membership controls creating group posts. Account email addresses are visible only to their owner and administrators. Suspended accounts cannot access member endpoints and their authored content is hidden from the main lists. Moderators can inspect reported content even if its author is suspended.

Images currently use external HTTPS URLs, not file uploads. External hosts may receive visitors' IP addresses. Avoid image URLs that expose private tokens. No child profiles, exact-location tracking, payments, shipping, direct messages, friend requests, push notifications, email verification, password reset or automated content moderation are included yet. Marketplace transactions are arranged outside the app. The first release is a foundation for testing with trusted members; add email verification/recovery and a production privacy policy before broad public onboarding.

Lists are bounded to the latest 50 posts, 100 comments per post, 100 groups/events/listings, and 200 staff records. Pagination and full-history browsing are future work. Content deletion is permanent and also removes dependent comments, memberships, likes or RSVPs.

## Checks

`npm test` runs input-validation tests; `npm run check` checks JavaScript syntax. GitHub Actions also runs an integration test against a disposable MySQL 8.4 service, covering signup/login, CSRF, ownership restrictions, profiles, posts/comments/likes, group membership, RSVPs, marketplace, reports and account suspensions. Integration tests are skipped locally unless `MV_INTEGRATION=1`; they refuse to overwrite an existing `config.js`. Only run these against a disposable database configured exactly as in the workflow. They leave test data behind. Verify the UI and secure cookies through your production HTTPS proxy before inviting members.
