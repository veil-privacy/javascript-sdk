export class ProofInputsAssembler {
    constructor(merkleClient, commitmentBuilder) {
        this.merkleClient = merkleClient;
        this.commitmentBuilder = commitmentBuilder;
    }
    async assemble(note, options = {}) {
        console.log('🔧 Assembling proof inputs...');
        // Get Merkle proof
        const merkleProof = await this.merkleClient.getProof(note.metadata.commitment);
        // Verify proof
        const proofValid = await this.merkleClient.verifyProof(merkleProof);
        if (!proofValid) {
            throw new Error('Invalid Merkle proof for note commitment');
        }
        // Generate nullifier using commitmentBuilder's calculateNullifierHash method
        // FIXED: Use the existing method that takes (nullifier, secret)
        const nullifierHash = await this.commitmentBuilder.calculateNullifierHash(note.secrets.nullifier, note.secrets.secret);
        // Create output commitment
        const commitmentOutResult = await this.commitmentBuilder.buildCommitment(note.secrets.secret, note.secrets.nullifier, note.metadata.assetId, note.metadata.bucketAmount);
        // Prepare public inputs
        const publicInputs = {
            root: merkleProof.root,
            nullifier: nullifierHash.toString(),
            commitmentOut: commitmentOutResult.commitment.toString(),
            recipient: options.recipient || '0x0',
            fee: (options.relayerFee || 0n).toString()
        };
        // Prepare private inputs (witnesses)
        const proofInputs = {
            secret: note.secrets.secret.toString(),
            nullifierSecret: note.secrets.nullifier.toString(),
            noteId: note.secrets.noteId.toString(),
            amount: note.metadata.amount.toString(),
            bucketAmount: note.metadata.bucketAmount.toString(),
            assetId: note.metadata.assetId.toString(),
            merklePath: merkleProof.path,
            merkleIndex: merkleProof.index,
            publicInputs
        };
        console.log('✅ Proof inputs assembled');
        console.log(`   Root: ${merkleProof.root.slice(0, 16)}...`);
        console.log(`   Nullifier: ${nullifierHash.toString().slice(0, 16)}...`);
        console.log(`   Merkle path length: ${merkleProof.path.length}`);
        return proofInputs;
    }
    async assembleBatch(notes, options = {}) {
        const proofs = await Promise.all(notes.map(note => this.assemble(note, options)));
        return proofs;
    }
}
//# sourceMappingURL=inputs.js.map