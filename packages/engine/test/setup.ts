import fc from 'fast-check';

// Fixed seed + run count: property tests are reproducible run-to-run and in CI.
// A failure prints the counterexample; add it as a permanent regression test.
fc.configureGlobal({ seed: 424242, numRuns: 500 });
