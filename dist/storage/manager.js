import { EncryptionService } from '../crypto/encryption.js';
// Node.js file-based storage adapter
class NodeStorageAdapter {
    constructor(walletSignature) {
        this.data = new Map();
        this.filePath = '';
        this.notesDir = '';
        // Initialize synchronously in constructor
        this.initFileSystem(walletSignature);
    }
    async initFileSystem(walletSignature) {
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
        }
        catch (error) {
            console.warn('⚠️ Failed to initialize filesystem storage:', error);
        }
    }
    async loadFromFile() {
        try {
            const fs = await import('node:fs');
            if (fs.existsSync(this.filePath)) {
                const content = fs.readFileSync(this.filePath, 'utf8');
                const data = JSON.parse(content);
                this.data = new Map(Object.entries(data));
                console.log(`📁 Loaded ${this.data.size} notes from ${this.filePath}`);
            }
        }
        catch (error) {
            console.warn('⚠️ Could not load notes from file:', error);
            this.data = new Map();
        }
    }
    async saveToFile() {
        try {
            const fs = await import('node:fs');
            const data = Object.fromEntries(this.data);
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
        }
        catch (error) {
            console.warn('⚠️ Could not save notes to file:', error);
        }
    }
    async get(key) {
        return this.data.get(key) || null;
    }
    async getAll() {
        return Array.from(this.data.values());
    }
    async put(key, value) {
        this.data.set(key, value);
        await this.saveToFile();
    }
    async delete(key) {
        this.data.delete(key);
        await this.saveToFile();
    }
    async clear() {
        this.data.clear();
        await this.saveToFile();
    }
    async getAllByIndex(indexName, value) {
        const allNotes = await this.getAll();
        switch (indexName) {
            case 'spent':
                return allNotes.filter(note => note.spent === value);
            case 'assetId':
                return allNotes.filter(note => note.metadata.assetId === value.toString());
            case 'spent_asset':
                const [spent, assetId] = value;
                return allNotes.filter(note => note.spent === spent && note.metadata.assetId === assetId.toString());
            default:
                return allNotes;
        }
    }
}
// Browser IndexedDB storage adapter
class BrowserStorageAdapter {
    constructor() {
        this.db = null;
        // Will be initialized in initialize()
    }
    async initialize() {
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
    async get(key) {
        return this.db.get('notes', key);
    }
    async getAll() {
        return this.db.getAll('notes');
    }
    async put(key, value) {
        await this.db.put('notes', value);
    }
    async delete(key) {
        await this.db.delete('notes', key);
    }
    async clear() {
        await this.db.clear('notes');
    }
    async getAllByIndex(indexName, value) {
        if (indexName === 'spent_asset') {
            return this.db.getAllFromIndex('notes', 'spent_asset', IDBKeyRange.bound([value[0], value[1]], [value[0], value[1]]));
        }
        else {
            return this.db.getAllFromIndex('notes', indexName, IDBKeyRange.only(value));
        }
    }
}
export class StorageManager {
    constructor() {
        this.adapter = null;
        this.storageKey = null;
        this.encryption = new EncryptionService();
        this.isNode = typeof window === 'undefined' && typeof process !== 'undefined';
    }
    async initialize(walletSignature) {
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
            }
            catch (error) {
                console.log('📁 Notes stored in: ~/shade/notes/');
            }
        }
        else {
            console.log('💾 Initializing browser storage...');
            const browserAdapter = new BrowserStorageAdapter();
            await browserAdapter.initialize();
            this.adapter = browserAdapter;
            console.log('✅ Browser storage initialized');
        }
    }
    getStorageKey() {
        if (!this.storageKey) {
            throw new Error('Storage key not initialized. Call initialize() first.');
        }
        return this.storageKey;
    }
    getAdapter() {
        if (!this.adapter) {
            throw new Error('Storage adapter not initialized. Call initialize() first.');
        }
        return this.adapter;
    }
    async storeNote(note) {
        const adapter = this.getAdapter();
        const key = this.getStorageKey();
        // Convert secrets to JSON and encrypt
        const secretsJson = JSON.stringify({
            secret: note.secrets.secret.toString(),
            nullifier: note.secrets.nullifier.toString(),
            noteId: note.secrets.noteId.toString()
        });
        const encryptedSecrets = await this.encryption.encrypt(key, secretsJson);
        const storedNote = {
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
    async getNote(commitment) {
        const adapter = this.getAdapter();
        const key = this.getStorageKey();
        const stored = await adapter.get(commitment);
        if (!stored)
            return null;
        const secretsJson = await this.encryption.decrypt(key, stored.encryptedSecrets);
        const secretsData = JSON.parse(secretsJson);
        const secrets = {
            secret: BigInt(secretsData.secret),
            nullifier: BigInt(secretsData.nullifier),
            noteId: BigInt(secretsData.noteId)
        };
        return {
            secrets,
            metadata: stored.metadata
        };
    }
    async getUnspentNotes(assetId) {
        const adapter = this.getAdapter();
        const key = this.getStorageKey();
        let storedNotes;
        if (assetId !== undefined) {
            storedNotes = await adapter.getAllByIndex('spent_asset', [false, assetId.toString()]);
        }
        else {
            storedNotes = await adapter.getAllByIndex('spent', false);
        }
        // Decrypt all notes
        const notes = await Promise.all(storedNotes.map(async (stored) => {
            const secretsJson = await this.encryption.decrypt(key, stored.encryptedSecrets);
            const secretsData = JSON.parse(secretsJson);
            const secrets = {
                secret: BigInt(secretsData.secret),
                nullifier: BigInt(secretsData.nullifier),
                noteId: BigInt(secretsData.noteId)
            };
            return {
                secrets,
                metadata: stored.metadata
            };
        }));
        console.log(`📊 Found ${notes.length} unspent note(s)`);
        return notes;
    }
    async markAsSpent(commitment) {
        const adapter = this.getAdapter();
        const stored = await adapter.get(commitment);
        if (stored) {
            stored.spent = true;
            stored.updatedAt = Date.now();
            await adapter.put(commitment, stored);
            console.log(`✅ Note marked as spent: ${commitment.slice(0, 16)}...`);
        }
    }
    async getAllNotes() {
        const adapter = this.getAdapter();
        return adapter.getAll();
    }
    async clearAll() {
        const adapter = this.getAdapter();
        await adapter.clear();
        console.log('🗑️ All notes cleared from storage');
    }
    async listNotes() {
        if (this.isNode) {
            try {
                const fs = await import('node:fs/promises');
                const path = await import('node:path');
                const os = await import('node:os');
                const notesDir = path.join(os.homedir(), 'shade', 'notes');
                const files = await fs.readdir(notesDir);
                return files.filter(file => file.endsWith('.json'));
            }
            catch (error) {
                console.warn('⚠️ Could not list notes:', error);
                return [];
            }
        }
        else {
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
//# sourceMappingURL=manager.js.map