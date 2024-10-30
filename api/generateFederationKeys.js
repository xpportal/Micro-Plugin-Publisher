// generate-keys.js
const crypto = require('crypto');

// Generate the keypair
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

// Export keys in PEM format with proper line breaks
const privPem = privateKey.export({
  type: 'pkcs8',
  format: 'pem'
}).toString();

const pubPem = publicKey.export({
  type: 'spki',
  format: 'pem'
}).toString();

console.log('Private Key:');
console.log(privPem);
console.log('\nPublic Key:');
console.log(pubPem);

// Also show the commands to set in wrangler
console.log('\nWrangler commands:');
console.log('wrangler secret put FEDERATION_PRIVATE_KEY');
console.log('# Paste the private key including BEGIN and END lines');
console.log('\nwrangler secret put FEDERATION_PUBLIC_KEY');
console.log('# Paste the public key including BEGIN and END lines');