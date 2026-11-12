# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from plane.app.permissions import ROLE
from plane.db.models import Workflow, WorkflowStatus, WorkspaceMember
from plane.db.models.workflow import (
    MAX_STATES_PER_WORKFLOW,
    MAX_TRANSITIONS_PER_WORKFLOW,
    RESERVED_STATUS_NAMES,
    RULE_RESTRICT_ACTORS,
    WORKFLOW_GROUPS,
)
from plane.utils.issue_types import StrictUUIDField
from .base import BaseSerializer

DUPLICATE_WORKFLOW_NAME_MESSAGE = "A workflow with this name already exists."
ROLE_VALUES = [ROLE.ADMIN.value, ROLE.MEMBER.value, ROLE.GUEST.value]


def graph_error(code):
    return serializers.ValidationError({"graph": [code]})


class WorkflowStatusSerializer(BaseSerializer):
    workflow_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = WorkflowStatus
        fields = ["id", "name", "color", "group", "group_is_auto", "sequence", "workflow_count"]
        read_only_fields = fields


class WorkflowSerializer(BaseSerializer):
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, trim_whitespace=True)

    class Meta:
        model = Workflow
        fields = ["id", "name", "description", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, value):
        duplicates = Workflow.objects.filter(workspace_id=self.context["workspace_id"], name__iexact=value)
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(DUPLICATE_WORKFLOW_NAME_MESSAGE)
        return value


class StrictBooleanField(serializers.Field):
    # JSON true or false only: "yes", 1 or "true" must not count (same rule as the type routes).
    def to_internal_value(self, data):
        if data is not True and data is not False:
            raise serializers.ValidationError("Must be true or false.")
        return data

    def to_representation(self, value):
        return value


class RestrictActorsParamsSerializer(serializers.Serializer):
    roles = serializers.ListField(child=serializers.ChoiceField(choices=ROLE_VALUES), required=False, max_length=3)
    user_ids = serializers.ListField(child=StrictUUIDField(), required=False, max_length=200)
    assignee = StrictBooleanField(required=False)
    creator = StrictBooleanField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise graph_error("invalid_rule")
        return super().to_internal_value(data)

    def validate(self, attrs):
        user_ids = list(dict.fromkeys(str(user_id) for user_id in attrs.get("user_ids", [])))
        if user_ids and WorkspaceMember.objects.filter(
            workspace_id=self.context["workspace_id"], member_id__in=user_ids, is_active=True
        ).count() != len(user_ids):
            raise graph_error("invalid_rule")
        params = {}
        if attrs.get("roles"):
            params["roles"] = sorted(set(attrs["roles"]))
        if user_ids:
            params["user_ids"] = user_ids
        for flag in ("assignee", "creator"):
            if attrs.get(flag) is True:
                params[flag] = True
        if not params:
            raise graph_error("invalid_rule")
        return params


class GraphRuleInputSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=[RULE_RESTRICT_ACTORS])
    params = serializers.JSONField()

    def validate(self, attrs):
        params = RestrictActorsParamsSerializer(data=attrs["params"], context=self.context)
        if not params.is_valid():
            raise graph_error("invalid_rule")
        return {"type": attrs["type"], "params": params.validated_data}


class GraphStatusInputSerializer(serializers.Serializer):
    id = StrictUUIDField(required=False)
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    color = serializers.RegexField(r"^#[0-9a-fA-F]{6}$")
    group = serializers.ChoiceField(choices=WORKFLOW_GROUPS, required=False, allow_null=True)


class GraphStateInputSerializer(serializers.Serializer):
    key = serializers.CharField(max_length=64)
    status = GraphStatusInputSerializer()
    position_x = serializers.FloatField(min_value=-1_000_000, max_value=1_000_000)
    position_y = serializers.FloatField(min_value=-1_000_000, max_value=1_000_000)
    is_initial = StrictBooleanField()


class GraphTransitionInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    from_any = StrictBooleanField()
    source_keys = serializers.ListField(
        child=serializers.CharField(max_length=64), required=False, default=list, max_length=MAX_STATES_PER_WORKFLOW
    )
    target_key = serializers.CharField(max_length=64)
    rules = serializers.ListField(child=GraphRuleInputSerializer(), required=False, default=list, max_length=1)


class WorkflowGraphInputSerializer(serializers.Serializer):
    states = serializers.ListField(child=GraphStateInputSerializer(), max_length=MAX_STATES_PER_WORKFLOW)
    transitions = serializers.ListField(
        child=GraphTransitionInputSerializer(), max_length=MAX_TRANSITIONS_PER_WORKFLOW
    )

    def validate(self, attrs):
        states = attrs["states"]
        keys = [state["key"] for state in states]
        if len(set(keys)) != len(keys):
            raise graph_error("duplicate_state_key")
        names = [state["status"]["name"].lower() for state in states]
        if any(name in RESERVED_STATUS_NAMES for name in names):
            raise graph_error("reserved_status_name")
        status_ids = [state["status"]["id"] for state in states if "id" in state["status"]]
        if len(set(status_ids)) != len(status_ids):
            raise graph_error("duplicate_status")
        if len(set(names)) != len(names):
            raise graph_error("duplicate_status_name")
        if states and sum(1 for state in states if state["is_initial"]) != 1:
            raise graph_error("initial_state_required")
        for transition in attrs["transitions"]:
            sources = transition["source_keys"]
            if (
                transition["target_key"] not in keys
                or any(source not in keys for source in sources)
                or len(set(sources)) != len(sources)
                or transition["target_key"] in sources
                or transition["from_any"] == bool(sources)
            ):
                raise graph_error("invalid_transition")
        return attrs
