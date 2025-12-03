const CryptoJS = require('crypto-js');

function signPayload(encryptedData, secret, timestamp) {
  const message = `${encryptedData.ciphertext}:${timestamp}`;
  const hash = CryptoJS.HmacSHA256(message, secret).toString();
  return hash;
}

module.exports = { signPayload };
