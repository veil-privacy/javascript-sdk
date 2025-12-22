import { KeyManager, NoteSecrets } from './keys.ts';
import { CommitmentBuilder } from './commitment_builder.ts';
import { SHADE_DOMAIN, AssetId } from '../domain/constants.ts';

export interface NoteMetadata {
  assetId: AssetId;
  amount: bigint;
  bucketAmount: bigint;
  timestamp: number;
  spent: boolean;
  commitment: bigint;
  nullifierHash?: bigint;
}

export interface Note {
  secrets: NoteSecrets;
  metadata: NoteMetadata;
}

export class NoteEngine {
  private commitmentBuilder: CommitmentBuilder;
  
  constructor(commitmentBuilder: CommitmentBuilder) {
    this.commitmentBuilder = commitmentBuilder;
  }
  
  /**
   * Create a complete note with commitment
   */
  async createNote(assetId: AssetId, amount: bigint): Promise<Note> {
    // Generate secrets
    const secrets = KeyManager.generateSecrets();
    
    // Build commitment
    const { commitment, bucketAmount } = await this.commitmentBuilder.buildCommitment(
      secrets.secret,
      secrets.nullifier,
      assetId,
      amount
    );
    
    // Create metadata
    const metadata: NoteMetadata = {
      assetId,
      amount,
      bucketAmount,
      timestamp: Date.now(),
      spent: false,
      commitment
    };
    
    return { secrets, metadata };
  }
  
  /**
   * Prepare note for spending
   */
  async prepareForSpending(note: Note): Promise<Note> {
    const nullifierHash = await this.commitmentBuilder.calculateNullifierHash(
      note.secrets.nullifier,
      note.secrets.secret
    );
    
    return {
      ...note,
      metadata: {
        ...note.metadata,
        nullifierHash
      }
    };
  }
}