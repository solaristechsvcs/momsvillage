# Moms Village

A community for moms: profiles, a discussion feed, local groups, events, a marketplace, friend requests, private messaging and notifications. Includes direct photo uploads, member search, contact blocking, and moderation.

## Upgrading an existing installation to 0.2

1. Update the application files from `main`, keeping your existing `config.js`.
2. Run `npm install --omit=dev` and restart the server. Existing configuration works without adding new keys.
3. Startup creates the new tables from `social-schema.sql` automatically without changing or deleting existing accounts, posts, groups, events or listings. You do not need a manual SQL import.
4. Keep the `uploads/` directory persistent and writable by the app. It contains uploaded photos; back it up alongside MySQL. Optionally set `uploadsDirectory` in `config.js` to another persistent directory. Do not overwrite this directory when updating your application.

The new navigation includes **Find moms**, **Friends**, **Messages**, and **Notifications**. Badge counts refresh every 30 seconds while the page is visible; conversations have a Refresh button. These are in-app updates, not browser push notifications.

## Requirements

- Node.js 22 or later and npm
- An existing MySQL 8+ database (or compatible MariaDB), reachable from your container
- A dedicated database user with table creation, SELECT, INSERT, UPDATE, DELETE and index permissions

## Setup

1. Download or clone this repository.
2. Copy `config.example.js` to `config.js` and enter your external MySQL connection details. Do not commit `config.js`: it contains credentials.
3. Generate a unique secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and set `sessionSecret`. Do not reuse another project's secret.
4. Set `publicUrl` to your domain for reference, `secureCookies: true` for HTTPS, and configure `trustProxy` to match your proxy setup (for example `1` for one trusted reverse proxy). `publicUrl` does not configure DNS or a proxy automatically.
5. Set `adminEmails` to your own email and generate a separate random `adminRegistrationCode` of at least 32 characters. Register with that email and enter the code under **Administrator setup**. Allowlisted addresses are reserved and cannot register without the code. There is no default account or password. Clear the setup code after provisioning your first admin. Assign or revoke other administrators through **Administration**. Existing accounts are not promoted or demoted by editing `adminEmails`; that list now only reserves bootstrap registration addresses.
6. Run `npm install`, then `npm start`. Retain the generated `package-lock.json` for reproducible subsequent installs with `npm ci`.

The app creates tables from `schema.sql`, `social-schema.sql`, and its session store at startup. Create the database itself first. Separate SQL imports are unnecessary. This upgrade only adds new tables; future alterations to existing columns will require migrations.

## Wisp / Pterodactyl

Use a Node.js 22+ egg. Install with `npm install --omit=dev`, set the main file to **server.js**, and run `node server.js` (or `npm start`). Set `port` to your Wisp allocation and leave `host` as **0.0.0.0**, not the public IP. Route your domain / Cloudflare Tunnel to the allocated port. The database host must be reachable from within the container; `127.0.0.1` means the container itself.

For Docker: `docker build -t momsvillage .`, then `docker run -d --name momsvillage -p 3014:3014 --mount type=bind,source=/absolute/path/config.js,target=/home/node/app/config.js,readonly --mount type=volume,source=momsvillage-photos,target=/home/node/app/uploads momsvillage`. Ensure the configuration is readable by the container's `node` user. The configuration and uploads are excluded from the Docker image. Records and sessions live in external MySQL; photo files live in the mounted volume. Back up both.

`GET /health` checks database connectivity and returns `{"ok":true}`. Startup intentionally fails if configuration or the database is unavailable.

## Site still looks old after updating

The new social navigation is visible after signing in; the public landing page stays similar. Check `/version` to identify the running application release. Version 0.2.1 adds versioned CSS/JavaScript URLs, disables browser/CDN caching of application assets at the origin, and prints the release in the startup log.

After copying files, install dependencies and fully restart Wisp. The current log should say `Moms Village v0.3.0 listening on port ...`. If `/version` is missing or reports an older version, check the running container, application directory and Cloudflare Tunnel destination. If the origin is current but the public domain is stale, purge the site's Cloudflare cache and ensure custom cache rules respect origin headers or bypass caching for this app, particularly `/api/*` and `/version`. Origin headers cannot invalidate content that a proxy already cached or override a proxy configured to ignore them.

## Administrator roles (0.3)

In **Administration**, search members by name/email, click their name or **View profile**, and select **Grant admin** or **Revoke admin**. Role changes require confirmation and take effect on the next request without sign-out. All administrators have the same full access, including assigning other administrators. Restore suspended accounts before granting access; revoke admin access before suspending an administrator. The last active administrator cannot be demoted, including during concurrent changes.

Roles are persisted in MySQL. On the first 0.3 startup, a one-time migration preserves the previously effective administrator list: old admin flags on accounts excluded from the previous `adminEmails` allowlist are cleared so revoked access is not unintentionally restored. Later startups leave dashboard-assigned roles intact. Both this marker and account administration audit records are stored in new tables created automatically. No manual SQL import or `config.js` changes are required.

Administrative profile previews include role, suspension status, biography, city and account email, and work for suspended members. Regular profile endpoints continue to exclude private account email and suspended accounts. Account access changes are recorded in `admin_audit` with actor, target, action and timestamp.

## Included

- Registration (18+ and guidelines agreement), sign-in and sign-out; bcrypt passwords and persistent MySQL sessions
- Profiles with display name, city, biography and HTTPS avatar URL; view another member by clicking their name
- Feed posts with an optional HTTPS image, likes, comments, and author deletion
- Searchable local groups, join/leave membership, group conversations and group owner deletion
- Upcoming events in local display time, stored in UTC, with attendee counts and RSVP/cancellation
- Searchable marketplace, USD prices/free items, explicit seller contact instructions, sold/relist and deletion
- Reports on posts, comments, groups, events and listings; staff content inspection/removal, report resolution, and account suspension/restoration
- Search moms by display name or city, view profiles, send/accept/decline/cancel requests and remove friendships
- Private text conversations between accepted friends, inbox previews, unread counts and older-message browsing
- Contact blocking removes friendship and prevents requests, messages and notifications in either direction
- Individual message reporting; administrators may inspect/remove only reported messages, with no staff inbox access to private conversations
- In-app notifications for requests, acceptance, messages, comments and likes, with individual or bulk read controls
- JPEG/PNG/WebP uploads up to 8 MB / 25 megapixels, resized to 1600 pixels and re-encoded as WebP without metadata; session-protected delivery, ownership checks on image attachment, per-member/global storage limits, and an unused-image library under My profile
- Request limits, CSRF checks, session rotation, escaped member content, security headers, parameterized SQL and server-side ownership checks

## Privacy and current scope

Community content, profiles, groups and marketplace contact instructions are visible to signed-in members. All groups are open; group membership controls creating group posts. Account email addresses are visible only to their owner and administrators. Private message APIs return only the current member's conversations; staff can view an individual message only through a report. Database operators can access stored records: messages are not end-to-end encrypted. Blocking prevents contact and notifications but does not hide shared community posts, group activity or external seller contact information. Suspended accounts cannot access member endpoints and their authored content is hidden from the main lists. Moderators can inspect reported content even if its author is suspended.

Images can be uploaded directly or supplied as external HTTPS URLs. External hosts may receive visitors' IP addresses; avoid URLs that expose private tokens. Uploads are visible to signed-in members, including anyone who has their URL. Uploaded images may only be attached by their owner. Storage is limited to 100 MB per member and 2 GB across the installation. Delete unused images from **My profile → My image library**; attached images must be removed from their content before deletion. Unpublished uploads remain in this library and count toward limits. Backups and files left by an interrupted upload may need operator cleanup.

No child profiles, exact-location tracking, payments, shipping, browser push notifications, email verification, password recovery or automated content moderation are included yet. Marketplace transactions are arranged outside the app. Add email verification/recovery and a production privacy policy before broad public onboarding.

Lists are bounded to the latest 50 posts, 100 comments per post, 100 groups/events/listings, 100 directory results/notifications/inbox threads, and 200 friends/blocked members/staff records/upload-library entries. Conversations load 50 messages per page and support older messages. Other list pagination is future work. Content deletion is permanent and also removes dependent comments, memberships, likes or RSVPs. Messages have no member-side deletion; staff can remove reported messages.

## Checks

`npm test` runs input-validation tests; `npm run check` checks JavaScript syntax. GitHub Actions runs MySQL 8.4 integration tests for core workflows, friend-request permissions, message isolation, blocking, reports, unread state, image validation/ownership, metadata removal and safe image deletion. It also runs DOM-based UI tests for member search/navigation, friend requests, messaging, notifications, escaping and photo fields. These tests are gated by `MV_INTEGRATION=1` and `MV_UI=1` respectively. Integration tests refuse to overwrite an existing `config.js`; use only the disposable database configured in the workflow. They leave test data behind. Verify layout and secure cookies through your production HTTPS proxy before inviting members.
