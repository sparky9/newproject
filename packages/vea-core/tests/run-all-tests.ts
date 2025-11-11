/**
 * Simple Test Runner
 *
 * Runs all tests without external dependencies
 */

import * as path from 'path';
import * as fs from 'fs';

console.log('🧪 VEA Core Test Suite\n');
console.log('=' .repeat(80));

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Simple test framework
global.describe = function(name: string, fn: () => void) {
  console.log(`\n📋 ${name}`);
  fn();
};

global.test = function(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          passedTests++;
          console.log(`  ✅ ${name}`);
        })
        .catch((error) => {
          failedTests++;
          console.log(`  ❌ ${name}`);
          console.log(`     Error: ${error.message}`);
        });
    } else {
      passedTests++;
      console.log(`  ✅ ${name}`);
    }
  } catch (error: any) {
    failedTests++;
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
  }
};

global.beforeEach = function(fn: () => void) {
  fn();
};

global.expect = function(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined but got ${actual}`);
      }
    },
    toContain(expected: any) {
      if (typeof actual === 'string' && !actual.includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      } else if (Array.isArray(actual) && !actual.includes(expected)) {
        throw new Error(`Expected array to contain ${expected}`);
      }
    },
    toHaveLength(expected: number) {
      if (actual.length !== expected) {
        throw new Error(`Expected length ${expected} but got ${actual.length}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (actual >= expected) {
        throw new Error(`Expected ${actual} to be less than ${expected}`);
      }
    },
    not: {
      toBe(expected: any) {
        if (actual === expected) {
          throw new Error(`Expected ${actual} not to be ${expected}`);
        }
      },
      toBeNull() {
        if (actual === null) {
          throw new Error(`Expected value not to be null`);
        }
      },
    },
  };
};

// Run tests
async function runTests() {
  try {
    console.log('\n🔍 Running Persona Tool Registry Tests...\n');
    await import('./persona-tools.test.js');

    console.log('\n\n🔍 Running Persona Action Executor Tests...\n');
    await import('./persona-executor.test.js');

    console.log('\n\n🔍 Running Integration Tests...\n');
    await import('./integration.test.js');

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 Test Summary\n');
    console.log(`Total Tests:  ${totalTests}`);
    console.log(`Passed:       ${passedTests} ✅`);
    console.log(`Failed:       ${failedTests} ❌`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

    if (failedTests > 0) {
      console.log('❌ Some tests failed. Please review errors above.\n');
      process.exit(1);
    } else {
      console.log('✅ All tests passed!\n');
      process.exit(0);
    }
  } catch (error: any) {
    console.error('\n❌ Test execution error:', error.message);
    process.exit(1);
  }
}

runTests();
