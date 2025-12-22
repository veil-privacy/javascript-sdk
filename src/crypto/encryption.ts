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
    
    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM,
        iv: iv
      },
      key,
      dataBuffer
    );
    
    // Extract tag from encrypted data (last 16 bytes for GCM)
    const ciphertext = encryptedBuffer.slice(0, -16);
    const tag = encryptedBuffer.slice(-16);
    
    return {
      ciphertext: this.arrayBufferToBase64(ciphertext),
      iv: this.arrayBufferToBase64(iv),
      tag: this.arrayBufferToBase64(tag)
    };
  }
  
  /**
   * Decrypt data
   */
  async decrypt(key: CryptoKey, encrypted: EncryptedData): Promise<string> {
    const ciphertextBuffer = this.base64ToArrayBuffer(encrypted.ciphertext);
    const ivBuffer = this.base64ToArrayBuffer(encrypted.iv);
    
    // Combine ciphertext and tag for GCM
    const tagBuffer = encrypted.tag ? this.base64ToArrayBuffer(encrypted.tag) : new ArrayBuffer(0);
    const combinedBuffer = await this.concatBuffers(ciphertextBuffer, tagBuffer);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: SHADE_DOMAIN.ENCRYPTION_ALGORITHM,
        iv: ivBuffer
      },
      key,
      combinedBuffer
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  }
  
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
  }
  
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  private async concatBuffers(buffer1: ArrayBuffer, buffer2: ArrayBuffer): Promise<ArrayBuffer> {
    const result = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
    result.set(new Uint8Array(buffer1), 0);
    result.set(new Uint8Array(buffer2), buffer1.byteLength);
    return result.buffer;
  }
}