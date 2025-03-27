const crypto = require('crypto');

// Secret key for URL encryption - should be in environment variables
const URL_ENCRYPTION_KEY = process.env.URL_ENCRYPTION_KEY || 'your-secret-key-min-32-chars-long-secure';
const URL_ENCRYPTION_IV = process.env.URL_ENCRYPTION_IV || crypto.randomBytes(16).toString('hex').slice(0, 16);

/**
 * Encrypt a URL to create a secure redirect ID
 * 
 * @param {string} url - The original job URL to encrypt
 * @returns {string} - The encrypted URL as a base64 string
 */
function encodeJobUrl(url) {
  try {
    const cipher = crypto.createCipheriv(
      'aes-256-cbc', 
      Buffer.from(URL_ENCRYPTION_KEY), 
      Buffer.from(URL_ENCRYPTION_IV)
    );
    
    let encrypted = cipher.update(url, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // Make it URL safe
    return encrypted
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (error) {
    console.error('Error encoding job URL:', error);
    return null;
  }
}

/**
 * Decrypt an encoded URL ID back to the original URL
 * 
 * @param {string} encoded - The encrypted URL string
 * @returns {string|null} - The original URL or null if decryption fails
 */
function decodeJobUrl(encoded) {
  try {
    // Restore from URL safe format
    const base64 = encoded
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    const paddedBase64 = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc', 
      Buffer.from(URL_ENCRYPTION_KEY), 
      Buffer.from(URL_ENCRYPTION_IV)
    );
    
    let decrypted = decipher.update(paddedBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Error decoding job URL:', error);
    return null;
  }
}

module.exports = {
  encodeJobUrl,
  decodeJobUrl
};