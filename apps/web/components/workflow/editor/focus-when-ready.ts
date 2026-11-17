/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Focuses what find returns as soon as it can take the focus, retrying each frame (a new React Flow
 * node shows once measured, a closing modal keeps the page inert). Stops after the first success, after
 * the given frames, or at the first key or pointer press of the user. Returns the cancel function.
 */
export const focusWhenReady = (find: () => HTMLElement | null | undefined, frames = 60): (() => void) => {
  let frame = 0;
  let left = frames;
  const stop = () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("keydown", stop, true);
    document.removeEventListener("pointerdown", stop, true);
  };
  const attempt = () => {
    const target = find();
    target?.focus();
    left -= 1;
    if ((target && document.activeElement === target) || left <= 0) stop();
    else frame = requestAnimationFrame(attempt);
  };
  document.addEventListener("keydown", stop, true);
  document.addEventListener("pointerdown", stop, true);
  attempt();
  return stop;
};
