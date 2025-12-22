// merkle/client.ts - Production-ready with real Poseidon verification
import axios from 'axios';
export class MerkleClient {
    constructor(merkleServiceUrl = 'http://localhost:3002', poseidonServiceUrl = 'http://localhost:3001') {
        this.serviceUrl = merkleServiceUrl;
        this.poseidonUrl = poseidonServiceUrl;
    }
    /**
     * Poseidon hash using the microservice
     */
    async poseidonHash(inputs) {
        try {
            const response = await axios.post(`${this.poseidonUrl}/poseidon`, {
                inputs: inputs.map(i => i.toString())
            }, { timeout: 10000 });
            return BigInt(response.data.hash);
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Poseidon hash failed: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Hash a leaf node (some implementations use commitment directly,
     * others hash it with zero salt)
     */
    async hashLeaf(leaf) {
        // Many implementations use leaf directly as the hash
        // If your tree uses hashed leaves, uncomment the following:
        // return this.poseidonHash([leaf, 0n]);
        return leaf; // Using leaf directly as hash
    }
    /**
     * Hash two nodes together (Merkle tree parent hash)
     */
    async hashParent(left, right) {
        return this.poseidonHash([left, right]);
    }
    /**
     * Insert a commitment into the Merkle tree
     */
    async insert(commitment) {
        const commitmentStr = typeof commitment === 'bigint'
            ? commitment.toString()
            : commitment;
        try {
            const response = await axios.post(`${this.serviceUrl}/insert`, { commitment: commitmentStr }, { timeout: 10000 });
            console.log(`✅ Inserted commitment at index ${response.data.index}`);
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Merkle insert failed: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Get Merkle proof for a commitment
     */
    async getProof(commitment) {
        const commitmentStr = typeof commitment === 'bigint'
            ? commitment.toString()
            : commitment;
        try {
            const response = await axios.get(`${this.serviceUrl}/merkle-path`, {
                params: { commitment: commitmentStr },
                timeout: 10000
            });
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    throw new Error(`Commitment not found in Merkle tree: ${commitmentStr.slice(0, 16)}...`);
                }
                throw new Error(`Merkle service error: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Get Merkle proof by index
     */
    async getProofByIndex(index) {
        try {
            const response = await axios.get(`${this.serviceUrl}/proof/${index}`, { timeout: 10000 });
            return response.data;
        }
        catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Failed to get proof for index ${index}: ${error.message}`);
            }
            throw error;
        }
    }
    /**
     * Verify Merkle proof using real Poseidon hashing
     */
    async verifyProof(proof) {
        try {
            const leafHash = await this.hashLeaf(BigInt(proof.leaf));
            let currentHash = leafHash;
            // Reconstruct the root from leaf and path
            for (let i = 0; i < proof.path.length; i++) {
                const siblingHash = BigInt(proof.path[i]);
                // Determine if current node is left or right child
                const isLeftChild = ((proof.index >> i) & 1) === 0;
                if (isLeftChild) {
                    // Current is left, sibling is right
                    currentHash = await this.hashParent(currentHash, siblingHash);
                }
                else {
                    // Current is right, sibling is left
                    currentHash = await this.hashParent(siblingHash, currentHash);
                }
            }
            // Compare computed root with claimed root
            const computedRoot = currentHash.toString();
            const matches = computedRoot === proof.root;
            if (!matches) {
                console.warn(`⚠️ Merkle proof verification failed:`);
                console.warn(`   Computed root: ${computedRoot}`);
                console.warn(`   Claimed root: ${proof.root}`);
            }
            return matches;
        }
        catch (error) {
            console.error('❌ Error verifying Merkle proof:', error);
            return false;
        }
    }
    /**
     * Insert and verify in one call
     */
    async insertAndVerify(commitment) {
        // Insert commitment
        const insertResult = await this.insert(commitment);
        // Get proof
        const proof = await this.getProof(commitment);
        // Verify proof
        const verified = await this.verifyProof(proof);
        if (!verified) {
            throw new Error('Merkle proof verification failed after insertion');
        }
        return { insertResult, proof, verified };
    }
    /**
     * Get current Merkle root
     */
    async getRoot() {
        try {
            const response = await axios.get(`${this.serviceUrl}/root`, { timeout: 5000 });
            return response.data.root;
        }
        catch (error) {
            throw new Error(`Failed to get Merkle root: ${error}`);
        }
    }
    /**
     * Get tree information
     */
    async getTreeInfo() {
        try {
            const response = await axios.get(`${this.serviceUrl}/info`, { timeout: 5000 });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to get tree info: ${error}`);
        }
    }
    /**
     * Get all leaves (for debugging)
     */
    async getLeaves() {
        try {
            const response = await axios.get(`${this.serviceUrl}/leaves`, { timeout: 5000 });
            return response.data;
        }
        catch (error) {
            throw new Error(`Failed to get leaves: ${error}`);
        }
    }
    /**
     * Health check both services
     */
    async healthCheck() {
        let merkleHealthy = false;
        let poseidonHealthy = false;
        try {
            const merkleResponse = await axios.get(`${this.serviceUrl}/health`, { timeout: 3000 });
            merkleHealthy = merkleResponse.data.healthy === true;
        }
        catch {
            merkleHealthy = false;
        }
        try {
            const poseidonResponse = await axios.get(`${this.poseidonUrl}/test`, { timeout: 3000 });
            poseidonHealthy = poseidonResponse.data.status === 'running';
        }
        catch {
            poseidonHealthy = false;
        }
        return {
            merkleHealthy,
            poseidonHealthy,
            allHealthy: merkleHealthy && poseidonHealthy
        };
    }
    /**
     * Verify a batch of proofs
     */
    async verifyProofsBatch(proofs) {
        const results = await Promise.all(proofs.map(proof => this.verifyProof(proof)));
        return results;
    }
    /**
     * Generate proof for a leaf and verify it immediately
     */
    async generateAndVerifyProof(commitment) {
        const startTime = Date.now();
        const proof = await this.getProof(commitment);
        const verified = await this.verifyProof(proof);
        const verificationTime = Date.now() - startTime;
        return {
            proof,
            verified,
            verificationTime
        };
    }
}
//# sourceMappingURL=client.js.map