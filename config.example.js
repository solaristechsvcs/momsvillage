export default {
  host: '0.0.0.0', port: 3014,
  publicUrl: 'http://localhost:3014',
  verification: {
    enabled: false, // Enable after configuring AWS and testing the camera flow over HTTPS.
    region: 'us-east-1',
    browserRoleArn: '', // Separate IAM role restricted to Rekognition StartFaceLivenessSession.
    accessKeyId: '', secretAccessKey: '', // Or use an AWS workload role/default SDK credential chain.
    encryptionKey: '', // Unique 32-byte key as 64 hex characters; keep it secret and stable.
    autoApproveThreshold: 95, autoApprove: true,
    retentionHours: 72
  },
  membership: { inviteOnly: true }, // Invitations are required; false no longer disables this requirement.
  uploadsDirectory: './uploads', // Persistent writable directory. Existing configs default to this.
  sessionSecret: 'REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
  secureCookies: false, // true when publicUrl uses HTTPS
  trustProxy: false, // 1 if behind one trusted reverse proxy (including Cloudflare Tunnel)
  mysql: { host: '127.0.0.1', port: 3306, user: 'momsvillage', password: '', database: 'momsvillage' },
  // Reserved bootstrap admin emails. Manage existing accounts through Administration.
  adminEmails: ['owner@example.com'],
  adminRegistrationCode: '' // Generate a separate random secret of at least 32 characters.
};
