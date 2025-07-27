import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import { Throttle } from './throttle.mjs'

describe('Throttle', () => {
  test('should create throttle with fixed speed', () => {
    const throttle = new Throttle(1024 * 1024) // 1MB/s
    assert.strictEqual(throttle.speed, 1024 * 1024)
  })

  test('should create throttle with dynamic speed function', () => {
    let currentSpeed = 1024 * 1024
    const throttle = new Throttle(() => currentSpeed)
    assert.strictEqual(throttle.speed, 1024 * 1024)

    currentSpeed = 2 * 1024 * 1024
    assert.strictEqual(throttle.speed, 2 * 1024 * 1024)
  })

  test('should throw error for zero or negative speed', () => {
    const throttle = new Throttle(0)
    assert.throws(() => throttle.speed, /speed must be greater than zero/)
  })

  test('getNextSlot should return empty object for immediate execution', () => {
    const throttle = new Throttle(1024 * 1024) // 1MB/s
    const result = throttle.getNextSlot(100) // 100 bytes
    assert.deepStrictEqual(result, {})
  })

  test('getNextSlot should return promise for delayed execution', async () => {
    const throttle = new Throttle(100) // 100 bytes/s (very slow for testing)

    // First call should be immediate
    let result = throttle.getNextSlot(50)
    assert.deepStrictEqual(result, {})

    // Second call should be delayed
    result = throttle.getNextSlot(100)
    assert.ok(result.promise instanceof Promise)
    assert.ok(typeof result.timeout !== 'undefined')

    // Clean up timeout
    if (result.timeout) {
      clearTimeout(result.timeout)
    }
  })

  test('createThrottledGenerator should throttle data flow', async () => {
    const throttle = new Throttle(1000) // 1000 bytes/s

    // Create test data generator
    async function* testDataGenerator() {
      yield { length: 300, data: 'chunk1' }
      yield { length: 300, data: 'chunk2' }
      yield { length: 300, data: 'chunk3' }
    }

    const startTime = Date.now()
    const results = []

    for await (const chunk of throttle.createThrottledGenerator(testDataGenerator())) {
      results.push(chunk)
    }

    const endTime = Date.now()
    const duration = endTime - startTime

    assert.strictEqual(results.length, 3)
    // Should take at least 600ms to process 900 bytes at 1000 bytes/s
    // (first chunk is immediate, subsequent chunks are throttled)
    assert.ok(duration >= 500, `Duration ${duration}ms should be >= 500ms`)
  })

  test('should handle generator cleanup on error', async () => {
    const throttle = new Throttle(1000)

    async function* errorGenerator() {
      yield { length: 100, data: 'chunk1' }
      throw new Error('Test error')
    }

    try {
      for await (const chunk of throttle.createThrottledGenerator(errorGenerator())) {
        // This should throw
      }
      assert.fail('Should have thrown an error')
    } catch (error: any) {
      assert.strictEqual(error.message, 'Test error')
    }
  })

  test('should enforce 1MiB/s transfer rate limit', async () => {
    const maxRateMiBps = 1 // 1 MiB/s
    const maxRateBytesPs = maxRateMiBps * 1024 * 1024 // 1,048,576 bytes/s
    const throttle = new Throttle(maxRateBytesPs)

    // Create data chunks totaling 2 MiB to test over multiple seconds
    const chunkSize = 256 * 1024 // 256 KiB chunks
    const totalChunks = 8 // 8 chunks = 2 MiB total

    async function* dataGenerator() {
      for (let i = 0; i < totalChunks; i++) {
        yield { length: chunkSize, data: `chunk-${i}` }
      }
    }

    const startTime = Date.now()
    let totalBytesProcessed = 0
    const transferRates = []

    for await (const chunk of throttle.createThrottledGenerator(dataGenerator())) {
      totalBytesProcessed += chunk.length
      const currentTime = Date.now()
      const elapsedSeconds = (currentTime - startTime) / 1000

      if (elapsedSeconds > 0) {
        const currentRate = totalBytesProcessed / elapsedSeconds
        transferRates.push(currentRate)

        // Allow some tolerance for timing precision and first chunk being immediate
        const toleranceFactor = 1.2 // 20% tolerance
        const maxAllowedRate = maxRateBytesPs * toleranceFactor

        // Skip the first measurement as it's often skewed by immediate first chunk
        if (transferRates.length > 1) {
          assert.ok(
            currentRate <= maxAllowedRate,
            `Transfer rate ${(currentRate / (1024 * 1024)).toFixed(2)} MiB/s exceeds limit ${maxRateMiBps} MiB/s (with tolerance)`
          )
        }
      }
    }

    const endTime = Date.now()
    const totalDuration = (endTime - startTime) / 1000
    const averageRate = totalBytesProcessed / totalDuration

    assert.strictEqual(totalBytesProcessed, totalChunks * chunkSize)

    // The average rate should be close to but not exceed the limit significantly
    const averageRateMiBps = averageRate / (1024 * 1024)
    assert.ok(
      averageRateMiBps <= maxRateMiBps * 1.1, // 10% tolerance for average
      `Average transfer rate ${averageRateMiBps.toFixed(2)} MiB/s exceeds limit ${maxRateMiBps} MiB/s`
    )

    // Should take at least 1.8 seconds to transfer 2 MiB at 1 MiB/s (accounting for first chunk being immediate)
    assert.ok(
      totalDuration >= 1.5,
      `Duration ${totalDuration.toFixed(2)}s is too short for 2 MiB at 1 MiB/s limit`
    )
  })

  test('should measure actual throughput with multiple speed limits', async () => {
    const testCases = [
      { limitMiBps: 0.5, expectedMinDuration: 3.5 }, // 0.5 MiB/s, 2 MiB should take ~4s
      { limitMiBps: 2, expectedMinDuration: 0.8 },   // 2 MiB/s, 2 MiB should take ~1s
    ]

    for (const testCase of testCases) {
      const throttle = new Throttle(testCase.limitMiBps * 1024 * 1024)
      const chunkSize = 512 * 1024 // 512 KiB chunks
      const totalSize = 2 * 1024 * 1024 // 2 MiB total
      const numChunks = totalSize / chunkSize

      async function* testDataGenerator() {
        for (let i = 0; i < numChunks; i++) {
          yield { length: chunkSize, data: `test-chunk-${i}` }
        }
      }

      const startTime = Date.now()
      let processedBytes = 0

      for await (const chunk of throttle.createThrottledGenerator(testDataGenerator())) {
        processedBytes += chunk.length
      }

      const endTime = Date.now()
      const duration = (endTime - startTime) / 1000
      const actualRateMiBps = (processedBytes / (1024 * 1024)) / duration

      assert.strictEqual(processedBytes, totalSize)

      // Verify actual rate doesn't significantly exceed the limit
      assert.ok(
        actualRateMiBps <= testCase.limitMiBps * 1.2,
        `Actual rate ${actualRateMiBps.toFixed(2)} MiB/s exceeds limit ${testCase.limitMiBps} MiB/s for test case`
      )

      // Verify minimum duration (accounting for first chunk being immediate)
      assert.ok(
        duration >= testCase.expectedMinDuration,
        `Duration ${duration.toFixed(2)}s is too short for ${testCase.limitMiBps} MiB/s limit (expected >= ${testCase.expectedMinDuration}s)`
      )
    }
  })
})
