/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import type { TStateGroups } from "@plane/types";
import { toneOf } from "./editor/graph-model";
import { TONE_CLASS } from "./editor/tones";

type Props = { name: string; group: TStateGroups };

/** A state as Jira draws it: upper-case name on its category colour (spec 3). */
export function StateLozenge({ name, group }: Props) {
  const { t } = useTranslation();
  return (
    <span
      title={t(`workflows.groups.${group}`)}
      className={`inline-block rounded-sm border px-1.5 py-0.5 text-caption-sm-medium font-bold whitespace-nowrap uppercase ${TONE_CLASS[toneOf(group)]}`}
    >
      {name}
    </span>
  );
}
