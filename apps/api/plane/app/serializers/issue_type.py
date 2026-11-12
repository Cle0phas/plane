# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import re

# Third party imports
from rest_framework import serializers

# Module imports
from plane.db.models import IssueType
from .base import BaseSerializer

LOGO_COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
LOGO_ICON_NAME_PATTERN = re.compile(r"^[a-z0-9_-]{1,64}$")
LOGO_EMOJI_PATTERN = re.compile(r"^[0-9]{1,7}(-[0-9]{1,7}){0,9}$")
DUPLICATE_NAME_MESSAGE = "A work item type with this name already exists."
INVALID_LOGO_PROPS_MESSAGE = "logo_props must be an emoji code or a named icon with hexadecimal colours."


def clean_logo_props(value):
    """Keep only the logo shape the web app writes, so no URL or markup is stored for other members."""
    if not isinstance(value, dict):
        raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
    if not value:
        return {}
    if set(value) - {"in_use", "emoji", "icon"}:
        raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
    if value.get("in_use") == "emoji":
        emoji = value.get("emoji")
        if (
            not isinstance(emoji, dict)
            or set(emoji) != {"value"}
            or not isinstance(emoji["value"], str)
            or not LOGO_EMOJI_PATTERN.match(emoji["value"])
        ):
            raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
        return {"in_use": "emoji", "emoji": {"value": emoji["value"]}}
    if value.get("in_use") == "icon":
        icon = value.get("icon")
        if not isinstance(icon, dict) or set(icon) - {"name", "color", "background_color"}:
            raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
        name = icon.get("name")
        if not isinstance(name, str) or not LOGO_ICON_NAME_PATTERN.match(name):
            raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
        cleaned = {"name": name}
        for key in ("color", "background_color"):
            if key in icon:
                if not isinstance(icon[key], str) or not LOGO_COLOR_PATTERN.match(icon[key]):
                    raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)
                cleaned[key] = icon[key]
        return {"in_use": "icon", "icon": cleaned}
    raise serializers.ValidationError(INVALID_LOGO_PROPS_MESSAGE)


class IssueTypeSerializer(BaseSerializer):
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, trim_whitespace=True)
    logo_props = serializers.JSONField(required=False)
    issue_count = serializers.IntegerField(read_only=True)
    project_default_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = IssueType
        fields = [
            "id",
            "name",
            "description",
            "logo_props",
            "is_active",
            "is_default",
            "issue_count",
            "project_default_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_default", "created_at", "updated_at"]

    def validate_name(self, value):
        duplicates = IssueType.objects.filter(workspace_id=self.context["workspace_id"], name__iexact=value)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(DUPLICATE_NAME_MESSAGE)
        return value

    def validate_logo_props(self, value):
        return clean_logo_props(value)
