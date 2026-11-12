/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
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
import { EmojiPicker } from "@plane/blocks/emoji-icon-picker";
import type { ChangeHandlerPayload } from "@plane/blocks/emoji-icon-picker";
import { setToast } from "@plane/blocks/toast";
import { useTranslation } from "@plane/i18n";
import type { TIssueType, TIssueTypeFormData } from "@plane/types";
// components
import { getApiErrorMessage, getApiFieldError } from "@/components/work-item-types/helpers";
import { WorkItemTypeIcon } from "@/components/work-item-types/work-item-type-icon";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

type TWorkItemTypeFormModalProps = {
  workspaceSlug: string;
  isOpen: boolean;
  workItemType?: TIssueType;
  onClose: () => void;
};

const EMPTY_FORM: TIssueTypeFormData = {
  name: "",
  description: "",
  logo_props: { in_use: "icon", icon: { name: "check_box", color: "#6d7b8a" } },
};

export const WorkItemTypeFormModal = observer(function WorkItemTypeFormModal(props: TWorkItemTypeFormModalProps) {
  const { workspaceSlug, isOpen, workItemType, onClose } = props;
  const [isLogoPickerOpen, setIsLogoPickerOpen] = useState(false);
  const { t } = useTranslation();
  const { createType, updateType } = useWorkItemType();
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TIssueTypeFormData>({ defaultValues: EMPTY_FORM });

  useEffect(() => {
    if (!isOpen) return;
    reset(
      workItemType
        ? { name: workItemType.name, description: workItemType.description, logo_props: workItemType.logo_props }
        : EMPTY_FORM
    );
  }, [isOpen, workItemType, reset]);

  const toastKey = workItemType ? "update" : "create";

  const onSubmit = async (formData: TIssueTypeFormData) => {
    const payload = { ...formData, name: formData.name.trim(), description: formData.description.trim() };
    try {
      if (workItemType) await updateType(workspaceSlug, workItemType.id, payload);
      else await createType(workspaceSlug, payload);
      setToast({
        type: "success",
        title: t(`work_item_types.${toastKey}.toast.success.title`),
        message: t(`work_item_types.${toastKey}.toast.success.message`, { name: payload.name }),
      });
      onClose();
    } catch (error) {
      for (const field of ["name", "description"] as const) {
        const message = getApiFieldError(error, field);
        if (message) setError(field, { message });
      }
      setToast({
        type: "error",
        title: t(`work_item_types.${toastKey}.toast.error.title`),
        message: getApiErrorMessage(error) ?? t(`work_item_types.${toastKey}.toast.error.message.default`),
      });
    }
  };

  const handleLogoChange = (
    selection: ChangeHandlerPayload,
    onChange: (value: TIssueTypeFormData["logo_props"]) => void
  ) => {
    onChange(
      selection.type === "emoji"
        ? { in_use: "emoji", emoji: { value: selection.value } }
        : { in_use: "icon", icon: selection.value }
    );
    setIsLogoPickerOpen(false);
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
                <DialogTitle>
                  {workItemType ? t("work_item_types.update.title") : t("work_item_types.create.title")}
                </DialogTitle>
              </DialogHeading>
            </DialogHeader>
            <DialogBody tabIndex={0}>
              <div className="space-y-5">
                <Controller
                  control={control}
                  name="logo_props"
                  render={({ field: { value, onChange } }) => (
                    <div className="flex flex-col gap-1">
                      <span className="text-body-xs-medium text-secondary">
                        {t("work_item_types.create_update.form.icon.label")}
                      </span>
                      <EmojiPicker
                        iconType="material"
                        isOpen={isLogoPickerOpen}
                        handleToggle={setIsLogoPickerOpen}
                        label={
                          <span className="grid size-9 place-items-center rounded-md border border-subtle bg-layer-2">
                            <WorkItemTypeIcon
                              workItemType={{
                                name: t("work_item_types.create_update.form.icon.label"),
                                logo_props: value,
                              }}
                              size={20}
                            />
                          </span>
                        }
                        onChange={(selection) => handleLogoChange(selection, onChange)}
                        defaultIconColor={value.in_use === "icon" ? value.icon?.color : undefined}
                        defaultOpen={value.in_use === "emoji" ? "emoji" : "icon"}
                      />
                    </div>
                  )}
                />
                <Controller
                  control={control}
                  name="name"
                  rules={{
                    validate: (value) =>
                      value.trim().length > 0 || t("work_item_types.create_update.form.name.required"),
                    maxLength: { value: 255, message: t("work_item_types.create_update.form.name.max_length") },
                  }}
                  render={({ field: { value, onChange, ref } }) => (
                    <InputField
                      size="lg"
                      orientation="vertical"
                      id="work-item-type-name"
                      name="name"
                      type="text"
                      required
                      label={t("work_item_types.create_update.form.name.label")}
                      placeholder={t("work_item_types.create_update.form.name.placeholder")}
                      value={value}
                      onChange={onChange}
                      ref={ref}
                      error={errors.name?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="description"
                  rules={{
                    maxLength: { value: 1000, message: t("work_item_types.create_update.form.description.max_length") },
                  }}
                  render={({ field: { value, onChange } }) => (
                    <TextAreaField
                      size="lg"
                      resize="none"
                      autoResize
                      maxRows={6}
                      id="work-item-type-description"
                      name="description"
                      label={t("work_item_types.create_update.form.description.label")}
                      placeholder={t("work_item_types.create_update.form.description.placeholder")}
                      value={value}
                      onChange={onChange}
                      error={errors.description?.message}
                    />
                  )}
                />
              </div>
            </DialogBody>
          </DialogMain>
          <DialogActions>
            <Button variant="secondary" size="md" stretch="auto" onClick={onClose} label={t("cancel")} />
            <Button
              variant="primary"
              size="md"
              stretch="auto"
              type="submit"
              loading={isSubmitting}
              label={workItemType ? t("work_item_types.update.button") : t("work_item_types.create.button")}
            />
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
});
