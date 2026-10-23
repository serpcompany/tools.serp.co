import process from "node:process";

// The CPU time this thread has used, in milliseconds. Tests that bound how
// long CPU-bound work takes bound its CPU time, not the clock: on a busy
// machine (CI's runners, with other test files beside this one, or a laptop
// with builds running) the clock also counts the time the thread waits for a
// core, and fails the test when the machine is busy rather than when the
// code is slow. Work on a worker thread is timed there: the worker reports
// its own threadCpuMs().
//
// A bound is about five times or more the work's CPU time on a recent Mac,
// as CI's runners take two to three times as long: a refusal that takes
// 1.1 s here took 3.05 s on CI (staging's 0fbfef0), past a 3 s bound.
export const threadCpuMs = () => {
  const { user, system } = process.threadCpuUsage ? process.threadCpuUsage() : process.cpuUsage();
  return (user + system) / 1000;
};
