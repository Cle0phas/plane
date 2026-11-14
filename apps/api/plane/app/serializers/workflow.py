# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import math

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
    TRANSITION_SIDES,
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
    workflows = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowStatus
        fields = ["id", "name", "color", "group", "group_is_auto", "sequence", "workflow_count", "workflows"]
        read_only_fields = fields

    def get_workflows(self, obj):
        # Read from the prefetch of the view: one query for every status.
        return [{"id": str(state.workflow_id), "name": state.workflow.name} for state in obj.workflow_states.all()]


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


class CoordinateField(serializers.Field):
    # Finite JSON numbers only: no strings, booleans, NaN or infinities.
    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, (int, float)) or not math.isfinite(data):
            raise serializers.ValidationError("Must be a finite number.")
        if abs(data) > 1_000_000:
            raise serializers.ValidationError("Out of range.")
        return float(data)

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
    position_x = CoordinateField()
    position_y = CoordinateField()
    is_initial = StrictBooleanField()


class GraphTransitionInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    from_any = StrictBooleanField()
    source_keys = serializers.ListField(
        child=serializers.CharField(max_length=64), required=False, default=list, max_length=MAX_STATES_PER_WORKFLOW
    )
    target_key = serializers.CharField(max_length=64)
    # Rules are validated in WorkflowGraphInputSerializer.validate so their errors surface under `graph`.
    rules = serializers.ListField(child=serializers.JSONField(), required=False, default=list, max_length=1)
    # Validated in WorkflowGraphInputSerializer.validate, next to the sources it refers to.
    sides = serializers.DictField(child=serializers.JSONField(), required=False, default=dict)


class WorkflowGraphInputSerializer(serializers.Serializer):
    states = serializers.ListField(child=GraphStateInputSerializer(), max_length=MAX_STATES_PER_WORKFLOW)
    transitions = serializers.ListField(child=GraphTransitionInputSerializer(), max_length=MAX_TRANSITIONS_PER_WORKFLOW)

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
            rules = []
            for rule in transition["rules"]:
                rule_serializer = GraphRuleInputSerializer(data=rule, context=self.context)
                if not rule_serializer.is_valid():
                    raise graph_error("invalid_rule")
                rules.append(rule_serializer.validated_data)
            transition["rules"] = rules
            sources = transition["source_keys"]
            if (
                transition["target_key"] not in keys
                or any(source not in keys for source in sources)
                or len(set(sources)) != len(sources)
                or transition["target_key"] in sources
                or transition["from_any"] == bool(sources)
            ):
                raise graph_error("invalid_transition")
            sides = {}
            for key, value in transition["sides"].items():
                if (
                    key not in sources
                    or not isinstance(value, dict)
                    or set(value) != {"source", "target"}
                    or value["source"] not in TRANSITION_SIDES
                    or value["target"] not in TRANSITION_SIDES
                ):
                    raise graph_error("invalid_transition")
                sides[key] = {"source": value["source"], "target": value["target"]}
            transition["sides"] = sides
        return attrs


class SchemeItemInputSerializer(serializers.Serializer):
    issue_type_id = StrictUUIDField()
    workflow_id = StrictUUIDField()


class SchemeMappingInputSerializer(serializers.Serializer):
    state_id = StrictUUIDField()
    workflow_id = StrictUUIDField()
    status_id = StrictUUIDField()


class ProjectWorkflowSchemeInputSerializer(serializers.Serializer):
    default_workflow_id = StrictUUIDField()
    items = serializers.ListField(child=SchemeItemInputSerializer(), required=False, default=list, max_length=200)
    mappings = serializers.ListField(
        child=SchemeMappingInputSerializer(), required=False, default=list, max_length=MAX_STATES_PER_WORKFLOW * 5
    )

    def validate_items(self, items):
        type_ids = [item["issue_type_id"] for item in items]
        if len(set(type_ids)) != len(type_ids):
            raise serializers.ValidationError("Each work item type appears once.")
        return items

    def validate_mappings(self, mappings):
        keys = [(mapping["state_id"], mapping["workflow_id"]) for mapping in mappings]
        if len(set(keys)) != len(keys):
            raise serializers.ValidationError("Each state and workflow pair appears once.")
        return mappings
