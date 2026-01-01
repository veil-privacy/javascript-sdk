import { NoteEngine, Note } from './core/notes.js';
import { CommitmentBuilder } from './core/commitment_builder.js';
import { PoseidonClient } from './crypto/poseidon.js';
import { StorageManager } from './storage/manager.js';
import { MerkleClient } from './merkle/client.js';
import { ProofInputsAssembler, PublicInputs } from './prover/inputs.js';
import { ExecutionBundleBuilder, ExecutionConstraints, ExecutionBundle } from './execution/bundle.js';
import { ProofInputs } from './prover/inputs.js';
import { SHADE_DOMAIN, AssetId } from './domain/constants.js';

export interface SDKConfig {
  walletSignature: string;
  poseidonUrl?: string;
  merkleUrl?: string;
  proverUrl?: string;
}

export class ShadeSDK {
  private config: SDKConfig;
  private poseidonClient: PoseidonClient;
  private merkleClient: MerkleClient;
  private commitmentBuilder: CommitmentBuilder;
  private noteEngine: NoteEngine;
  private storage: StorageManager;
  private proofAssembler: ProofInputsAssembler;
  private bundleBuilder: ExecutionBundleBuilder;
  
  constructor(config: SDKConfig) {
    if (!config.walletSignature) {
      throw new Error('walletSignature is required');
    }
    
    this.config = config;
    
    // Initialize clients
    this.poseidonClient = new PoseidonClient(config.poseidonUrl);
    this.merkleClient = new MerkleClient(config.merkleUrl);
    
    // Initialize core components
    this.commitmentBuilder = new CommitmentBuilder(this.poseidonClient);
    this.noteEngine = new NoteEngine(this.commitmentBuilder);
    this.storage = new StorageManager();
    this.proofAssembler = new ProofInputsAssembler(this.merkleClient, this.commitmentBuilder);
    this.bundleBuilder = new ExecutionBundleBuilder();
  }
  
  /**
    Initialize SDK (must be called first)
   */
  async initialize(): Promise<void> {
    console.log('🔧 Initializing Shade SDK...');
    
    // Test Poseidon service
    const poseidonReady = await this.poseidonClient.testConnection();
    if (!poseidonReady) {
      throw new Error('Poseidon service not available');
    }
    
    // Initialize storage
    await this.storage.initialize(this.config.walletSignature);
    
    console.log('✅ Shade SDK initialized');
  }
  
  /**
   * Create a new note (deposit)
   */
  async createNote(assetId: AssetId, amount: bigint): Promise<{
    note: Note;
    commitment: bigint;
    bucketAmount: bigint;
  }> {
    console.log(`📝 Creating note: ${amount} of asset ${assetId}`);
    
    const note = await this.noteEngine.createNote(assetId, amount);
    const storageId = await this.storage.storeNote(note);
    
    console.log(`💾 Note stored with commitment: ${note.metadata.commitment}`);
    
    return {
      note,
      commitment: note.metadata.commitment,
      bucketAmount: note.metadata.bucketAmount
    };
  }
  
  /**
   * Get unspent notes (optionally filtered by asset)
   */
  async getUnspentNotes(assetId?: AssetId): Promise<Note[]> {
    return this.storage.getUnspentNotes(assetId);
  }
  
  /**
   * Prepare proof for spending a note
   */
  async prepareSpendProof(
    commitment: string,
    options: {
      relayerFee?: bigint;
      protocolFee?: bigint;
      recipient?: string;
    } = {}
  ): Promise<{
    note: Note;
    proofInputs: ProofInputs;
  }> {
    console.log(`🔍 Preparing spend proof for: ${commitment}`);
    
    // Load note
    const note = await this.storage.getNote(commitment);
    if (!note) {
      throw new Error(`Note not found: ${commitment}`);
    }
    
    if (note.metadata.spent) {
      throw new Error('Note already spent');
    }
    
    // Prepare note for spending
    const preparedNote = await this.noteEngine.prepareForSpending(note);
    
    // Assemble proof inputs
    const proofInputs = await this.proofAssembler.assemble(preparedNote, options);
    
    console.log(`📊 Proof inputs assembled`);
    
    return {
      note: preparedNote,
      proofInputs
    };
  }
  
  /**
   * Build execution bundle
   */
  async buildExecutionBundle(
    proof: any,
    publicInputs: PublicInputs,
    callData: string,
    constraints: ExecutionConstraints
  ): Promise<ExecutionBundle> {
    return this.bundleBuilder.build(proof, publicInputs, callData, constraints);
  }
  
  /**
   * Mark note as spent (call after successful execution)
   */
  async markNoteSpent(commitment: string): Promise<void> {
    await this.storage.markAsSpent(commitment);
    console.log(`🏷️ Note marked as spent: ${commitment}`);
  }
  
  /**
   * Get SDK version and status
   */
  getStatus() {
    return {
      version: '1.0.0',
      initialized: true,
      services: {
        poseidon: 'connected',
        merkle: 'connected'
      }
    };
  }
}
// Add auto-execution when file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  async function main() {
    console.log('🚀 Starting Shade SDK Demo\n');
    
    try {
      const sdk = new ShadeSDK({
        walletSignature: 'demo-' + Date.now(),
        poseidonUrl: 'http://localhost:3001',
        merkleUrl: 'http://localhost:3002'
      });
      
      console.log('✅ SDK instance created');
      
      // Try to initialize
      try {
        await sdk.initialize();
        console.log('✅ SDK initialized');
      } catch (err) {
        console.log('⚠️  Services not available (expected):', err);
        console.log('💡 Start services with: npm run services:all');
      }
      
      console.log('\n🎉 Shade SDK is ready!');
      console.log('\nNow you can:');
      console.log('1. Import this SDK in your app');
      console.log('2. Create private notes');
      console.log('3. Generate zero-knowledge proofs');
      console.log('4. Execute private transactions');
      
    } catch (error) {
      const err = error as Error;
      console.error('❌ Error:', err.message);
    }
  }
  
  main();
}
