const CryptoJS = require('crypto-js');

function encryptPayload(payload, secret) {
  const ciphertext = CryptoJS.AES.encrypt(JSON.stringify(payload), secret).toString();
  return { ciphertext };
}

module.exports = { encryptPayload };
