/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";

export type TStateNodeData = {
  name: string;
  color: string;
  group: TStateGroups | null;
  isInitial: boolean;
  hasGlobalTransition: boolean;
};
export type TStateNode = Node<TStateNodeData, "workflowState">;

export function WorkflowStateNode({ data, selected }: NodeProps<TStateNode>) {
  const { t } = useTranslation();
  const globalLabel = data.hasGlobalTransition ? t("workflows.editor.global") : undefined;
  return (
    <div
      className={`min-w-40 rounded-md border-2 bg-layer-1 px-3 py-2 ${selected ? "ring-2 ring-accent-strong" : ""}`}
      style={{ borderColor: data.color }}
    >
      <Handle type="target" position={Position.Top} />
      {data.isInitial && (
        <span className="mb-1 inline-block rounded-sm bg-accent-primary px-1 text-caption-sm-medium text-on-color">
          {t("workflows.editor.start")}
        </span>
      )}
      <div className="text-body-sm-medium text-primary">{data.name}</div>
      <div className="text-caption-sm-regular text-tertiary">
        {data.group ? t(`workflows.groups.${data.group}`) : t("workflows.editor.add_state.group_auto")}
      </div>
      {globalLabel && (
        <div className="mt-1 text-caption-sm-regular text-secondary" title={globalLabel}>
          {globalLabel}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
