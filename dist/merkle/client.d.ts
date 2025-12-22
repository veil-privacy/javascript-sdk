export interface MerkleProof {
    root: string;
    path: string[];
    index: number;
    leaf: string;
}
export interface InsertResponse {
    index: number;
    root: string;
}
export interface TreeInfo {
    root: string;
    leaves_count: number;
    height: number;
    max_capacity: number;
}
export interface PoseidonHashResponse {
    hash: string;
}
export declare class MerkleClient {
    private serviceUrl;
    private poseidonUrl;
    constructor(merkleServiceUrl?: string, poseidonServiceUrl?: string);
    /**
     * Poseidon hash using the microservice
     */
    private poseidonHash;
    /**
     * Hash a leaf node (some implementations use commitment directly,
     * others hash it with zero salt)
     */
    private hashLeaf;
    /**
     * Hash two nodes together (Merkle tree parent hash)
     */
    private hashParent;
    /**
     * Insert a commitment into the Merkle tree
     */
    insert(commitment: bigint | string): Promise<InsertResponse>;
    /**
     * Get Merkle proof for a commitment
     */
    getProof(commitment: bigint | string): Promise<MerkleProof>;
    /**
     * Get Merkle proof by index
     */
    getProofByIndex(index: number): Promise<MerkleProof>;
    /**
     * Verify Merkle proof using real Poseidon hashing
     */
    verifyProof(proof: MerkleProof): Promise<boolean>;
    /**
     * Insert and verify in one call
     */
    insertAndVerify(commitment: bigint | string): Promise<{
        insertResult: InsertResponse;
        proof: MerkleProof;
        verified: boolean;
    }>;
    /**
     * Get current Merkle root
     */
    getRoot(): Promise<string>;
    /**
     * Get tree information
     */
    getTreeInfo(): Promise<TreeInfo>;
    /**
     * Get all leaves (for debugging)
     */
    getLeaves(): Promise<string[]>;
    /**
     * Health check both services
     */
    healthCheck(): Promise<{
        merkleHealthy: boolean;
        poseidonHealthy: boolean;
        allHealthy: boolean;
    }>;
    /**
     * Verify a batch of proofs
     */
    verifyProofsBatch(proofs: MerkleProof[]): Promise<boolean[]>;
    /**
     * Generate proof for a leaf and verify it immediately
     */
    generateAndVerifyProof(commitment: bigint | string): Promise<{
        proof: MerkleProof;
        verified: boolean;
        verificationTime: number;
    }>;
}
//# sourceMappingURL=client.d.ts.map