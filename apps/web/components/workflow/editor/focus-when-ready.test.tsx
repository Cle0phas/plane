/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusWhenReady } from "./focus-when-ready";

const FRAME = 16;

describe("focusWhenReady", () => {
  let target: HTMLButtonElement;
  let other: HTMLButtonElement;
  let ready: boolean;
  const find = () => (ready ? target : null);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
    target = document.createElement("button");
    other = document.createElement("button");
    document.body.append(target, other);
    ready = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    target.remove();
    other.remove();
  });

  it("focuses the element once it shows up", () => {
    focusWhenReady(find);
    vi.advanceTimersByTime(FRAME * 2);
    ready = true;
    vi.advanceTimersByTime(FRAME);
    expect(document.activeElement).toBe(target);
  });

  it("lets the focus go once the element has had it", () => {
    ready = true;
    focusWhenReady(find);
    expect(document.activeElement).toBe(target);
    other.focus();
    vi.advanceTimersByTime(FRAME * 10);
    expect(document.activeElement).toBe(other);
  });

  it("gives up when the user acts before the element shows up", () => {
    focusWhenReady(find);
    other.focus();
    fireEvent.keyDown(other, { key: "Tab" });
    ready = true;
    vi.advanceTimersByTime(FRAME * 10);
    expect(document.activeElement).toBe(other);
  });

  it("gives up after the given number of frames", () => {
    focusWhenReady(find, 3);
    vi.advanceTimersByTime(FRAME * 5);
    ready = true;
    vi.advanceTimersByTime(FRAME * 5);
    expect(document.activeElement).not.toBe(target);
  });
});
