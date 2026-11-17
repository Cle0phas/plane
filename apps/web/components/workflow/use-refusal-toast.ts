/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback } from "react";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
// local imports
import { getWorkflowRefusalKey } from "./helpers";

/** Explains a workflow refusal (spec 4.5); any other error is rethrown to keep the caller's behaviour. */
export const useWorkflowRefusalHandler = () => {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      const key = getWorkflowRefusalKey(error);
      if (!key) throw error;
      setToast({ type: "error", title: t("common.error.label"), message: t(key) });
    },
    [t]
  );
};
