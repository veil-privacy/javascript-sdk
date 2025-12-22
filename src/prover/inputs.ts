import { Note } from '../core/notes.js';
import { MerkleClient, MerklePath } from '../merkle/client.js';
import { CommitmentBuilder } from '../core/commitment_builder.js';
import { SHADE_DOMAIN } from '../domain/constants.js';

export interface PrivateInputs {
  secret: string;
  nullifier: string;
  amount: string;
  amount_decomposition: string[];
  merkle_path: string[];
  merkle_path_index: number;
}

export interface PublicInputs {
  merkle_root: string;
  nullifier_hash: string;
  asset_id: string;
  relayer_fee: string;
  protocol_fee: string;
  recipient?: string;
}

export interface ProofInputs {
  private: PrivateInputs;
  public: PublicInputs;
  circuit_id: string;
}

export class ProofInputsAssembler {
  private merkleClient: MerkleClient;
  private commitmentBuilder: CommitmentBuilder;
  
  constructor(merkleClient: MerkleClient, commitmentBuilder: CommitmentBuilder) {
    this.merkleClient = merkleClient;
    this.commitmentBuilder = commitmentBuilder;
  }
  
  /**
   * Assemble all inputs for proof generation
   */
  async assemble(
    note: Note,
    options: {
      relayerFee?: bigint;
      protocolFee?: bigint;
      recipient?: string;
    } = {}
  ): Promise<ProofInputs> {
    // Get Merkle path
    const merklePath = await this.merkleClient.getMerklePath(note.metadata.commitment);
    
    // Calculate nullifier hash
    const nullifierHash = await this.commitmentBuilder.calculateNullifierHash(
      note.secrets.nullifier,
      note.secrets.secret
    );
    
    // Decompose amount for range proof
    const amountDecomposition = this.decomposeAmount(note.metadata.amount);
    
    // Assemble private inputs
    const privateInputs: PrivateInputs = {
      secret: note.secrets.secret.toString(),
      nullifier: note.secrets.nullifier.toString(),
      amount: note.metadata.amount.toString(),
      amount_decomposition: amountDecomposition.map(a => a.toString()),
      merkle_path: merklePath.path,
      merkle_path_index: merklePath.index
    };
    
    // Assemble public inputs
    const publicInputs: PublicInputs = {
      merkle_root: merklePath.root,
      nullifier_hash: nullifierHash.toString(),
      asset_id: note.metadata.assetId.toString(),
      relayer_fee: (options.relayerFee || 0n).toString(),
      protocol_fee: (options.protocolFee || 0n).toString(),
      recipient: options.recipient
    };
    
    return {
      private: privateInputs,
      public: publicInputs,
      circuit_id: 'shade_transfer_v1'
    };
  }
  
  /**
   * Decompose amount into bits for range proof
   */
  private decomposeAmount(amount: bigint): bigint[] {
    const decomposition: bigint[] = [];
    
    for (let i = 0; i < SHADE_DOMAIN.AMOUNT_DECOMPOSITION_BITS; i++) {
      decomposition.push((amount >> BigInt(i)) & 1n);
    }
    
    return decomposition;
  }
}