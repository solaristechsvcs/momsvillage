# Moms Village

Version 0.5.2 groups staff tools under Administration with top navigation for Users, Membership, Verification review, Moderation, Logs, and Invitations. Logs display recorded account, membership, verification, and password actions, newest first, with pagination. Existing application and verification review links redirect to their Administration tabs. Member verification and personal invitations remain available outside staff tools.


Version 0.5.1: Administration now offers Set temporary password. Confirm your administrator password, choose a temporary password (12 characters minimum, 72 UTF-8 bytes maximum), and share it privately after confirming account ownership. It expires after 24 hours and must be changed before community access. Existing sessions are invalidated. Only hashes are stored; audit entries contain no passwords. Resetting does not approve or restore membership. Administrators must ask another administrator to reset their own account. Update files and restart; the password_state table is created automatically.


A community for moms: profiles, a discussion feed, local groups, events, a marketplace, friend requests, private messaging and notifications. Includes direct photo uploads, member search, contact blocking, and moderation.

## Upgrading an existing installation to 0.2

1. Update the application files from `main`, keeping your existing `config.js`.
2. Run `npm install --omit=dev` and restart the server. Existing configuration works without adding new keys.
3. Startup creates the new tables from `social-schema.sql` automatically without changing or deleting existing accounts, posts, groups, events or listings. You do not need a manual SQL import.
4. Keep the `uploads/` directory persistent and writable by the app. It contains uploaded photos; back it up alongside MySQL. Optionally set `uploadsDirectory` in `config.js` to another persistent directory. Do not overwrite this directory when updating your application.

The new navigation includes **Find moms**, **Friends**, **Messages**, and **Notifications**. Badge counts refresh every 30 seconds while the page is visible; conversations have a Refresh button. These are in-app updates, not browser push notifications.

## Membership approval rollout (0.4.0)

This release makes the community private to approved members. Update application files, preserve your existing config.js and uploads directory, install dependencies and restart. Startup creates the new membership tables automatically; no manual SQL import or external AI account is needed.

**Existing active administrators retain access. Every existing non-admin account enters Pending review.** Their accounts, messages, uploads and community content are preserved. Existing members must sign in, submit their application and be approved before regaining community access. Pending/declined authors and their comments/profiles are hidden from normal community lists. Administrative profile previews remain available for review. Later restarts preserve all membership decisions.

New applicants self-confirm they meet the adult mothers-only membership policy and explain what they seek from the community. Application answers, referral information and review messages are private to the applicant and administrators. No children’s information, identity documents, photos, or gender classification are requested. Membership approval records an administrator's admission decision; it is not proof of gender or parenthood.

- Pending and Declined accounts can sign in, read their own status/feedback, update/resubmit an application, and sign out. They cannot access member content, directories, protected photos, conversations or invitations through the interface or API.
- Approved members have normal community access. Administrators may decline membership or request more information later; restrictions apply on the next request.
- Suspended accounts may sign in to see their status but cannot submit applications or access the community. Restoring an account preserves its underlying membership decision.
- Bootstrap registration with a reserved administrator email and valid setup code remains available so a new installation can be administered. Regular accounts cannot bypass review with role/status fields or an invitation.
- Granting administrator access and badges requires approved, unsuspended membership.

Use **Review applications** in the admin navigation to approve, decline, or request more information. Feedback is visible to the applicant. Each decision checks the application's revision so a changed application cannot be approved from a stale review. Review actions are recorded in admin_audit. In Administration, **Review membership** opens a specific member's application, including older accounts outside the latest queue page. Revoke admin privileges before restricting an administrator's membership.

Approved members can create invitations from **Invitations**. Codes expire after 14 days, can be redeemed once and are shown only at creation. Only a SHA-256 hash and a short suffix are stored. Each member can have 5 active invitations and create 20 per week. Applicants can supply a code when registering or submitting an application; invitation redemption and account/application creation are atomic. Invalid, expired, revoked or used codes are rejected. An issuer must still be approved and unsuspended at redemption. Invitations do not auto-approve anyone.

Members can revoke their own unused codes; admins can revoke any unused code from the review page's recent invitation list. Revoking a used code does not change the applicant's membership: review that application directly.

Invitations are optional by default. For invitation-only applications, add this configuration and restart:

```js
membership: { inviteOnly: true },
```

Existing configuration files work without this key. Existing approved members retain access when enabling invitation-only applications; a new approval requires an attached invitation. Bootstrap administrators are exempt. Applicants with an existing attached invitation can resubmit without a new code.

Community lists and review queues are bounded as documented below (up to 200 applications/invitations per admin view). Email notifications are not included; optional liveness is configured separately as described above; applicants use Check application status to see decisions.

## Optional AI verification (0.5.0)

Approved members may complete an optional AWS Rekognition Face Liveness check. Successful high-confidence checks grant a Verified badge; flagged attempts enter a private review queue. No community feature is restricted by Verified status in this release.

Verification is disabled by default until AWS and a unique encryption key are configured. Install dependencies to build the camera component, preserve config.js, and restart. New tables are created automatically. Review images are encrypted, expire, and are cleared after decisions or withdrawal. No gender or parenthood inference is performed.

See [the setup guide](docs/verification.md) for configuration, AWS permissions, consent/retention, testing and future feature-gating guidance. Existing configuration remains compatible with verification unavailable until setup is complete.

## Requirements

- Node.js 22 or later and npm
- An existing MySQL 8+ database (or compatible MariaDB), reachable from your container
- A dedicated database user with table creation, ALTER, SELECT, INSERT, UPDATE, DELETE and index permissions

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

After copying files, install dependencies and fully restart Wisp. The current log should say `Moms Village v0.5.0 listening on port ...`. If `/version` is missing or reports an older version, check the running container, application directory and Cloudflare Tunnel destination. If the origin is current but the public domain is stale, purge the site's Cloudflare cache and ensure custom cache rules respect origin headers or bypass caching for this app, particularly `/api/*` and `/version`. Origin headers cannot invalidate content that a proxy already cached or override a proxy configured to ignore them.

## Administrator roles (0.3)

In **Administration**, search members by name/email, click their name or **View profile**, and select **Grant admin** or **Revoke admin**. Role changes require confirmation and take effect on the next request without sign-out. All administrators have the same full access, including assigning other administrators. Restore suspended accounts before granting access; revoke admin access before suspending an administrator. The last active administrator cannot be demoted, including during concurrent changes.

Roles are persisted in MySQL. On the first 0.3 startup, a one-time migration preserves the previously effective administrator list: old admin flags on accounts excluded from the previous `adminEmails` allowlist are cleared so revoked access is not unintentionally restored. Later startups leave dashboard-assigned roles intact. Both this marker and account administration audit records are stored in new tables created automatically. No manual SQL import or `config.js` changes are required.

Administrative profile previews include role, suspension status, biography, city and account email, and work for suspended members. Regular profile endpoints continue to exclude private account email and suspended accounts. Account access changes are recorded in `admin_audit` with actor, target, action and timestamp.

## Staff and Developer badges (0.3.1)

Admins automatically display a **Staff** badge. In **Administration**, choose **Assign Developer badge** or **Remove Developer badge** for a member and confirm. Only active administrators can change this badge. Restore suspended accounts before assigning it; an existing badge may still be removed while an account is suspended. Assignments and removals are recorded in `admin_audit`.

Developer is a display badge, not an administrator role. A Developer cannot manage members or badges unless separately assigned admin access. Both badges can appear together. Revoking admin access removes Staff automatically without removing Developer. Members cannot set badges through signup or profile editing.

Badges appear on public/member profile previews, own profile, discussion authors/comments, member search, friend lists, message authors/inbox previews, notifications, event hosts, listing sellers and the admin page. Their values are read from the current database roles/assignments rather than stored on each post. Restart after updating; the new badge table is created automatically without a manual SQL import.

## Founding Member and Tester badges (0.3.2)

Administrators can assign and remove **Founding Member** and **Tester** from each member's Administration row. Both badges are independent of Developer and Staff, appear in the same profile/name locations, and do not grant permissions. Gold identifies Founding Member; teal identifies Tester. Changes require confirmation and are audited.

The first restart automatically converts the previous Developer-only badge column to expandable storage while preserving existing assignments. Your database user needs ALTER permission for this one-time upgrade. Fresh installs use the new schema directly. Keep your existing configuration; no manual SQL import is required.

## Feed comment previews (0.3.3)

Each feed/group post displays only its newest visible comment below the action buttons. The Comments button opens the conversation, with 100 recent comments per page and a View older comments control for earlier replies. Preview author names remain clickable, badges are shown, and adding a reply updates the feed preview/count. Deleted comments and comments by suspended authors are excluded from previews and counts. Existing data works without a migration.

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

Community content, profiles, groups and marketplace contact instructions are visible to approved members. All groups are open to approved members; group membership controls creating group posts. Account email addresses are visible only to their owner and administrators. Private message APIs return only the current member's conversations; staff can view an individual message only through a report. Database operators can access stored records: messages are not end-to-end encrypted. Blocking prevents contact and notifications but does not hide shared community posts, group activity or external seller contact information. Suspended accounts cannot access member endpoints and their authored content is hidden from the main lists. Moderators can inspect reported content even if its author is suspended.

Images can be uploaded directly or supplied as external HTTPS URLs. External hosts may receive visitors' IP addresses; avoid URLs that expose private tokens. Uploads are visible to approved members, including anyone who has their URL. Uploaded images may only be attached by their owner. Storage is limited to 100 MB per member and 2 GB across the installation. Delete unused images from **My profile → My image library**; attached images must be removed from their content before deletion. Unpublished uploads remain in this library and count toward limits. Backups and files left by an interrupted upload may need operator cleanup.

No child profiles, exact-location tracking, payments, shipping, browser push notifications, email verification, password recovery or automated content moderation are included yet. Marketplace transactions are arranged outside the app. Add email verification/recovery and a production privacy policy before broad public onboarding.

Lists are bounded to the latest 50 posts, 100 comments per conversation page, 100 groups/events/listings, 100 directory results/notifications/inbox threads, and 200 friends/blocked members/staff records/upload-library entries. Conversations load 50 messages per page and support older messages. Other list pagination is future work. Content deletion is permanent and also removes dependent comments, memberships, likes or RSVPs. Messages have no member-side deletion; staff can remove reported messages.

## Checks

`npm test` runs input-validation tests; `npm run check` checks JavaScript syntax. GitHub Actions runs MySQL 8.4 integration tests for core workflows, friend-request permissions, message isolation, blocking, reports, unread state, image validation/ownership, metadata removal and safe image deletion. It also runs DOM-based UI tests for member search/navigation, friend requests, messaging, notifications, escaping and photo fields. These tests are gated by `MV_INTEGRATION=1` and `MV_UI=1` respectively. Integration tests refuse to overwrite an existing `config.js`; use only the disposable database configured in the workflow. They leave test data behind. Verify layout and secure cookies through your production HTTPS proxy before inviting members.

## Live chat (0.6.0)

The Messages page now receives live updates for private, text-only conversations between accepted friends. Existing message history is preserved. Blocking and reporting remain available; staff can review individual reported messages through Administration / Moderation. Verified status is not required.

Online visibility is off by default; enable it on the Messages inbox. Only accepted, unblocked friends may receive online status and typing hints. Status is approximate and disappears when visibility is disabled or access is removed. Typing clears automatically.

Messages are committed to MySQL through the existing CSRF-protected API before live notifications are sent. Browser send identifiers prevent duplicate messages on retry. Reconnection loads missed messages using an incremental cursor and preserves the current draft. Failed sends retain the draft; press Send again to retry. When disconnected, messages can still be sent over HTTPS and checked with Refresh. Viewing older history pauses live updates until returning to the latest conversation.

Sessions, password versions, membership, friendships, and blocks are checked on live access. Security-related HTTP changes trigger connection revalidation, with a five-second background check as a fallback. Unapproved, suspended, password-change-required, signed-out, and password-reset sessions cannot keep using chat. Each member may have six concurrent live connections; typing/watch events and message sends are rate limited.

Deploy: update source, run npm install, and restart Wisp. Tables are created automatically. Set config.js publicUrl to the exact browser origin, for example https://social.thesynergy.dev. Development uses the configured publicUrl too. Cloudflare Tunnel must forward /socket.io/ WebSocket connections to the same Wisp application and port; no additional public port is needed. Avoid caching /socket.io/. Use a single Node process/replica; multi-instance operation requires a shared Socket.IO adapter and distributed coordination before scaling.

HTTPS/WSS protects network traffic. Messages remain readable in the application database; this release does not implement end-to-end encryption. No chat attachments, group chat, push notifications, or delivery/read receipts are included. Test production WebSocket connectivity through your tunnel after deployment.


### Bottom chat dock (0.6.1)

Approved members now have a persistent bottom-right Chat button. Expand it to see accepted friends, with opted-in online friends first. Select a friend or a Message link to open a separate conversation window. Up to three windows can remain open; close one to open another. Each window can be minimized, reopened, or closed independently. Windows and drafts stay intact while navigating the site, and are cleared on sign-out or membership restriction. A full browser reload clears windows and unsent drafts.

New live conversation activity opens its own window while the site is visible. Existing minimized windows show a New marker; collapsed windows do not fetch or mark incoming messages read until expanded. The Chat button displays the unread count. If all three windows are occupied, additional conversations remain available through the inbox. Online visibility remains opt-in on the Messages page. The friends list refreshes while expanded. Small screens can scroll horizontally among conversation windows. Deployment: update source, npm install, and restart Wisp. No new configuration or database migration is required beyond 0.6.0.

### Mobile layout (0.6.2)

Phone layouts now have a collapsible Menu, wrapping content and touch-sized controls, single-column cards, horizontally scrollable Administration tabs, and viewport-sized dialogs. Forms use 16px text on phones to avoid focus zoom. The chat dock opens full-width conversation cards on phones; opening another window minimizes the previous one while keeping its draft and New indicator. Chat adjusts to viewport and keyboard size and respects device safe areas. Tablets retain the sidebar and desktop layouts keep multiple chat windows.

Update files, npm install, restart Wisp, and hard refresh. No configuration changes are needed. CI checks Chromium layouts at 320, 375, 390, 768, and 1280 pixels, including menus, password dialogs, chat windows, and page overflow. Native iOS/Android keyboard and camera behavior still benefit from testing on physical devices.

### Children on profiles (0.7.0)

My profile includes an optional Children section. Add, edit, or remove up to 20 entries, with a name/nickname, age in whole years or months, and Boy, Girl, or Rather not say for gender. Name and age also support Rather not say. Age in months is limited to 0–23; age in years accepts 0–120. Ages are entered manually; no birthdate or child photograph is collected.

Entries are private by default. Enable Show this entry on my profile to approved members for each entry you wish to share. Shared entries appear as compact age badges beside the profile name: blue for boys, pink for girls, and a rainbow icon for undisclosed gender. For example, 23 months displays 1y11m and 9 years displays 9y. Name and full age/gender details are available in the badge's accessible description/tooltip. Private entries are excluded from member and administrator profile responses; blocked viewers cannot see shared entries. Removing or switching an entry to private takes effect on subsequent profile requests.

Deploy source and restart Wisp; profile_children is created automatically. No config changes are required. Tests cover ownership, validation, sharing, privacy, removal, compact age labels, and the mobile editor.

### Sitewide announcement (0.7.1)

Administration / Announcements lets approved administrators save a draft, publish or edit one active public banner, choose Info/Important/Maintenance styling, and remove the banner. Removing it keeps the text as an unpublished draft. A revision check prevents stale edits from overwriting another administrator's changes. Changes are recorded in audit logs without including announcement text.

The banner appears on community pages, sign-in/application screens, password-change screens, and the verification camera page. It is public, so do not include private member information. Open visible pages check every 30 seconds and when returning to a tab. Visitors may dismiss the current revision for that browser tab/session; a new revision appears again. Messages are plain text and are escaped. On a network interruption, the last loaded banner remains until the next successful refresh.

Update files and restart Wisp; site_announcement is created automatically. No config changes are needed.

### Group and post editing (0.7.3)

Group owners can edit the group name, city/area, and description from the group page or Local groups cards. Post authors can edit their own text and photo from Edit post on group posts and the main feed. Editing preserves the group, author, likes, comments, and original post identifier. Ownership fields in edit requests are ignored. Neither group owners nor administrators can rewrite another author's posts; existing moderation deletion remains available separately. Uploaded replacement photos must belong to the author. Approved membership is required. No schema or config changes are needed.
