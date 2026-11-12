/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
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
import { InputField } from "@makeplane/propel/components/input-field";
import { TextAreaField } from "@makeplane/propel/components/text-area-field";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TWorkflowDetail, TWorkflowFormData } from "@plane/types";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";

type Props = {
  workspaceSlug: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: (workflow: TWorkflowDetail) => void;
};

const EMPTY: TWorkflowFormData = { name: "", description: "" };

export const WorkflowCreateModal = observer(function WorkflowCreateModal(props: Props) {
  const { workspaceSlug, isOpen, onClose, onCreated } = props;
  const { t } = useTranslation();
  const { createWorkflow } = useWorkflow();
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TWorkflowFormData>({ defaultValues: EMPTY });

  useEffect(() => {
    if (isOpen) reset(EMPTY);
  }, [isOpen, reset]);

  const onSubmit = async (data: TWorkflowFormData) => {
    try {
      const workflow = await createWorkflow(workspaceSlug, {
        name: data.name.trim(),
        description: data.description?.trim(),
      });
      onCreated(workflow);
    } catch (error) {
      // Only the field array of a name conflict is mapped; server text is never shown.
      if (typeof error === "object" && error !== null && Array.isArray((error as { name?: unknown }).name)) {
        setError("name", { message: t("workflows.settings.form.duplicate") });
        return;
      }
      setToast({ type: "error", title: t("common.error.label"), message: t("workflows.settings.error") });
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <DialogMain>
            <DialogHeader>
              <DialogHeading>
                <DialogTitle>{t("workflows.settings.form.create_title")}</DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-5">
                <Controller
                  control={control}
                  name="name"
                  rules={{ validate: (value) => (value.trim().length > 0 && value.trim().length <= 255) || " " }}
                  render={({ field: { value, onChange, ref } }) => (
                    <InputField
                      size="lg"
                      orientation="vertical"
                      id="workflow-name"
                      name="name"
                      type="text"
                      required
                      label={t("workflows.settings.form.name")}
                      value={value}
                      onChange={onChange}
                      ref={ref}
                      error={errors.name?.message?.trim() || undefined}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="description"
                  render={({ field: { value, onChange } }) => (
                    <TextAreaField
                      size="lg"
                      resize="none"
                      autoResize
                      maxRows={6}
                      id="workflow-description"
                      name="description"
                      label={t("workflows.settings.form.description")}
                      value={value ?? ""}
                      onChange={onChange}
                    />
                  )}
                />
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button
              variant="secondary"
              size="md"
              stretch="auto"
              onClick={onClose}
              label={t("workflows.settings.form.cancel")}
            />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isSubmitting}
              label={t("workflows.settings.form.submit")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
});
