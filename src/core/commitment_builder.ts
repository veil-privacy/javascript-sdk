import { SHADE_DOMAIN } from '../domain/constants.js';
import { PoseidonClient } from '../crypto/poseidon.js';

export interface CommitmentResult {
  commitment: bigint;
  bucketAmount: bigint;
  rawInputs: {
    secret: bigint;
    nullifier: bigint;
    assetId: bigint;
    amount: bigint;
  };
}

export class CommitmentBuilder {
  private poseidon: PoseidonClient;
  
  constructor(poseidonClient: PoseidonClient) {
    this.poseidon = poseidonClient;
  }
  
  /**
   * Build commitment: Poseidon(secret, nullifier, assetId, bucketAmount)
   * This is the core cryptographic primitive of the system
   */
  async buildCommitment(
    secret: bigint,
    nullifier: bigint,
    assetId: bigint,
    amount: bigint
  ): Promise<CommitmentResult> {
    // Validate inputs
    this.validateInputs(secret, nullifier, assetId, amount);
    
    // Find appropriate bucket for amount (for privacy)
    const bucketAmount = this.findBucket(amount);
    
    console.log(`🔢 Building commitment with:`);
    console.log(`   Secret: 0x${secret.toString(16).slice(0, 16)}...`);
    console.log(`   Nullifier: 0x${nullifier.toString(16).slice(0, 16)}...`);
    console.log(`   Asset ID: ${assetId}`);
    console.log(`   Amount: ${amount} -> Bucket: ${bucketAmount}`);
    
    // Generate commitment using Poseidon hash
    const commitment = await this.poseidon.hash([
      secret,
      nullifier,
      assetId,
      bucketAmount
    ]);
    
    console.log(`🎯 Generated commitment: 0x${commitment.toString(16)}`);
    
    return {
      commitment,
      bucketAmount,
      rawInputs: { secret, nullifier, assetId, amount }
    };
  }
  
  /**
   * Calculate nullifier hash for spending: Poseidon(nullifier, secret)
   * This prevents double-spending while maintaining privacy
   */
  async calculateNullifierHash(nullifier: bigint, secret: bigint): Promise<bigint> {
    this.validateNullifierInputs(nullifier, secret);
    
    console.log(`🔢 Calculating nullifier hash:`);
    console.log(`   Nullifier: 0x${nullifier.toString(16).slice(0, 16)}...`);
    console.log(`   Secret: 0x${secret.toString(16).slice(0, 16)}...`);
    

    
    const nullifierHash = await this.poseidon.hash([nullifier, secret]);
    
    console.log(`🎯 Nullifier hash: 0x${nullifierHash.toString(16)}`);
    
    return nullifierHash;
  }
  
  /**
   * Find the smallest bucket that can hold the amount
   * Buckets provide privacy by hiding exact amounts
   */
  private findBucket(amount: bigint): bigint {
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
    
    if (amount > SHADE_DOMAIN.MAX_AMOUNT) {
      throw new Error(`Amount ${amount} exceeds maximum ${SHADE_DOMAIN.MAX_AMOUNT}`);
    }
    
    // Find first bucket that's >= amount
    for (const bucket of SHADE_DOMAIN.AMOUNT_BUCKETS) {
      if (bucket >= amount) {
        return bucket;
      }
    }
    
    // If amount is larger than largest bucket, use the largest bucket
    const largestBucket = SHADE_DOMAIN.AMOUNT_BUCKETS[SHADE_DOMAIN.AMOUNT_BUCKETS.length - 1];
    
    // Round down to nearest largest bucket
    return (amount / largestBucket) * largestBucket;
  }
  
  /**
   * Validate input parameters
   */
  private validateInputs(
    secret: bigint,
    nullifier: bigint,
    assetId: bigint,
    amount: bigint
  ): void {
    // Validate secret (256-bit)
    if (secret < 0n || secret >= (1n << 256n)) {
      throw new Error('Secret must be a 256-bit value');
    }
    
    // Validate nullifier (256-bit)
    if (nullifier < 0n || nullifier >= (1n << 256n)) {
      throw new Error('Nullifier must be a 256-bit value');
    }
    
    // Validate asset ID
    if (assetId < 0n) {
      throw new Error('Asset ID must be non-negative');
    }
    
    // Validate amount
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
    
    if (amount > SHADE_DOMAIN.MAX_AMOUNT) {
      throw new Error(`Amount ${amount} exceeds maximum ${SHADE_DOMAIN.MAX_AMOUNT}`);
    }
    
    // Ensure secret and nullifier are different
    if (secret === nullifier) {
      throw new Error('Secret and nullifier must be different');
    }
  }
  
  /**
   * Validate nullifier hash inputs
   */
  private validateNullifierInputs(nullifier: bigint, secret: bigint): void {
    if (nullifier < 0n || nullifier >= (1n << 256n)) {
      throw new Error('Nullifier must be a 256-bit value');
    }
    
    if (secret < 0n || secret >= (1n << 256n)) {
      throw new Error('Secret must be a 256-bit value');
    }
  }
  
  /**
   * Reconstruct commitment from components (for verification)
   */
  async reconstructCommitment(
    secret: bigint,
    nullifier: bigint,
    assetId: bigint,
    bucketAmount: bigint
  ): Promise<bigint> {
    return this.poseidon.hash([
      secret,
      nullifier,
      assetId,
      bucketAmount
    ]);
  }
  
  /**
   * Decompose amount into buckets for circuit constraints
   */
  decomposeToBuckets(amount: bigint): { buckets: bigint[]; remainder: bigint } {
    const buckets: bigint[] = [];
    let remaining = amount;
    
    // Use buckets in descending order
    const sortedBuckets = [...SHADE_DOMAIN.AMOUNT_BUCKETS].sort((a, b) => 
      Number(b - a)
    );
    
    for (const bucket of sortedBuckets) {
      if (remaining >= bucket) {
        const count = remaining / bucket;
        for (let i = 0; i < Number(count); i++) {
          buckets.push(bucket);
        }
        remaining = remaining % bucket;
      }
    }
    
    return { buckets, remainder: remaining };
  }
  
  /**
   * Check if a commitment is valid (for debugging/verification)
   */
  async verifyCommitment(
    commitment: bigint,
    secret: bigint,
    nullifier: bigint,
    assetId: bigint,
    amount: bigint
  ): Promise<boolean> {
    try {
      const bucketAmount = this.findBucket(amount);
      const recomputed = await this.reconstructCommitment(
        secret,
        nullifier,
        assetId,
        bucketAmount
      );
      
      return commitment === recomputed;
    } catch (error) {
      console.error('Error verifying commitment:', error);
      return false;
    }
  }
}