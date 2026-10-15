/**
 * Largest growth ratio a parser may show between an input of length n and one of length 10 n (linear: about
 * 10, quadratic: about 100). Measured under `npm run coverage:lcov` (instrumented) on all twelve header
 * inputs, three rounds each: the highest ratio was 14.6; the limit is three times that, rounded up.
 */
export const LINEAR_RATIO_LIMIT = 44;

/** Timeout of a ratio test: a linear parser needs about a second, a quadratic one is stopped well before 10 s. */
export const RATIO_TEST_TIMEOUT_MS = 10_000;

/** Each timed run lasts at least this long (the clock of the Workers test pool advances in whole milliseconds). */
const MIN_RUN_MS = 20;
const MAX_REPETITIONS = 1 << 22;
const RUNS_PER_LENGTH = 3;

function durationOf(parse: (input: string) => unknown, input: string, repetitions: number): number {
  const start = performance.now();
  for (let index = 0; index < repetitions; index++) {
    parse(input);
  }
  return performance.now() - start;
}

function fastestOf(parse: (input: string) => unknown, input: string, repetitions: number): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < RUNS_PER_LENGTH; run++) {
    fastest = Math.min(fastest, durationOf(parse, input, repetitions));
  }
  return fastest;
}

/**
 * The duration of `parse` on `inputAt(10 * length)` divided by its duration on `inputAt(length)`. The number of
 * repetitions is chosen once, on the short input, so that a run takes at least 20 ms, and is then the same for
 * both lengths; each duration is the fastest of three runs after a warm-up.
 */
export function growthRatio(
  parse: (input: string) => unknown,
  inputAt: (length: number) => string,
  length: number,
): number {
  const short = inputAt(length);
  const long = inputAt(10 * length);
  let repetitions = 1;
  while (durationOf(parse, short, repetitions) < MIN_RUN_MS && repetitions < MAX_REPETITIONS) {
    repetitions *= 2;
  }
  const shortDuration = fastestOf(parse, short, repetitions);
  const longDuration = fastestOf(parse, long, repetitions);
  return longDuration / shortDuration;
}
