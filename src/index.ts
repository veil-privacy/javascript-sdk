

import { NoteEngine, Note, NoteStatus } from "./core/notes.js";
import { CommitmentBuilder } from "./core/commitment_builder.js";
import { PoseidonDomain, AssetId } from "./domain/constants.js";

import { LocalPoseidon } from "./crypto/local_poseidon.js";
import { RemotePoseidonClient } from "./crypto/remote_poseidon.js";

import { StorageManager, WalletStorageConfig } from "./storage/manager.js";
import { MerkleClient } from "./merkle/client.js";
import { ChainSyncManager } from "./sync/chain_sync.js";
import { RecoveryManager } from "./recovery/manager.js";

import {
  ProofInputsAssembler,
  ProofInputs,
  PublicInputs
} from "./prover/inputs.js";

import {
  ExecutionBundleBuilder,
  ExecutionConstraints,
  ExecutionBundle
} from "./execution/bundle.js";

import { HealthMonitor } from "./health/monitor.js";

/* ──────────────────────────────────────────────
   SDK Configuration
────────────────────────────────────────────── */
export interface SDKConfig {
  // Wallet configuration (can be multiple)
  wallets: WalletConfig[];
  
  // Service endpoints
  poseidonUrl?: string;
  merkleUrl: string;
  proverUrl?: string;
  rpcUrl: string;
  
  // Chain configuration
  chainId: bigint;
  commitmentContract: string;
  treasuryContract: string;
  
  // Optional features
  enableTelemetry?: boolean;
  syncIntervalMs?: number;
}

export interface WalletConfig {
  address: string;
  signature?: string; // Optional for encryption
  label?: string; // User-friendly name
}

/* ──────────────────────────────────────────────
   SDK Status
────────────────────────────────────────────── */
export interface SDKStatus {
  version: string;
  wallets: {
    address: string;
    label?: string;
    noteCount: number;
    lastSync?: Date;
  }[];
  services: {
    storage: 'healthy' | 'degraded' | 'unavailable';
    merkle: 'healthy' | 'degraded' | 'unavailable';
    poseidon: 'healthy' | 'degraded' | 'unavailable' | 'disabled';
    rpc: 'healthy' | 'degraded' | 'unavailable';
    sync: 'idle' | 'syncing' | 'error';
  };
  sync: {
    latestBlock: number;
    lastSyncTime: Date;
    pendingUpdates: number;
  };
}

/* ──────────────────────────────────────────────
   Shade SDK
────────────────────────────────────────────── */
export class ShadeSDK {
  private readonly storage: StorageManager;
  private readonly noteEngine: NoteEngine;
  private readonly proofAssembler: ProofInputsAssembler;
  private readonly bundleBuilder: ExecutionBundleBuilder;
  private readonly syncManager: ChainSyncManager;
  private readonly recoveryManager: RecoveryManager;
  private readonly healthMonitor: HealthMonitor;

  private readonly localPoseidon: LocalPoseidon;
  private readonly remotePoseidon?: RemotePoseidonClient;

  private syncInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(private readonly config: SDKConfig) {
    // Validate configuration
    this.validateConfig(config);

    /* ───────── Local cryptography ───────── */
    this.localPoseidon = new LocalPoseidon();

    /* ───────── Optional remote Poseidon ───────── */
    if (config.poseidonUrl) {
      this.remotePoseidon = new RemotePoseidonClient(config.poseidonUrl);
    }

    /* ───────── Commitment builder ───────── */
    const commitmentBuilder = new CommitmentBuilder(
      async (domain: PoseidonDomain, inputs: bigint[]) => {
        const local = this.localPoseidon.hash(inputs, domain);

        if (this.remotePoseidon) {
          const remote = await this.remotePoseidon.hash(inputs, domain);
          if (remote !== local) {
            throw new Error("Poseidon mismatch — remote service untrusted");
          }
        }

        return local;
      },
      config.chainId,
      BigInt(config.commitmentContract)
    );

    this.noteEngine = new NoteEngine(commitmentBuilder);

    /* ───────── Storage (multi-wallet) ───────── */
    const storageConfigs: WalletStorageConfig[] = config.wallets.map(wallet => ({
      address: wallet.address,
      encryptionKey: wallet.signature,
      label: wallet.label
    }));
    
    this.storage = new StorageManager(storageConfigs);

    /* ───────── Merkle + Proof assembly ───────── */
    const merkleClient = new MerkleClient(config.merkleUrl);
    this.proofAssembler = new ProofInputsAssembler(
      merkleClient,
      commitmentBuilder
    );

    /* ───────── Chain synchronization ───────── */
    this.syncManager = new ChainSyncManager({
      rpcUrl: config.rpcUrl,
      commitmentContract: config.commitmentContract,
      treasuryContract: config.treasuryContract,
      merkleClient,
      storage: this.storage,
      noteEngine: this.noteEngine
    });

    /* ───────── Recovery manager ───────── */
    this.recoveryManager = new RecoveryManager({
      storage: this.storage,
      noteEngine: this.noteEngine,
      commitmentBuilder
    });

    /* ───────── Execution bundling ───────── */
    this.bundleBuilder = new ExecutionBundleBuilder();

    /* ───────── Health monitoring ───────── */
    this.healthMonitor = new HealthMonitor({
      storage: this.storage,
      merkleClient,
      poseidonClient: this.remotePoseidon,
      rpcUrl: config.rpcUrl,
      syncManager: this.syncManager
    });
  }

  private validateConfig(config: SDKConfig): void {
    if (!config.wallets || config.wallets.length === 0) {
      throw new Error("At least one wallet must be configured");
    }
    
    if (!config.merkleUrl) {
      throw new Error("merkleUrl is required");
    }
    
    if (!config.rpcUrl) {
      throw new Error("rpcUrl is required");
    }
    
    if (!config.commitmentContract) {
      throw new Error("commitmentContract is required");
    }
    
    if (!config.treasuryContract) {
      throw new Error("treasuryContract is required");
    }
  }

  /* ──────────────────────────────────────────────
     SDK Initialization
  ─────────────────────────────────────────────── */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.storage.initialize();
    await this.healthMonitor.initialize();
    
    // Initial sync
    await this.syncManager.fullSync();
    
    // Start periodic sync
    const syncInterval = this.config.syncIntervalMs || 30000; // 30 seconds
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncManager.incrementalSync();
      } catch (error) {
        console.warn("Background sync failed:", error);
      }
    }, syncInterval);
    
    this.isInitialized = true;
  }

  /* ──────────────────────────────────────────────
     Create a private note (DEPOSIT)
  ────────────────────────────────────────────── */
  async createNote(
    walletAddress: string,
    assetId: AssetId,
    amount: bigint
  ): Promise<{
    note: Note;
    commitment: bigint;
    bucketAmount: bigint;
  }> {
    this.ensureInitialized();
    this.ensureWalletExists(walletAddress);
    
    const note = await this.noteEngine.createNote(assetId, amount);
    await this.storage.storeNote(walletAddress, note);

    return {
      note,
      commitment: note.metadata.commitment,
      bucketAmount: note.metadata.bucketAmount
    };
  }

  /* ──────────────────────────────────────────────
     List unspent notes
  ────────────────────────────────────────────── */
  async getUnspentNotes(
    walletAddress?: string,
    assetId?: AssetId
  ): Promise<Note[]> {
    this.ensureInitialized();
    
    if (walletAddress) {
      this.ensureWalletExists(walletAddress);
      return this.storage.getUnspentNotes(walletAddress, assetId);
    }
    
    // Return from all wallets
    const allNotes: Note[] = [];
    for (const wallet of this.config.wallets) {
      const notes = await this.storage.getUnspentNotes(wallet.address, assetId);
      allNotes.push(...notes);
    }
    return allNotes;
  }

  /* ──────────────────────────────────────────────
     Prepare a note for spending (ZK input stage)
  ────────────────────────────────────────────── */
  async prepareSpendProof(
    walletAddress: string,
    commitment: bigint,
    options: {
      recipient: string;
      relayerFee?: bigint;
      protocolFee?: bigint;
    }
  ): Promise<{
    note: Note;
    proofInputs: ProofInputs;
  }> {
    this.ensureInitialized();
    this.ensureWalletExists(walletAddress);
    
    const note = await this.storage.getNote(walletAddress, commitment);
    if (!note) {
      throw new Error(`Note not found for wallet ${walletAddress}`);
    }

    const pendingNote = await this.noteEngine.prepareForSpending(note);
    await this.storage.updateNote(walletAddress, pendingNote);

    const proofInputs =
      await this.proofAssembler.assemble(pendingNote, options);

    return { note: pendingNote, proofInputs };
  }

  /* ──────────────────────────────────────────────
     RECOVERY: Recover notes from seed phrase
  ────────────────────────────────────────────── */
  async recoverNotesFromSeed(
    seedPhrase: string,
    derivationPath?: string
  ): Promise<RecoveryResult> {
    this.ensureInitialized();
    
    return await this.recoveryManager.recoverFromSeed(
      seedPhrase,
      derivationPath
    );
  }

  /* ──────────────────────────────────────────────
     RECOVERY: Recover notes from private key
  ────────────────────────────────────────────── */
  async recoverNotesFromPrivateKey(
    privateKey: string,
    label?: string
  ): Promise<RecoveryResult> {
    this.ensureInitialized();
    
    return await this.recoveryManager.recoverFromPrivateKey(
      privateKey,
      label
    );
  }

  /* ──────────────────────────────────────────────
     SYNC: Manual synchronization
  ────────────────────────────────────────────── */
  async sync(forceFullSync = false): Promise<SyncResult> {
    this.ensureInitialized();
    
    if (forceFullSync) {
      return await this.syncManager.fullSync();
    }
    return await this.syncManager.incrementalSync();
  }

  /* ──────────────────────────────────────────────
     WALLET MANAGEMENT: Add new wallet
  ────────────────────────────────────────────── */
  async addWallet(
    address: string,
    signature?: string,
    label?: string
  ): Promise<void> {
    this.ensureInitialized();
    
    await this.storage.addWallet({
      address,
      encryptionKey: signature,
      label
    });
    
    // Sync for new wallet
    await this.syncManager.syncWallet(address);
  }

  /* ──────────────────────────────────────────────
     WALLET MANAGEMENT: Remove wallet
  ────────────────────────────────────────────── */
  async removeWallet(address: string): Promise<void> {
    this.ensureInitialized();
    
    await this.storage.removeWallet(address);
  }

  /* ──────────────────────────────────────────────
     HEALTH: Get comprehensive status
  ────────────────────────────────────────────── */
  async getStatus(): Promise<SDKStatus> {
    this.ensureInitialized();
    
    const health = await this.healthMonitor.checkAll();
    const syncStatus = await this.syncManager.getStatus();
    
    const walletStatuses = await Promise.all(
      this.config.wallets.map(async wallet => ({
        address: wallet.address,
        label: wallet.label,
        noteCount: await this.storage.getNoteCount(wallet.address),
        lastSync: await this.storage.getLastSync(wallet.address)
      }))
    );
    
    return {
      version: "2.0.0",
      wallets: walletStatuses,
      services: health,
      sync: syncStatus
    };
  }

  /* ──────────────────────────────────────────────
     Build execution bundle (relayer-ready)
  ────────────────────────────────────────────── */
  async buildExecutionBundle(
    proof: any,
    publicInputs: PublicInputs,
    calldata: string,
    constraints: ExecutionConstraints
  ): Promise<ExecutionBundle> {
    return this.bundleBuilder.build(
      proof,
      publicInputs,
      calldata,
      constraints
    );
  }

  /* ──────────────────────────────────────────────
     Finalize spend after on-chain success
  ────────────────────────────────────────────── */
  async markNoteSpent(
    walletAddress: string,
    commitment: bigint
  ): Promise<void> {
    this.ensureInitialized();
    this.ensureWalletExists(walletAddress);
    
    const note = await this.storage.getNote(walletAddress, commitment);
    if (!note) {
      throw new Error("Note not found");
    }

    const spent = this.noteEngine.markSpent(note);
    await this.storage.updateNote(walletAddress, spent);
  }

  /* ──────────────────────────────────────────────
     Cleanup
  ────────────────────────────────────────────── */
  async destroy(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    await this.syncManager.destroy();
    await this.storage.destroy();
    this.isInitialized = false;
  }

  /* ──────────────────────────────────────────────
     Private helpers
  ────────────────────────────────────────────── */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error("SDK not initialized. Call initialize() first.");
    }
  }

  private ensureWalletExists(address: string): void {
    const exists = this.config.wallets.some(w => w.address === address);
    if (!exists) {
      throw new Error(`Wallet ${address} not configured`);
    }
  }
}

/* ──────────────────────────────────────────────
   Recovery Result
────────────────────────────────────────────── */
export interface RecoveryResult {
  walletAddress: string;
  recoveredNotes: number;
  newNotes: number;
  existingNotes: number;
  label?: string;
}

/* ──────────────────────────────────────────────
   Sync Result
────────────────────────────────────────────── */
export interface SyncResult {
  timestamp: Date;
  walletsSynced: string[];
  newNotes: number;
  updatedNotes: number;
  spentNotes: number;
  latestBlock: number;
}