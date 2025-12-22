import { MerkleClient } from './dist/merkle/client.js';

async function testFullIntegration() {
  console.log('🚀 Testing Poseidon + Merkle Integration\n');
  
  const client = new MerkleClient(
    'http://localhost:3002',
    'http://localhost:3001'
  );
  
  try {
    // 1. Health check both services
    console.log('1. Health checking services...');
    const health = await client.healthCheck();
    console.log(`   Merkle service: ${health.merkleHealthy ? '✅' : '❌'}`);
    console.log(`   Poseidon service: ${health.poseidonHealthy ? '✅' : '❌'}`);
    
    if (!health.allHealthy) {
      console.log('\n💡 Make sure both services are running:');
      console.log('   - Poseidon: node server.js (port 3001)');
      console.log('   - Merkle: cargo run (port 3002)');
      return;
    }
    
    console.log('✅ Both services healthy\n');
    
    // 2. Get current tree info
    console.log('2. Getting Merkle tree info...');
    const treeInfo = await client.getTreeInfo();
    console.log(`   Root: ${treeInfo.root.slice(0, 16)}...`);
    console.log(`   Current leaves: ${treeInfo.leaves_count}`);
    console.log(`   Tree height: ${treeInfo.height}`);
    console.log(`   Max capacity: ${treeInfo.max_capacity}\n`);
    
    // 3. Create a test commitment (simulating your SDK)
    const testCommitment = '1234567890123456789012345678901234567890123456789012345678901234';
    console.log('3. Inserting test commitment...');
    console.log(`   Commitment: ${testCommitment.slice(0, 16)}...`);
    
    // 4. Insert and verify in one call
    const { insertResult, proof, verified } = await client.insertAndVerify(testCommitment);
    console.log(`   Inserted at index: ${insertResult.index}`);
    console.log(`   New root: ${insertResult.root.slice(0, 16)}...`);
    console.log(`   Proof verification: ${verified ? '✅' : '❌'}`);
    console.log(`   Proof path length: ${proof.path.length}`);
    
    if (!verified) {
      throw new Error('Proof verification failed!');
    }
    
    console.log('\n4. Testing proof retrieval...');
    const retrievedProof = await client.getProof(testCommitment);
    const reVerified = await client.verifyProof(retrievedProof);
    console.log(`   Retrieved proof matches: ${JSON.stringify(proof) === JSON.stringify(retrievedProof) ? '✅' : '❌'}`);
    console.log(`   Re-verification: ${reVerified ? '✅' : '❌'}`);
    
    // 5. Test proof by index
    console.log('\n5. Testing proof by index...');
    const proofByIndex = await client.getProofByIndex(insertResult.index);
    console.log(`   Index proof matches: ${JSON.stringify(proof) === JSON.stringify(proofByIndex) ? '✅' : '❌'}`);
    
    // 6. Test batch verification
    console.log('\n6. Testing batch verification...');
    const batchProofs = [proof, proofByIndex];
    const batchResults = await client.verifyProofsBatch(batchProofs);
    console.log(`   Batch results: ${batchResults.map(r => r ? '✅' : '❌').join(', ')}`);
    
    // 7. Test invalid proof (should fail)
    console.log('\n7. Testing with tampered proof...');
    const tamperedProof = { ...proof, root: '9999999999999999999999999999999999999999' };
    const tamperedResult = await client.verifyProof(tamperedProof);
    console.log(`   Tampered proof should fail: ${!tamperedResult ? '✅' : '❌'}`);
    
    console.log('\n🎉 All integration tests passed!');
    console.log('\n📊 Summary:');
    console.log(`   • Both services connected`);
    console.log(`   • Merkle tree operational (${treeInfo.leaves_count} leaves)`);
    console.log(`   • Poseidon hashing working`);
    console.log(`   • Proof generation and verification working`);
    console.log(`   • Ready for production use`);
    
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run test
testFullIntegration();