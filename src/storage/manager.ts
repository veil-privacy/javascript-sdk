import { openDB, IDBPDatabase } from 'idb';
import { EncryptionService, EncryptedData } from '../crypto/encryption.js';
import { Note, NoteMetadata } from '../core/notes.js';
import { NoteSecrets } from '../core/keys.js';

interface StoredNote {
  commitment: string;
  encryptedSecrets: EncryptedData;
  metadata: NoteMetadata;
  spent: boolean;
  createdAt: number;
  updatedAt: number;
}

export class StorageManager {
  private db: IDBPDatabase | null = null;
  private encryption: EncryptionService;
  private storageKey: CryptoKey | null = null;
  
  constructor() {
    this.encryption = new EncryptionService();
  }
  
  /**
   * Initialize storage with wallet signature
   */
  async initialize(walletSignature: string): Promise<void> {
    // Derive encryption key
    this.storageKey = await this.encryption.deriveStorageKey(walletSignature);
    
    // Initialize IndexedDB
    this.db = await openDB('shade-notes', 2, {
      upgrade(db, oldVersion, newVersion) {
        if (oldVersion < 1) {
          // Version 1: initial schema
          const store = db.createObjectStore('notes', { keyPath: 'commitment' });
          store.createIndex('spent', 'spent');
          store.createIndex('assetId', 'metadata.assetId');
          store.createIndex('createdAt', 'createdAt');
        }
        
        if (oldVersion < 2) {
          // Version 2: add composite index for queries
          const store = db.transaction.objectStore('notes');
          store.createIndex('spent_asset', ['spent', 'metadata.assetId']);
        }
      }
    });
    
    console.log('💾 Storage initialized');
  }
  
  /**
   * Store a note securely
   */
  async storeNote(note: Note): Promise<string> {
    if (!this.db || !this.storageKey) {
      throw new Error('Storage not initialized');
    }
    
    // Encrypt secrets
    const secretsJson = JSON.stringify({
      secret: note.secrets.secret.toString(),
      nullifier: note.secrets.nullifier.toString(),
      noteId: note.secrets.noteId.toString()
    });
    
    const encryptedSecrets = await this.encryption.encrypt(this.storageKey, secretsJson);
    
    // Prepare stored note
    const storedNote: StoredNote = {
      commitment: note.metadata.commitment.toString(),
      encryptedSecrets,
      metadata: note.metadata,
      spent: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    // Store in IndexedDB
    await this.db.put('notes', storedNote);
    
    // Backup to filesystem if in Node.js
    await this.backupToFilesystem(storedNote);
    
    return note.metadata.commitment.toString();
  }
  
  /**
   * Retrieve a note by commitment
   */
  async getNote(commitment: string): Promise<Note | null> {
    if (!this.db || !this.storageKey) {
      throw new Error('Storage not initialized');
    }
    
    const stored = await this.db.get('notes', commitment);
    if (!stored) return null;
    
    // Decrypt secrets
    const secretsJson = await this.encryption.decrypt(this.storageKey, stored.encryptedSecrets);
    const secretsData = JSON.parse(secretsJson);
    
    const secrets: NoteSecrets = {
      secret: BigInt(secretsData.secret),
      nullifier: BigInt(secretsData.nullifier),
      noteId: BigInt(secretsData.noteId)
    };
    
    return {
      secrets,
      metadata: stored.metadata
    };
  }
  
  /**
   * Get all unspent notes for an asset
   */
  async getUnspentNotes(assetId?: bigint): Promise<Note[]> {
    if (!this.db || !this.storageKey) {
      throw new Error('Storage not initialized');
    }
    
    let index: IDBIndex;
    let range: IDBKeyRange | undefined;
    
    if (assetId !== undefined) {
      // Query unspent notes for specific asset
      index = this.db.transaction('notes').store.index('spent_asset');
      range = IDBKeyRange.bound([false, assetId.toString()], [false, assetId.toString()]);
    } else {
      // Query all unspent notes
      index = this.db.transaction('notes').store.index('spent');
      range = IDBKeyRange.only(false);
    }
    
    const storedNotes = await index.getAll(range);
    
    // Decrypt all notes
    const notes = await Promise.all(
      storedNotes.map(async (stored) => {
        const secretsJson = await this.encryption.decrypt(this.storageKey, stored.encryptedSecrets);
        const secretsData = JSON.parse(secretsJson);
        
        const secrets: NoteSecrets = {
          secret: BigInt(secretsData.secret),
          nullifier: BigInt(secretsData.nullifier),
          noteId: BigInt(secretsData.noteId)
        };
        
        return {
          secrets,
          metadata: stored.metadata
        };
      })
    );
    
    return notes;
  }
  
  /**
   * Mark note as spent
   */
  async markAsSpent(commitment: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    
    const tx = this.db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    
    const note = await store.get(commitment);
    if (note) {
      note.spent = true;
      note.updatedAt = Date.now();
      await store.put(note);
    }
    
    await tx.done;
  }
  
  /**
   * Backup note to filesystem (Node.js only)
   */
  private async backupToFilesystem(note: StoredNote): Promise<void> {
    if (typeof window !== 'undefined') return; // Browser only
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { homedir } = await import('os');
      
      const notesDir = path.join(homedir(), '.shade', 'notes');
      await fs.mkdir(notesDir, { recursive: true });
      
      const filename = `note_${note.commitment}.json`;
      const filepath = path.join(notesDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(note, null, 2), 'utf8');
      console.log(`💾 Note backed up to: ${filepath}`);
    } catch (error) {
      console.warn('⚠️ Filesystem backup failed:', error);
    }
  }
}