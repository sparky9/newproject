declare module 'vitest' {
  export const describe: (...args: any[]) => any;
  export const it: (...args: any[]) => any;
  export const expect: (...args: any[]) => any;
  export const beforeAll: (...args: any[]) => any;
  export const afterAll: (...args: any[]) => any;
  export const beforeEach: (...args: any[]) => any;
  export const afterEach: (...args: any[]) => any;
  export const vi: any;
}

declare module 'bullmq' {
  export interface Job<T = any> {
    id?: string | number;
    name?: string;
    data: T;
    attemptsMade: number;
    updateProgress: (value: unknown) => Promise<void>;
  }

  export class Worker<T = any> {
    constructor(name: string, processor: (job: Job<T>) => Promise<unknown>, options?: Record<string, unknown>);
  }

  export class Queue<T = any> {
    constructor(name: string);
    add: (jobName: string, data: T) => Promise<unknown>;
  }
}
