import { PoseidonDomain, AssetId, ShadeError, ErrorCode } from "../domain/constants.js";
import { CommitmentBuilder } from "./commitment_builder.js";

/* ──────────────────────────────────────────────
   Note State Machine
────────────────────────────────────────────── */

export enum NoteState {
  UNSPENT = 'unspent',
  PENDING_SPEND = 'pending_spend',
  SPENT = 'spent',
  RECOVERED = 'recovered',
  CORRUPTED = 'corrupted'
}

/* ──────────────────────────────────────────────
   Note Metadata
────────────────────────────────────────────── */
export interface NoteMetadata {
  commitment: bigint;
  nullifier: bigint;
  secret: bigint;
  assetId: AssetId;
  amount: bigint;
  bucketAmount: bigint;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  depositBlock?: number;
  depositTxHash?: string;
}

/* ──────────────────────────────────────────────
   Note (Core Data Structure)
────────────────────────────────────────────── */
export interface Note {
  // Core cryptographic data
  metadata: NoteMetadata;
  
  // State
  state: NoteState;
  
  // Merkle proof data
  merklePath?: {
    root: bigint;
    path: bigint[];
    index: number;
    blockNumber: number;
  };
  
  // Withdrawal data (when pending)
  withdrawalData?: {
    recipient: string;
    relayerFee: bigint;
    protocolFee: bigint;
    timestamp: Date;
    proof?: any;
  };
  
  // Recovery data
  recoveryId?: string;
}

/* ──────────────────────────────────────────────
   Note Engine (Business Logic)
────────────────────────────────────────────── */
export class NoteEngine {
  constructor(private commitmentBuilder: CommitmentBuilder) {}
  
  /* ───────── Note Creation ───────── */
  async createNote(
    assetId: AssetId,
    amount: bigint
  ): Promise<Note> {
    // Validate inputs
    if (amount <= 0n) {
      throw new ShadeError(
        ErrorCode.VALIDATION_INVALID_INPUT,
        'Amount must be positive'
      );
    }
    
    // Generate random secret (256-bit)
    const secret = this.generateRandomSecret();
    
    // Generate nullifier
    const nullifier = await this.commitmentBuilder.hash(
      PoseidonDomain.NULLIFIER,
      [secret]
    );
    
    // Generate commitment
    const commitment = await this.commitmentBuilder.hash(
      PoseidonDomain.COMMITMENT,
      [secret, amount, BigInt(assetId)]
    );
    
    // Calculate bucket amount (rounded for privacy)
    const bucketAmount = this.calculateBucketAmount(amount);
    
    const now = new Date();
    
    return {
      metadata: {
        commitment,
        nullifier,
        secret,
        assetId,
        amount,
        bucketAmount,
        createdAt: now,
        updatedAt: now,
        version: 1
      },
      state: NoteState.UNSPENT
    };
  }
  
  /* ───────── Prepare for Spending ───────── */
  async prepareForSpending(note: Note): Promise<Note> {
    if (note.state !== NoteState.UNSPENT) {
      throw new ShadeError(
        ErrorCode.NOTE_INVALID_STATE,
        `Note must be UNSPENT, got ${note.state}`
      );
    }
    
    return {
      ...note,
      state: NoteState.PENDING_SPEND,
      metadata: {
        ...note.metadata,
        updatedAt: new Date()
      }
    };
  }
  
  /* ───────── Mark as Spent ───────── */
  markSpent(note: Note): Note {
    if (note.state !== NoteState.PENDING_SPEND && note.state !== NoteState.UNSPENT) {
      throw new ShadeError(
        ErrorCode.NOTE_INVALID_STATE,
        `Note must be UNSPENT or PENDING_SPEND, got ${note.state}`
      );
    }
    
    return {
      ...note,
      state: NoteState.SPENT,
      metadata: {
        ...note.metadata,
        updatedAt: new Date()
      }
    };
  }
  
  /* ───────── Validate Note ───────── */
  async validateNote(note: Note): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    try {
      // Verify commitment matches secret
      const expectedCommitment = await this.commitmentBuilder.hash(
        PoseidonDomain.COMMITMENT,
        [note.metadata.secret, note.metadata.amount, BigInt(note.metadata.assetId)]
      );
      
      if (expectedCommitment !== note.metadata.commitment) {
        errors.push('Commitment does not match secret');
      }
      
      // Verify nullifier matches secret
      const expectedNullifier = await this.commitmentBuilder.hash(
        PoseidonDomain.NULLIFIER,
        [note.metadata.secret]
      );
      
      if (expectedNullifier !== note.metadata.nullifier) {
        errors.push('Nullifier does not match secret');
      }
      
      // Verify amount is positive
      if (note.metadata.amount <= 0n) {
        errors.push('Amount must be positive');
      }
      
      // Verify bucket amount is correct
      const expectedBucketAmount = this.calculateBucketAmount(note.metadata.amount);
      if (expectedBucketAmount !== note.metadata.bucketAmount) {
        errors.push('Bucket amount is incorrect');
      }
      
    } catch (error) {
      errors.push(`Validation error: ${error}`);
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /* ───────── Recover Note ───────── */
  async recoverNote(
    secret: bigint,
    assetId: AssetId,
    amount: bigint,
    depositBlock?: number,
    depositTxHash?: string
  ): Promise<Note> {
    // Recreate note from secret
    const nullifier = await this.commitmentBuilder.hash(
      PoseidonDomain.NULLIFIER,
      [secret]
    );
    
    const commitment = await this.commitmentBuilder.hash(
      PoseidonDomain.COMMITMENT,
      [secret, amount, BigInt(assetId)]
    );
    
    const bucketAmount = this.calculateBucketAmount(amount);
    const now = new Date();
    
    return {
      metadata: {
        commitment,
        nullifier,
        secret,
        assetId,
        amount,
        bucketAmount,
        createdAt: now,
        updatedAt: now,
        version: 1,
        depositBlock,
        depositTxHash
      },
      state: NoteState.RECOVERED
    };
  }
  
  /* ───────── Private Helpers ───────── */
  private generateRandomSecret(): bigint {
    // Generate cryptographically secure random 256-bit number
    const array = new Uint32Array(8);
    crypto.getRandomValues(array);
    
    let secret = 0n;
    for (let i = 0; i < array.length; i++) {
      secret = (secret << 32n) | BigInt(array[i]);
    }
    
    // Ensure 256-bit
    return secret & ((1n << 256n) - 1n);
  }
  
  private calculateBucketAmount(amount: bigint): bigint {
    // Round amount to nearest bucket for privacy
    // Buckets: 0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000
    const buckets = [
      0.1, 0.5, 1, 5, 10, 50, 100, 500, 1000
    ].map(b => BigInt(Math.floor(b * 1e18))); // Assuming 18 decimals
    
    // Convert amount to BigInt with decimals
    const amountInWei = amount; // Assuming amount is already in wei
    
    // Find closest bucket
    let closest = buckets[0];
    let minDiff = amountInWei > closest ? amountInWei - closest : closest - amountInWei;
    
    for (const bucket of buckets.slice(1)) {
      const diff = amountInWei > bucket ? amountInWei - bucket : bucket - amountInWei;
      if (diff < minDiff) {
        minDiff = diff;
        closest = bucket;
      }
    }
    
    return closest;
  }
  
  /* ───────── Note Serialization ───────── */
  serializeNote(note: Note): string {
    return JSON.stringify(note, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
  }
  
  deserializeNote(data: string): Note {
    const parsed = JSON.parse(data, (key, value) => {
      if (typeof value === 'string' && /^\d+n?$/.test(value)) {
        return BigInt(value.replace('n', ''));
      }
      return value;
    });
    
    // Convert date strings back to Date objects
    if (parsed.metadata.createdAt) {
      parsed.metadata.createdAt = new Date(parsed.metadata.createdAt);
    }
    if (parsed.metadata.updatedAt) {
      parsed.metadata.updatedAt = new Date(parsed.metadata.updatedAt);
    }
    if (parsed.withdrawalData?.timestamp) {
      parsed.withdrawalData.timestamp = new Date(parsed.withdrawalData.timestamp);
    }
    
    return parsed;
  }
}