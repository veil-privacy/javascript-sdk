import { MerkleClient } from '../merkle/client.js';
import { CommitmentBuilder } from '../core/commitment_builder.js';
import { Note } from '../core/notes.js';
export interface PublicInputs {
    root: string;
    nullifier: string;
    commitmentOut: string;
    recipient: string;
    fee: string;
}
export interface ProofInputs {
    secret: string;
    nullifierSecret: string;
    noteId: string;
    amount: string;
    bucketAmount: string;
    assetId: string;
    merklePath: string[];
    merkleIndex: number;
    publicInputs: PublicInputs;
}
export declare class ProofInputsAssembler {
    private merkleClient;
    private commitmentBuilder;
    constructor(merkleClient: MerkleClient, commitmentBuilder: CommitmentBuilder);
    assemble(note: Note, options?: {
        relayerFee?: bigint;
        protocolFee?: bigint;
        recipient?: string;
    }): Promise<ProofInputs>;
    assembleBatch(notes: Note[], options?: {
        relayerFee?: bigint;
        protocolFee?: bigint;
        recipient?: string;
    }): Promise<ProofInputs[]>;
}
//# sourceMappingURL=inputs.d.ts.map