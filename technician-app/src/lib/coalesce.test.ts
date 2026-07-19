import { coalesce } from "./coalesce";

it("collapses a burst of calls into one trailing invocation", () => {
  jest.useFakeTimers();
  try {
    const fn = jest.fn();
    const c = coalesce(fn, 400);
    c.call();
    c.call();
    c.call();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it("a call after the quiet gap fires again", () => {
  jest.useFakeTimers();
  try {
    const fn = jest.fn();
    const c = coalesce(fn, 400);
    c.call();
    jest.advanceTimersByTime(400);
    c.call();
    jest.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it("cancel drops a pending invocation", () => {
  jest.useFakeTimers();
  try {
    const fn = jest.fn();
    const c = coalesce(fn, 400);
    c.call();
    c.cancel();
    jest.advanceTimersByTime(1_000);
    expect(fn).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
