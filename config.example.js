export default {
  host: '0.0.0.0', port: 3014,
  publicUrl: 'http://localhost:3014',
  uploadsDirectory: './uploads', // Persistent writable directory. Existing configs default to this.
  sessionSecret: 'REPLACE_WITH_A_UNIQUE_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
  secureCookies: false, // true when publicUrl uses HTTPS
  trustProxy: false, // 1 if behind one trusted reverse proxy (including Cloudflare Tunnel)
  mysql: { host: '127.0.0.1', port: 3306, user: 'momsvillage', password: '', database: 'momsvillage' },
  // Allowlisted admin accounts also require the one-time setup code during registration.
  adminEmails: ['owner@example.com'],
  adminRegistrationCode: '' // Generate a separate random secret of at least 32 characters.
};
