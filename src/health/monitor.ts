export class HealthMonitor {
  async checkAll(): Promise<ServiceHealth> {
    return {
      storage: await this.checkStorage(),
      merkle: await this.checkMerkle(),
      poseidon: await this.checkPoseidon(),
      rpc: await this.checkRpc(),
      sync: await this.checkSync()
    };
  }
  
  private async checkMerkle(): Promise<HealthStatus> {
    try {
      const root = await this.merkleClient.getLatestRoot();
      return root ? 'healthy' : 'degraded';
    } catch {
      return 'unavailable';
    }
  }
}