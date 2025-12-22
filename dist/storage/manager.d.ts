import { EncryptedData } from '../crypto/encryption.js';
import { Note, NoteMetadata } from '../core/notes.js';
interface StoredNote {
    commitment: string;
    encryptedSecrets: EncryptedData;
    metadata: NoteMetadata;
    spent: boolean;
    createdAt: number;
    updatedAt: number;
}
export declare class StorageManager {
    private adapter;
    private encryption;
    private storageKey;
    private isNode;
    constructor();
    initialize(walletSignature: string): Promise<void>;
    private getStorageKey;
    private getAdapter;
    storeNote(note: Note): Promise<string>;
    getNote(commitment: string): Promise<Note | null>;
    getUnspentNotes(assetId?: bigint): Promise<Note[]>;
    markAsSpent(commitment: string): Promise<void>;
    getAllNotes(): Promise<StoredNote[]>;
    clearAll(): Promise<void>;
    listNotes(): Promise<string[]>;
    getStatus(): {
        initialized: boolean;
        environment: string;
        storageType: string;
        hasKey: boolean;
        hasAdapter: boolean;
    };
}
export {};
//# sourceMappingURL=manager.d.ts.map