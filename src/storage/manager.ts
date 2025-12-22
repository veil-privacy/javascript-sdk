import { openDB, IDBPDatabase, DBSchema, StoreNames, StoreKey, StoreValue } from 'idb';
import { EncryptionService, EncryptedData } from '../crypto/encryption.js';
import { Note, NoteMetadata } from '../core/notes.js';
import { NoteSecrets } from '../core/keys.js';

// Define the database schema
interface ShadeDBSchema extends DBSchema {
  notes: {
    key: string; // commitment
    value: StoredNote;
    indexes: {
      'spent': boolean;
      'assetId': string;
      'createdAt': number;
      'spent_asset': [boolean, string];
    };
  };
}

interface StoredNote {
  commitment: string;
  encryptedSecrets: EncryptedData;
  metadata: NoteMetadata;
  spent: boolean;
  createdAt: number;
  updatedAt: number;
}

export class StorageManager {
  private db: IDBPDatabase<ShadeDBSchema> | null = null;
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
    
    // Initialize IndexedDB with proper typing
    this.db = await openDB<ShadeDBSchema>('shade-notes', 2, {
      upgrade(db, oldVersion, newVersion, transaction) {
        console.log(`Upgrading database from version ${oldVersion} to ${newVersion}`);
        
        if (oldVersion < 1) {
          // Version 1: initial schema
          const store = db.createObjectStore('notes', { keyPath: 'commitment' });
          store.createIndex('spent', 'spent');
          store.createIndex('assetId', 'metadata.assetId');
          store.createIndex('createdAt', 'createdAt');
        }
        
        if (oldVersion < 2) {
          // Version 2: add composite index for queries
          const store = transaction.objectStore('notes');
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
    
    // Backup to filesystem if in Node
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
    
    let storedNotes: StoredNote[] = [];
    
    if (assetId !== undefined) {
      // Query unspent notes for specific asset
      const assetIdStr = assetId.toString();
      storedNotes = await this.db.getAllFromIndex('notes', 'spent_asset', IDBKeyRange.bound(
        [false, assetIdStr],
        [false, assetIdStr]
      ));
    } else {
      // Query all unspent notes
      storedNotes = await this.db.getAllFromIndex('notes', 'spent', false);
    }
    
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
   * Get all notes (for debugging)
   */
  async getAllNotes(): Promise<StoredNote[]> {
    if (!this.db) throw new Error('Storage not initialized');
    return this.db.getAll('notes');
  }
  
  /**
   * Clear all notes (for testing)
   */
  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    await this.db.clear('notes');
  }
  
  /**
   * Backup note to filesystem (Node only)
   */
  private async backupToFilesystem(note: StoredNote): Promise<void> {
    // Skip in browser
    if (typeof window !== 'undefined') return;
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const { homedir } = await import('os');
      
      const notesDir = path.join(homedir(), '.shade', 'notes');
      await fs.mkdir(notesDir, { recursive: true });
      
      const filename = `note_${note.commitment.slice(0, 16)}.json`;
      const filepath = path.join(notesDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(note, null, 2), 'utf8');
      console.log(`💾 Note backed up to: ${filepath}`);
    } catch (error) {
      console.warn('⚠️ Filesystem backup failed:', error);
    }
  }
  
  /**
   * Export all notes (for backup)
   */
  async exportNotes(): Promise<string> {
    if (!this.db || !this.storageKey) {
      throw new Error('Storage not initialized');
    }
    
    const allNotes = await this.getAllNotes();
    const exportData = {
      version: '1.0.0',
      timestamp: Date.now(),
      notes: allNotes
    };
    
    return JSON.stringify(exportData, null, 2);
  }
  
  /**
   * Import notes (for restore)
   */
  async importNotes(jsonData: string): Promise<void> {
    if (!this.db) throw new Error('Storage not initialized');
    
    const importData = JSON.parse(jsonData);
    const tx = this.db.transaction('notes', 'readwrite');
    
    for (const note of importData.notes) {
      await tx.store.put(note);
    }
    
    await tx.done;
  }
}