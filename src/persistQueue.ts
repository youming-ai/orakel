class PersistQueue {
  private readonly queue: Array<() => Promise<void>> = [];
  private processing = false;

  async enqueue(fn: () => Promise<void> | void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await fn();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        void this.process();
      }
    });
  }

  private async process(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) continue;
      await job();
    }

    this.processing = false;
  }
}

export const persistQueue = new PersistQueue();
