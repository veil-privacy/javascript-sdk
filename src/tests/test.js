// correct-test.js
const ZKIntentSDK = require('shade-privacy');
const { ethers } = require('ethers');

(async () => {
  try {
    console.log('🚀 Starting Private Transfer Test...\n');

    // 1️⃣ Initialize SDK
    const sdk = new ZKIntentSDK({
      apiKey: '85vdsNgSjNeO1u7XktiPI9YTbSj79qH2',
      hmacSecret: '5b3a24dea34c47d2b9d4273b073cd7897fad037af88139a1a446659718011c6d',
    });

    // 2️⃣ Create wallet (Alice)
    const wallet = new ethers.Wallet('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113b37e8a5d2bd1c13c64c8f3ed');
    console.log('👩‍💼 Alice Address:', wallet.address);

    // 3️⃣ CONTRACT ADDRESS (what gets signed)
    const PRIVACY_POOL_CONTRACT = '0x1234567890abcdef1234567890abcdef12345678';
    
    // 4️⃣ Bob's address (passed separately, NOT in signature)
    const BOB_ADDRESS = '0xFEDCBA0987654321';
    console.log('👨‍💼 Bob Address (will be encrypted by SDK):', BOB_ADDRESS);

    // 5️⃣ Prepare payload for SIGNING (contract is recipient!)
    const payloadForSignature = {
      // CONTRACT ADDRESS - what gets signed
      recipient: PRIVACY_POOL_CONTRACT,
      
      // Transaction details
      amount: 10,
      token: 'USDC',
      
      // Security
      nonce: Date.now().toString(),
      timestamp: Math.floor(Date.now() / 1000),
      chainId: 1,
      
      // Wallet info
      sender: wallet.address,
      walletType: 'ethereum',
      
      // Operation type (public)
      action: 'private_transfer'
    };

    console.log('\n📝 What Gets SIGNED (Public):');
    console.log('Recipient (Contract):', payloadForSignature.recipient);
    console.log('Amount:', payloadForSignature.amount, payloadForSignature.token);
    console.log('From:', payloadForSignature.sender);
    console.log('Nonce:', payloadForSignature.nonce);

    // 6️⃣ Sign the payload (contract is recipient!)
    const payloadString = JSON.stringify(payloadForSignature);
    const walletSignature = await wallet.signMessage(payloadString);
    console.log('\n✍️ Signature:', walletSignature.substring(0, 64) + '...');

    // 7️⃣ Create intent - Bob's address passed separately
    const intentResponse = await sdk.createIntent({
      // Public payload (gets signed, goes to contract)
      payload: payloadForSignature,
      
      // Signature of above payload
      walletSignature,
      
      // PRIVATE DATA - SDK will encrypt this
      privateData: {
        actualRecipient: BOB_ADDRESS, // SDK encrypts this
        note: 'Payment for invoice #123'
      },
      
      // Additional info for SDK processing
      metadata: {
        network: 'starknet',
        version: '1.0',
        proofType: 'noir'
      }
    });

    console.log('\n✅ Intent Created!');
    console.log('Intent ID:', intentResponse.intentId);
    console.log('Status:', intentResponse.status);

    // 8️⃣ Listen for proof
    console.log('\n⏳ Waiting for proof generation...');
    sdk.listenProof(intentResponse.intentId, (proofData) => {
      console.log('\n🔐 Proof Ready!');
      console.log('Transaction Hash:', proofData.txHash);
      console.log('Block:', proofData.blockNumber);
      console.log('Gas Used:', proofData.gasUsed);
    });

  } catch (err) {
    console.error('❌ Error:', err.message || err);
  }
})();