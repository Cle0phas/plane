/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "@plane/blocks/dialog";
import { useTranslation } from "@plane/i18n";

/**
 * Asks before leaving while `when` is true (D8): navigation inside the application through the router,
 * tab close or reload through the browser's own confirmation.
 */
export function LeaveGuard({ when }: { when: boolean }) {
  const { t } = useTranslation();
  const blocker = useBlocker(when);

  useEffect(() => {
    if (!when) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers only show their confirmation when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [when]);

  // A navigation blocked while its reason has gone (saved meanwhile) goes through.
  useEffect(() => {
    if (blocker.state === "blocked" && !when) blocker.proceed();
  }, [blocker, when]);

  return (
    <ConfirmDialog
      isSubmitting={false}
      isOpen={blocker.state === "blocked"}
      handleClose={() => blocker.reset?.()}
      handleSubmit={() => blocker.proceed?.()}
      title={t("workflows.editor.leave.title")}
      content={t("workflows.editor.leave.body")}
      primaryButtonText={{
        loading: t("workflows.editor.leave.confirm"),
        default: t("workflows.editor.leave.confirm"),
      }}
      secondaryButtonText={t("workflows.editor.leave.stay")}
    />
  );
}
