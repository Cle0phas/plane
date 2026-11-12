/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Button } from "@makeplane/propel/components/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeading,
  DialogMain,
  DialogTitle,
} from "@makeplane/propel/components/dialog";
import { useTranslation } from "@plane/i18n";
// components
import { StateSelect } from "@/components/dropdowns/state/state-select";

type Props = {
  isOpen: boolean;
  projectId: string;
  stateIds: Set<string>;
  onSubmit: (stateId: string) => void;
  onClose: () => void;
};

export const ArrivalStateDialog = observer(function ArrivalStateDialog({
  isOpen,
  projectId,
  stateIds,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [stateId, setStateId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setStateId(null);
  }, [isOpen]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm">
        <DialogMain>
          <DialogHeader>
            <DialogHeading>
              <DialogTitle>{t("workflows.type_change.title")}</DialogTitle>
            </DialogHeading>
          </DialogHeader>
          <DialogBody tabIndex={0}>
            <p className="mb-3 text-body-sm-regular text-secondary">{t("workflows.type_change.description")}</p>
            <StateSelect
              value={stateId}
              onChange={setStateId}
              projectId={projectId}
              variant="select-ghost-lg"
              allowedStateIds={stateIds}
            />
          </DialogBody>
        </DialogMain>
        <DialogActions>
          <Button
            variant="secondary"
            size="md"
            stretch="auto"
            label={t("workflows.type_change.cancel")}
            onClick={onClose}
          />
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            disabled={!stateId}
            label={t("workflows.type_change.submit")}
            onClick={() => stateId && onSubmit(stateId)}
          />
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
});
