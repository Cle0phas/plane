/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLanguage, ILanguageOption } from "../types";

// ASIN serves French first; English stays the source of every key (decision 2026-11-17).
export const FALLBACK_LANGUAGE: TLanguage = "fr";

export const SUPPORTED_LANGUAGES: ILanguageOption[] = [
  { label: "Français", value: "fr" },
  { label: "English", value: "en" },
];

export const LANGUAGE_STORAGE_KEY = "userLanguage";
