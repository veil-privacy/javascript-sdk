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

// Universal storage interface
interface StorageAdapter {
  get(key: string): Promise<StoredNote | null>;
  getAll(): Promise<StoredNote[]>;
  put(key: string, value: StoredNote): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllByIndex(indexName: string, value: any): Promise<StoredNote[]>;
}

// Node.js file-based storage adapter
class NodeStorageAdapter implements StorageAdapter {
  private data: Map<string, StoredNote> = new Map();
  private filePath: string = '';
  private notesDir: string = '';
  
  constructor(walletSignature: string) {
    // Initialize synchronously in constructor
    this.initFileSystem(walletSignature);
  }
  
  private async initFileSystem(walletSignature: string): Promise<void> {
    // Dynamic imports for Node.js modules
    if (typeof window !== 'undefined') {
      throw new Error('NodeStorageAdapter can only be used in Node.js environment');
    }
    
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      
      this.notesDir = path.join(os.homedir(), 'shade', 'notes');
      
      // Ensure directory exists
      if (!fs.existsSync(this.notesDir)) {
        fs.mkdirSync(this.notesDir, { recursive: true });
      }
      
      this.filePath = path.join(this.notesDir, `${walletSignature.slice(0, 16)}.json`);
      await this.loadFromFile();
    } catch (error) {
      console.warn('⚠️ Failed to initialize filesystem storage:', error);
    }
  }
  
  private async loadFromFile(): Promise<void> {
    try {
      const fs = await import('node:fs');
      
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(content);
        this.data = new Map(Object.entries(data));
        console.log(`📁 Loaded ${this.data.size} notes from ${this.filePath}`);
      }
    } catch (error) {
      console.warn('⚠️ Could not load notes from file:', error);
      this.data = new Map();
    }
  }
  
  private async saveToFile(): Promise<void> {
  try {
    const fs = await import('node:fs');
    
    const data = Object.fromEntries(this.data);
    
    // Custom JSON replacer to handle BigInt
    const jsonString = JSON.stringify(data, (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }, 2);
    
    fs.writeFileSync(this.filePath, jsonString, 'utf8');
  } catch (error) {
    console.warn('⚠️ Could not save notes to file:', error);
  }
}
  
  async get(key: string): Promise<StoredNote | null> {
    return this.data.get(key) || null;
  }
  
  async getAll(): Promise<StoredNote[]> {
    return Array.from(this.data.values());
  }
  
  async put(key: string, value: StoredNote): Promise<void> {
    this.data.set(key, value);
    await this.saveToFile();
  }
  
  async delete(key: string): Promise<void> {
    this.data.delete(key);
    await this.saveToFile();
  }
  
  async clear(): Promise<void> {
    this.data.clear();
    await this.saveToFile();
  }
  
  async getAllByIndex(indexName: string, value: any): Promise<StoredNote[]> {
    const allNotes = await this.getAll();
    
    switch (indexName) {
      case 'spent':
        return allNotes.filter(note => note.spent === value);
      case 'assetId':
        return allNotes.filter(note => note.metadata.assetId === value.toString());
      case 'spent_asset':
        const [spent, assetId] = value;
        return allNotes.filter(note => 
          note.spent === spent && note.metadata.assetId === assetId.toString()
        );
      default:
        return allNotes;
    }
  }
}

// Browser IndexedDB storage adapter
class BrowserStorageAdapter implements StorageAdapter {
  private db: any = null;
  
  constructor() {
    // Will be initialized in initialize()
  }
  
  async initialize(): Promise<void> {
    const { openDB } = await import('idb');
    
    this.db = await openDB('shade-notes', 2, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (!db.objectStoreNames.contains('notes')) {
          const store = db.createObjectStore('notes', { keyPath: 'commitment' });
          store.createIndex('spent', 'spent');
          store.createIndex('assetId', 'metadata.assetId');
          store.createIndex('createdAt', 'createdAt');
        }
        
        if (oldVersion < 2) {
          const store = transaction.objectStore('notes');
          if (!store.indexNames.contains('spent_asset')) {
            store.createIndex('spent_asset', ['spent', 'metadata.assetId']);
          }
        }
      },
    });
  }
  
  async get(key: string): Promise<StoredNote | null> {
    return this.db.get('notes', key);
  }
  
  async getAll(): Promise<StoredNote[]> {
    return this.db.getAll('notes');
  }
  
  async put(key: string, value: StoredNote): Promise<void> {
    await this.db.put('notes', value);
  }
  
  async delete(key: string): Promise<void> {
    await this.db.delete('notes', key);
  }
  
  async clear(): Promise<void> {
    await this.db.clear('notes');
  }
  
  async getAllByIndex(indexName: string, value: any): Promise<StoredNote[]> {
    if (indexName === 'spent_asset') {
      return this.db.getAllFromIndex('notes', 'spent_asset', 
        IDBKeyRange.bound([value[0], value[1]], [value[0], value[1]])
      );
    } else {
      return this.db.getAllFromIndex('notes', indexName, IDBKeyRange.only(value));
    }
  }
}

export class StorageManager {
  private adapter: StorageAdapter | null = null;
  private encryption: EncryptionService;
  private storageKey: CryptoKey | null = null;
  private isNode: boolean;
  
  constructor() {
    this.encryption = new EncryptionService();
    this.isNode = typeof window === 'undefined' && typeof process !== 'undefined';
  }
  
  async initialize(walletSignature: string): Promise<void> {
    // Derive storage key
    this.storageKey = await this.encryption.deriveStorageKey(walletSignature);
    
    // Initialize appropriate storage adapter
    if (this.isNode) {
      console.log('💾 Initializing Node.js file system storage...');
      this.adapter = new NodeStorageAdapter(walletSignature);
      
      // Wait a bit for initialization
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.log('✅ Node.js storage initialized');
      
      // Show storage location
      try {
        const os = await import('node:os');
        const path = await import('node:path');
        const notesDir = path.join(os.homedir(), 'shade', 'notes');
        console.log(`📁 Storage directory: ${notesDir}`);
      } catch (error) {
        console.log('📁 Notes stored in: ~/shade/notes/');
      }
    } else {
      console.log('💾 Initializing browser storage...');
      const browserAdapter = new BrowserStorageAdapter();
      await browserAdapter.initialize();
      this.adapter = browserAdapter;
      console.log('✅ Browser storage initialized');
    }
  }
  
  private getStorageKey(): CryptoKey {
    if (!this.storageKey) {
      throw new Error('Storage key not initialized. Call initialize() first.');
    }
    return this.storageKey;
  }
  
  private getAdapter(): StorageAdapter {
    if (!this.adapter) {
      throw new Error('Storage adapter not initialized. Call initialize() first.');
    }
    return this.adapter;
  }
  
  async storeNote(note: Note): Promise<string> {
    const adapter = this.getAdapter();
    const key = this.getStorageKey();
    
    // Convert secrets to JSON and encrypt
    const secretsJson = JSON.stringify({
      secret: note.secrets.secret.toString(),
      nullifier: note.secrets.nullifier.toString(),
      noteId: note.secrets.noteId.toString()
    });
    
    const encryptedSecrets = await this.encryption.encrypt(key, secretsJson);
    
    const storedNote: StoredNote = {
      commitment: note.metadata.commitment.toString(),
      encryptedSecrets,
      metadata: note.metadata,
      spent: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await adapter.put(storedNote.commitment, storedNote);
    
    console.log(`💾 Note saved to ${this.isNode ? 'file system' : 'IndexedDB'}`);
    console.log(`   Commitment: ${storedNote.commitment.slice(0, 16)}...`);
    
    return storedNote.commitment;
  }
  
  async getNote(commitment: string): Promise<Note | null> {
    const adapter = this.getAdapter();
    const key = this.getStorageKey();
    
    const stored = await adapter.get(commitment);
    if (!stored) return null;
    
    const secretsJson = await this.encryption.decrypt(key, stored.encryptedSecrets);
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
  
  async getUnspentNotes(assetId?: bigint): Promise<Note[]> {
    const adapter = this.getAdapter();
    const key = this.getStorageKey();
    
    let storedNotes: StoredNote[];
    
    if (assetId !== undefined) {
      storedNotes = await adapter.getAllByIndex('spent_asset', [false, assetId.toString()]);
    } else {
      storedNotes = await adapter.getAllByIndex('spent', false);
    }
    
    // Decrypt all notes
    const notes = await Promise.all(
      storedNotes.map(async (stored) => {
        const secretsJson = await this.encryption.decrypt(key, stored.encryptedSecrets);
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
    
    console.log(`📊 Found ${notes.length} unspent note(s)`);
    
    return notes;
  }
  
  async markAsSpent(commitment: string): Promise<void> {
    const adapter = this.getAdapter();
    
    const stored = await adapter.get(commitment);
    if (stored) {
      stored.spent = true;
      stored.updatedAt = Date.now();
      await adapter.put(commitment, stored);
      console.log(`✅ Note marked as spent: ${commitment.slice(0, 16)}...`);
    }
  }
  
  async getAllNotes(): Promise<StoredNote[]> {
    const adapter = this.getAdapter();
    return adapter.getAll();
  }
  
  async clearAll(): Promise<void> {
    const adapter = this.getAdapter();
    await adapter.clear();
    console.log('🗑️ All notes cleared from storage');
  }
  
  async listNotes(): Promise<string[]> {
    if (this.isNode) {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const os = await import('node:os');
        
        const notesDir = path.join(os.homedir(), 'shade', 'notes');
        const files = await fs.readdir(notesDir);
        return files.filter(file => file.endsWith('.json'));
      } catch (error) {
        console.warn('⚠️ Could not list notes:', error);
        return [];
      }
    } else {
      const notes = await this.getAllNotes();
      return notes.map(note => `${note.commitment}.json`);
    }
  }
  
  getStatus() {
    return {
      initialized: !!this.adapter && !!this.storageKey,
      environment: this.isNode ? 'node' : 'browser',
      storageType: this.isNode ? 'file system (~/shade/notes/)' : 'IndexedDB',
      hasKey: !!this.storageKey,
      hasAdapter: !!this.adapter
    };
  }
}