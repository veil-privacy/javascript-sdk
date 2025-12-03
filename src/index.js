// index.js
const axios = require('axios');
const { encryptPayload } = require('./utils/encrypt');
const { signPayload } = require('./utils/sign');
const { connectWebSocket } = require('./utils/websockets');

class ZKIntentSDK {
  constructor({ apiKey, hmacSecret}) {
    if (!apiKey || !hmacSecret ) {
      throw new Error('apiKey, hmacSecret, and baseUrl are required');
    }
    this.apiKey = apiKey;
    this.hmacSecret = hmacSecret;
    this.baseUrl = 'http://localhost:8000/api';
  }

  /**
   * Create a new ZK intent
   * @param {Object} options
   * @param {Object} options.payload - Transaction payload {recipient, amount, token, walletType}
   * @param {string} options.walletSignature - Wallet signature of the payload
   * @param {Object} [options.metadata] - Optional metadata {note, priority, ...}
   * @returns {Promise<Object>} Backend response
   */
  async createIntent({ payload, walletSignature, metadata = {} }) {
    // 1️⃣ Validate input
    if (!payload || typeof payload !== 'object') {
      throw new Error('payload must be a non-empty object');
    }
    if (!walletSignature || typeof walletSignature !== 'string') {
      throw new Error('walletSignature is required and must be a string');
    }

    const requiredFields = ['recipient', 'amount', 'token', 'walletType'];
    const missingFields = requiredFields.filter((f) => !(f in payload));
    if (missingFields.length > 0) {
      throw new Error(`Missing required payload fields: ${missingFields.join(', ')}`);
    }

    if (typeof payload.amount !== 'number' || payload.amount <= 0) {
      throw new Error('amount must be a positive number');
    }

    // 2️⃣ Combine payload and wallet signature
    const combinedData = { ...payload, walletSignature };

    // 3️⃣ Encrypt combined data
    const encryptedData = encryptPayload(combinedData, this.hmacSecret);

    // 4️⃣ Generate HMAC signature for request
    const timestamp = new Date().toISOString();
    const signature = signPayload(encryptedData, this.hmacSecret, timestamp);

    // 5️⃣ Send request to backend
    try {
      const response = await axios.post(
        `${this.baseUrl}/intents/`,
        {
          intent: { payload },  // raw payload also sent
          encryptedData,
          metadata,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'x-signature': signature,
            'x-timestamp': timestamp,
          },
        }
      );
      console.log('Intent submitted successfully:', response.data);
      return response.data;
    } catch (err) {
      console.error('Failed to submit intent:', err.response?.data || err.message);
      throw err;
    }
  }

  /**
   * Listen for proof ready event over WebSocket
   * @param {string} intentId - ID of the intent
   * @param {function} callback - Function called with proof data
   * @returns {WebSocket} WebSocket instance
   */
  listenProof(intentId, callback) {
    if (!intentId) throw new Error('intentId is required');

    const wsUrl = `${this.baseUrl.replace(/^http/, 'ws')}/ws/proofs/${intentId}/`;
    return connectWebSocket(wsUrl, callback);
  }
}

module.exports = ZKIntentSDK;
