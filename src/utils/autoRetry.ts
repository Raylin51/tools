/**
 * Asynchronously retries a function that returns a Promise.
 *
 * @template T The expected type of the Promise resolution.
 * @param {() => Promise<T>} fn The function to retry. This function should return a Promise.
 * @param {number} [retries=3] The maximum number of retries. Defaults to 3.
 * @param {number} [delay=1000] The delay in milliseconds between retries. Defaults to 1000ms.
 * @returns {Promise<T>} A Promise that resolves with the result of the function if successful,
 * or rejects if all retries fail.
 */
export const autoRetry = async <T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> => {
  let lastError: any
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}
