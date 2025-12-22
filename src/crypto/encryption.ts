import { SHADE_DOMAIN } from '../domain/constants.js';

export interface EncryptedData {
  ciphertext: string;
  iv: string;
  tag?: string;
}

export class EncryptionService {
  /**
   * Derive storage key from wallet signature
   */
  async deriveStorageKey(walletSignature: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const signatureBuffer = encoder.encode(walletSignature);
    
    // Import as raw key for HKDF
    const baseKey = await crypto.subtle.importKey(
      'raw',
      signatureBuffer,
      { name: 'HKDF' },
      false,
      ['deriveKey']
    );
    
    // Derive specific key for storage
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: encoder.encode(SHADE_DOMAIN.STORAGE_KEY_DERIVATION_SALT),
        info: encoder.encode('note-encryption'),
        hash: 'SHA-256'
      },
      baseKey,
      { name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM, length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  /**
   * Encrypt data with AES-GCM
   */
  async encrypt(key: CryptoKey, data: string): Promise<EncryptedData> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    // Generate random IV (12 bytes for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt with AES-GCM
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM,
        iv: iv
      },
      key,
      dataBuffer
    );
    
    // Extract ciphertext (everything except the last 16 bytes which is the tag)
    const ciphertext = encryptedBuffer.slice(0, -16);
    const tag = encryptedBuffer.slice(-16);
    
    return {
      ciphertext: this.arrayBufferToBase64(ciphertext),
      iv: this.arrayBufferToBase64(iv.buffer),
      tag: this.arrayBufferToBase64(tag)
    };
  }
  
  /**
   * Decrypt data
   */
  async decrypt(key: CryptoKey, encrypted: EncryptedData): Promise<string> {
    // Decode base64 strings back to ArrayBuffers
    const ciphertextBuffer = this.base64ToArrayBuffer(encrypted.ciphertext);
    const ivBuffer = this.base64ToArrayBuffer(encrypted.iv);
    
    if (encrypted.tag) {
      // Combine ciphertext and tag for GCM decryption
      const tagBuffer = this.base64ToArrayBuffer(encrypted.tag);
      const combinedBuffer = this.concatBuffers(ciphertextBuffer, tagBuffer);
      
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM,
          iv: new Uint8Array(ivBuffer)
        },
        key,
        combinedBuffer
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } else {
      // Fallback for legacy data (without separate tag)
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM,
          iv: new Uint8Array(ivBuffer)
        },
        key,
        ciphertextBuffer
      );
      
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    }
  }
  
  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  /**
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  /**
   * Concatenate two ArrayBuffers
   */
  private concatBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer {
    const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    tmp.set(new Uint8Array(buffer1), 0);
    tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
    return tmp.buffer;
  }
  
  /**
   * Simple encryption for testing (no key derivation)
   */
  async simpleEncrypt(data: string, password: string): Promise<EncryptedData> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    
    // Derive key from password
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('shade-simple-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    
    return this.encrypt(key, data);
  }
  
  /**
   * Generate a random encryption key
   */
  async generateRandomKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
      {
        name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM,
        length: 256
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );
  }
  
  /**
   * Export key to base64 for storage
   */
  async exportKey(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('raw', key);
    return this.arrayBufferToBase64(exported);
  }
  
  /**
   * Import key from base64 string
   */
  async importKey(base64Key: string): Promise<CryptoKey> {
    const keyBuffer = this.base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM },
      true,
      ['encrypt', 'decrypt']
    );
  }
}