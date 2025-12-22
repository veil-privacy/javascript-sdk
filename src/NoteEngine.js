export class NoteEngine {
  constructor(poseidonClient) {
    this.poseidon = poseidonClient;
  }
  
  async createNote(secret, nullifier, assetId, amount) {
    // Convert all to BigInt
    const secretBig = BigInt(secret);
    const nullifierBig = BigInt(nullifier);
    const assetIdBig = BigInt(assetId);
    const amountBig = BigInt(amount);
    
    // Bucket the amount (simplified - real implementation would use buckets)
    const bucketAmount = this.bucketAmount(amountBig);
    
    // Create commitment
    const commitment = await this.poseidon.hash([
      secretBig,
      nullifierBig,
      assetIdBig,
      bucketAmount
    ]);
    
    return {
      commitment,
      bucketAmount
    };
  }
  
  bucketAmount(amount) {
    // Simplified bucket logic
    // Real implementation: map to nearest bucket (e.g., powers of 2)
    if (amount < 100n) return 100n;
    if (amount < 1000n) return 1000n;
    if (amount < 10000n) return 10000n;
    return amount - (amount % 10000n);
  }
  
  async calculateNullifierHash(nullifier, secret) {
    return this.poseidon.hash([nullifier, secret]);
  }
}