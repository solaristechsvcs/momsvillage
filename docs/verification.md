# Optional AI liveness verification (0.5.0)

Verification is separate from approved membership and remains optional. No community feature is locked behind Verified status in this release. The badge means a member completed a liveness check or was approved after a flagged-check review; it does not prove gender, motherhood, legal identity, or that an account is safe.

## Deployment

1. Preserve config.js and uploads, update files, and run npm install. The postinstall step builds the isolated camera component. You may run npm run build:verification explicitly.
2. Restart Wisp. Verification tables are created automatically. Existing configuration works with verification disabled.
3. Configure AWS IAM identities/roles below, in a supported Face Liveness region. This is a billed AWS service; set an account budget and pilot before enabling member use.
4. Generate a unique image key with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
5. Add configuration, keep secrets on the server, and restart. Test over HTTPS with real mobile/desktop cameras.

Example config.js section:

```js
verification: {
  enabled: true,
  region: 'us-east-1',
  browserRoleArn: 'arn:aws:iam::YOUR_ACCOUNT_ID:role/MomsVillageCamera',
  accessKeyId: 'SERVER_IAM_ACCESS_KEY',
  secretAccessKey: 'SERVER_IAM_SECRET',
  // sessionToken: 'ONLY_IF_USING_TEMPORARY_SERVER_CREDENTIALS',
  encryptionKey: 'YOUR_UNIQUE_64_HEX_CHARACTER_IMAGE_KEY',
  autoApproveThreshold: 95,
  autoApprove: true,
  retentionHours: 72
},
```

The server can instead use an AWS workload identity/default SDK credential chain. Do not commit config.js or disclose secrets. Keep the image key stable until all retained evidence has expired; changing it makes existing frames unreadable. It must differ from sessionSecret. A disabled or incomplete configuration leaves other community features operational. A camera bundle must be present before checks can start.

## AWS permissions

Use a dedicated server identity with:
- rekognition:CreateFaceLivenessSession
- rekognition:GetFaceLivenessSessionResults
- sts:AssumeRole for the camera role only

The camera role should trust that server identity and allow only rekognition:StartFaceLivenessSession. Policy templates in this directory contain account, identity and region placeholders to replace. Existing permissions must not be broadened beyond these requirements.

The backend assumes the camera role for 15 minutes and supplies an additional restrictive session policy allowing only StartFaceLivenessSession in the configured region. AWS requires Resource "*" for this action. Browser credentials cannot create sessions or read their results. Opaque single-use session identifiers, ownership checks and server attempt limits bound access to app-created attempts. Users remain in the existing MySQL authentication system; a Cognito migration is unnecessary.

References:
- [AWS Face Liveness](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)
- [Amplify custom credentials](https://ui.docs.amplify.aws/react/connected-components/liveness)
- [Session creation](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html)
- [Result API](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceLivenessSessionResults.html)

## Camera flow and decisions

Approved members open Verification, read the notice and explicitly consent to AWS processing. The camera page uses FaceLivenessDetectorCore to stream the short check. Sessions have approximately three minutes to finish. The server retrieves results from AWS using the session bound to the member. Browser-supplied scores, flags or provider session IDs cannot grant verification.

Successful results at or above the configured threshold, with a usable reference frame, can pass automatically. Lower-confidence results enter private manual review. Failed/expired sessions, invalid scores, provider errors or unusable reference frames do not verify the member. Set autoApprove:false to review every successful check.

The default threshold is an operator setting, not a measured accuracy guarantee. Pilot and calibrate it for your users and devices. Limit: three new attempts per member per day. An active or pending-review attempt must be finished, withdrawn or expired before starting another.

## Review, privacy and withdrawal

Administrators use Verification review to open flagged frames, assess authenticity/quality, select a decision and record a reason visible to the member. They must not infer gender or motherhood from appearance.

Frames are resized to JPEG, stripped of metadata, and encrypted with AES-256-GCM in MySQL with user/attempt binding. They never enter ordinary uploads. High-confidence automatic passes do not retain review frames in the app. Flagged frames expire after 1–168 configured hours (72 by default) and are cleared immediately after a decision or member withdrawal. Access endpoints enforce expiry even before periodic cleanup.

Scores and evidence remain private. Evidence views, automatic passes, manual decisions, revocations and withdrawal are recorded in admin_audit. Manual approval requires a current flagged attempt, matching revision and unexpired/decryptable evidence. It never bypasses membership suspension or review.

Members may delete review data and withdraw Verified status, including after membership restriction. Administrators may revoke current verification with a reason. Existing verified status persists if new checks are disabled; pending reviews can still be handled with the correct image key. Metadata is retained for audit and quota enforcement; encrypted evidence in database backups follows the backup retention policy.

Stopping the component stops local capture. App-side deletion cannot recall video already processed by AWS. AWS retention and data-use settings apply separately. Review [provider data-use controls](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html), including AI service improvement opt-outs, and publish notices matching deployment before enabling member use.

## Future feature gates and testing

The server exposes a current verified_member boolean, backed by member_verifications and the verificationSql helper. A later release can guard selected features using that status together with approved membership. This release activates no such restrictions.

Tests use real MySQL, a mock liveness provider and synthetic images. They cover spoofed client scores, missing images, ownership, encrypted evidence, expiry, private reviews, withdrawal, revocation, quotas and optional access. The AWS credential policy is tested without paid requests. CI builds the camera bundle.

Real AWS credentials, IAM configuration, camera capture, streaming and the chosen threshold require a deployment pilot. Browsers load AWS face-detection model/WASM resources from its CDN; only the isolated camera page receives the extra CSP permissions. Normal community pages retain their existing script/style policy.
